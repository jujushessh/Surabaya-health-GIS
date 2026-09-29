/**
 * Konstanta bersama. Nilai di sini dipakai oleh skrip data maupun aplikasi,
 * sehingga batas wilayah dan ambang validasi tidak pernah berbeda antara
 * keduanya.
 */

import type { BBox } from '../types';

/**
 * Kotak pembatas Kota Surabaya, dengan sedikit kelonggaran di tepi.
 * Dipakai untuk menolak koordinat yang jelas berada di luar kota saat impor.
 */
export const CITY_BBOX: BBox = {
  minLat: -7.4,
  maxLat: -7.13,
  minLon: 112.55,
  maxLon: 112.95,
};

export const CITY_NAME = 'Kota Surabaya';

/** Titik tengah awal peta. */
export const CITY_CENTER = { lat: -7.2575, lon: 112.7521 };

/** Zoom awal peta. */
export const CITY_ZOOM = 12;

/** Jarak sampel grid untuk perhitungan cakupan (km). */
export const GRID_STEP_KM = 0.5;

/** Batas jumlah kelas choropleth. */
export const MAX_CHOROPLETH_CLASSES = 7;

/** Versi skema data — dipakai untuk menolak berkas impor dari versi lain. */
export const DATA_SCHEMA_VERSION = '1.0.0';

/** Tahun rujukan default bila sumber tidak menyebutkan tahun. */
export const DEFAULT_POPULATION_YEAR = 2023;