import { describe, expect, it } from 'vitest';

import type { Facility, FacilityKind, Region } from '../types';
import type { RegionGeometry } from '../types';
import { pointOnSurface } from './geo';
import {
  addCounts,
  countByKind,
  countsByRegion,
  densityOf,
  emptyCounts,
  facilityRatio,
  mergeChildren,
  summarize,
  unassignedFacilities,
} from './aggregate';

function makeRegion(
  id: string,
  name: string,
  level: 'kecamatan' | 'kelurahan',
  population: number | null,
  areaKm2: number | null,
  parentId: string | null = null,
): Region {
  const geometry: RegionGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [112.75, -7.25],
        [112.76, -7.25],
        [112.76, -7.24],
        [112.75, -7.24],
        [112.75, -7.25],
      ],
    ],
  };
  return {
    id,
    name,
    level,
    parentId,
    parentName: null,
    population,
    populationYear: 2023,
    areaKm2,
    areaOfficialKm2: null,
    centroid: pointOnSurface(geometry),
    bbox: { minLat: -7.25, minLon: 112.75, maxLat: -7.24, maxLon: 112.76 },
    geometry,
    notes: [],
  };
}

function makeFacility(id: string, kind: FacilityKind, regionId: string | null): Facility {
  return {
    id,
    name: `Fasilitas ${id}`,
    kind,
    lat: -7.245,
    lon: 112.755,
    source: 'osm',
    regionId,
    regionName: null,
  };
}

describe('countByKind dan emptyCounts', () => {
  it('menghitung setiap jenis dan totalnya', () => {
    const counts = countByKind([
      makeFacility('a', 'hospital', null),
      makeFacility('b', 'hospital', null),
      makeFacility('c', 'pharmacy', null),
    ]);
    expect(counts.hospital).toBe(2);
    expect(counts.pharmacy).toBe(1);
    expect(counts.clinic).toBe(0);
    expect(counts.total).toBe(3);
  });

  it('mengembalikan semua jenis bernilai nol untuk daftar kosong', () => {
    const counts = countByKind([]);
    expect(counts.total).toBe(0);
    expect(counts.doctor).toBe(0);
    expect(Object.keys(counts)).toHaveLength(6);
  });

  it('addCounts tidak mengubah objek sumbernya', () => {
    const base = emptyCounts();
    const added = addCounts(base, countByKind([makeFacility('a', 'clinic', null)]));
    expect(base.total).toBe(0);
    expect(added.total).toBe(1);
    expect(added.clinic).toBe(1);
  });
});

describe('countsByRegion', () => {
  it('mengabaikan fasilitas tanpa wilayah yang dikenal', () => {
    const ids = new Set(['kel-1']);
    const counts = countsByRegion(
      [
        makeFacility('a', 'hospital', 'kel-1'),
        makeFacility('b', 'pharmacy', 'kel-1'),
        makeFacility('c', 'clinic', null),
        makeFacility('d', 'clinic', 'kel-tidak-ada'),
      ],
      ids,
    );

    expect(counts.get('kel-1')?.total).toBe(2);
    expect(counts.get('kel-1')?.hospital).toBe(1);
    expect(counts.size).toBe(1);
  });

  it('menghitung fasilitas untuk wilayah induknya juga', () => {
    // Fasilitas hanya menyimpan id kelurahan. Tanpa penelusuran induk,
    // kecamatan selalu nol meski wilayahnya penuh fasilitas.
    const counts = countsByRegion(
      [
        makeFacility('a', 'hospital', 'kel-1'),
        makeFacility('b', 'clinic', 'kel-1'),
        makeFacility('c', 'clinic', 'kel-2'),
      ],
      new Set(['kec-1', 'kel-1', 'kel-2']),
      (id) => (id === 'kel-1' || id === 'kel-2' ? 'kec-1' : null),
    );

    expect(counts.get('kec-1')?.total).toBe(3);
    expect(counts.get('kec-1')?.clinic).toBe(2);
    expect(counts.get('kec-1')?.hospital).toBe(1);
    // Hitungan kelurahan tetap milik kelurahan masing-masing.
    expect(counts.get('kel-1')?.total).toBe(2);
    expect(counts.get('kel-2')?.total).toBe(1);
  });

  it('tidak menghitung ganda ketika fasilitas sudah berada di tingkat kecamatan', () => {
    // Fasilitas di luar semua kelurahan memakai id kecamatan langsung.
    const counts = countsByRegion(
      [makeFacility('a', 'clinic', 'kec-1')],
      new Set(['kec-1']),
      (id) => (id === 'kec-1' ? 'kec-1' : null),
    );
    expect(counts.get('kec-1')?.total).toBe(1);
  });

  it('mengabaikan induk yang bukan bagian dari wilayah yang diminta', () => {
    const counts = countsByRegion(
      [makeFacility('a', 'clinic', 'kel-1')],
      new Set(['kel-1']),
      () => 'kec-1',
    );
    expect(counts.has('kec-1')).toBe(false);
    expect(counts.get('kel-1')?.total).toBe(1);
  });

  it('tetap berfungsi tanpa penelusur induk', () => {
    const counts = countsByRegion([makeFacility('a', 'clinic', 'kel-1')], new Set(['kel-1']));
    expect(counts.get('kel-1')?.total).toBe(1);
  });
});

