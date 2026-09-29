/**
 * Skor prioritas wilayah.
 *
 * Skor ini adalah alat bantu penyaringan, bukan keputusan otomatis: bobot
 * ditampilkan dan dapat diubah pengguna, dan seluruh nilai mentah penyusunnya
 * ikut ditampilkan agar setiap angka dapat ditelusuri kembali. Arah skor
 * adalah "semakin tinggi semakin perlu perhatian": penduduk padat, fasilitas
 * sedikit, dan jarak jauh semuanya menaikkan skor.
 */

import type { Region } from '../types';

export interface PriorityWeights {
  /** Bobot kepadatan penduduk tinggi. */
  density: number;
  /** Bobot rasio fasilitas rendah. */
  scarcity: number;
  /** Bobot jarak jauh ke fasilitas terdekat. */
  distance: number;
}

export const DEFAULT_WEIGHTS: PriorityWeights = {
  density: 0.4,
  scarcity: 0.35,
  distance: 0.25,
};

export type PriorityComponent = 'density' | 'scarcity' | 'distance';

export interface PriorityInput {
  regionId: string;
  density: number | null;
  facilityRatio: number | null;
  nearestDistanceKm: number | null;
}

export interface PriorityResult {
  regionId: string;
  /** Nilai 0–100, dibulatkan satu desimal. */
  score: number | null;
  components: Record<PriorityComponent, number | null>;
  /** Komponen yang tidak tersedia karena datanya kosong. */
  missing: PriorityComponent[];
}

/** Rata-rata dan simpangan baku dari nilai yang tersedia. */
function stats(values: number[]): { mean: number; sd: number } | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, sd: 0 };
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * Ubah nilai menjadi skor 0–1 memakai skor-z yang dipetakan ke rentang
 * tetap. Pemetaan ini menahan pengaruh nilai ekstrem: wilayah dengan
 * kepadatan jauh di atas rata-rata tidak langsung mendominasi seluruh skor.
 */
function zToUnit(value: number, mean: number, sd: number, higherIsWorse: boolean): number {
  if (sd === 0) return 0.5;
  const z = (value - mean) / sd;
  const clamped = Math.max(-2.5, Math.min(2.5, z));
  const unit = (clamped + 2.5) / 5; // 0..1
  return higherIsWorse ? unit : 1 - unit;
}

/**
 * Hitung skor prioritas untuk sekumpulan wilayah.
 *
 * Wilayah yang datanya tidak lengkap tetap mendapat skor selama minimal satu
 * komponennya tersedia; komponen yang kosong diisi 0,5 (netral) dan dicatat
 * di `missing` supaya antarmuka bisa memberi tanda "data belum lengkap".
 */
export function computePriority(
  inputs: PriorityInput[],
  weights: PriorityWeights = DEFAULT_WEIGHTS,
  kind: 'kelurahan' | 'kecamatan' = 'kelurahan',
): PriorityResult[] {
  const densityStats = stats(
    inputs.map((i) => i.density).filter((v): v is number => v !== null),
  );
  const ratioStats = stats(
    inputs.map((i) => i.facilityRatio).filter((v): v is number => v !== null),
  );
  const distanceStats = stats(
    inputs.map((i) => i.nearestDistanceKm).filter((v): v is number => v !== null),
  );

  // Seluruh kalkulasi z-score memakai statistik dari level yang sama
  // (kelurahan dibanding kelurahan, kecamatan dibanding kecamatan).
  void kind;

  return inputs.map((input) => {
    const missing: PriorityComponent[] = [];

    let densityUnit: number | null = null;
    if (input.density !== null && densityStats) {
      densityUnit = zToUnit(input.density, densityStats.mean, densityStats.sd, true);
    } else {
      missing.push('density');
    }

    let scarcityUnit: number | null = null;
    if (input.facilityRatio !== null && ratioStats) {
      // Rasio tinggi = fasilitas banyak = lebih baik, jadi higherIsWorse false.
      scarcityUnit = zToUnit(input.facilityRatio, ratioStats.mean, ratioStats.sd, false);
    } else {
      missing.push('scarcity');
    }

    let distanceUnit: number | null = null;
    if (input.nearestDistanceKm !== null && distanceStats) {
      distanceUnit = zToUnit(input.nearestDistanceKm, distanceStats.mean, distanceStats.sd, true);
    } else {
      missing.push('distance');
    }

    const active: { key: PriorityComponent; unit: number; weight: number }[] = [];
    if (densityUnit !== null) active.push({ key: 'density', unit: densityUnit, weight: weights.density });
    if (scarcityUnit !== null)
      active.push({ key: 'scarcity', unit: scarcityUnit, weight: weights.scarcity });
    if (distanceUnit !== null)
      active.push({ key: 'distance', unit: distanceUnit, weight: weights.distance });

    if (active.length === 0) {
      return {
        regionId: input.regionId,
        score: null,
        components: { density: null, scarcity: null, distance: null },
        missing,
      };
    }

    // Bobot dinormalisasi ulang terhadap komponen yang benar-benar tersedia,
    // supaya wilayah dengan data sebagian tidak otomatis berskor rendah.
    const weightSum = active.reduce((acc, a) => acc + a.weight, 0);
    const effectiveSum = weightSum > 0 ? weightSum : active.length;
    const score =
      active.reduce((acc, a) => acc + a.unit * (weightSum > 0 ? a.weight : 1), 0) / effectiveSum;

    return {
      regionId: input.regionId,
      score: Math.round(score * 1000) / 10,
      components: {
        density: densityUnit,
        scarcity: scarcityUnit,
        distance: distanceUnit,
      },
      missing,
    };
  });
}

/** Peringkat wilayah berdasarkan skor; skor kosong selalu di urutan bawah. */
export function rankPriority(results: PriorityResult[]): PriorityResult[] {
  return [...results].sort((a, b) => {
    if (a.score === null && b.score === null) return a.regionId.localeCompare(b.regionId);
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    if (b.score !== a.score) return b.score - a.score;
    return a.regionId.localeCompare(b.regionId);
  });
}

/** Bangun input skor prioritas dari data wilayah dan metrik yang dihitung. */
export function buildPriorityInputs(
  regions: Region[],
  metrics: Map<string, { density: number | null; facilityRatio: number | null; nearestDistanceKm: number | null }>,
): PriorityInput[] {
  return regions.map((region) => {
    const metric = metrics.get(region.id);
    return {
      regionId: region.id,
      density: metric?.density ?? null,
      facilityRatio: metric?.facilityRatio ?? null,
      nearestDistanceKm: metric?.nearestDistanceKm ?? null,
    };
  });
}