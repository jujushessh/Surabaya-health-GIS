/**
 * Tes klasifikasi choropleth.
 *
 * Dua sifat yang paling penting: jumlah kelas tidak pernah melampaui batas
 * keterbacaan (7), dan setiap nilai harus masuk tepat satu kelas — tanpa
 * celah, tanpa hitungan ganda.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_CLASSES,
  buildClasses,
  classIndexOf,
  classify,
  extent,
  jenksBreaks,
  quantileBreaks,
} from './classify';

const SPREAD = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

describe('extent', () => {
  it('mengembalikan nilai terkecil dan terbesar', () => {
    expect(extent([5, 1, 9, 3])).toEqual([1, 9]);
  });

  it('mengembalikan null untuk daftar kosong', () => {
    expect(extent([])).toBeNull();
  });

  it('bekerja untuk satu nilai', () => {
    expect(extent([7])).toEqual([7, 7]);
  });

  it('menangani nilai negatif', () => {
    expect(extent([-5, -1, -9])).toEqual([-9, -1]);
  });
});

describe('quantileBreaks', () => {
  it('menghasilkan jumlah batas satu kurangnya dari jumlah kelas', () => {
    expect(quantileBreaks(SPREAD, 4)).toHaveLength(3);
  });

  it('membatasi kelas pada MAX_CLASSES', () => {
    const cuts = quantileBreaks(SPREAD, 20);
    expect(cuts.length).toBeLessThanOrEqual(MAX_CLASSES - 1);
  });

  it('tidak melampaui jumlah nilai yang tersedia', () => {
    const cuts = quantileBreaks([1, 2], 7);
    expect(cuts.length).toBeLessThanOrEqual(1);
  });

  it('mengembalikan larik kosong untuk satu kelas', () => {
    expect(quantileBreaks(SPREAD, 1)).toEqual([]);
  });

  it('membuang batas kembar agar tidak ada kelas kosong', () => {
    // Semua nilai sama → semua batas sama → tidak ada sekat yang berarti.
    expect(quantileBreaks([5, 5, 5, 5], 4)).toEqual([]);
  });

  it('menghasilkan batas yang menaik', () => {
    const cuts = quantileBreaks(SPREAD, 5);
    for (let i = 1; i < cuts.length; i += 1) {
      expect(cuts[i]).toBeGreaterThan(cuts[i - 1]);
    }
  });
});

describe('jenksBreaks', () => {
  it('menghasilkan jumlah batas satu kurangnya dari jumlah kelas', () => {
    expect(jenksBreaks(SPREAD, 4)).toHaveLength(3);
  });

  it('menghasilkan batas yang menaik', () => {
    const cuts = jenksBreaks(SPREAD, 5);
    for (let i = 1; i < cuts.length; i += 1) {
      expect(cuts[i]).toBeGreaterThan(cuts[i - 1]);
    }
  });

  it('memisahkan kelompok yang jelas terpisah pada sekat yang tepat', () => {
    // Dua kelompok berukuran sama yang berjauhan: 1–4 dan 1001–1004.
    // Sebaran seperti ini hanya masuk akal dipecah tepat di antara keduanya.
    const values = [1, 2, 3, 4, 1001, 1002, 1003, 1004];
    const cuts = jenksBreaks(values, 2);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toBeGreaterThanOrEqual(4);
    expect(cuts[0]).toBeLessThan(1001);
  });

  it('membatasi kelas pada MAX_CLASSES', () => {
    expect(jenksBreaks(SPREAD, 20).length).toBeLessThanOrEqual(MAX_CLASSES - 1);
  });

  it('menangani data yang semuanya sama', () => {
    expect(jenksBreaks([4, 4, 4, 4], 3)).toEqual([]);
  });

  it('menangani satu kelas', () => {
    expect(jenksBreaks(SPREAD, 1)).toEqual([]);
  });

  it('tidak mengubah larik asal', () => {
    const values = [5, 3, 1, 4, 2];
    const before = [...values];
    jenksBreaks(values, 3);
    expect(values).toEqual(before);
  });
});

describe('buildClasses', () => {
  it('menyusun kelas yang mencakup seluruh rentang nilai', () => {
    const values = [1, 5, 9];
    const classes = buildClasses(values, [5]);
    expect(classes[0].min).toBe(1);
    expect(classes[classes.length - 1].max).toBe(9);
  });

  it('menghitung jumlah anggota setiap kelas secara menyeluruh', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const classes = buildClasses(values, [4, 7]);
    const total = classes.reduce((sum, cls) => sum + cls.count, 0);
    expect(total).toBe(values.length);
  });

  it('mengembalikan larik kosong untuk nilai kosong', () => {
    expect(buildClasses([], [])).toEqual([]);
  });

  it('membuat satu kelas bila tidak ada sekat', () => {
    const classes = buildClasses([1, 2, 3], []);
    expect(classes).toHaveLength(1);
    expect(classes[0].count).toBe(3);
  });

  it('menyertakan nilai batas tepat satu kali', () => {
    // Batas 5 harus masuk kelas pertama ([min, 5]) atau kedua ((5, max]), bukan keduanya.
    const values = [1, 3, 5, 7, 9];
    const classes = buildClasses(values, [5]);
    const total = classes.reduce((sum, cls) => sum + cls.count, 0);
    expect(total).toBe(values.length);
  });
});

describe('classIndexOf', () => {
  const classes = buildClasses([1, 2, 3, 4, 5], [2, 4]);

  it('menempatkan nilai minimum di kelas pertama', () => {
    expect(classIndexOf(1, classes)).toBe(0);
  });

  it('menempatkan nilai maksimum di kelas terakhir', () => {
    expect(classIndexOf(5, classes)).toBe(classes.length - 1);
  });

  it('memberi indeks yang menaik seiring nilai', () => {
    const indices = [1, 2, 3, 4, 5].map((v) => classIndexOf(v, classes));
    for (let i = 1; i < indices.length; i += 1) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
  });

  it('mengembalikan -1 untuk daftar kelas kosong', () => {
    expect(classIndexOf(5, [])).toBe(-1);
  });

  it('menjepit nilai di luar rentang', () => {
    expect(classIndexOf(-100, classes)).toBe(0);
    expect(classIndexOf(999, classes)).toBe(classes.length - 1);
  });
});

describe('classify', () => {
  it('memakai metode yang diminta', () => {
    expect(classify(SPREAD, 'quantile', 4).method).toBe('quantile');
    expect(classify(SPREAD, 'jenks', 4).method).toBe('jenks');
  });

  it('membatasi jumlah kelas pada MAX_CLASSES', () => {
    for (const method of ['quantile', 'jenks'] as const) {
      const result = classify(SPREAD, method, 50);
      expect(result.classes.length).toBeLessThanOrEqual(MAX_CLASSES);
    }
  });

  it('mengembalikan kelas kosong bila tidak ada nilai sah', () => {
    expect(classify([], 'quantile', 5).classes).toEqual([]);
    expect(classify([NaN, Infinity], 'jenks', 5).classes).toEqual([]);
  });

  it('mengabaikan nilai bukan angka', () => {
    const result = classify([1, 2, NaN, 3, Infinity, 4], 'quantile', 2);
    const total = result.classes.reduce((sum, cls) => sum + cls.count, 0);
    expect(total).toBe(4);
  });

  it('setiap nilai masuk tepat satu kelas pada kedua metode', () => {
    for (const method of ['quantile', 'jenks'] as const) {
      const result = classify(SPREAD, method, 5);
      const total = result.classes.reduce((sum, cls) => sum + cls.count, 0);
      expect(total).toBe(SPREAD.length);
    }
  });
});