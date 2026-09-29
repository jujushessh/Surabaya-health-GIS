/**
 * Agregasi wilayah: kepadatan, rasio fasilitas, dan penggabungan kelurahan
 * menjadi kecamatan.
 *
 * Prinsip yang dijaga di sini: nilai yang tidak diketahui adalah `null`, bukan 0.
 * Wilayah tanpa angka penduduk tidak boleh menampilkan rasio 0 yang terlihat
 * seperti "tidak ada fasilitas sama sekali".
 */

import type { DatasetMeta, Facility, FacilityKind, Region, RegionLevel } from '../types';
import { FACILITY_KINDS } from '../types';

export type FacilityCounts = Record<FacilityKind, number> & { total: number };

export function emptyCounts(): FacilityCounts {
  return {
    hospital: 0,
    clinic: 0,
    pharmacy: 0,
    doctor: 0,
    health_post: 0,
    total: 0,
  };
}

export function addCounts(target: FacilityCounts, source: FacilityCounts): FacilityCounts {
  const next = { ...target };
  for (const kind of FACILITY_KINDS) next[kind] += source[kind];
  next.total += source.total;
  return next;
}

/** Jumlah fasilitas per jenis untuk satu set fasilitas. */
export function countByKind(facilities: Facility[]): FacilityCounts {
  const counts = emptyCounts();
  for (const facility of facilities) {
    counts[facility.kind] += 1;
    counts.total += 1;
  }
  return counts;
}

/**
 * Jumlah fasilitas per wilayah, dihitung dari `facility.regionId`.
 * Fasilitas tanpa wilayah yang dikenal diabaikan dan dihitung sebagai anomali
 * oleh pemanggil (lihat kualitas data).
 */
export function countsByRegion(
  facilities: Facility[],
  regionIds: Set<string>,
  parentOf?: (regionId: string) => string | null,
): Map<string, FacilityCounts> {
  const perRegion = new Map<string, FacilityCounts>();

  /** Tambahkan satu fasilitas ke ember sebuah wilayah. */
  const addTo = (regionId: string, facility: Facility): void => {
    const bucket = perRegion.get(regionId);
    if (bucket) {
      bucket[facility.kind] += 1;
      bucket.total += 1;
    } else {
      const fresh = emptyCounts();
      fresh[facility.kind] = 1;
      fresh.total = 1;
      perRegion.set(regionId, fresh);
    }
  };

  for (const facility of facilities) {
    const regionId = facility.regionId;
    if (!regionId) continue;

    // Setiap fasilitas hanya menyimpan SATU id wilayah — wilayah terdalam yang
    // memuatnya (kelurahan). Tanpa menelusuri induknya, kecamatan tidak pernah
    // mendapat hitungan apa pun: seluruh fasilitas berada di dalam kelurahan,
    // sehingga setiap kecamatan selalu berjumlah nol meskipun wilayahnya penuh
    // fasilitas. Induk ditelusuri lewat `parentOf`.
    if (regionIds.has(regionId)) addTo(regionId, facility);

    const parentId = parentOf?.(regionId);
    if (parentId && parentId !== regionId && regionIds.has(parentId)) {
      addTo(parentId, facility);
    }
  }

  return perRegion;
}

/** Kepadatan penduduk (jiwa/km²). `null` bila penduduk atau luas tidak ada. */
export function densityOf(population: number | null, areaKm2: number | null): number | null {
  if (population === null || areaKm2 === null || areaKm2 <= 0) return null;
  return population / areaKm2;
}

/**
 * Fasilitas per 1.000 penduduk. `null` bila penduduk tidak diketahui atau nol —
 * pembagian dengan nol menghasilkan Infinity dan itu bukan nilai yang bermakna.
 */
export function facilityRatio(facilityCount: number, population: number | null): number | null {
  if (population === null || population <= 0) return null;
  return (facilityCount / population) * 1000;
}

/**
 * Gabungkan kelurahan menjadi kecamatan.
 *
 * Nilai yang tidak tersedia tetap `null` (bukan dianggap nol) agar kecamatan
 * dengan kelurahan berdata sebagian tidak menampilkan rasio yang menyesatkan.
 * `complete` menandai apakah seluruh kelurahan penyusunnya punya data penduduk.
 */
export interface MergedTotals {
  population: number | null;
  populationComplete: boolean;
  areaKm2: number | null;
  counts: FacilityCounts;
  kelurahanCount: number;
  kelurahanWithPopulation: number;
}

export function mergeChildren(children: Region[], childCounts: Map<string, FacilityCounts>): MergedTotals {
  let population = 0;
  let populationComplete = true;
  let areaKm2 = 0;
  let areaKnown = true;
  let counts = emptyCounts();
  let kelurahanWithPopulation = 0;

  for (const child of children) {
    if (child.population === null) populationComplete = false;
    else {
      population += child.population;
      kelurahanWithPopulation += 1;
    }

    if (child.areaKm2 === null) areaKnown = false;
    else areaKm2 += child.areaKm2;

    const childCount = childCounts.get(child.id);
    if (childCount) counts = addCounts(counts, childCount);
  }

  return {
    population: populationComplete ? population : null,
    populationComplete,
    areaKm2: areaKnown ? areaKm2 : null,
    counts,
    kelurahanCount: children.length,
    kelurahanWithPopulation,
  };
}

/** Fasilitas yang tidak berhasil dipetakan ke wilayah mana pun. */
export function unassignedFacilities(facilities: Facility[], regionIds: Set<string>): Facility[] {
  return facilities.filter((f) => !f.regionId || !regionIds.has(f.regionId));
}

export interface DatasetSummary {
  regionsByLevel: Record<RegionLevel, number>;
  populationTotal: { kecamatan: number | null; kelurahan: number | null };
  facilityTotal: number;
}

export function summarize(regions: Region[], facilities: Facility[]): DatasetSummary {
  const kecamatan = regions.filter((r) => r.level === 'kecamatan');
  const kelurahan = regions.filter((r) => r.level === 'kelurahan');

  const sumIfComplete = (list: Region[]): number | null =>
    list.every((r) => r.population !== null)
      ? list.reduce((acc, r) => acc + (r.population ?? 0), 0)
      : null;

  return {
    regionsByLevel: { kecamatan: kecamatan.length, kelurahan: kelurahan.length },
    populationTotal: {
      kecamatan: sumIfComplete(kecamatan),
      kelurahan: sumIfComplete(kelurahan),
    },
    facilityTotal: facilities.length,
  };
}

/** Metadata dataset bawaan untuk wilayah administratif. */
export function boundaryDatasetMeta(
  source: string,
  url: string,
  accessedAt: string,
  recordCount: number,
  notes: string[] = [],
): DatasetMeta {
  return {
    id: 'boundaries',
    title: 'Batas wilayah administratif',
    source,
    url,
    license: 'OpenStreetMap contributors — ODbL 1.0',
    accessedAt,
    recordCount,
    notes,
    limitations: [
      'Batas administratif dipetakan oleh komunitas OpenStreetMap dan dapat berbeda sedikit dari batas resmi.',
      'Luas dihitung dari poligon; luas versi resmi disertakan sebagai pembanding bila tersedia.',
    ],
  };
}