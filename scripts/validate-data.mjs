/**
 * Periksa dataset hasil rakitan sebelum dipakai.
 *
 * Pemeriksaan ini mencari hal-hal yang membuat angka di aplikasi menyesatkan:
 * wilayah tanpa geometri, fasilitas di luar semua wilayah, luas yang tidak
 * wajar, hubungan kelurahan–kecamatan yang putus, dan angka penduduk yang
 * berada di luar rentang masuk akal.
 *
 * Skrip mengembalikan kode keluar 1 bila menemukan masalah berat, sehingga
 * dapat dipakai sebagai gerbang pada alur kerja otomatis.
 */

import { paths, readJson, exists, heading, info, warn, fail } from './lib/io.mjs';
import { pointInGeometry, geometryAreaKm2 } from './lib/geo.mjs';

const LEVELS = ['kecamatan', 'kelurahan'];

async function main() {
  heading('Pemeriksaan dataset');

  const files = {
    kecamatan: `${paths.processed}/kecamatan.geojson`,
    kelurahan: `${paths.processed}/kelurahan.geojson`,
    fasilitas: `${paths.processed}/fasilitas.geojson`,
  };

  for (const [name, file] of Object.entries(files)) {
    if (!(await exists(file))) {
      fail(
        [
          `Berkas ${name} belum ada: ${file}`,
          '',
          'Rakit dataset lebih dahulu: npm run data:build',
        ].join('\n'),
      );
      process.exitCode = 1;
      return;
    }
  }

  const kecamatan = await readJson(files.kecamatan);
  const kelurahan = await readJson(files.kelurahan);
  const fasilitas = await readJson(files.fasilitas);

  const errors = [];
  const warnings = [];

  // --- 1. Wilayah ---------------------------------------------------------
  const regionIds = new Set();
  const regions = [];

  for (const collection of [kecamatan, kelurahan]) {
    for (const feature of collection.features) {
      const props = feature.properties;

      if (!props?.id) {
        errors.push('Ada wilayah tanpa id.');
        continue;
      }
      if (regionIds.has(props.id)) {
        errors.push(`ID wilayah kembar: ${props.id}`);
        continue;
      }
      regionIds.add(props.id);
      regions.push(props);

      if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
        errors.push(`Wilayah ${props.name} tidak punya geometri poligon.`);
        continue;
      }

      const area = geometryAreaKm2(feature.geometry);
      if (!Number.isFinite(area) || area <= 0) {
        errors.push(`Wilayah ${props.name} memiliki luas nol atau tidak sah.`);
      } else if (props.level === 'kecamatan' && (area < 1 || area > 60)) {
        warnings.push(
          `Kecamatan ${props.name} memiliki luas ${area.toFixed(2)} km² — di luar rentang wajar untuk Surabaya.`,
        );
      } else if (props.level === 'kelurahan' && area > 25) {
        warnings.push(`Kelurahan ${props.name} memiliki luas ${area.toFixed(2)} km² — terasa terlalu besar.`);
      }

      // Titik representatif harus benar-benar berada di dalam wilayah; kalau
      // tidak, semua perhitungan jarak dari wilayah itu akan salah.
      const centroid = { lat: props.centroid_lat, lon: props.centroid_lon };
      if (!Number.isFinite(centroid.lat) || !Number.isFinite(centroid.lon)) {
        errors.push(`Wilayah ${props.name} tidak punya titik representatif.`);
      } else if (!pointInGeometry(centroid, feature.geometry)) {
        errors.push(
          `Titik representatif ${props.name} (${centroid.lat}, ${centroid.lon}) berada DI LUAR wilayahnya.`,
        );
      }
    }
  }

  info(`Wilayah diperiksa: ${regions.length}`);

  // --- 2. Hubungan kelurahan → kecamatan ----------------------------------
  const kecamatanIds = new Set(regions.filter((r) => r.level === 'kecamatan').map((r) => r.id));
  const orphans = regions.filter(
    (r) => r.level === 'kelurahan' && (!r.parent_id || !kecamatanIds.has(r.parent_id)),
  );
  if (orphans.length > 0) {
    errors.push(
      `${orphans.length} kelurahan tidak memiliki kecamatan induk yang sah: ${orphans
        .slice(0, 5)
        .map((r) => r.name)
        .join(', ')}${orphans.length > 5 ? ', …' : ''}`,
    );
  } else {
    info('Semua kelurahan memiliki kecamatan induk yang sah.');
  }

  // --- 3. Fasilitas -------------------------------------------------------
  const facilities = fasilitas.features.map((f) => f.properties);
  info(`Fasilitas diperiksa: ${facilities.length}`);

  let outside = 0;
  let unassigned = 0;
  const kindCounts = {};

  // Pencarian pemilik wilayah dilakukan lewat indeks, bukan pencarian linear
  // pada setiap fasilitas. Dataset Surabaya masih kecil, tetapi indeks ini juga
  // memastikan fitur yang sudah ditolak karena ID kembar tidak ikut tercari.
  const featuresById = new Map();
  for (const collection of [kecamatan, kelurahan]) {
    for (const feature of collection.features) {
      const id = feature.properties?.id;
      if (id && !featuresById.has(id)) featuresById.set(id, feature);
    }
  }

  for (const feature of fasilitas.features) {
    const props = feature.properties;
    const [lon, lat] = feature.geometry?.coordinates ?? [];

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      errors.push(`Fasilitas ${props.name} tidak punya koordinat yang sah.`);
      continue;
    }

    kindCounts[props.kind] = (kindCounts[props.kind] ?? 0) + 1;

    if (!props.region_id || !regionIds.has(props.region_id)) unassigned += 1;

    // Periksa silang: apakah titik benar-benar berada di dalam wilayah yang
    // diklaim? Ketidakcocokan menandakan pemetaan wilayah bermasalah.
    const owner = props.region_id ? featuresById.get(props.region_id) : null;
    if (owner && !pointInGeometry({ lat, lon }, owner.geometry)) {
      outside += 1;
    }
  }

  if (unassigned > 0) {
    warnings.push(
      `${unassigned} fasilitas tidak terpetakan ke wilayah mana pun (biasanya berada di luar batas atau tepat di perbatasan).`,
    );
  }
  if (outside > 0) {
    errors.push(
      `${outside} fasilitas tercatat di dalam sebuah wilayah padahal koordinatnya berada di luar wilayah itu.`,
    );
  }

  const kindSummary = Object.entries(kindCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${kind}=${count}`)
    .join(', ');
  info(`Sebaran jenis: ${kindSummary || '(kosong)'}`);

  // --- 4. Angka penduduk --------------------------------------------------
  const withPopulation = regions.filter((r) => Number.isFinite(r.population));
  info(`Wilayah dengan angka penduduk: ${withPopulation.length} dari ${regions.length}`);

  for (const region of withPopulation) {
    if (region.population < 0) {
      errors.push(`Wilayah ${region.name} memiliki angka penduduk negatif.`);
    } else if (region.population > 200000) {
      warnings.push(
        `Wilayah ${region.name} memiliki ${region.population.toLocaleString('id-ID')} penduduk — periksa apakah ini kelurahan atau kecamatan.`,
      );
    }
    if (Number.isFinite(region.area_km2) && region.area_km2 > 0) {
      const density = region.population / region.area_km2;
      if (density > 80000) {
        warnings.push(
          `Kepadatan ${region.name} mencapai ${Math.round(density).toLocaleString('id-ID')} jiwa/km² — sangat tinggi; periksa satuan luas.`,
        );
      }
    }
  }

  // Jumlah penduduk kota dijumlahkan dari kecamatan sebagai pemeriksaan kasar.
  const kecamatanWithPopulation = regions.filter(
    (r) => r.level === 'kecamatan' && Number.isFinite(r.population),
  );
  if (kecamatanWithPopulation.length > 0) {
    const total = kecamatanWithPopulation.reduce((acc, r) => acc + r.population, 0);
    info(
      `Total penduduk dari ${kecamatanWithPopulation.length} kecamatan: ${total.toLocaleString('id-ID')} jiwa`,
    );
    if (kecamatanWithPopulation.length === kecamatanIds.size) {
      if (total < 2000000 || total > 4500000) {
        warnings.push(
          `Total penduduk kota ${total.toLocaleString('id-ID')} jiwa berada di luar rentang wajar Surabaya (sekitar 2,8–3,2 juta). Periksa apakah kolom yang dibaca adalah jumlah penduduk, bukan jumlah KK.`,
        );
      }
    }
  }

  // --- 5. Metadata -------------------------------------------------------
  if (!(await exists(paths.metadata))) {
    errors.push('Metadata dataset belum ada: data/metadata.json');
  }

  // --- Hasil -------------------------------------------------------------
  console.log('');
  if (warnings.length > 0) {
    warn(`${warnings.length} peringatan:`);
    for (const message of warnings) info(`- ${message}`);
  } else {
    info('Tidak ada peringatan.');
  }

  if (errors.length > 0) {
    console.log('');
    fail(`${errors.length} masalah berat:`);
    for (const message of errors) console.error(`  - ${message}`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  info('Pemeriksaan selesai tanpa masalah berat.');
  LEVELS.forEach((level) => {
    const count = regions.filter((r) => r.level === level).length;
    info(`  ${level}: ${count} wilayah`);
  });
}

main().catch((error) => {
  fail(`Galat tak terduga: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});