describe('densityOf', () => {
  it('membagi penduduk dengan luas', () => {
    expect(densityOf(1000, 2)).toBe(500);
  });

  it('mengembalikan null bila penduduk belum ada', () => {
    expect(densityOf(null, 2)).toBeNull();
  });

  it('mengembalikan null bila luas belum ada', () => {
    expect(densityOf(1000, null)).toBeNull();
  });

  it('mengembalikan null untuk luas nol, bukan Infinity', () => {
    expect(densityOf(1000, 0)).toBeNull();
  });
});

describe('facilityRatio', () => {
  it('menghitung fasilitas per 1.000 penduduk', () => {
    expect(facilityRatio(5, 10000)).toBeCloseTo(0.5, 9);
  });

  it('mengembalikan null bila penduduk belum ada', () => {
    expect(facilityRatio(5, null)).toBeNull();
  });

  it('mengembalikan null untuk penduduk nol, bukan Infinity', () => {
    expect(facilityRatio(5, 0)).toBeNull();
  });

  it('mengembalikan nol yang sah bila memang tidak ada fasilitas', () => {
    // Ini kasus yang berbeda dari "tidak diketahui": nol fasilitas pada
    // penduduk yang terukur memang bernilai nol.
    expect(facilityRatio(0, 10000)).toBe(0);
  });
});

describe('mergeChildren', () => {
  it('menjumlahkan kelurahan yang lengkap datanya', () => {
    const children = [
      makeRegion('kel-1', 'Satu', 'kelurahan', 1000, 1),
      makeRegion('kel-2', 'Dua', 'kelurahan', 2000, 2),
    ];
    const counts = new Map([
      ['kel-1', countByKind([makeFacility('a', 'hospital', 'kel-1')])],
      ['kel-2', countByKind([makeFacility('b', 'clinic', 'kel-2'), makeFacility('c', 'clinic', 'kel-2')])],
    ]);

    const merged = mergeChildren(children, counts);
    expect(merged.population).toBe(3000);
    expect(merged.populationComplete).toBe(true);
    expect(merged.areaKm2).toBe(3);
    expect(merged.counts.total).toBe(3);
    expect(merged.counts.clinic).toBe(2);
    expect(merged.kelurahanWithPopulation).toBe(2);
  });

  it('mengembalikan penduduk null bila ada kelurahan yang belum berdata', () => {
    // Inti dari aturan null ≠ 0: kecamatan tidak boleh menampilkan jumlah
    // yang seolah-olah lengkap padahal satu kelurahannya belum diketahui.
    const children = [
      makeRegion('kel-1', 'Satu', 'kelurahan', 1000, 1),
      makeRegion('kel-2', 'Dua', 'kelurahan', null, 2),
    ];

    const merged = mergeChildren(children, new Map());
    expect(merged.population).toBeNull();
    expect(merged.populationComplete).toBe(false);
    expect(merged.kelurahanWithPopulation).toBe(1);
    // Luas tetap dapat dijumlahkan karena luasnya diketahui keduanya.
    expect(merged.areaKm2).toBe(3);
  });

  it('mengembalikan luas null bila ada luas yang belum diketahui', () => {
    const children = [
      makeRegion('kel-1', 'Satu', 'kelurahan', 1000, 1),
      makeRegion('kel-2', 'Dua', 'kelurahan', 1000, null),
    ];
    expect(mergeChildren(children, new Map()).areaKm2).toBeNull();
  });

  it('menangani daftar kelurahan kosong tanpa galat', () => {
    const merged = mergeChildren([], new Map());
    expect(merged.population).toBe(0);
    expect(merged.populationComplete).toBe(true);
    expect(merged.kelurahanCount).toBe(0);
  });

  it('tetap menghitung fasilitas walau penduduknya tidak lengkap', () => {
    const children = [makeRegion('kel-1', 'Satu', 'kelurahan', null, 1)];
    const counts = new Map([['kel-1', countByKind([makeFacility('a', 'hospital', 'kel-1')])]]);
    const merged = mergeChildren(children, counts);
    expect(merged.population).toBeNull();
    expect(merged.counts.total).toBe(1);
  });
});

describe('unassignedFacilities', () => {
  it('menemukan fasilitas tanpa wilayah dan wilayah tak dikenal', () => {
    const result = unassignedFacilities(
      [
        makeFacility('a', 'hospital', 'kel-1'),
        makeFacility('b', 'clinic', null),
        makeFacility('c', 'pharmacy', 'kel-hilang'),
      ],
      new Set(['kel-1']),
    );
    expect(result.map((f) => f.id)).toEqual(['b', 'c']);
  });
});

describe('summarize', () => {
  it('menghitung jumlah wilayah per level', () => {
    const summary = summarize(
      [
        makeRegion('kec-1', 'Kecamatan', 'kecamatan', 5000, 10),
        makeRegion('kel-1', 'Satu', 'kelurahan', 2000, 4, 'kec-1'),
        makeRegion('kel-2', 'Dua', 'kelurahan', null, 6, 'kec-1'),
      ],
      [makeFacility('a', 'hospital', 'kel-1')],
    );

    expect(summary.regionsByLevel.kecamatan).toBe(1);
    expect(summary.regionsByLevel.kelurahan).toBe(2);
    expect(summary.facilityTotal).toBe(1);
    // Kelurahan tidak lengkap, jadi totalnya null — bukan 2000.
    expect(summary.populationTotal.kelurahan).toBeNull();
    expect(summary.populationTotal.kecamatan).toBe(5000);
  });
});