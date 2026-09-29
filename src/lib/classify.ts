/**
 * Klasifikasi nilai untuk choropleth.
 *
 * Jumlah kelas dibatasi 7: di atas itu, warna-warna bersebelahan mulai
 * berbaur dan pembaca berhenti membedakannya (lihat panduan anti-pola
 * visualisasi data). Dua metode disediakan dan dipilih di antarmuka:
 * kuantil (jumlah wilayah per kelas seimbang) dan natural breaks / Jenks
 * (kelas mengikuti pengelompokan alami nilai).
 */

export type ClassMethod = 'quantile' | 'jenks';

export interface ClassBreak {
  min: number;
  max: number;
  count: number;
}

export const MAX_CLASSES = 7;

/** Nilai minimum dan maksimum dari daftar yang sudah bersih. */
export function extent(values: number[]): [number, number] | null {
  if (values.length === 0) return null;
  let min = values[0];
  let max = values[0];
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [min, max];
}

/**
 * Batas kelas kuantil. Nilai kembar (banyak wilayah bernilai sama) dapat
 * membuat kelas berisi lebih sedikit wilayah daripada hitungan ideal — itu
 * memang sifat kuantil pada data yang banyak duplikat, bukan kesalahan.
 */
export function quantileBreaks(values: number[], classCount: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.min(Math.max(1, classCount), MAX_CLASSES, sorted.length);
  const cuts: number[] = [];
  for (let i = 1; i < k; i += 1) {
    const position = (i * sorted.length) / k;
    cuts.push(sorted[Math.min(sorted.length - 1, Math.floor(position))]);
  }
  return cleanCuts(cuts, sorted);
}

/**
 * Buang batas yang kembar atau berada di tepi rentang data.
 *
 * Sekat yang sama dengan nilai terkecil atau terbesar tidak membagi apa pun.
 * Pada data yang seluruhnya bernilai sama, hasilnya harus nol sekat — bukan
 * satu sekat yang menghasilkan kelas kosong.
 */
function cleanCuts(cuts: number[], sortedValues: number[]): number[] {
  if (sortedValues.length === 0) return [];
  const min = sortedValues[0];
  const max = sortedValues[sortedValues.length - 1];
  const unique: number[] = [];
  for (const cut of cuts) {
    if (cut <= min || cut >= max) continue;
    if (unique.length === 0 || cut > unique[unique.length - 1]) unique.push(cut);
  }
  return unique;
}

/**
 * Variansi total terhadap rata-rata kelas, ukuran kualitas pengelompokan
 * yang diminimalkan oleh algoritma Jenks.
 */
function sumSquaredError(sorted: number[], start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += sorted[i];
  const mean = sum / (end - start);
  let sse = 0;
  for (let i = start; i < end; i += 1) sse += (sorted[i] - mean) ** 2;
  return sse;
}

/**
 * Batas kelas natural breaks (Jenks) secara eksak dengan pemrograman dinamis.
 *
 * Jumlah wilayah Surabaya hanya ratusan, sehingga O(k·n²) masih sangat cepat
 * dan hasilnya optimal — tidak perlu versi aproksimasi.
 */
export function jenksBreaks(values: number[], classCount: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const k = Math.min(Math.max(1, classCount), MAX_CLASSES, n);

  // Satu kelas berarti tidak ada sekat sama sekali.
  if (k <= 1) return [];

  if (n <= k) {
    // Lebih sedikit data daripada kelas yang diminta: tiap nilai unik menjadi
    // kelasnya sendiri, sehingga sekatnya adalah nilai-nilai selain yang
    // pertama dan terakhir (keduanya dipakai sebagai tepi rentang).
    return cleanCuts(sorted.slice(1), sorted);
  }

  const sse = (i: number, j: number): number => sumSquaredError(sorted, i, j);

  // best[j][i] = total SSE terkecil untuk i kelas atas j data pertama.
  const best: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
  const splitAt: number[][] = Array.from({ length: k + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let j = 1; j <= n; j += 1) best[1][j] = sse(0, j);

  for (let i = 2; i <= k; i += 1) {
    for (let j = i; j <= n; j += 1) {
      let lowest = Infinity;
      let bestSplit = i - 1;
      for (let m = i - 1; m < j; m += 1) {
        const cost = best[i - 1][m] + sse(m, j);
        if (cost < lowest) {
          lowest = cost;
          bestSplit = m;
        }
      }
      best[i][j] = lowest;
      splitAt[i][j] = bestSplit;
    }
  }

  const cuts: number[] = [];
  let j = n;
  for (let i = k; i > 1; i -= 1) {
    const split = splitAt[i][j];
    cuts.push(sorted[split - 1]);
    j = split;
  }

  return cleanCuts(cuts.reverse(), sorted);
}

/** Susun daftar kelas lengkap (min, max, jumlah anggota) dari batas. */
export function buildClasses(values: number[], cuts: number[]): ClassBreak[] {
  const bounds = extent(values);
  if (!bounds) return [];

  const [min, max] = bounds;
  const edges = [min, ...cuts.filter((c) => c > min && c < max), max];
  const classes: ClassBreak[] = [];

  for (let i = 0; i < edges.length - 1; i += 1) {
    const lower = edges[i];
    const upper = edges[i + 1];
    // Kelas pertama inklusif di kedua ujung, sisanya setengah terbuka
    // (lower, upper] supaya tidak ada nilai yang terhitung dua kali.
    const count = values.filter((v) => (i === 0 ? v >= lower && v <= upper : v > lower && v <= upper))
      .length;
    classes.push({ min: lower, max: upper, count });
  }

  return classes;
}

/** Indeks kelas (0 = terendah) untuk sebuah nilai. */
export function classIndexOf(value: number, classes: ClassBreak[]): number {
  if (classes.length === 0) return -1;
  for (let i = 0; i < classes.length; i += 1) {
    const cls = classes[i];
    if (i === 0 ? value >= cls.min && value <= cls.max : value > cls.min && value <= cls.max) {
      return i;
    }
  }
  return value <= classes[0].min ? 0 : classes.length - 1;
}

export interface Classification {
  method: ClassMethod;
  classes: ClassBreak[];
}

export function classify(values: number[], method: ClassMethod, classCount: number): Classification {
  const known = values.filter((v) => Number.isFinite(v));
  if (known.length === 0) return { method, classes: [] };
  const cuts = method === 'jenks' ? jenksBreaks(known, classCount) : quantileBreaks(known, classCount);
  return { method, classes: buildClasses(known, cuts) };
}