/** Utilitas berkas dan pelaporan bersama untuk skrip data. */

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const paths = {
  root: ROOT,
  raw: resolve(ROOT, 'data', 'raw'),
  // Keluaran rakitan sengaja diletakkan di public/ agar aplikasi dapat
  // memuatnya saat berjalan. Dengan begitu dataset bisa diganti tanpa
  // menjalankan build ulang, dan berkasnya tetap berupa teks yang dapat
  // diperiksa serta dibandingkan antarversi.
  processed: resolve(ROOT, 'public', 'data'),
  templates: resolve(ROOT, 'data', 'templates'),
  metadata: resolve(ROOT, 'public', 'data', 'metadata.json'),
};

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

export async function writeJson(file, value) {
  await ensureDir(dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`  tersimpan: ${relativeTo(file)}`);
}

export async function readJson(file) {
  const text = await readFile(file, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function relativeTo(file) {
  return file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
}

/** Tanggal akses hari ini, format YYYY-MM-DD. */
export function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function heading(text) {
  console.log(`\n${text}`);
  console.log('-'.repeat(text.length));
}

export function info(text) {
  console.log(`  ${text}`);
}

export function warn(text) {
  console.warn(`  PERINGATAN: ${text}`);
}

export function fail(text) {
  console.error(`\n  GAGAL: ${text}\n`);
}

/** Unduh URL dengan User-Agent yang jelas dan batas waktu. */
export async function fetchText(url, { timeoutMs = 60000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'surabaya-health-gis/1.0 (analisis aksesibilitas fasilitas kesehatan; penggunaan akademis)',
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}