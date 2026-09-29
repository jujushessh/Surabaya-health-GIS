/**
 * Rakit dataset akhir dari berkas mentah.
 *
 * Langkah yang dikerjakan:
 * 1. Baca batas wilayah, fasilitas, dan angka penduduk (bila ada).
 * 2. Tentukan kecamatan induk setiap kelurahan lewat uji ruang, bukan tag.
 * 3. Petakan setiap fasilitas ke wilayah: kelurahan lebih dahulu, lalu jatuh
 *    ke kecamatan bila titiknya tidak masuk kelurahan mana pun (bisa terjadi
 *    karena perbedaan batas atau titik tepat di perbatasan).
 * 4. Hitung luas dari poligon, titik representatif, dan kotak pembatas.
 * 5. Catat kualitas data: fasilitas tanpa nama, di luar batas, atau tak
 *    terpetakan; wilayah tanpa angka penduduk.
 * 6. Tulis data/processed/ dan data/metadata.json.
 *
 * Angka penduduk tidak pernah dikarang. Bila belum ada, kolomnya `null` dan
 * kualitas data mencatat berapa wilayah yang belum terisi.
 */

import { paths, writeJson, readJson, exists, todayIso, heading, info, warn, fail } from './lib/io.mjs';
import { pointInGeometry, pointOnSurface, geometryBBox, geometryAreaKm2, round6 } from './lib/geo.mjs';
import { CITY_NAME, CITY_BBOX } from './lib/constants.mjs';
import { DATA_SCHEMA_VERSION } from './lib/schema.mjs';

/** Normalisasi nama untuk pencocokan silang antarberkas. */
function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\b(kecamatan|kelurahan|kec|kel)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Pastikan setiap ID wilayah unik.
 *
 * Dua wilayah boleh punya nama sama (memang ada di Surabaya: kelurahan
 * "Wonorejo" di Kecamatan Rungkut dan di Kecamatan Tegalsari). ID yang kembar
 * akan membuat validasi menolak dataset dan, lebih berbahaya, membuat
 * pencarian wilayah berdasarkan ID mengambil poligon yang salah.
 *
 * Nama kembar dibedakan dengan id OSM-nya — nilai yang stabil dan benar-benar
 * unik, bukan nomor urut yang berubah ketika data sumber ditambah.
 */
function resolveDuplicateIds(kecamatan, kelurahan) {
  const notes = [];

  // 1. Kecamatan lebih dahulu. Nama kembar di sini dibedakan apa adanya.
  const used = new Set();
  const kecamatanByName = new Map();
  for (const region of kecamatan) {
    let id = region.id;
    if (used.has(id)) {
      id = region.osmId ? `${region.id}-${region.osmId}` : `${id}-2`;
      notes.push(`kecamatan ${region.name}: ID kembar, dibedakan menjadi ${id}`);
    }
    region.id = id;
    used.add(id);
    kecamatanByName.set(region.name, region);
  }

  // 2. Kelurahan. Nama kembar dibedakan dengan id OSM; bila id OSM tidak ada,
  //    dipakai nama kecamatan induk sebagai pembeda yang bermakna.
  for (const region of kelurahan) {
    if (!used.has(region.id)) {
      used.add(region.id);
      continue;
    }

    const kecamatanName = kecamatanByName.get(region.parentName)?.name ?? null;
    const suffix = kecamatanName
      ? normalizeName(kecamatanName)
      : region.osmId
        ? String(region.osmId)
        : '2';

    let id = `${region.id}-${suffix}`;
    let counter = 2;
    while (used.has(id)) {
      id = `${region.id}-${suffix}-${counter}`;
      counter += 1;
    }

    notes.push(
      `kelurahan ${region.name}: ID kembar, dibedakan menjadi ${id}` +
        (kecamatanName ? ` (induk ${kecamatanName})` : ''),
    );
    region.id = id;
    used.add(id);
  }

  return notes;
}

/**
 * Tentukan kecamatan induk setiap kelurahan.
 *
 * Tag parent di OpenStreetMap sering kosong atau salah, jadi hubungan ini
 * ditentukan dari uji ruang: titik representatif kelurahan diuji terhadap
 * setiap poligon kecamatan. Cara ini lebih dapat dipercaya dan dapat
 * diperiksa ulang.
 */
