/**
 * Ambil angka penduduk dan luas wilayah per kecamatan/kelurahan.
 *
 * PENTING — sifat skrip ini berbeda dari dua skrip pengambilan lainnya.
 * Sumber angka penduduk resmi (BPS Kota Surabaya, portal open data) menyajikan
 * data dalam tabel HTML atau berkas Excel dengan struktur yang berubah dari
 * waktu ke waktu. Skrip ini karena itu **tidak menebak**: ia mencoba membaca
 * tabel yang dikenali, dan bila gagal ia berhenti dengan pesan yang menjelaskan
 * cara mengisinya sendiri.
 *
 * Berkas CSV hasil unduhan mentah selalu disimpan ke data/raw/ agar dapat
 * diperiksa manual. Angka penduduk yang tidak dapat dipastikan tidak pernah
 * dikarang.
 */

import { CITY_NAME } from './lib/constants.mjs';
import { paths, writeJson, readJson, exists, todayIso, heading, info, warn, fail } from './lib/io.mjs';

/**
 * Kandidat sumber. Struktur situs dapat berubah, jadi setiap kandidat
 * diperlakukan sebagai percobaan, bukan jaminan.
 */
const CANDIDATES = [
  {
    id: 'bps-surabaya',
    label: 'BPS Kota Surabaya — Kota Surabaya Dalam Angka',
    url: 'https://surabayakota.bps.go.id/id/statistics-table',
    kind: 'index',
  },
];

/** Bersihkan teks sel: buang tag, entitas, dan spasi berlebih. */
function cleanCell(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ubah "1.234,56" atau "1,234.56" menjadi angka. */
function parseNumber(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/[^\d.,-]/g, '').trim();
  if (text === '') return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  // Format Indonesia: titik sebagai pemisah ribuan, koma sebagai desimal.
  if (lastComma > lastDot) {
    const normalized = text.replace(/\./g, '').replace(',', '.');
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/** Ambil baris tabel HTML yang memuat nama wilayah dan angka. */
function extractTableRows(html) {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(match[1])) !== null) {
      cells.push(cleanCell(cellMatch[1]));
    }
    if (cells.length >= 2) rows.push(cells);
  }

  return rows;
}

