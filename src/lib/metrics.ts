/**
 * Mesin metrik: menyatukan wilayah, fasilitas, aksesibilitas, dan agregasi
 * menjadi satu tabel metrik per wilayah.
 *
 * Semua angka yang ditampilkan aplikasi berasal dari fungsi di berkas ini,
 * sehingga tidak ada nilai yang dihitung ulang dengan cara berbeda di
 * komponen antarmuka.
 */

import type { Facility, MetricId, Region, RegionLevel } from '../types';
import { METRIC_META } from '../types';
import { type FacilityCounts, countByKind, countsByRegion, densityOf, facilityRatio } from './aggregate';
import { type RegionAccess, analyzeRegions } from './access';
import { type PriorityResult, computePriority, DEFAULT_WEIGHTS, type PriorityWeights, rankPriority } from './priority';
import { MAX_CLASSES, type ClassMethod, type Classification, classIndexOf, classify } from './classify';

export interface RegionMetrics {
  regionId: string;
  name: string;
  level: RegionLevel;
  parentName: string | null;
  population: number | null;
  populationYear: number | null;
  areaKm2: number | null;
  counts: FacilityCounts;
  /** Semua metrik siap tampil; `null` berarti tidak dapat dihitung. */
  values: Record<MetricId, number | null>;
  access: RegionAccess;
  /** Peringkat 1..n pada level yang sama untuk metrik terpilih. */
  priority: PriorityResult | null;
}

/** Nilai satu metrik untuk sebuah wilayah, dengan penanganan nilai kosong. */
export function metricValue(
  metric: MetricId,
  input: {
    counts: FacilityCounts;
    density: number | null;
    ratio: number | null;
    access: RegionAccess;
    priorityScore: number | null;
    kindFilter: FacilityCounts['total'] | null;
  },
): number | null {
  switch (metric) {
    case 'density':
      return input.density;
    case 'facilityRatio':
      return input.ratio;
    case 'nearestDistance':
      return input.access.nearestAnyKm;
    case 'coverage':
      return input.access.coverage[3];
    case 'priorityScore':
      return input.priorityScore;
    case 'facilityCount':
      return input.kindFilter === null ? input.counts.total : input.kindFilter;
    default:
      return null;
  }
}

export interface MetricsOptions {
  kindsFilter?: Facility['kind'][];
  weights?: PriorityWeights;
}

export interface MetricsResult {
  regions: Region[];
  byId: Map<string, RegionMetrics>;
  /** Urutan peringkat pada tiap level untuk metrik prioritas. */
  priorityByLevel: Record<RegionLevel, PriorityResult[]>;
  /** Fasilitas yang benar-benar dipakai (setelah filter jenis). */
  usedFacilities: Facility[];
}

/**
 * Hitung metrik untuk seluruh wilayah.
 *
 * Filter jenis fasilitas memengaruhi jumlah, rasio, jarak, dan cakupan —
 * tetapi tidak mengubah angka penduduk dan luas, karena keduanya bukan
 * besaran fasilitas.
 */
