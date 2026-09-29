/**
 * Versi skema data. Harus sama dengan DATA_SCHEMA_VERSION di src/lib/constants.ts.
 *
 * Versi ini dinaikkan bila bentuk berkas di data/processed/ berubah, supaya
 * berkas impor lama dapat ditolak dengan pesan yang jelas alih-alih dimuat
 * sebagian lalu menghasilkan angka yang salah.
 */
export const DATA_SCHEMA_VERSION = '1.0.0';