/**
 * Ambil batas administratif kecamatan dan kelurahan Kota Surabaya dari
 * OpenStreetMap lewat Overpass API.
 *
 * Hasilnya disimpan mentah di data/raw/. Bila relasi batas tidak ditemukan,
 * skrip berhenti dengan pesan yang menjelaskan apa yang harus dilakukan —
 * berkas batas tidak akan dibuat dari data karangan.
 */

import { OVERPASS_ENDPOINTS, overpass, osmElementToGeometry, geometryAreaKm2, geometryBBox } from './lib/osm.mjs';
import { paths, writeJson, readJson, exists, todayIso, heading, info, warn, fail } from './lib/io.mjs';
import {
  SURABAYA_RELATION_ID,
  ADMIN_LEVEL_KECAMATAN,
  ADMIN_LEVEL_KELURAHAN,
} from './lib/constants.mjs';

/**
 * Kueri utama: ambil seluruh kecamatan dan kelurahan yang berada di dalam
 * batas Kota Surabaya.
 *
 * Bentuk kueri:
 * 1. Bentuk area dari relasi kota
 * 2. Cari relasi administratif pada level yang diinginkan di dalam area
 * 3. `out body` untuk mendapatkan tag relasi
 * 4. `>;` untuk menelusuri semua anggota (way dan node)
 * 5. `out skel qt` untuk mendapatkan koordinat semua node
 *
 * `out geom` ternyata tidak mengirim geometri lengkap untuk relasi yang
 * anggotanya adalah way. Bentuk klasik `out body; >; out skel qt` lebih
 * andal karena mengirim node secara terpisah.
 */
function boundaryQuery() {
  return `
[out:json][timeout:300];
area(${3600000000 + SURABAYA_RELATION_ID})->.kota;
(
  relation["boundary"="administrative"]["admin_level"="${ADMIN_LEVEL_KECAMATAN}"](area.kota);
  relation["boundary"="administrative"]["admin_level"~"^(${ADMIN_LEVEL_KELURAHAN.join('|')})$"](area.kota);
);
out body;
>;
out skel qt;
`;
}

/**
 * Kueri cadangan: bila area kota tidak dapat dibentuk (kadang terjadi saat
 * Overpass sibuk), ambil relasi administratif di sekitar pusat kota lalu
 * penyaringan di dalam kota dilakukan oleh tahap build data.
 */
function fallbackQuery() {
  return `
[out:json][timeout:300];
(
  relation["boundary"="administrative"]["admin_level"="${ADMIN_LEVEL_KECAMATAN}"](around:35000,-7.2575,112.7521);
  relation["boundary"="administrative"]["admin_level"~"^(${ADMIN_LEVEL_KELURAHAN.join('|')})$"](around:35000,-7.2575,112.7521);
);
out body;
>;
out skel qt;
`;
}