export function computeMetrics(
  regions: Region[],
  facilities: Facility[],
  options: MetricsOptions = {},
): MetricsResult {
  const kindsFilter = options.kindsFilter;
  const usedFacilities = kindsFilter && kindsFilter.length > 0
    ? facilities.filter((facility) => kindsFilter.includes(facility.kind))
    : facilities;

  const accessMap = analyzeRegions(
    regions,
    usedFacilities,
    kindsFilter && kindsFilter.length > 0 ? kindsFilter : undefined,
  );

  // Jumlah fasilitas per wilayah untuk seluruh wilayah (kedua level), dihitung
  // sekali agar tidak berulang di dalam loop.
  const kecamatanIds = new Set(regions.filter((r) => r.level === 'kecamatan').map((r) => r.id));
  const kelurahanIds = new Set(regions.filter((r) => r.level === 'kelurahan').map((r) => r.id));

  // Fasilitas disimpan dengan id wilayah terdalam yang memuatnya (kelurahan),
  // jadi hitungan kecamatan diperoleh dengan menelusuri induk setiap kelurahan.
  const parentOf = new Map<string, string | null>();
  for (const region of regions) parentOf.set(region.id, region.parentId);
  const parentIdOf = (regionId: string): string | null => parentOf.get(regionId) ?? null;

  const countsForLevel = new Map<string, FacilityCounts>();
  for (const [id, counts] of countsByRegion(usedFacilities, kecamatanIds, parentIdOf)) countsForLevel.set(id, counts);
  for (const [id, counts] of countsByRegion(usedFacilities, kelurahanIds, parentIdOf)) countsForLevel.set(id, counts);

  // Skor prioritas dihitung per level: kelurahan dibanding kelurahan,
  // kecamatan dibanding kecamatan. Membandingkan kelurahan dengan kecamatan
  // akan membuat skor tidak bermakna.
  const priorityInputs = regions.map((region) => {
    const access = accessMap.get(region.id);
    const counts = countsForLevel.get(region.id) ?? countByKind([]);
    return {
      regionId: region.id,
      density: densityOf(region.population, region.areaKm2),
      facilityRatio: facilityRatio(counts.total, region.population),
      nearestDistanceKm: access?.nearestAnyKm ?? null,
    };
  });

  const weights = options.weights ?? DEFAULT_WEIGHTS;

  const priorityByLevel: Record<RegionLevel, PriorityResult[]> = {
    kecamatan: [],
    kelurahan: [],
  };
  const priorityMap = new Map<string, PriorityResult>();

  for (const level of ['kecamatan', 'kelurahan'] as RegionLevel[]) {
    const inputs = priorityInputs.filter((input) =>
      regions.some((region) => region.id === input.regionId && region.level === level),
    );
    const results = rankPriority(computePriority(inputs, weights, level));
    priorityByLevel[level] = results;
    for (const result of results) priorityMap.set(result.regionId, result);
  }

  const byId = new Map<string, RegionMetrics>();

  for (const region of regions) {
    const access = accessMap.get(region.id);
    if (!access) continue;

    const counts = countsForLevel.get(region.id) ?? countByKind([]);
    const density = densityOf(region.population, region.areaKm2);
    const ratio = facilityRatio(counts.total, region.population);
    const priority = priorityMap.get(region.id) ?? null;

    const values: Record<MetricId, number | null> = {
      density,
      facilityRatio: ratio,
      nearestDistance: access.nearestAnyKm,
      coverage: access.coverage[3],
      priorityScore: priority?.score ?? null,
      facilityCount: counts.total,
    };

    byId.set(region.id, {
      regionId: region.id,
      name: region.name,
      level: region.level,
      parentName: region.parentName,
      population: region.population,
      populationYear: region.populationYear,
      areaKm2: region.areaKm2,
      counts,
      values,
      access,
      priority,
    });
  }

  return { regions, byId, priorityByLevel, usedFacilities };
}

/** Peringkat wilayah pada satu level untuk metrik apa pun. */
export function rankByMetric(
  metrics: MetricsResult,
  level: RegionLevel,
  metric: MetricId,
): { regionId: string; name: string; value: number | null; rank: number | null }[] {
  const meta = METRIC_META[metric];

  const rows = metrics.regions
    .filter((region) => region.level === level)
    .map((region) => {
      const entry = metrics.byId.get(region.id);
      return {
        regionId: region.id,
        name: region.name,
        value: entry ? entry.values[metric] : null,
      };
    });

  const rankable = rows
    .filter((row): row is { regionId: string; name: string; value: number } => row.value !== null)
    .sort((a, b) => (meta.higherIsBetter ? b.value - a.value : a.value - b.value));

  const rankById = new Map(rankable.map((row, index) => [row.regionId, index + 1]));

  // Wilayah tanpa nilai selalu di urutan akhir dan tidak diberi peringkat.
  const sorted = [...rows].sort((a, b) => {
    if (a.value === null && b.value === null) return a.name.localeCompare(b.name, 'id');
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return meta.higherIsBetter ? b.value - a.value : a.value - b.value;
  });

  return sorted.map((row) => ({
    ...row,
    rank: row.value === null ? null : (rankById.get(row.regionId) ?? null),
  }));
}

