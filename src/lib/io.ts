/**
 * Impor dan ekspor data.
 *
 * Prinsip yang dijaga: impor yang gagal tidak boleh merusak data yang sudah ada.
 * Karena itu setiap fungsi di sini mengembalikan hasil lengkap dengan daftar
 * masalah, dan hanya mengembalikan `ok: true` bila tidak ada satu pun baris yang
 * tidak valid. Pemanggil (store) baru mengganti state setelah `ok` bernilai true.
 */

import type { BBox, Facility, FacilityKind, Region } from '../types';
import { FACILITY_KINDS } from '../types';
import { CITY_BBOX } from './constants';

export interface ImportIssue {
  /** Nomor baris pada berkas asal (1 = baris pertama setelah header). */
  row: number;
  field?: string;
  message: string;
}

export interface ImportResult<T> {
  ok: boolean;
  data: T[];
  issues: ImportIssue[];
}

/** Buang BOM dan rapikan spasi di ujung setiap baris. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parser CSV sederhana yang sadar tanda kutip.
 *
 * Tidak memakai pemisahan dengan koma mentah karena alamat fasilitas sering
 * mengandung koma di dalam tanda kutip.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const input = stripBom(text);

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',' || char === ';') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

/** Ubah CSV menjadi objek per baris dengan header sebagai kunci. */
export function tableFromCsv(text: string): ParsedTable {
  const raw = parseCsv(text);
  if (raw.length === 0) return { headers: [], rows: [] };

  const headers = raw[0].map((h) => h.trim().toLowerCase());
  const rows = raw.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim();
    });
    return record;
  });

  return { headers, rows };
}

/**
 * Lindungi sel CSV dari penyisipan formula.
 *
 * Excel dan Google Sheets mengeksekusi sel yang diawali =, +, -, atau @.
 * Data yang diimpor pengguna bisa berisi nama seperti "=cmd|..." sehingga
 * ekspor harus dinetralkan lebih dahulu.
 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const needsGuard = /^[=+\-@\t\r]/.test(text);
  const escaped = text.replace(/"/g, '""');
  const guarded = needsGuard ? `'${escaped}` : escaped;
  return /[",\n\r]/.test(guarded) || needsGuard ? `"${guarded}"` : guarded;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // BOM agar Excel di Indonesia membaca UTF-8 dengan benar.
  return `﻿${lines.join('\r\n')}`;
}

function isFiniteNumber(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

function inBBox(lat: number, lon: number, box: BBox): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
}

export const FACILITY_CSV_HEADERS = [
  'id',
  'name',
  'kind',
  'lat',
  'lon',
  'address',
  'phone',
  'operator',
  'beds',
] as const;

/**
 * Impor fasilitas dari CSV.
 *
 * Kolom wajib: name, kind, lat, lon. Koordinat harus berupa angka dan berada
 * di dalam kotak pembatas kota — titik di luar batas hampir selalu berarti
 * kolom tertukar atau salah salin, dan lebih baik ditolak dengan pesan jelas.
 */
