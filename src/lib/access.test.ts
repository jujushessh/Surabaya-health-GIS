/**
 * Tes perhitungan aksesibilitas.
 *
 * Yang dijaga di sini adalah disiplin "null bukan nol": wilayah tanpa fasilitas
 * atau tanpa sampel grid harus menghasilkan `null`, bukan 0, supaya antarmuka
 * tidak pernah menampilkan "jarak 0 km" untuk data yang sebenarnya tidak ada.
 */

import { describe, expect, it } from 'vitest';
import type { Facility, Region, RegionGeometry } from '../types';
import {
  COVERAGE_RADII_KM,
  analyzeRegion,
  analyzeRegions,
  coverageFromPoints,
  facilitiesWithin,
  nearestAny,
  nearestPerKind,
} from './access';
import { SpatialIndex, haversineKm } from './geo';

/**
 * Persegi kecil di sekitar pusat kota (sekitar 2,2 km × 2,2 km), dalam urutan
 * GeoJSON [lon, lat]. Sengaja kecil agar penyampelan grid tetap cepat.
 */
const SQUARE: RegionGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [112.79, -7.21],
      [112.81, -7.21],
      [112.81, -7.19],
      [112.79, -7.19],
      [112.79, -7.21],
    ],
  ],
};

function makeRegion(overrides: Partial<Region> = {}): Region {
  return {
    id: 'kel-1',
    name: 'Kelurahan Uji',
    level: 'kelurahan',
    parentId: 'kec-1',
    parentName: 'Kecamatan Uji',
    population: 10000,
    populationYear: 2023,
    areaKm2: 4,
    areaOfficialKm2: null,
    centroid: { lat: -7.2, lon: 112.8 },
    bbox: { minLat: -7.21, minLon: 112.79, maxLat: -7.19, maxLon: 112.81 },
    geometry: SQUARE,
    notes: [],
    ...overrides,
  };
}

function makeFacility(id: string, kind: Facility['kind'], lat: number, lon: number): Facility {
  return { id, name: `Fasilitas ${id}`, kind, lat, lon, source: 'demo' };
}

const HOSPITAL = makeFacility('rs-1', 'hospital', -7.2, 112.8);

describe('nearestPerKind', () => {
  it('mengembalikan satu hasil untuk setiap jenis yang diminta', () => {
    const index = new SpatialIndex([HOSPITAL]);
    const result = nearestPerKind({ lat: -7.2, lon: 112.8 }, index, ['hospital', 'clinic']);
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('hospital');
    expect(result[1].kind).toBe('clinic');
  });

  it('mengisi km dan id untuk jenis yang tersedia', () => {
    const index = new SpatialIndex([HOSPITAL]);
    const [hospital] = nearestPerKind({ lat: -7.2, lon: 112.8 }, index, ['hospital']);
    expect(hospital.km).toBeCloseTo(0, 6);
    expect(hospital.facilityId).toBe('rs-1');
    expect(hospital.facilityName).toBe('Fasilitas rs-1');
  });

  it('memberi null — bukan 0 — untuk jenis yang tidak ada', () => {
    const index = new SpatialIndex([HOSPITAL]);
    const [clinic] = nearestPerKind({ lat: -7.2, lon: 112.8 }, index, ['clinic']);
    expect(clinic.km).toBeNull();
    expect(clinic.facilityId).toBeNull();
    expect(clinic.facilityName).toBeNull();
  });

  it('memilih fasilitas terdekat, bukan yang pertama di daftar', () => {
    const far = makeFacility('rs-jauh', 'hospital', -7.29, 112.89);
    const near = makeFacility('rs-dekat', 'hospital', -7.201, 112.801);
    const index = new SpatialIndex([far, near]);
    const [hospital] = nearestPerKind({ lat: -7.2, lon: 112.8 }, index, ['hospital']);
    expect(hospital.facilityId).toBe('rs-dekat');
  });
});

