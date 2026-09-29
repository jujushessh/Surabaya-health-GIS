/**
 * Tes pemilihan metrik awal.
 *
 * Yang dijaga di sini: aplikasi tidak boleh membuka peta pada metrik yang
 * tidak dapat dihitung dari data yang tersedia. Bila angka penduduk belum
 * diisi, metrik kepadatan akan kosong untuk seluruh wilayah dan peta tampak
 * rusak — padahal datanya memang belum ada, bukan salah gambar.
 */

import { describe, expect, it } from 'vitest';
import type { Region } from '../types';
import { initialMetricFor, metricNeedsPopulation, populationAvailableIn } from './DataProvider';

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'kec-1',
    name: 'Kecamatan Uji',
    level: 'kecamatan',
    parentId: null,
    parentName: null,
    population: null,
    populationYear: null,
    areaKm2: 10,
    areaOfficialKm2: null,
    centroid: { lat: -7.26, lon: 112.75 },
    bbox: { minLat: -7.3, minLon: 112.7, maxLat: -7.2, maxLon: 112.8 },
    geometry: { type: 'Polygon', coordinates: [[]] },
    notes: [],
    ...overrides,
  };
}

describe('metricNeedsPopulation', () => {
  it('menandai metrik yang bergantung pada angka penduduk', () => {
    expect(metricNeedsPopulation('density')).toBe(true);
    expect(metricNeedsPopulation('facilityRatio')).toBe(true);
    expect(metricNeedsPopulation('priorityScore')).toBe(true);
  });

  it('tidak menandai metrik yang bisa dihitung tanpa penduduk', () => {
    expect(metricNeedsPopulation('nearestDistance')).toBe(false);
    expect(metricNeedsPopulation('coverage')).toBe(false);
    expect(metricNeedsPopulation('facilityCount')).toBe(false);
  });
});

describe('populationAvailableIn', () => {
  it('bernilai benar bila ada satu wilayah berpenduduk', () => {
    expect(populationAvailableIn([makeRegion(), makeRegion({ population: 0 })])).toBe(true);
  });

  it('bernilai salah bila seluruh penduduk null', () => {
    expect(populationAvailableIn([makeRegion(), makeRegion()])).toBe(false);
  });

  it('bernilai salah untuk daftar kosong', () => {
    expect(populationAvailableIn([])).toBe(false);
  });

  it('menghitung nol penduduk sebagai tersedia, bukan hilang', () => {
    // Nol penduduk adalah angka yang sah; null yang berarti belum ada data.
    expect(populationAvailableIn([makeRegion({ population: 0 })])).toBe(true);
  });
});

describe('initialMetricFor', () => {
  it('mempertahankan metrik kepadatan bila penduduk sudah ada', () => {
    const regions = [makeRegion({ population: 120000 })];
    expect(initialMetricFor(regions, 'density')).toBe('density');
  });

  it('mengalihkan dari kepadatan ke jarak terdekat bila penduduk belum ada', () => {
    const regions = [makeRegion(), makeRegion()];
    expect(initialMetricFor(regions, 'density')).toBe('nearestDistance');
  });

  it('mengalihkan dari rasio fasilitas dan skor prioritas juga', () => {
    const regions = [makeRegion()];
    expect(initialMetricFor(regions, 'facilityRatio')).toBe('nearestDistance');
    expect(initialMetricFor(regions, 'priorityScore')).toBe('nearestDistance');
  });

  it('tidak mengubah metrik yang tidak butuh penduduk', () => {
    const regions = [makeRegion()];
    expect(initialMetricFor(regions, 'facilityCount')).toBe('facilityCount');
    expect(initialMetricFor(regions, 'coverage')).toBe('coverage');
  });

  it('memakai kepadatan sebagai pilihan awal bila tidak disebutkan', () => {
    expect(initialMetricFor([makeRegion({ population: 1 })])).toBe('density');
  });
});