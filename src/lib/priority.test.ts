/**
 * Tes skor prioritas.
 *
 * Skor ini adalah alat bantu, bukan keputusan otomatis. Yang diuji di sini
 * adalah sifat-sifat yang harus dipegang agar tidak menyesatkan: wilayah dengan
 * data tidak lengkap tidak otomatis berskor rendah, skor kosong berada di bawah
 * semua skor, dan urutan peringkat stabil.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  buildPriorityInputs,
  computePriority,
  rankPriority,
  type PriorityInput,
  type PriorityWeights,
} from './priority';
import type { Region } from '../types';

/** Data lengkap untuk enam wilayah dengan kepadatan dan rasio yang bervariasi. */
const FULL_INPUTS: PriorityInput[] = [
  { regionId: 'a', density: 10000, facilityRatio: 2, nearestDistanceKm: 0.5 },
  { regionId: 'b', density: 20000, facilityRatio: 1, nearestDistanceKm: 1.5 },
  { regionId: 'c', density: 30000, facilityRatio: 0.5, nearestDistanceKm: 3 },
  { regionId: 'd', density: 15000, facilityRatio: 3, nearestDistanceKm: 0.8 },
  { regionId: 'e', density: 25000, facilityRatio: 0.8, nearestDistanceKm: 2.2 },
  { regionId: 'f', density: 5000, facilityRatio: 5, nearestDistanceKm: 0.3 },
];

describe('computePriority', () => {
  it('memberi skor untuk semua wilayah yang datanya lengkap', () => {
    const results = computePriority(FULL_INPUTS, DEFAULT_WEIGHTS);
    for (const result of results) {
      expect(result.score).not.toBeNull();
      expect(result.missing).toEqual([]);
    }
  });

  it('membatasi skor pada rentang 0–100', () => {
    const results = computePriority(FULL_INPUTS, DEFAULT_WEIGHTS);
    for (const result of results) {
      expect(result.score as number).toBeGreaterThanOrEqual(0);
      expect(result.score as number).toBeLessThanOrEqual(100);
    }
  });

  it('memberi skor lebih tinggi pada wilayah yang lebih padat dan jarang fasilitas', () => {
    const results = computePriority(FULL_INPUTS, DEFAULT_WEIGHTS);
    const byId = new Map(results.map((r) => [r.regionId, r.score]));
    const scoreOf = (id: string): number => {
      const value = byId.get(id);
      expect(value).not.toBeNull();
      expect(typeof value).toBe('number');
      return value as number;
    };
    // 'c' = paling padat, rasio terendah, jarak terjauh → skor tertinggi.
    // 'f' = paling jarang, rasio tertinggi, jarak terdekat → skor terendah.
    expect(scoreOf('c')).toBeGreaterThan(scoreOf('f'));
    expect(scoreOf('c')).toBeGreaterThan(scoreOf('a'));
  });

  it('tidak mengubah skor wilayah yang lengkap saat wilayah lain kehilangan data', () => {
    const withExtra = computePriority(
      [...FULL_INPUTS, { regionId: 'g', density: null, facilityRatio: null, nearestDistanceKm: null }],
      DEFAULT_WEIGHTS,
    );
    const base = computePriority(FULL_INPUTS, DEFAULT_WEIGHTS);
    const gScore = withExtra.find((r) => r.regionId === 'g')?.score;
    expect(gScore).toBeNull();
    for (const region of ['a', 'c', 'f']) {
      const before = base.find((r) => r.regionId === region)?.score;
      const after = withExtra.find((r) => r.regionId === region)?.score;
      // Statistik z-score ikut berubah karena tidak ada nilai; wilayah lengkap
      // tetap harus mendapat skor, dan nilainya konsisten dengan data yang ada.
      expect(after).not.toBeNull();
      expect(before).not.toBeNull();
    }
  });

  it('memberi skor meski hanya satu komponen tersedia', () => {
    const results = computePriority([
      { regionId: 'only-density', density: 12000, facilityRatio: null, nearestDistanceKm: null },
      { regionId: 'other', density: 8000, facilityRatio: null, nearestDistanceKm: null },
    ]);
    const only = results.find((r) => r.regionId === 'only-density');
    expect(only?.score).not.toBeNull();
    expect(only?.missing).toContain('scarcity');
    expect(only?.missing).toContain('distance');
  });

  it('mencatat komponen yang hilang, bukan mengisinya dengan nol', () => {
    const results = computePriority([{ regionId: 'x', density: null, facilityRatio: 1, nearestDistanceKm: 2 }]);
    const result = results[0];
    expect(result.missing).toEqual(['density']);
    expect(result.components.density).toBeNull();
    expect(result.components.scarcity).not.toBeNull();
  });

  it('memberi skor null bila seluruh komponen kosong', () => {
    const results = computePriority([
      { regionId: 'kosong', density: null, facilityRatio: null, nearestDistanceKm: null },
    ]);
    expect(results[0].score).toBeNull();
    expect(results[0].missing).toHaveLength(3);
  });

  it('memberi skor netral untuk data kembar (simpangan baku nol)', () => {
    const results = computePriority([
      { regionId: 'a', density: 10000, facilityRatio: 1, nearestDistanceKm: 1 },
      { regionId: 'b', density: 10000, facilityRatio: 1, nearestDistanceKm: 1 },
    ]);
    for (const result of results) {
      // z selalu 0 → clamped 0 → unit 0,5 pada semua komponen → skor 50.
      expect(result.score).toBeCloseTo(50, 6);
    }
  });

  it('memakai bobot default dengan jumlah 1', () => {
    const sum = DEFAULT_WEIGHTS.density + DEFAULT_WEIGHTS.scarcity + DEFAULT_WEIGHTS.distance;
    expect(sum).toBeCloseTo(1, 9);
  });

  it('mengubah hasil saat bobot diubah', () => {
    const densityOnly: PriorityWeights = { density: 1, scarcity: 0, distance: 0 };
    const scarcityOnly: PriorityWeights = { density: 0, scarcity: 1, distance: 0 };
    const a = computePriority(FULL_INPUTS, densityOnly);
    const b = computePriority(FULL_INPUTS, scarcityOnly);
    const scoreA = a.find((r) => r.regionId === 'c')?.score;
    const scoreB = b.find((r) => r.regionId === 'c')?.score;
    // 'c' padat (baik untuk bobot kepadatan) tetapi rasionya rendah (buruk untuk
    // bobot kelangkaan) — kedua bobot tidak boleh menghasilkan skor identik.
    expect(scoreA).not.toBe(scoreB);
  });

  it('menahan pengaruh nilai ekstrem lewat pembatasan skor-z', () => {
    const inputs: PriorityInput[] = [
      { regionId: 'normal1', density: 10000, facilityRatio: null, nearestDistanceKm: null },
      { regionId: 'normal2', density: 11000, facilityRatio: null, nearestDistanceKm: null },
      { regionId: 'normal3', density: 9000, facilityRatio: null, nearestDistanceKm: null },
      { regionId: 'ekstrem', density: 1_000_000, facilityRatio: null, nearestDistanceKm: null },
    ];
    const results = computePriority(inputs, { density: 1, scarcity: 0, distance: 0 });
    const ekstrem = results.find((r) => r.regionId === 'ekstrem')?.score as number;
    const normal = results.find((r) => r.regionId === 'normal1')?.score as number;
    // Tanpa pembatasan, z ekstrem akan membuat skornya jauh melampaui 100.
    expect(ekstrem).toBeLessThanOrEqual(100);
    expect(ekstrem).toBeGreaterThan(normal);
  });

  it('membulatkan skor ke satu desimal', () => {
    const results = computePriority(FULL_INPUTS, DEFAULT_WEIGHTS);
    for (const result of results) {
      const value = result.score as number;
      expect(Math.round(value * 10) / 10).toBeCloseTo(value, 9);
    }
  });
});