async function main() {
  heading('Langkah 1/4 — Mengambil batas wilayah dari OpenStreetMap');

  info(`Endpoint yang dicoba: ${OVERPASS_ENDPOINTS.length} alamat`);

  // Respons mentah disimpan agar pengembangan berikutnya tidak perlu memanggil
  // Overpass berulang kali untuk data yang sama. Hapus berkasnya bila ingin
  // mengambil ulang dari sumber.
  const cachePath = `${paths.raw}/overpass-boundaries-raw.json`;

  let payload;
  if (await exists(cachePath)) {
    info(`Memakai respons mentah yang sudah ada: ${cachePath.slice(paths.root.length + 1)}`);
    info('Hapus berkas itu bila ingin mengambil ulang dari Overpass.');
    payload = await readJson(cachePath);
  } else {
    info('Ini bisa memakan waktu 1–3 menit karena relasi batas cukup besar.');
    try {
      payload = await overpass(boundaryQuery());
      await writeJson(cachePath, payload);
    } catch (error) {
      warn('Kueri berbasis area gagal.');
      info(String(error.message).split('\n')[0]);
      info('Mencoba kueri alternatif berdasarkan jarak dari pusat kota…');
      try {
        payload = await overpass(fallbackQuery());
        await writeJson(cachePath, payload);
      } catch (secondError) {
        fail(
          [
            'Tidak dapat mengambil batas wilayah dari Overpass API.',
            '',
            'Kemungkinan penyebab: tidak ada koneksi internet, Overpass sedang sibuk,',
            'atau ID relasi wilayah sudah berubah.',
            '',
            `Rincian: ${String(secondError.message).split('\n').slice(0, 4).join(' ')}`,
            '',
            'Yang bisa dilakukan:',
            '  1. Periksa koneksi internet lalu jalankan ulang: npm run data:boundaries',
            '  2. Atau unduh GeoJSON batas kecamatan/kelurahan dari sumber resmi',
            '     (mis. portal open data Pemerintah Kota Surabaya), lalu impor',
            '     langsung lewat halaman Data pada aplikasi.',
            '',
            'Aplikasi tetap dapat dijalankan dan akan menampilkan panduan impor.',
          ].join('\n'),
        );
        process.exitCode = 1;
        return;
      }
    }
  }

  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  info(`Elemen diterima: ${elements.length}`);

  // Kueri baru memakai `out body; >; out skel qt` yang mengirim node dan way
  // terpisah, bukan `out geom` yang mengirim geometri lengkap.
  const nodes = new Map();
  for (const element of elements) {
    if (element.type === 'node') {
      nodes.set(element.id, { lat: element.lat, lon: element.lon });
    }
  }
  info(`Titik koordinat: ${nodes.size}`);

  const ways = new Map();
  for (const element of elements) {
    if (element.type === 'way' && Array.isArray(element.nodes)) {
      const geometry = element.nodes
        .map((nodeId) => nodes.get(nodeId))
        .filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lon));
      ways.set(element.id, { ref: element.id, geometry });
    }
  }
  info(`Potongan garis (way): ${ways.size}`);

  const relations = elements.filter((element) => element.type === 'relation');
  info(`Relasi: ${relations.length}`);

  if (relations.length === 0) {
    warn('Tidak ada relasi pada jawaban Overpass.');
  }

  // Distribusi admin_level dilaporkan apa adanya supaya penentuan tingkat
  // wilayah berpijak pada data nyata, bukan asumsi. Bila sebarannya berbeda
  // dari yang diharapkan, konstanta ADMIN_LEVEL_* yang perlu disesuaikan.
  const levelCounts = new Map();
  for (const relation of relations) {
    const level = relation.tags?.admin_level ?? '(tanpa admin_level)';
    levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
  }
  const levelList = [...levelCounts.entries()].sort((a, b) => b[1] - a[1]);
  info(`Sebaran admin_level: ${levelList.map(([level, count]) => `${level}×${count}`).join(', ')}`);
  info(`Tingkat kecamatan yang diharapkan: admin_level=${ADMIN_LEVEL_KECAMATAN}`);
  info(`Tingkat kelurahan yang diharapkan: admin_level=${ADMIN_LEVEL_KELURAHAN.join('|')}`);

  const features = [];
  const problems = [];

  for (const relation of relations) {
    const tags = relation.tags ?? {};
    const adminLevel = tags.admin_level;
    const name = tags.name;

    if (!name) continue;

    const isKecamatan = adminLevel === ADMIN_LEVEL_KECAMATAN;
    const isKelurahan = ADMIN_LEVEL_KELURAHAN.includes(adminLevel);

    if (!isKecamatan && !isKelurahan) continue;

    // Setiap anggota way diambil geometrinya dari peta way yang sudah diisi.
    //
    // `type: 'way'` wajib ikut disertakan: osmElementToGeometry menyaring
    // anggota berdasarkan field itu. Tanpa field tersebut, daftar way yang
    // dirakit menjadi kosong dan setiap relasi dilaporkan gagal dirangkai.
    const members = (relation.members ?? [])
      .filter((member) => member.type === 'way' && ways.has(member.ref))
      .map((member) => ({
        type: 'way',
        ref: member.ref,
        role: member.role,
        geometry: ways.get(member.ref).geometry,
      }));

    if (members.length === 0) {
      problems.push(
        `relasi ${relation.id} (${name}) tidak punya potongan garis yang dapat dibaca — ` +
          'kemungkinan batasnya disusun dari sub-relasi, bukan way langsung',
      );
      continue;
    }

    const geometry = osmElementToGeometry({
      type: 'relation',
      members,
    });

    if (!geometry) {
      problems.push(`relasi ${relation.id} (${name}) gagal dirangkai menjadi cincin tertutup`);
      continue;
    }

    const areaKm2 = geometryAreaKm2(geometry);
    const bbox = geometryBBox(geometry);

    if (!Number.isFinite(areaKm2) || areaKm2 <= 0) {
      problems.push(`relasi ${relation.id} (${name}) menghasilkan luas nol atau tidak sah`);
      continue;
    }

    features.push({
      type: 'Feature',
      id: `osm-relation/${relation.id}`,
      properties: {
        osm_id: relation.id,
        name: name.replace(/^(Kecamatan|Kelurahan|Kec\.|Kel\.)\s+/i, '').trim(),
        name_full: name,
        level: isKecamatan ? 'kecamatan' : 'kelurahan',
        admin_level: adminLevel,
        area_km2_calculated: Math.round(areaKm2 * 1000) / 1000,
        wikidata: tags.wikidata ?? null,
        // Nama kecamatan induk belum tentu tersedia langsung; diisi saat build
        // data dengan menguji ruang, bukan dari tag yang bisa keliru.
        parent_osm_id: null,
      },
      bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat],
      geometry,
    });
  }

  const kecamatan = features.filter((f) => f.properties.level === 'kecamatan');
  const kelurahan = features.filter((f) => f.properties.level === 'kelurahan');

  info(`Kecamatan terbaca: ${kecamatan.length}`);
  info(`Kelurahan terbaca: ${kelurahan.length}`);

  if (problems.length > 0) {
    warn(`${problems.length} relasi dilewati:`);
    for (const problem of problems.slice(0, 8)) info(`- ${problem}`);
    if (problems.length > 8) info(`- … dan ${problems.length - 8} lainnya`);
  }

  if (kecamatan.length === 0) {
    fail(
      [
        'Tidak ada kecamatan yang berhasil dibaca.',
        '',
        `Relasi kota yang dipakai: ${SURABAYA_RELATION_ID}, tingkat kecamatan yang`,
        `diharapkan: admin_level=${ADMIN_LEVEL_KECAMATAN}. Bila salah satunya berubah`,
        'di OpenStreetMap, keduanya perlu diperbarui.',
        '',
        'Periksa dengan menjalankan: node scripts/find-boundary-relation.mjs',
        'Skrip itu menampilkan daftar relasi administratif beserta jumlah anggotanya,',
        'sehingga ID yang benar dapat dipastikan — bukan ditebak.',
        '',
        'Yang bisa dilakukan juga: impor GeoJSON batas wilayah secara manual lewat',
        'halaman Data pada aplikasi.',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const collection = {
    type: 'FeatureCollection',
    name: 'surabaya-administrative-boundaries',
    generated_at: new Date().toISOString(),
    accessed_at: todayIso(),
    source: 'OpenStreetMap via Overpass API',
    source_url: 'https://www.openstreetmap.org',
    license: 'ODbL 1.0 — © OpenStreetMap contributors',
    features,
  };

  const output = `${paths.raw}/boundaries-osm.geojson`;
  await writeJson(output, collection);

  console.log('');
  info(`Luas total kecamatan: ${kecamatan.reduce((acc, f) => acc + f.properties.area_km2_calculated, 0).toFixed(1)} km²`);
  info('Langkah berikutnya: npm run data:facilities');

  // Ringkasan singkat agar jumlah wilayah bisa diperiksa terhadap angka resmi.
  const summary = {
    accessedAt: todayIso(),
    source: 'OpenStreetMap via Overpass API',
    kecamatan: kecamatan.map((f) => f.properties.name).sort((a, b) => a.localeCompare(b, 'id')),
    kelurahanCount: kelurahan.length,
    problems,
  };
  await writeJson(`${paths.raw}/boundaries-summary.json`, summary);
}

main().catch(async (error) => {
  fail(`Galat tak terduga: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});