async function main() {
  heading('Langkah 3/4 — Menyiapkan angka penduduk dan luas wilayah');

  const boundariesFile = `${paths.raw}/boundaries-osm.geojson`;
  if (!(await exists(boundariesFile))) {
    fail(
      [
        'Berkas batas wilayah belum ada, sehingga angka penduduk tidak dapat dipetakan.',
        '',
        'Jalankan lebih dahulu: npm run data:boundaries',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  const boundaries = await readJson(boundariesFile);
  const kecamatanNames = boundaries.features
    .filter((f) => f.properties.level === 'kecamatan')
    .map((f) => f.properties.name)
    .sort((a, b) => a.localeCompare(b, 'id'));

  info(`Wilayah kecamatan yang menunggu angka penduduk: ${kecamatanNames.length}`);

  const template = {
    _petunjuk: [
      'Berkas ini adalah TEMPLATE angka penduduk. Isi kolom penduduk dengan angka',
      'resmi dari BPS Kota Surabaya atau portal open data Pemerintah Kota Surabaya,',
      'lalu impor lewat halaman "Data" pada aplikasi.',
      '',
      'Kolom wajib: wilayah, penduduk.',
      'Kolom opsional: kecamatan_induk, level (kecamatan/kelurahan), tahun, luas_km2.',
      '',
      'Kolom kecamatan_induk hanya perlu diisi untuk kelurahan yang namanya kembar',
      '(mis. ada dua kelurahan "Wonorejo": di Kecamatan Rungkut dan Tegalsari).',
      '',
      'Nilai kolom "wilayah" di bawah ini sudah diisi dengan nama kecamatan yang',
      'benar-benar ada pada batas wilayah, sehingga tidak ada salah ketik nama.',
      'Baris penduduk sengaja dibiarkan kosong: angka tidak boleh dikarang.',
    ],
    headers: ['wilayah', 'kecamatan_induk', 'level', 'penduduk', 'tahun', 'luas_km2'],
    rows: kecamatanNames.map((name) => [name, '', 'kecamatan', '', '', '']),
  };

  const csvLines = [
    template._petunjuk.map((line) => `# ${line}`).join('\n'),
    template.headers.join(','),
    ...template.rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ];

  const templatePath = `${paths.templates}/penduduk-template.csv`;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(templatePath, `﻿${csvLines.join('\r\n')}\r\n`, 'utf8');
  info(`Template disimpan: data/templates/penduduk-template.csv`);

  // Coba baca tabel dari sumber terbuka. Kegagalan di sini bukan kesalahan
  // fatal: aplikasi tetap berjalan dan menandai penduduk sebagai tidak tersedia.
  const unparsed = [];

  for (const candidate of CANDIDATES) {
    info(`Mencoba sumber: ${candidate.label}`);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      const response = await fetch(candidate.url, {
        headers: {
          'User-Agent': 'surabaya-health-gis/1.0 (penggunaan akademis)',
          'Accept-Language': 'id-ID,id;q=0.9',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        unparsed.push(`${candidate.label}: HTTP ${response.status}`);
        continue;
      }

      const html = await response.text();
      // Simpan mentah agar dapat diperiksa manusia; ini bagian dari jejak audit.
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(`${paths.raw}/population-source-${candidate.id}.html`, html, 'utf8');
      info(`  halaman disimpan mentah: data/raw/population-source-${candidate.id}.html`);

      const rows = extractTableRows(html);
      info(`  baris tabel terdeteksi: ${rows.length}`);

      // Cocokkan nama kecamatan terhadap isi tabel.
      const found = new Map();
      for (const row of rows) {
        for (const name of kecamatanNames) {
          const cell = row[0] ?? '';
          if (cell.toLowerCase().includes(name.toLowerCase()) && !found.has(name)) {
            const numeric = row
              .slice(1)
              .map(parseNumber)
              .filter((value) => value !== null && value > 1000);
            if (numeric.length > 0) found.set(name, numeric[0]);
          }
        }
      }

      info(`  kecamatan dengan angka penduduk terbaca: ${found.size} dari ${kecamatanNames.length}`);

      if (found.size > 0) {
        warn(
          'Angka penduduk berhasil dibaca sebagian dari tabel daring. Angka ini TIDAK ' +
            'otomatis dipakai: tabel daring sering berisi beberapa tahun sekaligus dan ' +
            'kolom dapat tertukar.',
        );
        info('Pratinjau yang terbaca (periksa sebelum dipakai):');
        for (const [name, value] of [...found.entries()].slice(0, 5)) {
          info(`  ${name}: ${value.toLocaleString('id-ID')}`);
        }
        info('Berkas pratinjau disimpan untuk Anda periksa.');

        await writeJson(`${paths.raw}/population-preview.json`, {
          accessed_at: todayIso(),
          source: candidate.label,
          source_url: candidate.url,
          caveat:
            'Pratinjau otomatis. Angka belum diverifikasi dan tidak dipakai oleh aplikasi sampai Anda mengimpornya sendiri.',
          values: Object.fromEntries(found),
        });
      } else {
        unparsed.push(`${candidate.label}: tabel tidak memuat nama kecamatan yang dikenali`);
      }
    } catch (error) {
      unparsed.push(`${candidate.label}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
    }
  }

  console.log('');
  if (unparsed.length > 0) {
    warn('Sebagian sumber tidak dapat dibaca otomatis:');
    for (const problem of unparsed) info(`- ${problem}`);
  }

  // Ringkasan status: apa yang tersedia dan apa yang belum.
  await writeJson(`${paths.raw}/population-status.json`, {
    accessed_at: todayIso(),
    city: CITY_NAME,
    autoParsed: false,
    reason:
      'Angka penduduk resmi tidak diambil otomatis. Tabel daring BPS berisi banyak tahun ' +
      'dan kolom yang dapat berubah, sehingga angka yang ditebak berisiko salah. ' +
      'Aplikasi menandai penduduk sebagai "data tidak tersedia" sampai Anda mengisi ' +
      'template dan mengimpornya.',
    templatePath: 'data/templates/penduduk-template.csv',
    kecamatanWaiting: kecamatanNames,
    problems: unparsed,
  });

  console.log('');
  info('Status: angka penduduk BELUM terisi. Aplikasi tetap dapat dijalankan —');
  info('metrik yang memerlukan penduduk akan ditandai "data tidak tersedia".');
  info('');
  info('Cara mengisi angka penduduk yang sah:');
  info('  1. Buka data/templates/penduduk-template.csv (nama kecamatan sudah terisi).');
  info('  2. Isi kolom penduduk dari BPS Kota Surabaya / open data Surabaya.');
  info('     Sertakan kolom tahun agar sumbernya jelas.');
  info('  3. Impor berkas itu lewat halaman "Data" pada aplikasi.');
  console.log('');
  info('Langkah berikutnya: npm run data:build');
}

main().catch((error) => {
  fail(`Galat tak terduga: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});