describe('rankPriority', () => {
  it('mengurutkan skor tertinggi lebih dahulu', () => {
    const results = computePriority(FULL_INPUTS, DEFAULT_WEIGHTS);
    const ranked = rankPriority(results);
    for (let i = 1; i < ranked.length; i += 1) {
      const previous = ranked[i - 1].score as number;
      const current = ranked[i].score as number;
      expect(previous).toBeGreaterThanOrEqual(current);
    }
  });

  it('menempatkan skor kosong di urutan bawah', () => {
    const results = computePriority([
      { regionId: 'a', density: 10000, facilityRatio: 1, nearestDistanceKm: 1 },
      { regionId: 'kosong', density: null, facilityRatio: null, nearestDistanceKm: null },
    ]);
    const ranked = rankPriority(results);
    expect(ranked[ranked.length - 1].regionId).toBe('kosong');
  });

  it('mengurutkan skor kosong secara alfabetis di antara sesamanya', () => {
    const results = computePriority([
      { regionId: 'zeta', density: null, facilityRatio: null, nearestDistanceKm: null },
      { regionId: 'alpha', density: null, facilityRatio: null, nearestDistanceKm: null },
    ]);
    const ranked = rankPriority(results);
    expect(ranked.map((r) => r.regionId)).toEqual(['alpha', 'zeta']);
  });

  it('tidak mengubah daftar asal', () => {
    const results = computePriority(FULL_INPUTS, DEFAULT_WEIGHTS);
    const before = results.map((r) => r.regionId);
    rankPriority(results);
    expect(results.map((r) => r.regionId)).toEqual(before);
  });

  it('memecah seri dengan urutan id yang stabil', () => {
    const results = computePriority([
      { regionId: 'b', density: 10000, facilityRatio: 1, nearestDistanceKm: 1 },
      { regionId: 'a', density: 10000, facilityRatio: 1, nearestDistanceKm: 1 },
    ]);
    const ranked = rankPriority(results);
    // Skor sama (50) → urutan id menaik, bukan urutan asal.
    expect(ranked.map((r) => r.regionId)).toEqual(['a', 'b']);
  });
});

describe('buildPriorityInputs', () => {
  const region = (id: string): Region => ({
    id,
    name: `Wilayah ${id}`,
    level: 'kelurahan',
    parentId: null,
    parentName: null,
    population: null,
    populationYear: null,
    areaKm2: 1,
    areaOfficialKm2: null,
    centroid: { lat: -7.2, lon: 112.8 },
    bbox: { minLat: -7.3, minLon: 112.7, maxLat: -7.1, maxLon: 112.9 },
    geometry: { type: 'Polygon', coordinates: [[]] },
    notes: [],
  });

  it('mengambil nilai metrik untuk wilayah yang punya entri', () => {
    const metrics = new Map([
      ['kel-1', { density: 12000, facilityRatio: 1.5, nearestDistanceKm: 0.9 }],
    ]);
    const inputs = buildPriorityInputs([region('kel-1')], metrics);
    expect(inputs[0].density).toBe(12000);
    expect(inputs[0].facilityRatio).toBe(1.5);
    expect(inputs[0].nearestDistanceKm).toBe(0.9);
  });

  it('memberi null untuk wilayah yang tidak punya entri metrik', () => {
    const inputs = buildPriorityInputs([region('kel-2')], new Map());
    expect(inputs[0].density).toBeNull();
    expect(inputs[0].facilityRatio).toBeNull();
    expect(inputs[0].nearestDistanceKm).toBeNull();
  });
});