export function importFacilitiesCsv(text: string, bbox: BBox = CITY_BBOX): ImportResult<Facility> {
  const { headers, rows } = tableFromCsv(text);
  const issues: ImportIssue[] = [];
  const data: Facility[] = [];
  const seenIds = new Set<string>();

  const required = ['name', 'kind', 'lat', 'lon'];
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    return {
      ok: false,
      data: [],
      issues: [
        {
          row: 0,
          message: `Kolom wajib tidak ditemukan: ${missing.join(', ')}. Kolom yang terbaca: ${
            headers.join(', ') || '(tidak ada)'
          }`,
        },
      ],
    };
  }

  rows.forEach((record, index) => {
    const rowNumber = index + 1;
    const name = (record.name ?? '').trim();
    const kindRaw = (record.kind ?? '').trim().toLowerCase();

    if (name === '') issues.push({ row: rowNumber, field: 'name', message: 'Nama kosong.' });

    if (!FACILITY_KINDS.includes(kindRaw as FacilityKind)) {
      issues.push({
        row: rowNumber,
        field: 'kind',
        message: `Jenis "${record.kind}" tidak dikenal. Pilihan: ${FACILITY_KINDS.join(', ')}.`,
      });
    }

    if (!isFiniteNumber(record.lat) || !isFiniteNumber(record.lon)) {
      issues.push({ row: rowNumber, field: 'lat/lon', message: 'Koordinat bukan angka yang sah.' });
    } else {
      const lat = Number(record.lat);
      const lon = Number(record.lon);
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        issues.push({ row: rowNumber, field: 'lat/lon', message: 'Koordinat di luar rentang yang sah.' });
      } else if (!inBBox(lat, lon, bbox)) {
        issues.push({
          row: rowNumber,
          field: 'lat/lon',
          message: `Koordinat (${lat}, ${lon}) berada di luar batas Kota Surabaya.`,
        });
      }
    }

    let id = (record.id ?? '').trim();
    if (id === '') id = `imp-${rowNumber}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
    if (seenIds.has(id)) {
      issues.push({ row: rowNumber, field: 'id', message: `ID "${id}" muncul lebih dari sekali.` });
    }
    seenIds.add(id);

    const beds = isFiniteNumber(record.beds) ? Number(record.beds) : undefined;

    if (issues.some((issue) => issue.row === rowNumber)) return;

    data.push({
      id,
      name,
      kind: kindRaw as FacilityKind,
      lat: Number(record.lat),
      lon: Number(record.lon),
      address: record.address || undefined,
      phone: record.phone || undefined,
      operator: record.operator || undefined,
      beds: beds !== undefined && beds >= 0 ? beds : undefined,
      source: 'import',
      regionId: null,
      regionName: null,
    });
  });

  return { ok: issues.length === 0, data, issues };
}

export const POPULATION_CSV_HEADERS = ['wilayah', 'kecamatan_induk', 'level', 'penduduk', 'tahun', 'luas_km2'] as const;

/**
 * Impor angka penduduk per wilayah.
 *
 * Nama wilayah dicocokkan tanpa membedakan huruf besar/kecil dan tanda baca,
 * karena penulisan nama di berkas resmi sering tidak konsisten. Wilayah yang
 * tidak ditemukan dilaporkan, bukan diabaikan diam-diam.
 *
 * Beberapa kelurahan bisa punya nama sama — Kota Surabaya punya dua kelurahan
 * "Wonorejo" (Rungkut dan Tegalsari). Untuk itu kolom opsional
 * `kecamatan_induk` disediakan: mengisinya memilih kelurahan yang tepat alih-alih
 * menolak baris sebagai ambigu. Tanpa kolom itu, nama kembar tetap dilaporkan
 * sebagai ambigu agar pengguna tidak salah memasang angka.
 */
export function importPopulationCsv(
  text: string,
  regions: Region[],
): ImportResult<{ regionId: string; population: number; year: number | null; areaKm2: number | null }> {
  const { headers, rows } = tableFromCsv(text);
  const issues: ImportIssue[] = [];
  const data: { regionId: string; population: number; year: number | null; areaKm2: number | null }[] =
    [];

  const required = ['wilayah', 'penduduk'];
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    return {
      ok: false,
      data: [],
      issues: [
        {
          row: 0,
          message: `Kolom wajib tidak ditemukan: ${missing.join(', ')}. Kolom yang terbaca: ${
            headers.join(', ') || '(tidak ada)'
          }`,
        },
      ],
    };
  }

  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/\b(kecamatan|kelurahan|kec|kel)\b\.?/g, '')
      .replace(/[^a-z0-9]/g, '');

  const byName = new Map<string, Region[]>();
  for (const region of regions) {
    const key = normalize(region.name);
    const bucket = byName.get(key);
    if (bucket) bucket.push(region);
    else byName.set(key, [region]);
  }

  const seen = new Set<string>();

  rows.forEach((record, index) => {
    const rowNumber = index + 1;
    const name = (record.wilayah ?? '').trim();
    const levelRaw = (record.level ?? '').trim().toLowerCase();
    const parentRaw = (record.kecamatan_induk ?? record.parent ?? record.induk ?? '').trim();

    if (name === '') {
      issues.push({ row: rowNumber, field: 'wilayah', message: 'Nama wilayah kosong.' });
      return;
    }

    const candidates = byName.get(normalize(name)) ?? [];
    if (candidates.length === 0) {
      issues.push({ row: rowNumber, field: 'wilayah', message: `Wilayah "${name}" tidak ada dalam batas wilayah.` });
      return;
    }

    let filtered =
      levelRaw === 'kecamatan' || levelRaw === 'kelurahan'
        ? candidates.filter((region) => region.level === levelRaw)
        : candidates;

    // Kolom kecamatan induk memilih di antara nama kembar. Perbandingannya
    // memakai normalisasi yang sama supaya "Kec. Rungkut" dan "Rungkut" sama.
    if (parentRaw !== '') {
      const parentKey = normalize(parentRaw);
      const narrowed = filtered.filter((region) => normalize(region.parentName ?? '') === parentKey);
      if (narrowed.length > 0) filtered = narrowed;
    }

    if (filtered.length === 0) {
      issues.push({
        row: rowNumber,
        field: 'level',
        message: `Wilayah "${name}" tidak ada pada level "${levelRaw}".`,
      });
      return;
    }

    if (filtered.length > 1) {
      issues.push({
        row: rowNumber,
        field: 'wilayah',
        message:
          `Nama "${name}" ditemukan di ${filtered.length} wilayah. ` +
          'Tambahkan kolom kecamatan_induk untuk memilih salah satunya.',
      });
      return;
    }

    const region = filtered[0];

    if (!isFiniteNumber(record.penduduk)) {
      issues.push({ row: rowNumber, field: 'penduduk', message: 'Angka penduduk bukan angka yang sah.' });
      return;
    }

    const population = Number(record.penduduk);
    if (population < 0) {
      issues.push({ row: rowNumber, field: 'penduduk', message: 'Angka penduduk tidak boleh negatif.' });
      return;
    }

    if (seen.has(region.id)) {
      issues.push({
        row: rowNumber,
        field: 'wilayah',
        message: `Wilayah "${region.name}" muncul lebih dari sekali dalam berkas ini.`,
      });
      return;
    }
    seen.add(region.id);

    const year = isFiniteNumber(record.tahun) ? Number(record.tahun) : null;
    const areaKm2 = isFiniteNumber(record.luas_km2) ? Number(record.luas_km2) : null;

    data.push({ regionId: region.id, population, year, areaKm2 });
  });

  return { ok: issues.length === 0, data, issues };
}

/** Impor batas wilayah dari GeoJSON FeatureCollection. */
export function importBoundariesGeojson(text: string): ImportResult<Region> {
  const issues: ImportIssue[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripBom(text));
  } catch (error) {
    return {
      ok: false,
      data: [],
      issues: [{ row: 0, message: `Berkas bukan JSON yang sah: ${(error as Error).message}` }],
    };
  }

  const collection = parsed as { type?: string; features?: unknown[] };
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    return {
      ok: false,
      data: [],
      issues: [{ row: 0, message: 'GeoJSON harus berupa FeatureCollection dengan array "features".' }],
    };
  }

  const data: Region[] = [];
  const seen = new Set<string>();

  collection.features.forEach((feature, index) => {
    const rowNumber = index + 1;
    const item = feature as {
      properties?: Record<string, unknown>;
      geometry?: { type?: string; coordinates?: unknown };
    };

    const geometry = item.geometry;
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
      issues.push({ row: rowNumber, message: 'Geometri harus Polygon atau MultiPolygon.' });
      return;
    }

    const properties = item.properties ?? {};
    const name = String(
      properties.name ?? properties.nama ?? properties.NAME ?? properties.wilayah ?? '',
    ).trim();
    if (name === '') {
      issues.push({ row: rowNumber, field: 'name', message: 'Properti nama wilayah kosong.' });
      return;
    }

    const levelRaw = String(properties.level ?? properties.tingkat ?? 'kelurahan').toLowerCase();
    const level = levelRaw === 'kecamatan' ? 'kecamatan' : 'kelurahan';

    const id = String(properties.id ?? `${level}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    if (seen.has(id)) {
      issues.push({ row: rowNumber, field: 'id', message: `ID "${id}" muncul lebih dari sekali.` });
      return;
    }
    seen.add(id);

    // Nilai penduduk ikut dibaca bila ada; kalau tidak, tetap null.
    const populationRaw = properties.population ?? properties.penduduk;
    const population =
      populationRaw !== undefined && Number.isFinite(Number(populationRaw)) ? Number(populationRaw) : null;

    data.push({
      id,
      name,
      level,
      parentId: properties.parent_id ? String(properties.parent_id) : null,
      parentName: properties.parent_name ? String(properties.parent_name) : null,
      population,
      populationYear: population !== null ? Number(properties.population_year) || null : null,
      areaKm2: null,
      areaOfficialKm2: null,
      // Titik representatif dihitung ulang saat build; nilai sementara ini
      // hanya placeholder agar tipe tetap terpenuhi.
      centroid: { lat: 0, lon: 0 },
      bbox: { minLat: 0, minLon: 0, maxLat: 0, maxLon: 0 },
      geometry: geometry as Region['geometry'],
      notes: [],
    });
  });

  return { ok: issues.length === 0, data, issues };
}

/** Ringkas daftar masalah impor menjadi kalimat yang bisa ditampilkan. */
export function describeIssues(issues: ImportIssue[], limit = 6): string {
  if (issues.length === 0) return '';
  const shown = issues.slice(0, limit).map((issue) => {
    const where = issue.row > 0 ? `Baris ${issue.row}` : 'Berkas';
    const field = issue.field ? ` (${issue.field})` : '';
    return `${where}${field}: ${issue.message}`;
  });
  if (issues.length > limit) shown.push(`… dan ${issues.length - limit} masalah lain.`);
  return shown.join('\n');
}

/** Unduh teks sebagai berkas di browser. */
export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}