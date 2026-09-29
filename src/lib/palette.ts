/**
 * Palet warna.
 *
 * Nilai hex diambil apa adanya dari palet rujukan yang sudah tervalidasi
 * (lihat panduan visualisasi data: aturan "palet terdokumentasi" melarang
 * warna yang dikira-kira). Palet rujukan ini lolos seluruh gerbang warna:
 * rentang kecerahan, ambang kroma, pemisahan buta warna, dan kontras.
 *
 * KEPUTUSAN PENTING — batas jumlah seri pada peta:
 * Peta adalah bentuk "semua pasangan" (any two marks can sit side by side),
 * bukan "berpasangan". Pada uji semua-pasangan, hanya tiga slot pertama yang
 * lolos di kedua mode; slot keempat menempatkan kuning bersebelahan dengan
 * oranye dan gagal ambang.
 *
 * Karena itu tiga jenis yang diminta — rumah sakit, klinik, apotek — memakai
 * slot 1–3 dan aman secara buta warna. Dua jenis tambahan (praktik dokter,
 * pos kesehatan) hanya tampil bila dinyalakan pengguna, dan sejak awal
 * dibedakan lewat **bentuk penanda** (hue × bentuk), bukan warna saja.
 * Legenda selalu hadir, jadi identitas tidak pernah bergantung pada warna.
 *
 * Choropleth memakai satu hue berurutan (bukan kategorikal), maksimum 7 kelas.
 */

import type { FacilityKind, MetricId } from '../types';

export interface ModeColors {
  /** Permukaan kartu/peta tempat grafik digambar. */
  surface: string;
  pagePlane: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  gridline: string;
  axis: string;
  border: string;
  /** Warna teks untuk nilai yang membaik. */
  positive: string;
  negative: string;
  /** Slot kategorikal, urut dan tetap. */
  series: string[];
  /** Hue tunggal untuk skala berurutan (choropleth). */
  sequential: string[];
}

/**
 * Mode terang. Nilai dipilih untuk permukaan terang; mode gelap punya langkah
 * tersendiri dari ramp yang sama, bukan hasil pembalikan otomatis.
 */
export const LIGHT: ModeColors = {
  surface: '#fcfcfb',
  pagePlane: '#f9f9f7',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#898781',
  gridline: '#e1e0d9',
  axis: '#c3c2b7',
  border: 'rgba(11,11,11,0.10)',
  positive: '#006300',
  negative: '#d03b3b',
  series: [
    '#2a78d6', // 1 biru
    '#eb6834', // 2 oranye
    '#1baf7a', // 3 aqua
    '#eda100', // 4 kuning   (hanya untuk bentuk semua-pasangan terbatas)
    '#e87ba4', // 5 magenta
    '#008300', // 6 hijau
    '#4a3aa7', // 7 violet
    '#e34948', // 8 merah
  ],
  sequential: [
    '#cde2fb',
    '#b7d3f6',
    '#9ec5f4',
    '#86b6ef',
    '#6da7ec',
    '#5598e7',
    '#3987e5',
    '#2a78d6',
    '#256abf',
    '#1c5cab',
    '#184f95',
    '#104281',
    '#0d366b',
  ],
};

export const DARK: ModeColors = {
  surface: '#1a1a19',
  pagePlane: '#0d0d0d',
  textPrimary: '#ffffff',
  textSecondary: '#c3c2b7',
  textMuted: '#898781',
  gridline: '#2c2c2a',
  axis: '#383835',
  border: 'rgba(255,255,255,0.10)',
  positive: '#0ca30c',
  negative: '#e66767',
  series: [
    '#3987e5', // 1 biru
    '#d95926', // 2 oranye
    '#199e70', // 3 aqua
    '#c98500', // 4 kuning
    '#d55181', // 5 magenta
    '#008300', // 6 hijau
    '#9085e9', // 7 violet
    '#e66767', // 8 merah
  ],
  sequential: [
    '#0d366b',
    '#104281',
    '#184f95',
    '#1c5cab',
    '#256abf',
    '#2a78d6',
    '#3987e5',
    '#5598e7',
    '#6da7ec',
    '#86b6ef',
    '#9ec5f4',
    '#b7d3f6',
    '#cde2fb',
  ],
};

