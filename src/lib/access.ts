/**
 * Perhitungan aksesibilitas.
 *
 * Metode yang dipakai adalah **jarak garis lurus** (haversine) dari titik
 * representatif wilayah dan dari sampel grid ke fasilitas terdekat, ditambah
 * cakupan radius. Ini bukan jarak tempuh jaringan jalan: sebuah wilayah bisa
 * terlihat dekat padahal terhalang sungai atau tanpa jalan tembus. Keterbatasan
 * ini ditampilkan di antarmuka, bukan disembunyikan.
 */

import type { Facility, FacilityKind, LatLon, Region } from '../types';
import { FACILITY_KINDS } from '../types';
import { SpatialIndex, gridPointsInGeometry, haversineKm } from './geo';

export const COVERAGE_RADII_KM = [1, 3, 5] as const;
export type CoverageRadiusKm = (typeof COVERAGE_RADII_KM)[number];

export interface NearestResult {
  kind: FacilityKind;
  km: number | null;
  facilityId: string | null;
  facilityName: string | null;
}

/** Fasilitas terdekat per jenis dari satu titik. */
export function nearestPerKind(
  point: LatLon,
  index: SpatialIndex<Facility>,
  kinds: FacilityKind[] = FACILITY_KINDS,
): NearestResult[] {
  return kinds.map((kind) => {
    const hit = index.nearest(point.lat, point.lon, (facility) => facility.kind === kind);
    return {
      kind,
      km: hit ? hit.km : null,
      facilityId: hit ? hit.item.id : null,
      facilityName: hit ? hit.item.name : null,
    };
  });
}

/** Jarak terdekat ke fasilitas jenis apa pun. */
export function nearestAny(paths: NearestResult[]): number | null {
  const known = paths.map((p) => p.km).filter((km): km is number => km !== null);
  return known.length === 0 ? null : Math.min(...known);
}

/**
 * Perkiraan cakupan: dari sampel grid di dalam wilayah, berapa bagian yang
 * berada dalam radius `radiusKm` dari fasilitas jenis apa pun.
 *
 * Hasil adalah proporsi sampel, sehingga ketelitiannya terbatas pada kerapatan
 * grid (0,5 km). Nilai ini perkiraan, bukan hitungan luas eksak.
 */
export function coverageFromPoints(
  points: LatLon[],
  index: SpatialIndex<Facility>,
  radiusKm: number,
): number | null {
  if (points.length === 0) return null;
  let covered = 0;
  for (const point of points) {
    const hit = index.nearest(point.lat, point.lon);
    if (hit && hit.km <= radiusKm) covered += 1;
  }
  return (covered / points.length) * 100;
}

export interface RegionAccess {
  regionId: string;
  /** Jarak dari titik representatif wilayah ke fasilitas terdekat per jenis. */
  nearest: NearestResult[];
  nearestAnyKm: number | null;
  /** Cakupan per radius, dalam persen sampel grid. */
  coverage: Record<CoverageRadiusKm, number | null>;
  /** Jumlah titik grid yang dipakai; kecil berarti hasil kurang teliti. */
  samplePoints: number;
  /** Jarak terjadi dari sampel grid ke fasilitas terdekat (km). */
  worstSampleKm: number | null;
  /** Rata-rata jarak dari sampel grid ke fasilitas terdekat (km). */
  meanSampleKm: number | null;
}

/** Hitung aksesibilitas lengkap untuk satu wilayah. */
export function analyzeRegion(
  region: Region,
  index: SpatialIndex<Facility>,
  kinds: FacilityKind[] = FACILITY_KINDS,
): RegionAccess {
  const nearest = nearestPerKind(region.centroid, index, kinds);
  const points = gridPointsInGeometry(region.geometry, 0.5);

  const covered: Record<CoverageRadiusKm, number | null> = { 1: null, 3: null, 5: null };
  for (const radius of COVERAGE_RADII_KM) {
    covered[radius] = coverageFromPoints(points, index, radius);
  }

  let worst: number | null = null;
  let sum = 0;
  let counted = 0;
  for (const point of points) {
    const hit = index.nearest(point.lat, point.lon);
    if (!hit) continue;
    sum += hit.km;
    counted += 1;
    if (worst === null || hit.km > worst) worst = hit.km;
  }

  return {
    regionId: region.id,
    nearest,
    nearestAnyKm: nearestAny(nearest),
    coverage: covered,
    samplePoints: points.length,
    worstSampleKm: worst,
    meanSampleKm: counted > 0 ? sum / counted : null,
  };
}

/** Hitung aksesibilitas untuk banyak wilayah memakai satu indeks spasial. */
export function analyzeRegions(
  regions: Region[],
  facilities: Facility[],
  kinds: FacilityKind[] = FACILITY_KINDS,
): Map<string, RegionAccess> {
  const index = new SpatialIndex(facilities);
  const result = new Map<string, RegionAccess>();
  for (const region of regions) {
    result.set(region.id, analyzeRegion(region, index, kinds));
  }
  return result;
}

/** Fasilitas dalam radius `radiusKm` dari sebuah titik, diurutkan terdekat. */
export function facilitiesWithin(
  point: LatLon,
  facilities: Facility[],
  radiusKm: number,
): { facility: Facility; km: number }[] {
  const hits: { facility: Facility; km: number }[] = [];
  for (const facility of facilities) {
    const km = haversineKm(point, facility);
    if (km <= radiusKm) hits.push({ facility, km });
  }
  return hits.sort((a, b) => a.km - b.km);
}