/** Klasifikasi choropleth untuk metrik pada satu level. */
export function classifyMetric(
  metrics: MetricsResult,
  level: RegionLevel,
  metric: MetricId,
  method: ClassMethod,
  classCount = 5,
): Classification {
  const values = metrics.regions
    .filter((region) => region.level === level)
    .map((region) => metrics.byId.get(region.id)?.values[metric] ?? null)
    .filter((value): value is number => value !== null);

  return classify(values, method, Math.min(classCount, MAX_CLASSES));
}

/** Indeks kelas sebuah wilayah pada klasifikasi yang sudah dihitung. */
export function regionClassIndex(
  metrics: MetricsResult,
  regionId: string,
  metric: MetricId,
  classification: Classification,
): number {
  const value = metrics.byId.get(regionId)?.values[metric];
  if (value === null || value === undefined) return -1;
  return classIndexOf(value, classification.classes);
}

/**
 * Bandingkan metrik kecamatan yang dihitung langsung dari geometri kecamatan
 * dengan hasil penjumlahan kelurahannya.
 *
 * Perbedaan jarak/cakupan wajar terjadi karena titik representatif kecamatan
 * berbeda dari gabungan titik kelurahan; yang diperiksa di sini adalah
 * besaran yang memang harus sama: jumlah penduduk, luas, dan jumlah fasilitas.
 */
export interface ConsistencyIssue {
  kecamatanId: string;
  kecamatanName: string;
  field: 'population' | 'areaKm2' | 'facilityCount';
  direct: number | null;
  aggregated: number | null;
  differencePct: number | null;
}

export function checkLevelConsistency(
  metrics: MetricsResult,
  tolerancePct = 2,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const kecamatan = metrics.regions.filter((region) => region.level === 'kecamatan');

  for (const parent of kecamatan) {
    const children = metrics.regions.filter(
      (region) => region.level === 'kelurahan' && region.parentId === parent.id,
    );
    if (children.length === 0) continue;

    const direct = metrics.byId.get(parent.id);
    if (!direct) continue;

    const checks: { field: ConsistencyIssue['field']; directValue: number | null; sum: number | null }[] = [];

    const childPopulations = children.map((child) => metrics.byId.get(child.id)?.population ?? null);
    checks.push({
      field: 'population',
      directValue: direct.population,
      sum: childPopulations.every((p) => p !== null)
        ? childPopulations.reduce((acc, p) => acc + (p ?? 0), 0)
        : null,
    });

    const childAreas = children.map((child) => metrics.byId.get(child.id)?.areaKm2 ?? null);
    checks.push({
      field: 'areaKm2',
      directValue: direct.areaKm2,
      sum: childAreas.every((a) => a !== null) ? childAreas.reduce((acc, a) => acc + (a ?? 0), 0) : null,
    });

    const childCounts = children.map((child) => metrics.byId.get(child.id)?.counts.total ?? 0);
    checks.push({
      field: 'facilityCount',
      directValue: direct.counts.total,
      sum: childCounts.reduce((acc, c) => acc + c, 0),
    });

    for (const check of checks) {
      if (check.directValue === null || check.sum === null) continue;
      const base = Math.max(Math.abs(check.directValue), 1);
      const differencePct = (Math.abs(check.directValue - check.sum) / base) * 100;
      if (differencePct > tolerancePct) {
        issues.push({
          kecamatanId: parent.id,
          kecamatanName: parent.name,
          field: check.field,
          direct: check.directValue,
          aggregated: check.sum,
          differencePct: Math.round(differencePct * 10) / 10,
        });
      }
    }
  }

  return issues;
}