describe('nearestAny', () => {
  it('mengambil nilai terkecil dari yang tersedia', () => {
    const result = nearestAny([
      { kind: 'hospital', km: 2.5, facilityId: 'a', facilityName: 'A' },
      { kind: 'clinic', km: 0.7, facilityId: 'b', facilityName: 'B' },
      { kind: 'pharmacy', km: null, facilityId: null, facilityName: null },
    ]);
    expect(result).toBeCloseTo(0.7, 6);
  });

  it('mengembalikan null bila semua jenis kosong', () => {
    const result = nearestAny([
      { kind: 'hospital', km: null, facilityId: null, facilityName: null },
      { kind: 'clinic', km: null, facilityId: null, facilityName: null },
    ]);
    expect(result).toBeNull();
  });

  it('mengembalikan null untuk daftar kosong', () => {
    expect(nearestAny([])).toBeNull();
  });
});

describe('coverageFromPoints', () => {
  it('mengembalikan null bila tidak ada titik sampel', () => {
    const index = new SpatialIndex([HOSPITAL]);
    expect(coverageFromPoints([], index, 1)).toBeNull();
  });

  it('memberi 100% bila semua titik berada dalam radius', () => {
    const index = new SpatialIndex([HOSPITAL]);
    // Titik sangat dekat dengan fasilitas.
    const points = [
      { lat: -7.2, lon: 112.8 },
      { lat: -7.2005, lon: 112.8005 },
    ];
    expect(coverageFromPoints(points, index, 1)).toBeCloseTo(100, 6);
  });

  it('memberi 0% bila tidak ada titik yang tercakup', () => {
    const index = new SpatialIndex([HOSPITAL]);
    // Titik di ujung lain, jauh lebih dari 1 km.
    const points = [{ lat: -7.29, lon: 112.89 }];
    expect(coverageFromPoints(points, index, 1)).toBeCloseTo(0, 6);
  });

  it('menghitung proporsi sebagian dengan benar', () => {
    const index = new SpatialIndex([HOSPITAL]);
    const points = [
      { lat: -7.2, lon: 112.8 }, // tercakup
      { lat: -7.29, lon: 112.89 }, // tidak tercakup
    ];
    expect(coverageFromPoints(points, index, 1)).toBeCloseTo(50, 6);
  });

  it('memberi 0% — bukan 50% — bila tidak ada fasilitas sama sekali', () => {
    const index = new SpatialIndex<Facility>([]);
    const points = [{ lat: -7.2, lon: 112.8 }];
    expect(coverageFromPoints(points, index, 1)).toBeCloseTo(0, 6);
  });
});

describe('analyzeRegion', () => {
  it('mengisi semua radius cakupan yang didefinisikan', () => {
    const index = new SpatialIndex([HOSPITAL]);
    const access = analyzeRegion(makeRegion(), index);
    for (const radius of COVERAGE_RADII_KM) {
      expect(access.coverage[radius]).not.toBeUndefined();
    }
  });

  it('memakai id wilayah yang benar', () => {
    const index = new SpatialIndex([HOSPITAL]);
    expect(analyzeRegion(makeRegion({ id: 'kel-9' }), index).regionId).toBe('kel-9');
  });

  it('memberi null untuk jarak dan cakupan bila tidak ada fasilitas', () => {
    const index = new SpatialIndex<Facility>([]);
    const access = analyzeRegion(makeRegion(), index);
    expect(access.nearestAnyKm).toBeNull();
    expect(access.worstSampleKm).toBeNull();
    expect(access.meanSampleKm).toBeNull();
    for (const radius of COVERAGE_RADII_KM) {
      // 0% tercakup memang benar (tidak ada fasilitas), bukan "data hilang".
      expect(access.coverage[radius]).toBeCloseTo(0, 6);
    }
  });

  it('menghasilkan titik sampel grid untuk wilayah yang cukup luas', () => {
    const index = new SpatialIndex([HOSPITAL]);
    const access = analyzeRegion(makeRegion(), index);
    expect(access.samplePoints).toBeGreaterThan(0);
  });

  it('jarak rata-rata grid tidak melebihi jarak terburuk', () => {
    const index = new SpatialIndex([HOSPITAL]);
    const access = analyzeRegion(makeRegion(), index);
    expect(access.meanSampleKm).not.toBeNull();
    expect(access.worstSampleKm).not.toBeNull();
    expect(access.meanSampleKm as number).toBeLessThanOrEqual(access.worstSampleKm as number);
  });

  it('jarak terburuk grid tidak kurang dari jarak dari titik pusat', () => {
    const index = new SpatialIndex([HOSPITAL]);
    const access = analyzeRegion(makeRegion(), index);
    // Titik pusat adalah anggota himpunan grid, jadi jarak terburuk >= jarak pusat.
    expect(access.worstSampleKm as number).toBeGreaterThanOrEqual(
      (access.nearestAnyKm as number) - 1e-9,
    );
  });

  it('menghormati pembatasan jenis fasilitas', () => {
    const index = new SpatialIndex([HOSPITAL]);
    const access = analyzeRegion(makeRegion(), index, ['clinic']);
    expect(access.nearestAnyKm).toBeNull();
    expect(access.nearest).toHaveLength(1);
    expect(access.nearest[0].kind).toBe('clinic');
  });
});

