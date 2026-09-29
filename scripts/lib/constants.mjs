/**
 * Konstanta bersama untuk skrip data.
 *
 * Nilai di berkas ini harus sama dengan src/lib/constants.ts. Keduanya
 * sengaja diduplikasi karena skrip Node tidak dapat mengimpor TypeScript
 * secara langsung.
 */

export const CITY_BBOX = {
  minLat: -7.4,
  maxLat: -7.13,
  minLon: 112.55,
  maxLon: 112.95,
};

export const CITY_NAME = 'Kota Surabaya';

/**
 * Relasi OpenStreetMap untuk Kota Surabaya.
 *
 * ID ini diverifikasi dengan menjalankan `node scripts/find-boundary-relation.mjs`,
 * bukan ditebak. Nilai sebelumnya (4264685) ternyata bukan batas kota sama sekali
 * — relasi itu hanya mengembalikan 45 elemen.
 */
export const SURABAYA_RELATION_ID = 8225862;

/**
 * Tingkat administratif pada OpenStreetMap untuk wilayah ini.
 *
 * Di Kota Surabaya, kota berada di level 5, kecamatan di level 6, dan
 * kelurahan di level 7. Angka ini berbeda antar provinsi, jadi jangan
 * disalin ke proyek lain tanpa memeriksa ulang.
 *
 * Level 9 sengaja TIDAK disertakan meskipun sebarannya paling banyak: relasi
 * ber-level 9 di kota ini adalah RW (Rukun Warga), bukan kelurahan. Verifikasi
 * yang sudah dijalankan (data/raw/overpass-boundaries-raw.json) menunjukkan
 * 154 relasi level 7 dengan nama kelurahan sesungguhnya (Ketabang, Genteng, …)
 * dan 1398 relasi level 9 dengan nama "RW 01"…"RW 11". Jumlah 154 itu sejalan
 * dengan 153 kelurahan resmi Kota Surabaya; 1398 jauh di luar itu.
 *
 * Hanya level 7 yang dipakai agar "kelurahan" tidak diam-diam berisi RW.
 */
export const ADMIN_LEVEL_KECAMATAN = '6';
export const ADMIN_LEVEL_KELURAHAN = ['7'];

/** Jarak sampel grid untuk cakupan (km). */
export const GRID_STEP_KM = 0.5;