function linkKelurahanToKecamatan(kecamatan, kelurahan) {
  const notes = [];

  for (const child of kelurahan) {
    const inside = kecamatan.filter((parent) => pointInGeometry(child.centroid, parent.geometry));

    if (inside.length === 0) {
      // Tidak ada kecamatan yang memuat: ambil yang paling dekat berdasarkan
      // jarak titik representatif, dan catat sebagai anomali.
      let nearest = null;
      let nearestDistance = Infinity;
      for (const parent of kecamatan) {
        const dLat = parent.centroid.lat - child.centroid.lat;
        const dLon = (parent.centroid.lon - child.centroid.lon) * Math.cos((child.centroid.lat * Math.PI) / 180);
        const distance = dLat * dLat + dLon * dLon;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = parent;
        }
      }
      child.parentId = nearest ? nearest.id : null;
      child.parentName = nearest ? nearest.name : null;
      child.notes.push(
        'Titik representatif tidak berada di dalam kecamatan mana pun; induk ditentukan dari kecamatan terdekat.',
      );
      notes.push(`kelurahan ${child.name}: induk ditentukan dari jarak, bukan uji ruang`);
      continue;
    }

    if (inside.length > 1) {
      // Tumpang tindih batas: pilih yang paling kecil luasnya (biasanya yang
      // lebih spesifik) dan catat agar bisa diperiksa.
      inside.sort((a, b) => (a.areaKm2 ?? Infinity) - (b.areaKm2 ?? Infinity));
      child.parentId = inside[0].id;
      child.parentName = inside[0].name;
      child.notes.push(
        `Titik representatif berada di ${inside.length} kecamatan sekaligus (batas bertumpang tindih); dipilih yang terkecil luasnya.`,
      );
      notes.push(`kelurahan ${child.name}: batas bertumpang tindih dengan ${inside.length} kecamatan`);
      continue;
    }

    child.parentId = inside[0].id;
    child.parentName = inside[0].name;
  }

  return notes;
}

/**
 * Petakan fasilitas ke wilayah.
 *
 * Urutan pencarian: kelurahan dulu (lebih rinci), lalu kecamatan. Fasilitas
 * yang tidak masuk wilayah mana pun tetap disimpan di dataset — dibuang akan
 * membuat jumlah total tidak dapat direkonsiliasi — tetapi ditandai agar
 * antarmuka dapat menampilkannya sebagai catatan kualitas.
 */
function assignFacilities(facilities, kelurahan, kecamatan) {
  let assigned = 0;
  let toKecamatan = 0;
  let unassigned = 0;
  let outsideBoundary = 0;

  for (const facility of facilities) {
    const point = { lat: facility.lat, lon: facility.lon };

    // Uji cepat kotak pembatas sebelum uji poligon yang lebih mahal.
    const inCity =
      facility.lat >= CITY_BBOX.minLat &&
      facility.lat <= CITY_BBOX.maxLat &&
      facility.lon >= CITY_BBOX.minLon &&
      facility.lon <= CITY_BBOX.maxLon;

    const parent = kelurahan.find((region) => pointInGeometry(point, region.geometry));
    if (parent) {
      facility.regionId = parent.id;
      facility.regionName = parent.name;
      assigned += 1;
      continue;
    }

    const kec = kecamatan.find((region) => pointInGeometry(point, region.geometry));
    if (kec) {
      facility.regionId = kec.id;
      facility.regionName = kec.name;
      toKecamatan += 1;
      continue;
    }

    facility.regionId = null;
    facility.regionName = null;
    unassigned += 1;
    if (!inCity) outsideBoundary += 1;
  }

  return { assigned, toKecamatan, unassigned, outsideBoundary };
}

