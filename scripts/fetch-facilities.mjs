/**
 * Ambil fasilitas kesehatan Kota Surabaya dari OpenStreetMap lewat Overpass API.
 *
 * Jenis yang diambil: rumah sakit, klinik, apotek, praktik dokter, dan pos
 * kesehatan. Data OSM dipetakan komunitas sehingga tidak lengkap dan tidak
 * resmi — jumlah fasilitas yang benar-benar diperoleh dilaporkan apa adanya.
 */

import { overpass } from './lib/osm.mjs';
import { CITY_BBOX } from './lib/constants.mjs';
import { paths, writeJson, readJson, exists, todayIso, heading, info, warn, fail } from './lib/io.mjs';

const QUERY = (bbox) => `
[out:json][timeout:240];
(
  node["amenity"="hospital"](${bbox});
  way["amenity"="hospital"](${bbox});
  node["amenity"="clinic"](${bbox});
  way["amenity"="clinic"](${bbox});
  node["healthcare"="centre"](${bbox});
  node["amenity"="pharmacy"](${bbox});
  way["amenity"="pharmacy"](${bbox});
  node["amenity"="doctors"](${bbox});
  node["healthcare"="doctor"](${bbox});
  node["amenity"="health_post"](${bbox});
  node["healthcare"="health_post"](${bbox});
);
out center tags;
`;

/** Pemetaan tag OpenStreetMap ke jenis internal aplikasi. */
function classifyFacility(tags) {
  const amenity = tags.amenity;
  const healthcare = tags.healthcare;

  if (amenity === 'hospital') return 'hospital';
  if (amenity === 'clinic') return 'clinic';
  if (healthcare === 'centre' || healthcare === 'hospital') return 'clinic';
  if (amenity === 'pharmacy') return 'pharmacy';
  if (amenity === 'doctors' || healthcare === 'doctor') return 'doctor';
  if (amenity === 'health_post' || healthcare === 'health_post') return 'health_post';
  return null;
}

async function main() {
  heading('Langkah 2/4 — Mengambil fasilitas kesehatan dari OpenStreetMap');

  const boundariesFile = `${paths.raw}/boundaries-osm.geojson`;
  if (!(await exists(boundariesFile))) {
    warn('Berkas batas wilayah belum ada.');
    info('Jalankan lebih dahulu: npm run data:boundaries');
    info('Pengambilan tetap dilanjutkan memakai kotak pembatas kota, tetapi');
    info('fasilitas di luar batas tidak akan dapat dipetakan ke wilayah.');
  }

  const bbox = `${CITY_BBOX.minLat},${CITY_BBOX.minLon},${CITY_BBOX.maxLat},${CITY_BBOX.maxLon}`;
  info(`Kotak pembatas: ${bbox}`);

  // Respons mentah disimpan agar hasil pengambilan dapat diperiksa ulang tanpa
  // memanggil Overpass lagi. Hapus berkasnya untuk mengambil versi terbaru.
  const cachePath = `${paths.raw}/overpass-facilities-raw.json`;

  let payload;
  if (await exists(cachePath)) {
    info(`Memakai respons mentah yang sudah ada: ${cachePath.slice(paths.root.length + 1)}`);
    info('Hapus berkas itu bila ingin mengambil ulang dari Overpass.');
    payload = await readJson(cachePath);
  } else {
    info('Mengirim kueri ke Overpass API…');
    try {
      payload = await overpass(QUERY(bbox));
      await writeJson(cachePath, payload);
    } catch (error) {
      fail(
        [
          'Tidak dapat mengambil data fasilitas dari Overpass API.',
          '',
          `Rincian: ${String(error.message).split('\n').slice(0, 4).join(' ')}`,
          '',
          'Yang bisa dilakukan:',
          '  1. Periksa koneksi lalu jalankan ulang: npm run data:facilities',
          '  2. Atau siapkan sendiri CSV fasilitas dengan kolom:',
          '     id, name, kind, lat, lon, address, phone, operator, beds',
          '     lalu impor lewat halaman Data pada aplikasi.',
          '     Template: data/templates/fasilitas-template.csv',
          '',
          'Skrip ini tidak akan membuat data contoh dan menyebutnya sebagai data nyata.',
        ].join('\n'),
      );
      process.exitCode = 1;
      return;
    }
  }

  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  info(`Elemen diterima: ${elements.length}`);

  const facilities = [];
  const skipped = [];
  let withoutName = 0;

  for (const element of elements) {
    const tags = element.tags ?? {};

    const kind = classifyFacility(tags);
    if (!kind) continue;

    // Elemen berbentuk area memakai "center" yang dihasilkan oleh out center.
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      skipped.push(`elemen ${element.type}/${element.id} tanpa koordinat`);
      continue;
    }

    // Buang titik di luar kotak pembatas dengan kelonggaran kecil, agar
    // fasilitas di kabupaten tetangga tidak ikut terbawa.
    const pad = 0.02;
    if (
      lat < CITY_BBOX.minLat - pad ||
      lat > CITY_BBOX.maxLat + pad ||
      lon < CITY_BBOX.minLon - pad ||
      lon > CITY_BBOX.maxLon + pad
    ) {
      continue;
    }

    const rawName = tags.name ?? tags['name:id'] ?? '';
    if (!rawName) withoutName += 1;

    facilities.push({
      id: `${element.type}/${element.id}`,
      osmId: `${element.type}/${element.id}`,
      name: rawName.trim() || '(tanpa nama)',
      kind,
      lat: Math.round(lat * 1e7) / 1e7,
      lon: Math.round(lon * 1e7) / 1e7,
      address: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ') || undefined,
      phone: tags.phone ?? tags['contact:phone'] ?? undefined,
      operator: tags.operator ?? undefined,
      beds: Number.isFinite(Number(tags.beds)) ? Number(tags.beds) : undefined,
      source: 'osm',
    });
  }

  const byKind = facilities.reduce((acc, facility) => {
    acc[facility.kind] = (acc[facility.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log('');
  info(`Fasilitas terbaca: ${facilities.length}`);
  for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
    info(`  ${kind}: ${count}`);
  }
  if (withoutName > 0) {
    warn(`${withoutName} fasilitas tidak memiliki nama di OpenStreetMap dan diberi label "(tanpa nama)".`);
  }
  if (skipped.length > 0) {
    warn(`${skipped.length} elemen dilewati karena tidak punya koordinat.`);
  }

  if (facilities.length === 0) {
    fail(
      [
        'Tidak ada fasilitas kesehatan yang ditemukan dalam kotak pembatas.',
        '',
        'Kemungkinan penyebab: kueri gagal sebagian, atau penandaan OpenStreetMap',
        'di wilayah ini berbeda dari perkiraan.',
        '',
        'Yang bisa dilakukan: impor CSV fasilitas secara manual lewat halaman Data',
        'pada aplikasi. Template: data/templates/fasilitas-template.csv',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  await writeJson(`${paths.raw}/osm-facilities.json`, {
    accessed_at: todayIso(),
    source: 'OpenStreetMap via Overpass API',
    source_url: 'https://www.openstreetmap.org',
    license: 'ODbL 1.0 — © OpenStreetMap contributors',
    bbox: CITY_BBOX,
    withoutName,
    skipped,
    facilities,
  });

  console.log('');
  info('Langkah berikutnya: npm run data:population');
}

main().catch((error) => {
  fail(`Galat tak terduga: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});