describe('analyzeRegions', () => {
  it('mengembalikan satu entri per wilayah', () => {
    const regions = [
      makeRegion({ id: 'kel-1' }),
      makeRegion({ id: 'kel-2', centroid: { lat: -7.25, lon: 112.85 } }),
    ];
    const index = new SpatialIndex([HOSPITAL]);
    const result = analyzeRegions(regions, [HOSPITAL], ['hospital']);
    expect(result.size).toBe(2);
    expect(result.get('kel-1')?.regionId).toBe('kel-1');
    expect(result.get('kel-2')?.regionId).toBe('kel-2');
    void index;
  });

  it('memberi hasil yang sama dengan analyzeRegion satu per satu', () => {
    const region = makeRegion();
    const facilities = [HOSPITAL, makeFacility('kl-1', 'clinic', -7.22, 112.82)];
    const bulk = analyzeRegions([region], facilities, ['hospital']);
    const single = analyzeRegion(region, new SpatialIndex(facilities), ['hospital']);
    expect(bulk.get(region.id)?.nearestAnyKm).toBeCloseTo(single.nearestAnyKm as number, 9);
    expect(bulk.get(region.id)?.samplePoints).toBe(single.samplePoints);
  });
});

describe('facilitiesWithin', () => {
  it('mengembalikan fasilitas dalam radius, terdekat lebih dahulu', () => {
    const facilities = [
      makeFacility('a', 'hospital', -7.22, 112.82), // ~2,8 km
      makeFacility('b', 'hospital', -7.205, 112.805), // ~0,8 km
      makeFacility('c', 'hospital', -7.4, 112.99), // jauh, di luar radius
    ];
    const hits = facilitiesWithin({ lat: -7.2, lon: 112.8 }, facilities, 5);
    expect(hits.map((h) => h.facility.id)).toEqual(['b', 'a']);
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i].km).toBeGreaterThanOrEqual(hits[i - 1].km);
    }
  });

  it('mengembalikan daftar kosong bila tidak ada yang dalam radius', () => {
    const hits = facilitiesWithin({ lat: -7.2, lon: 112.8 }, [makeFacility('c', 'hospital', -7.4, 112.99)], 1);
    expect(hits).toEqual([]);
  });

  it('memasukkan fasilitas yang tepat di batas radius', () => {
    const distance = 3;
    const point = { lat: -7.2, lon: 112.8 };
    // Tempatkan fasilitas persis 3 km ke utara, lalu uji dengan radius 3 km.
    const north = { lat: point.lat + distance / 111.32, lon: point.lon };
    const facility = makeFacility('tepi', 'hospital', north.lat, north.lon);
    const actual = haversineKm(point, north);
    const hits = facilitiesWithin(point, [facility], actual);
    expect(hits).toHaveLength(1);
  });

  it('memakai jarak haversine yang sama dengan fungsi geometri', () => {
    const point = { lat: -7.2, lon: 112.8 };
    const facility = makeFacility('x', 'hospital', -7.26, 112.86);
    const hits = facilitiesWithin(point, [facility], 100);
    expect(hits[0].km).toBeCloseTo(haversineKm(point, facility), 9);
  });
});