async function main() {
  heading('Langkah 4/4 — Merakit dataset akhir');

  // --- Batas wilayah ------------------------------------------------------
  const boundariesFile = `${paths.raw}/boundaries-osm.geojson`;
  if (!(await exists(boundariesFile))) {
    fail(
      [
        'Berkas batas wilayah belum ada, sehingga dataset tidak dapat dirakit.',
        '',
        'Jalankan lebih dahulu: npm run data:boundaries',
        'Atau impor GeoJSON batas wilayah lewat halaman Data pada aplikasi.',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const boundaryCollection = await readJson(boundariesFile);
  info(`Berkas batas: ${boundaryCollection.features.length} fitur`);

  const buildRegions = (level) =>
    boundaryCollection.features
      .filter((feature) => feature.properties.level === level)
      .map((feature) => {
        const geometry = feature.geometry;
        const areaKm2 = geometryAreaKm2(geometry);
        const centroid = pointOnSurface(geometry);

        return {
          id: `${level}-${normalizeName(feature.properties.name)}`,
          osmId: feature.properties.osm_id ?? null,
          name: feature.properties.name,
          level,
          parentId: null,
          parentName: null,
          population: null,
          populationYear: null,
          areaKm2: round6(areaKm2),
          areaOfficialKm2: null,
          areaSourceKm2: feature.properties.area_km2_calculated ?? null,
          centroid: { lat: round6(centroid.lat), lon: round6(centroid.lon) },
          bbox: {
            minLat: round6(feature.bbox?.[1] ?? geometryBBox(geometry).minLat),
            minLon: round6(feature.bbox?.[0] ?? geometryBBox(geometry).minLon),
            maxLat: round6(feature.bbox?.[3] ?? geometryBBox(geometry).maxLat),
            maxLon: round6(feature.bbox?.[2] ?? geometryBBox(geometry).maxLon),
          },
          geometry,
          notes: [],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));

  const kecamatan = buildRegions('kecamatan');
  const kelurahan = buildRegions('kelurahan');

  // Nama wilayah tidak selalu unik: di Kota Surabaya ada dua kelurahan bernama
  // "Wonorejo" (di Kecamatan Rungkut dan Tegalsari). ID harus unik, jadi nama
  // kembar dibedakan dengan id OSM-nya. Dijadwalkan SETELAH kecamatan dirakit
  // supaya kecamatan yang perlu jadi pembeda sudah tersedia.
  const numbering = resolveDuplicateIds(kecamatan, kelurahan);

  info(`Kecamatan: ${kecamatan.length}`);
  info(`Kelurahan: ${kelurahan.length}`);
  for (const note of numbering) warn(note);

  if (kecamatan.length === 0) {
    fail('Tidak ada kecamatan pada berkas batas. Dataset tidak dapat dirakit.');
    process.exitCode = 1;
    return;
  }

  // --- Angka penduduk ----------------------------------------------------
  const populationStatusFile = `${paths.raw}/population-status.json`;
  let populationRows = [];

  if (await exists(populationStatusFile)) {
    const status = await readJson(populationStatusFile);
    populationRows = status.rows ?? [];
  }

  // Angka penduduk dapat juga datang dari berkas hasil impor pengguna.
  const populationOverrideFile = `${paths.raw}/population-values.json`;
  if (await exists(populationOverrideFile)) {
    const override = await readJson(populationOverrideFile);
    populationRows = override.rows ?? populationRows;
    info(`Angka penduduk dari berkas override: ${populationRows.length} baris`);
  }

  const regionByName = new Map();
  for (const region of [...kecamatan, ...kelurahan]) {
    regionByName.set(`${region.level}:${normalizeName(region.name)}`, region);
  }

  let populationApplied = 0;
  for (const row of populationRows) {
    const key = `${row.level ?? 'kecamatan'}:${normalizeName(row.wilayah ?? row.name)}`;
    const region = regionByName.get(key);
    if (!region) continue;
    if (!Number.isFinite(row.penduduk)) continue;

    region.population = row.penduduk;
    region.populationYear = Number.isFinite(row.tahun) ? row.tahun : null;
    region.areaOfficialKm2 = Number.isFinite(row.luas_km2) ? row.luas_km2 : null;
    populationApplied += 1;
  }

  info(`Angka penduduk terpasang: ${populationApplied} wilayah`);

  // --- Hubungan kelurahan → kecamatan ------------------------------------
  const linkNotes = linkKelurahanToKecamatan(kecamatan, kelurahan);
  const linked = kelurahan.filter((child) => child.parentId !== null).length;
  info(`Kelurahan terhubung ke kecamatan: ${linked} dari ${kelurahan.length}`);
  for (const note of linkNotes.slice(0, 5)) warn(note);
  if (linkNotes.length > 5) warn(`… dan ${linkNotes.length - 5} catatan lain`);

  // --- Fasilitas ---------------------------------------------------------
  const facilitiesFile = `${paths.raw}/osm-facilities.json`;
  let facilities = [];
  let facilitySource = 'tidak ada';

  if (await exists(facilitiesFile)) {
    const raw = await readJson(facilitiesFile);
    facilities = raw.facilities ?? [];
    facilitySource = raw.source ?? 'OpenStreetMap via Overpass API';
    info(`Fasilitas mentah: ${facilities.length}`);
  } else {
    warn('Berkas fasilitas belum ada; dataset akan berisi fasilitas kosong.');
    warn('Jalankan: npm run data:facilities');
  }

  const assignment = assignFacilities(facilities, kelurahan, kecamatan);
  info(`Fasilitas di dalam kelurahan: ${assignment.assigned}`);
  info(`Fasilitas hanya masuk level kecamatan: ${assignment.toKecamatan}`);
  if (assignment.unassigned > 0) {
    warn(`Fasilitas tidak terpetakan ke wilayah mana pun: ${assignment.unassigned}`);
  }
  if (assignment.outsideBoundary > 0) {
    warn(`Di antaranya di luar kotak pembatas kota: ${assignment.outsideBoundary}`);
  }

  const finalFacilities = facilities.map((facility) => ({
    id: facility.id,
    name: facility.name,
    kind: facility.kind,
    lat: facility.lat,
    lon: facility.lon,
    address: facility.address ?? null,
    phone: facility.phone ?? null,
    operator: facility.operator ?? null,
    beds: facility.beds ?? null,
    source: facility.source ?? 'osm',
    osmId: facility.osmId ?? null,
    regionId: facility.regionId,
    regionName: facility.regionName,
  }));

  // --- Kualitas data -----------------------------------------------------
  const withoutName = finalFacilities.filter((f) => !f.name || f.name === '(tanpa nama)').length;
  const regionsWithPopulation = [...kecamatan, ...kelurahan].filter(
    (region) => region.population !== null,
  ).length;

  // Periksa luas: poligon dihitung ulang vs luas yang dilaporkan sumber.
  let areaMismatch = 0;
  for (const region of [...kecamatan, ...kelurahan]) {
    if (!region.areaSourceKm2 || !region.areaKm2) continue;
    const difference = Math.abs(region.areaKm2 - region.areaSourceKm2) / region.areaSourceKm2;
    if (difference > 0.05) {
      areaMismatch += 1;
      region.notes.push(
        `Luas hitung ulang (${region.areaKm2.toFixed(2)} km²) berbeda ${(difference * 100).toFixed(1)}% dari luas saat pengambilan data (${region.areaSourceKm2.toFixed(2)} km²).`,
      );
    }
  }

  const quality = {
    facilitiesTotal: finalFacilities.length,
    facilitiesWithoutName: withoutName,
    facilitiesOutsideBoundary: assignment.outsideBoundary,
    facilitiesUnassignedToKelurahan: assignment.unassigned,
    regionsWithPopulation,
    regionsTotal: kecamatan.length + kelurahan.length,
    regionsWithAreaMismatch: areaMismatch,
  };

  // --- Berkas keluaran ---------------------------------------------------
  const generatedAt = new Date().toISOString();

  const toFeature = (region) => ({
    type: 'Feature',
    id: region.id,
    properties: {
      id: region.id,
      name: region.name,
      level: region.level,
      parent_id: region.parentId,
      parent_name: region.parentName,
      population: region.population,
      population_year: region.populationYear,
      area_km2: region.areaKm2,
      area_official_km2: region.areaOfficialKm2,
      centroid_lat: region.centroid.lat,
      centroid_lon: region.centroid.lon,
      notes: region.notes,
    },
    geometry: region.geometry,
  });

  await writeJson(`${paths.processed}/kecamatan.geojson`, {
    type: 'FeatureCollection',
    name: 'surabaya-kecamatan',
    generated_at: generatedAt,
    features: kecamatan.map(toFeature),
  });

  await writeJson(`${paths.processed}/kelurahan.geojson`, {
    type: 'FeatureCollection',
    name: 'surabaya-kelurahan',
    generated_at: generatedAt,
    features: kelurahan.map(toFeature),
  });

  await writeJson(`${paths.processed}/fasilitas.geojson`, {
    type: 'FeatureCollection',
    name: 'surabaya-fasilitas-kesehatan',
    generated_at: generatedAt,
    features: finalFacilities.map((facility) => ({
      type: 'Feature',
      id: facility.id,
      properties: {
        id: facility.id,
        name: facility.name,
        kind: facility.kind,
        address: facility.address,
        phone: facility.phone,
        operator: facility.operator,
        beds: facility.beds,
        source: facility.source,
        osm_id: facility.osmId,
        region_id: facility.regionId,
        region_name: facility.regionName,
      },
      geometry: { type: 'Point', coordinates: [facility.lon, facility.lat] },
    })),
  });

  // --- Metadata ----------------------------------------------------------
  const boundaryAccessed = boundaryCollection.accessed_at ?? todayIso();

  const datasets = [
    {
      id: 'boundaries',
      title: 'Batas wilayah administratif',
      source: 'OpenStreetMap via Overpass API',
      url: 'https://www.openstreetmap.org',
      license: 'ODbL 1.0 — © OpenStreetMap contributors',
      accessedAt: boundaryAccessed,
      recordCount: kecamatan.length + kelurahan.length,
      notes: [`${kecamatan.length} kecamatan, ${kelurahan.length} kelurahan`],
      limitations: [
        'Batas dipetakan komunitas OpenStreetMap dan dapat berbeda sedikit dari batas resmi pemerintah.',
        'Luas dihitung dari poligon pada bola; nilai resmi bila tersedia disertakan sebagai pembanding.',
        'Hubungan kelurahan ke kecamatan ditentukan lewat uji ruang, bukan dari tag OpenStreetMap.',
      ],
    },
    {
      id: 'facilities',
      title: 'Fasilitas kesehatan',
      source: facilitySource,
      url: 'https://www.openstreetmap.org',
      license: 'ODbL 1.0 — © OpenStreetMap contributors',
      accessedAt: facilitiesFile ? todayIso() : null,
      recordCount: finalFacilities.length,
      notes: [
        'Jenis: rumah sakit, klinik/puskesmas, apotek, praktik dokter, pos kesehatan',
        `${withoutName} fasilitas tidak memiliki nama di sumber asal`,
      ].filter(Boolean),
      limitations: [
        'DATA KOMUNITAS, BUKAN DATA RESMI. OpenStreetMap tidak menjamin kelengkapan maupun ketepatan.',
        'Fasilitas yang belum dipetakan di OpenStreetMap tidak muncul, sehingga jumlahnya cenderung lebih rendah dari kenyataan.',
        'Tidak ada informasi kapasitas, jam operasional, atau jenis layanan.',
      ],
    },
    {
      id: 'population',
      title: 'Jumlah penduduk dan luas wilayah',
      source: populationApplied > 0 ? 'Berkas yang diisi pengguna' : 'Belum tersedia',
      url: 'https://surabayakota.bps.go.id',
      license: 'Data BPS — mengikuti ketentuan penggunaan BPS',
      accessedAt: populationApplied > 0 ? todayIso() : null,
      recordCount: populationApplied,
      notes:
        populationApplied > 0
          ? [`${populationApplied} wilayah memiliki angka penduduk`]
          : [
              'Angka penduduk belum diisi. Metrik yang memerlukan penduduk ditandai "data tidak tersedia".',
              'Isi data/templates/penduduk-template.csv dari BPS Kota Surabaya lalu impor lewat halaman Data.',
            ],
      limitations:
        populationApplied > 0
          ? [
              'Angka penduduk adalah proyeksi/sensus pada tahun rujukan, bukan hitungan saat ini.',
              'Tahun rujukan ditampilkan pada setiap wilayah; wilayah dengan tahun berbeda tidak sepenuhnya sebanding.',
            ]
          : [
              'Tanpa angka penduduk, kepadatan, rasio fasilitas, cakupan berbobot, dan skor prioritas tidak dapat dihitung.',
            ],
    },
  ];

  await writeJson(`${paths.metadata}`, {
    schemaVersion: DATA_SCHEMA_VERSION,
    generatedAt,
    city: {
      name: CITY_NAME,
      bbox: CITY_BBOX,
    },
    counts: {
      kecamatan: kecamatan.length,
      kelurahan: kelurahan.length,
      facilities: finalFacilities.length,
      populationApplied,
    },
    datasets,
    quality,
  });

  console.log('');
  info('Ringkasan kualitas data:');
  info(`  wilayah: ${quality.regionsTotal} (${kecamatan.length} kecamatan, ${kelurahan.length} kelurahan)`);
  info(`  fasilitas: ${quality.facilitiesTotal}`);
  info(`  fasilitas tanpa nama: ${quality.facilitiesWithoutName}`);
  info(`  fasilitas tak terpetakan: ${quality.facilitiesUnassignedToKelurahan}`);
  info(`  wilayah dengan angka penduduk: ${quality.regionsWithPopulation} dari ${quality.regionsTotal}`);
  info(`  wilayah dengan selisih luas > 5%: ${quality.regionsWithAreaMismatch}`);

  console.log('');
  if (populationApplied === 0) {
    warn('Angka penduduk masih kosong — ini disengaja, bukan kegagalan.');
    info('Aplikasi tetap berjalan dan menandai metrik terkait sebagai belum tersedia.');
  }
  info('Selanjutnya: npm run dev');
}

main().catch((error) => {
  fail(`Galat tak terduga: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});