/**
 * Pemuatan dan penyusunan dataset dari berkas hasil rakitan.
 *
 * Setiap masalah diberi pesan yang menyebut berkas dan penyebabnya, supaya
 * pengguna tahu langkah perbaikan yang harus diambil. Aplikasi tidak pernah
 * mengarang data pengganti: bila berkas tidak ada, ia menampilkan panduan
 * penyiapan.
 */

import type {
  BBox,
  DataBundle,
  DataQuality,
  DatasetMeta,
  Facility,
  FacilityKind,
  LatLon,
  Region,
  RegionGeometry,
  RegionLevel,
} from '../types';
import { FACILITY_KINDS } from '../types';
import { pointOnSurface } from './geo';

/** Lokasi berkas data relatif terhadap halaman aplikasi. */
function dataUrl(file: string): string {
  const base = import.meta.env.BASE_URL || './';
  return `${base.replace(/\/$/, '')}/data/${file}`;
}

export class DatasetError extends Error {
  constructor(
    message: string,
    /** Langkah yang disarankan untuk pengguna. */
    readonly guidance: string[],
  ) {
    super(message);
    this.name = 'DatasetError';
  }
}

async function fetchJson(file: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(dataUrl(file), { cache: 'no-cache' });
  } catch (error) {
    throw new DatasetError(`Tidak dapat memuat ${file}.`, [
      'Periksa koneksi ke server tempat aplikasi dijalankan.',
      `Rincian: ${(error as Error).message}`,
    ]);
  }

  if (!response.ok) {
    throw new DatasetError(`Berkas ${file} tidak ditemukan (HTTP ${response.status}).`, [
      'Jalankan penyiapan data: npm run data:all',
      'Atau impor CSV/GeoJSON sendiri lewat halaman Data.',
    ]);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DatasetError(`Berkas ${file} bukan JSON yang sah.`, [
      'Berkas mungkin terpotong saat disalin.',
      'Rakit ulang dataset: npm run data:build',
      `Rincian: ${(error as Error).message}`,
    ]);
  }
}

interface GeoJsonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
}

interface GeoJsonCollection {
  type: string;
  features?: GeoJsonFeature[];
}

function asFeatureCollection(value: unknown, file: string): GeoJsonFeature[] {
  const collection = value as GeoJsonCollection;
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new DatasetError(`Berkas ${file} bukan FeatureCollection GeoJSON yang sah.`, [
      'Rakit ulang dataset: npm run data:build',
    ]);
  }
  return collection.features;
}

function isRegionGeometry(geometry: GeoJsonFeature['geometry']): geometry is RegionGeometry {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Ubah satu fitur wilayah menjadi Region.
 *
 * Titik representatif dihitung ulang di sini, bukan dipercaya dari berkas.
 * Alasannya: bila berkas dibuat oleh versi skrip yang berbeda atau diedit
 * tangan, titik yang salah akan membuat seluruh perhitungan jarak melenceng
 * tanpa gejala yang terlihat.
 */
function toRegion(feature: GeoJsonFeature, expectedLevel: RegionLevel): Region | null {
  const props = feature.properties;
  const id = str(props.id);
  const name = str(props.name);

  if (!id || !name) return null;
  if (!isRegionGeometry(feature.geometry)) return null;

  const level = (str(props.level) as RegionLevel | null) ?? expectedLevel;

  const centroidStored: LatLon = {
    lat: num(props.centroid_lat) ?? 0,
    lon: num(props.centroid_lon) ?? 0,
  };

  const centroid = pointOnSurface(feature.geometry);
  void centroidStored;

  const notes = Array.isArray(props.notes) ? (props.notes as unknown[]).map(String) : [];

  return {
    id,
    name,
    level,
    parentId: str(props.parent_id),
    parentName: str(props.parent_name),
    population: num(props.population),
    populationYear: num(props.population_year),
    areaKm2: num(props.area_km2),
    areaOfficialKm2: num(props.area_official_km2),
    centroid,
    bbox: bboxOfGeometry(feature.geometry),
    geometry: feature.geometry,
    notes,
  };
}

function bboxOfGeometry(geometry: RegionGeometry): BBox {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lat < minLat) minLat = lat;
        if (lon < minLon) minLon = lon;
        if (lat > maxLat) maxLat = lat;
        if (lon > maxLon) maxLon = lon;
      }
    }
  }

  return { minLat, minLon, maxLat, maxLon };
}