/** Warna status — makna tetap, tidak pernah dipakai sebagai warna seri. */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/**
 * Jenis fasilitas yang aman ditampilkan bersamaan sebagai penanda peta.
 * Tiga jenis ini adalah yang diminta pengguna dan sesuai batas uji
 * semua-pasangan. Jenis di luar daftar ini tetap ada di data dan di daftar
 * fasilitas, tetapi layer petanya harus dinyalakan secara sadar.
 */
export const MAP_PRIMARY_KINDS: FacilityKind[] = ['hospital', 'clinic', 'pharmacy'];

/**
 * Bentuk penanda per jenis. Ini kanal identitas kedua di samping warna,
 * sehingga pengguna dengan buta warna total tetap dapat membedakan jenis.
 */
export const KIND_SHAPE: Record<FacilityKind, 'circle' | 'square' | 'diamond' | 'triangle' | 'cross'> = {
  hospital: 'circle',
  clinic: 'square',
  pharmacy: 'diamond',
  doctor: 'triangle',
  health_post: 'cross',
};

export function colorsFor(mode: 'light' | 'dark'): ModeColors {
  return mode === 'dark' ? DARK : LIGHT;
}

/** Warna seri untuk sebuah jenis fasilitas. */
export function kindColor(kind: FacilityKind, mode: 'light' | 'dark', slot: number): string {
  void kind;
  const palette = colorsFor(mode);
  return palette.series[slot % palette.series.length];
}

/** Langkah ramp berurutan untuk indeks kelas choropleth (0 = terendah). */
export function sequentialStep(classIndex: number, classCount: number, mode: 'light' | 'dark'): string {
  const ramp = colorsFor(mode).sequential;
  if (classCount <= 1) return ramp[Math.floor(ramp.length / 2)];
  const span = ramp.length - 1;
  // Kelas terendah memakai langkah paling terang, tertinggi paling gelap.
  const position = Math.round((classIndex / (classCount - 1)) * span);
  return ramp[Math.max(0, Math.min(span, position))];
}

/** Warna teks yang kontras di atas sebuah isian (dipakai pada label di dalam peta). */
export function inkOn(backgroundHex: string, light: ModeColors, dark: ModeColors): string {
  const { r, g, b } = hexToRgb(backgroundHex);
  // Luminance relatif sederhana; cukup untuk memilih hitam atau putih.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  void light;
  void dark;
  return luminance > 0.55 ? '#0b0b0b' : '#ffffff';
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Palet kategorikal aktif, untuk divalidasi maupun dipakai grafik. */
export function categoricalPalette(mode: 'light' | 'dark', slots = 3): string[] {
  return colorsFor(mode).series.slice(0, slots);
}

/** Label sumbu choropleth, dipakai legenda. */
export const CHOROPLETH_NOTE =
  'Skala warna berurutan satu hue: makin gelap, makin tinggi nilainya.';

export interface MetricColorHint {
  metricId: MetricId;
  note: string;
}

/**
 * Metrik yang punya arah "semakin tinggi semakin baik" tetap memakai skala
 * berurutan yang sama; arahnya dijelaskan di legenda dan label, bukan dengan
 * membalik hue.
 */
export const METRIC_NOTES: Record<MetricId, string> = {
  density: 'Makin gelap berarti penduduk makin padat.',
  facilityRatio: 'Makin gelap berarti fasilitas makin banyak per 1.000 penduduk.',
  nearestDistance: 'Makin gelap berarti jarak ke fasilitas terdekat makin jauh.',
  coverage: 'Makin gelap berarti cakupan radius makin luas.',
  priorityScore: 'Makin gelap berarti wilayah makin perlu perhatian.',
  facilityCount: 'Makin gelap berarti jumlah fasilitas makin banyak.',
};