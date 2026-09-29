import { describe, expect, it } from 'vitest';

import type { LinearRing, PolygonGeometry, RegionGeometry } from '../types';
import {
  EARTH_RADIUS_KM,
  SpatialIndex,
  bboxIntersects,
  bboxOfPositions,
  bufferCircleKm,
  destinationPoint,
  geometryAreaKm2,
  geometryBBox,
  haversineKm,
  pointInGeometry,
  pointInRing,
  pointOnSurface,
  ringAreaKm2,
} from './geo';

/** Persegi sederhana dalam urutan GeoJSON [lon, lat]. */
function square(lon: number, lat: number, size: number): PolygonGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon - size, lat - size],
        [lon + size, lat - size],
        [lon + size, lat + size],
        [lon - size, lat + size],
        [lon - size, lat - size],
      ],
    ],
  };
}

describe('haversineKm', () => {
  it('mengembalikan nol untuk titik yang sama', () => {
    expect(haversineKm({ lat: -7.25, lon: 112.75 }, { lat: -7.25, lon: 112.75 })).toBeCloseTo(0, 9);
  });

  it('sama dengan panjang satu derajat lintang', () => {
    // Satu derajat busur meridian mendekati πR/180 ≈ 111,195 km.
    const km = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(km).toBeCloseTo((Math.PI * EARTH_RADIUS_KM) / 180, 1);
  });

  it('simetris terhadap urutan argumen', () => {
    const a = { lat: -7.2, lon: 112.6 };
    const b = { lat: -7.3, lon: 112.9 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it('menghitung jarak sekitar 1 km', () => {
    const km = haversineKm({ lat: -7.25, lon: 112.75 }, { lat: -7.25899, lon: 112.75 });
    expect(km).toBeGreaterThan(0.99);
    expect(km).toBeLessThan(1.01);
  });
});

describe('destinationPoint dan bufferCircleKm', () => {
  it('mengembalikan titik awal bila jaraknya nol', () => {
    const point = { lat: -7.25, lon: 112.75 };
    expect(destinationPoint(point, 45, 0).lat).toBeCloseTo(point.lat, 9);
  });

  it('menghasilkan lingkaran dengan jumlah titik yang diminta', () => {
    const center = { lat: -7.25, lon: 112.75 };
    const ring = bufferCircleKm(center, 3, 64);
    expect(ring).toHaveLength(64);
    // Setiap titik berjarak 3 km dari pusatnya.
    for (const point of ring) {
      expect(haversineKm(center, point)).toBeCloseTo(3, 1);
    }
  });
});

describe('pointInRing', () => {
  // Diambil dari poligon persegi, tetapi ditipekan sebagai LinearRing agar
  // penyempitan tipe tidak hilang saat diakses lewat union RegionGeometry.
  const ring: LinearRing = square(0, 0, 1).coordinates[0];

  it('menerima titik di tengah', () => {
    expect(pointInRing({ lat: 0, lon: 0 }, ring)).toBe(true);
  });

  it('menolak titik di luar', () => {
    expect(pointInRing({ lat: 5, lon: 5 }, ring)).toBe(false);
    expect(pointInRing({ lat: 0, lon: 2 }, ring)).toBe(false);
    expect(pointInRing({ lat: -2, lon: 0 }, ring)).toBe(false);
  });

  it('tidak bergantung pada titik awal perhitungan', () => {
    // Cincin yang dimulai dari titik lain harus memberi hasil sama.
    const rotated: LinearRing = [...ring];
    const first = rotated.shift()!;
    rotated.push(first);
    expect(pointInRing({ lat: 0.5, lon: 0.5 }, rotated)).toBe(true);
    expect(pointInRing({ lat: 1.5, lon: 0.5 }, rotated)).toBe(false);
  });
});

describe('pointInGeometry', () => {
  it('menolak titik yang jatuh di dalam lubang', () => {
    const withHole: RegionGeometry = {
      type: 'Polygon',
      coordinates: [
        square(0, 0, 2).coordinates[0],
        // Lubang berlawanan arah dengan cincin luar.
        [
          [-1, -1],
          [-1, 1],
          [1, 1],
          [1, -1],
          [-1, -1],
        ],
      ],
    };

    expect(pointInGeometry({ lat: 0, lon: 0 }, withHole)).toBe(false);
    expect(pointInGeometry({ lat: 1.5, lon: 0 }, withHole)).toBe(true);
  });

  it('menerima titik di salah satu bagian MultiPolygon', () => {
    const multi: RegionGeometry = {
      type: 'MultiPolygon',
      coordinates: [square(0, 0, 1).coordinates, square(10, 10, 1).coordinates],
    };
    expect(pointInGeometry({ lat: 10, lon: 10 }, multi)).toBe(true);
    expect(pointInGeometry({ lat: 5, lon: 5 }, multi)).toBe(false);
  });
});

describe('ringAreaKm2 dan geometryAreaKm2', () => {
  it('mendekati luas persegi 1° × 1° di ekuator', () => {
    const area = geometryAreaKm2(square(0, 0, 0.5));
    const expected = ((Math.PI * EARTH_RADIUS_KM) / 180) ** 2;
    expect(area).toBeGreaterThan(expected * 0.99);
    expect(area).toBeLessThan(expected * 1.01);
  });

  it('mengurangi luas lubang', () => {
    const outer = square(0, 0, 2).coordinates[0];
    const hole = square(0, 0, 1).coordinates[0];
    const withHole = geometryAreaKm2({ type: 'Polygon', coordinates: [outer, hole] });
    const solid = ringAreaKm2(outer);
    expect(withHole).toBeLessThan(solid);
    // Lubang berukuran setengah sisi berarti seperempat luas wilayah.
    expect(withHole / solid).toBeCloseTo(0.75, 1);
  });

  it('mengembalikan nol untuk cincin yang terlalu pendek', () => {
    expect(
      ringAreaKm2([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(0);
  });
});

describe('pointOnSurface', () => {
  it('memberi titik di dalam poligon cembung', () => {
    const geometry = square(112.75, -7.25, 0.02);
    expect(pointInGeometry(pointOnSurface(geometry), geometry)).toBe(true);
  });

  it('memberi titik di dalam poligon cekung berbentuk L', () => {
    // Bentuk L: sentroid kotak pembatasnya jatuh di luar wilayah, sehingga
    // fungsi ini harus mencari titik lain yang benar-benar di dalam.
    const geometry: RegionGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 1],
          [1, 1],
          [1, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    };
    expect(pointInGeometry(pointOnSurface(geometry), geometry)).toBe(true);
  });

  it('memilih bagian terluas pada MultiPolygon', () => {
    const geometry: RegionGeometry = {
      type: 'MultiPolygon',
      coordinates: [square(0, 0, 0.5).coordinates, square(20, 20, 2).coordinates],
    };
    const point = pointOnSurface(geometry);
    expect(pointInGeometry(point, geometry)).toBe(true);
    expect(point.lon).toBeCloseTo(20, 0);
  });
});

describe('geometryBBox dan bboxIntersects', () => {
  it('menghitung kotak pembatas dari seluruh cincin', () => {
    const box = geometryBBox(square(10, 20, 1));
    expect(box.minLat).toBeCloseTo(19, 9);
    expect(box.maxLat).toBeCloseTo(21, 9);
    expect(box.minLon).toBeCloseTo(9, 9);
    expect(box.maxLon).toBeCloseTo(11, 9);
  });

  it('menggabungkan beberapa posisi', () => {
    const box = bboxOfPositions([
      [112.7, -7.3],
      [112.8, -7.2],
    ]);
    expect(box.minLon).toBeCloseTo(112.7, 9);
    expect(box.maxLat).toBeCloseTo(-7.2, 9);
  });

  it('mengenali kotak yang bersinggungan dan yang terpisah', () => {
    const a = geometryBBox(square(0, 0, 1));
    const overlapping = geometryBBox(square(1, 1, 1));
    const apart = geometryBBox(square(50, 50, 1));
    expect(bboxIntersects(a, overlapping)).toBe(true);
    expect(bboxIntersects(a, apart)).toBe(false);
  });
});

describe('SpatialIndex', () => {
  const points = [
    { lat: -7.25, lon: 112.75, id: 'pusat' },
    { lat: -7.26, lon: 112.76, id: 'dekat' },
    { lat: -7.35, lon: 112.85, id: 'jauh' },
  ];

  it('menemukan titik terdekat', () => {
    const index = new SpatialIndex(points);
    const found = index.nearest(-7.2501, 112.7501);
    expect(found?.item.id).toBe('pusat');
    expect(found?.km).toBeLessThan(0.05);
  });

  it('menghormati penyaring', () => {
    const index = new SpatialIndex(points);
    const found = index.nearest(-7.25, 112.75, (point) => point.id !== 'pusat');
    expect(found?.item.id).toBe('dekat');
  });

  it('mengembalikan null untuk himpunan kosong', () => {
    const index = new SpatialIndex<{ lat: number; lon: number }>([]);
    expect(index.nearest(-7.25, 112.75)).toBeNull();
  });

  it('mengembalikan null bila penyaring menolak semua titik', () => {
    const index = new SpatialIndex(points);
    expect(index.nearest(-7.25, 112.75, () => false)).toBeNull();
  });

  it('sepakat dengan pencarian menyeluruh untuk titik yang berjauhan', () => {
    // Kasus batas penting: titik query jauh dari semua petak yang terisi,
    // sehingga pelebaran cincin harus berjalan jauh sebelum menemukan hasil.
    const index = new SpatialIndex(points);
    const query = { lat: -7.36, lon: 112.86 };
    const found = index.nearest(query.lat, query.lon);
    const brute = points
      .map((point) => ({ point, km: haversineKm(query, point) }))
      .sort((a, b) => a.km - b.km)[0];
    expect(found?.item.id).toBe(brute.point.id);
    expect(found?.km).toBeCloseTo(brute.km, 6);
  });
});