function toFacility(feature: GeoJsonFeature): Facility | null {
  const props = feature.properties;
  const id = str(props.id);
  const kind = str(props.kind);

  if (!id || !kind || !FACILITY_KINDS.includes(kind as FacilityKind)) return null;

  const coordinates = (feature.geometry as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return {
    id,
    name: str(props.name) ?? '(tanpa nama)',
    kind: kind as FacilityKind,
    lat,
    lon,
    address: str(props.address) ?? undefined,
    phone: str(props.phone) ?? undefined,
    operator: str(props.operator) ?? undefined,
    beds: num(props.beds) ?? undefined,
    source: (str(props.source) as Facility['source']) ?? 'osm',
    osmId: str(props.osm_id) ?? undefined,
    regionId: str(props.region_id),
    regionName: str(props.region_name),
  };
}

function toDatasetMeta(value: unknown): DatasetMeta | null {
  const item = value as Record<string, unknown>;
  if (!item || typeof item.id !== 'string') return null;

  return {
    id: item.id,
    title: String(item.title ?? item.id),
    source: String(item.source ?? ''),
    url: String(item.url ?? ''),
    license: String(item.license ?? ''),
    accessedAt: String(item.accessedAt ?? ''),
    recordCount: num(item.recordCount) ?? 0,
    notes: Array.isArray(item.notes) ? item.notes.map(String) : [],
    limitations: Array.isArray(item.limitations) ? item.limitations.map(String) : [],
  };
}

function toQuality(value: unknown): DataQuality {
  const item = (value ?? {}) as Record<string, unknown>;
  return {
    facilitiesTotal: num(item.facilitiesTotal) ?? 0,
    facilitiesWithoutName: num(item.facilitiesWithoutName) ?? 0,
    facilitiesOutsideBoundary: num(item.facilitiesOutsideBoundary) ?? 0,
    facilitiesUnassignedToKelurahan: num(item.facilitiesUnassignedToKelurahan) ?? 0,
    regionsWithPopulation: num(item.regionsWithPopulation) ?? 0,
    regionsTotal: num(item.regionsTotal) ?? 0,
    regionsWithAreaMismatch: num(item.regionsWithAreaMismatch) ?? 0,
  };
}

/** Muat seluruh dataset dari berkas hasil rakitan. */
export async function loadDataset(): Promise<DataBundle> {
  const [metadataRaw, kecamatanRaw, kelurahanRaw, fasilitasRaw] = await Promise.all([
    fetchJson('metadata.json'),
    fetchJson('kecamatan.geojson'),
    fetchJson('kelurahan.geojson'),
    fetchJson('fasilitas.geojson'),
  ]);

  const metadata = metadataRaw as Record<string, unknown>;

  const kecamatan = asFeatureCollection(kecamatanRaw, 'kecamatan.geojson')
    .map((feature) => toRegion(feature, 'kecamatan'))
    .filter((region): region is Region => region !== null);

  const kelurahan = asFeatureCollection(kelurahanRaw, 'kelurahan.geojson')
    .map((feature) => toRegion(feature, 'kelurahan'))
    .filter((region): region is Region => region !== null);

  const facilities = asFeatureCollection(fasilitasRaw, 'fasilitas.geojson')
    .map(toFacility)
    .filter((facility): facility is Facility => facility !== null);

  if (kecamatan.length === 0) {
    throw new DatasetError('Tidak ada wilayah kecamatan pada dataset.', [
      'Jalankan: npm run data:all',
      'Atau impor GeoJSON batas wilayah lewat halaman Data.',
    ]);
  }

  const cityRaw = (metadata.city ?? {}) as Record<string, unknown>;
  const cityBbox = cityRaw.bbox as BBox | undefined;

  const datasets = Array.isArray(metadata.datasets)
    ? metadata.datasets.map(toDatasetMeta).filter((meta): meta is DatasetMeta => meta !== null)
    : [];

  return {
    version: String(metadata.schemaVersion ?? '0'),
    generatedAt: String(metadata.generatedAt ?? ''),
    city: {
      name: String(cityRaw.name ?? 'Kota Surabaya'),
      bbox: cityBbox ?? bboxOfRegions([...kecamatan, ...kelurahan]),
    },
    regions: [...kecamatan, ...kelurahan],
    facilities,
    datasets,
    quality: toQuality(metadata.quality),
  };
}

export function bboxOfRegions(regions: Region[]): BBox {
  let box: BBox = { minLat: Infinity, minLon: Infinity, maxLat: -Infinity, maxLon: -Infinity };
  for (const region of regions) {
    box = {
      minLat: Math.min(box.minLat, region.bbox.minLat),
      minLon: Math.min(box.minLon, region.bbox.minLon),
      maxLat: Math.max(box.maxLat, region.bbox.maxLat),
      maxLon: Math.max(box.maxLon, region.bbox.maxLon),
    };
  }
  if (!Number.isFinite(box.minLat)) return { minLat: -7.4, minLon: 112.55, maxLat: -7.13, maxLon: 112.95 };
  return box;
}

/**
 * Data contoh untuk menguji tampilan saat dataset asli belum tersedia.
 *
 * Berkas ini TIDAK dipakai otomatis. Ia hanya dimuat bila pengguna secara
 * sadar menekan tombol "muat data contoh" pada layar penyiapan, dan aplikasi
 * menampilkan penanda bahwa angka yang terlihat bukan data nyata.
 */
export function demoBundle(): DataBundle {
  const square = (lat: number, lon: number, size: number): RegionGeometry => ({
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
  });

  const makeRegion = (
    id: string,
    name: string,
    level: RegionLevel,
    lat: number,
    lon: number,
    size: number,
    population: number | null,
    parentId: string | null,
    parentName: string | null,
  ): Region => {
    const geometry = square(lat, lon, size);
    return {
      id,
      name,
      level,
      parentId,
      parentName,
      population,
      populationYear: population === null ? null : 2023,
      areaKm2: null,
      areaOfficialKm2: null,
      centroid: pointOnSurface(geometry),
      bbox: bboxOfGeometry(geometry),
      geometry,
      notes: [],
    };
  };

  const kecamatanDefs: [string, number, number, number, number][] = [
    ['Contoh Pusat', -7.245, 112.745, 0.02, 210000],
    ['Contoh Timur', -7.26, 112.79, 0.025, 175000],
    ['Contoh Selatan', -7.3, 112.75, 0.025, 240000],
  ];

  const regions: Region[] = [];
  const facilities: Facility[] = [];

  kecamatanDefs.forEach(([name, lat, lon, size, population], index) => {
    const kecId = `kecamatan-demo-${index}`;
    regions.push(makeRegion(kecId, name, 'kecamatan', lat, lon, size, population, null, null));

    const childCount = 3;
    for (let c = 0; c < childCount; c += 1) {
      const childLat = lat - size / 2 + (size * c) / childCount / 1.2;
      const childLon = lon - size / 2.2 + (size * c) / childCount;
      const childId = `kelurahan-demo-${index}-${c}`;
      const childPopulation = Math.round(population / childCount / (c === 1 ? 2 : 1));

      regions.push(
        makeRegion(
          childId,
          `${name} Bagian ${c + 1}`,
          'kelurahan',
          childLat,
          childLon,
          size / 3,
          c === 2 && index === 0 ? null : childPopulation,
          kecId,
          name,
        ),
      );

      // Sebar beberapa fasilitas dengan kepadatan yang sengaja tidak merata,
      // supaya kejanggalan tampilan (mis. wilayah tanpa fasilitas) ikut teruji.
      const facilityCount = index === 0 ? 3 : index === 1 ? 2 : 1;
      for (let f = 0; f < facilityCount; f += 1) {
        facilities.push({
          id: `demo-facility-${index}-${c}-${f}`,
          name: `Fasilitas Contoh ${index + 1}-${c + 1}-${f + 1}`,
          kind: FACILITY_KINDS[(index + c + f) % 3],
          lat: childLat + (f - 1) * 0.002,
          lon: childLon + (f - 1) * 0.002,
          address: undefined,
          phone: undefined,
          operator: undefined,
          beds: undefined,
          source: 'demo',
          osmId: undefined,
          regionId: childId,
          regionName: `${name} Bagian ${c + 1}`,
        });
      }
    }
  });

  return {
    version: 'demo',
    generatedAt: new Date().toISOString(),
    city: { name: 'Data Contoh (bukan wilayah nyata)', bbox: bboxOfRegions(regions) },
    regions,
    facilities,
    datasets: [
      {
        id: 'demo',
        title: 'Data contoh bawaan aplikasi',
        source: 'Dibuat oleh aplikasi',
        url: '',
        license: 'Tidak berlaku',
        accessedAt: '',
        recordCount: facilities.length,
        notes: ['Angka dan bentuk wilayah pada mode ini dibuat-buat untuk menguji tampilan.'],
        limitations: [
          'BUKAN data nyata. Jangan dipakai untuk analisis atau kesimpulan apa pun.',
          'Wilayah, jumlah penduduk, dan fasilitas tidak mewakili Kota Surabaya.',
        ],
      },
    ],
    quality: {
      facilitiesTotal: facilities.length,
      facilitiesWithoutName: 0,
      facilitiesOutsideBoundary: 0,
      facilitiesUnassignedToKelurahan: 0,
      regionsWithPopulation: regions.filter((r) => r.population !== null).length,
      regionsTotal: regions.length,
      regionsWithAreaMismatch: 0,
    },
  };
}