/**
 * Pemformatan angka dan tanggal dalam konvensi Indonesia.
 *
 * Aturan penting: nilai yang tidak tersedia ditampilkan sebagai "data tidak
 * tersedia", bukan 0. Angka 0 adalah hasil pengukuran, sedangkan null berarti
 * belum terukur — dan menampilkan keduanya sama akan menyesatkan.
 */

export const NO_DATA = 'Data tidak tersedia';

const numberFormat = (decimals: number): Intl.NumberFormat =>
  new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** Angka dengan pemisah ribuan gaya Indonesia. */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA;
  return numberFormat(decimals).format(value);
}

/** Angka dengan satuan, mis. "12.345 jiwa/km²". */
export function formatWithUnit(
  value: number | null | undefined,
  unit: string,
  decimals = 0,
): string {
  const formatted = formatNumber(value, decimals);
  return formatted === NO_DATA ? NO_DATA : `${formatted} ${unit}`;
}

/** Ringkas untuk angka besar, dipakai pada kartu statistik. */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA;
  if (Math.abs(value) >= 1_000_000) return `${numberFormat(1).format(value / 1_000_000)} jt`;
  if (Math.abs(value) >= 10_000) return `${numberFormat(1).format(value / 1_000)} rb`;
  return numberFormat(0).format(value);
}

/**
 * Persentase dalam satuan PERSEN (0–100) — bukan rasio 0–1.
 *
 * Pembedaan ini penting dan pernah salah: bobot prioritas disimpan sebagai
 * rasio (0,4), lalu ditampilkan lewat fungsi ini sehingga terbaca "0,4%"
 * padahal maksudnya 40%. Untuk nilai rasio, pakai `formatRatioPercent` yang
 * mengalikan 100 lebih dahulu. Setiap nilai persen baru tidak perlu dikalikan
 * 100 lagi di tempat pemanggilan — itu justru menciptakan kesalahan yang sama
 * dari arah sebaliknya.
 */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA;
  return `${numberFormat(decimals).format(value)}%`;
}

/**
 * Persentase dari RASIO 0–1 (mis. bagian dari keseluruhan, bobot relatif).
 *
 * Diberi nama sendiri supaya tidak ada lagi pemanggilan
 * `formatPercent(x * 100)` yang tersebar — pengaliannya cukup di sini.
 */
export function formatRatioPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA;
  return formatPercent(value * 100, decimals);
}

/** Jarak dalam km; di bawah 1 km ditampilkan dalam meter agar lebih terbaca. */
export function formatDistance(km: number | null | undefined, decimals = 2): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return NO_DATA;
  if (km < 1) return `${numberFormat(0).format(km * 1000)} m`;
  return `${numberFormat(decimals).format(km)} km`;
}

/** Luas wilayah. */
export function formatArea(km2: number | null | undefined): string {
  return formatWithUnit(km2, 'km²', 2);
}

/**
 * Tanggal gaya Indonesia dari string ISO.
 *
 * Menerima tanggal saja (YYYY-MM-DD) maupun cap waktu lengkap
 * (YYYY-MM-DDTHH:mm:ssZ): hanya bagian tanggalnya yang dipakai, karena
 * cap waktu dari berkas metadata tidak pernah perlu ditampilkan sampai jam.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return NO_DATA;
  const datePart = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return NO_DATA;
  const parsed = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return NO_DATA;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/** Waktu lengkap untuk catatan tanggal akses data. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return NO_DATA;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return NO_DATA;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

/** Tanggal hari ini dalam format ISO, memakai zona waktu lokal pengguna. */
export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Label ordinal peringkat, mis. "Peringkat 3 dari 153". */
export function formatRank(rank: number, total: number): string {
  return `Peringkat ${formatNumber(rank)} dari ${formatNumber(total)}`;
}

/** Persentase dengan tanda eksplisit, untuk perubahan antarperiode. */
export function formatSignedPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA;
  const sign = value > 0 ? '+' : '';
  return `${sign}${numberFormat(decimals).format(value)}%`;
}