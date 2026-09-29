/**
 * Model data inti sistem.
 *
 * Konvensi koordinat (penting, jangan tertukar):
 * - `LatLon`   = { lat, lon }  -> dipakai di seluruh perhitungan analisis
 * - `Position` = [lon, lat]    -> urutan GeoJSON, hanya dipakai di dalam geometri
 */

/** Jenis fasilitas kesehatan yang dipetakan. */
export type FacilityKind = 'hospital' | 'clinic' | 'pharmacy' | 'doctor' | 'health_post';

export const FACILITY_KINDS: FacilityKind[] = [
  'hospital',
  'clinic',
  'pharmacy',
  'doctor',
  'health_post',
];

export interface FacilityKindMeta {
  kind: FacilityKind;
  /** Label bahasa Indonesia untuk UI. */
  label: string;
  /** Padanan tag OpenStreetMap yang dipakai saat pengambilan data. */
  osmTags: string[];
  /** Indeks slot kategorikal pada palet (lihat src/lib/palette.ts). */
  slot: number;
  /** Urutan tampil di legenda. */
  order: number;
}

export const FACILITY_KIND_META: Record<FacilityKind, FacilityKindMeta> = {
  hospital: {
    kind: 'hospital',
    label: 'Rumah Sakit',
    osmTags: ['amenity=hospital'],
    slot: 0,
    order: 0,
  },
  clinic: {
    kind: 'clinic',
    label: 'Klinik & Puskesmas',
    osmTags: ['amenity=clinic', 'healthcare=centre'],
    slot: 1,
    order: 1,
  },
  pharmacy: {
    kind: 'pharmacy',
    label: 'Apotek',
    osmTags: ['amenity=pharmacy'],
    slot: 2,
    order: 2,
  },
  doctor: {
    kind: 'doctor',
    label: 'Praktik Dokter',
    osmTags: ['amenity=doctors'],
    slot: 3,
    order: 3,
  },
  health_post: {
    kind: 'health_post',
    label: 'Pos Kesehatan',
    osmTags: ['amenity=health_post', 'healthcare=health_post'],
    slot: 4,
    order: 4,
  },
};

export interface LatLon {
  lat: number;
  lon: number;
}

export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export type Position = [number, number];
export type LinearRing = Position[];
export type PolygonCoords = LinearRing[];
export type MultiPolygonCoords = PolygonCoords[];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: PolygonCoords;
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: MultiPolygonCoords;
}

export type RegionGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface Facility {
  id: string;
  name: string;
  kind: FacilityKind;
  lat: number;
  lon: number;
  address?: string;
  phone?: string;
  operator?: string;
  beds?: number;
  /** 'osm' = hasil pengambilan otomatis; 'import' = diunggah pengguna. */
  source: 'osm' | 'import' | 'demo';
  /** ID elemen OSM (mis. "node/123"), untuk penelusuran balik. */
  osmId?: string;
  /** Nama wilayah tempat fasilitas berada (diisi saat build data). */
  regionId?: string | null;
  regionName?: string | null;
}

export type RegionLevel = 'kecamatan' | 'kelurahan';

export interface Region {
  id: string;
  name: string;
  level: RegionLevel;
  /** Untuk kelurahan: id kecamatan induk. Untuk kecamatan: null. */
  parentId: string | null;
  parentName: string | null;
  /** Jumlah penduduk. `null` berarti data tidak tersedia (bukan nol). */
  population: number | null;
  /** Tahun rujukan angka penduduk. */
  populationYear: number | null;
  /** Luas dihitung dari poligon (km²). */
  areaKm2: number | null;
  /** Luas menurut sumber resmi (km²), sebagai pembanding. */
  areaOfficialKm2: number | null;
  /** Titik representatif yang dijamin berada di dalam poligon. */
  centroid: LatLon;
  bbox: BBox;
  geometry: RegionGeometry;
  /** Catatan kualitas data yang ditemukan saat membangun dataset. */
  notes: string[];
}

export interface DatasetMeta {
  id: string;
  title: string;
  /** Nama lembaga/komunitas penyedia data. */
  source: string;
  url: string;
  license: string;
  /** Tanggal akses, format YYYY-MM-DD. */
  accessedAt: string;
  recordCount: number;
  notes: string[];
  limitations: string[];
}

/** Ukuran kualitas data yang ikut ditampilkan agar keterbatasan tidak tersembunyi. */
export interface DataQuality {
  facilitiesTotal: number;
  facilitiesWithoutName: number;
  facilitiesOutsideBoundary: number;
  facilitiesUnassignedToKelurahan: number;
  regionsWithPopulation: number;
  regionsTotal: number;
  regionsWithAreaMismatch: number;
}

export interface DataBundle {
  version: string;
  generatedAt: string;
  city: {
    name: string;
    bbox: BBox;
  };
  regions: Region[];
  facilities: Facility[];
  datasets: DatasetMeta[];
  quality: DataQuality;
}

/** Metrik yang bisa ditampilkan sebagai choropleth / peringkat. */
export type MetricId =
  | 'density'
  | 'facilityRatio'
  | 'nearestDistance'
  | 'coverage'
  | 'priorityScore'
  | 'facilityCount';

export interface MetricMeta {
  id: MetricId;
  label: string;
  /** Penjelasan singkat yang ditampilkan di UI dan legenda. */
  description: string;
  unit: string;
  /** true = nilai besar berarti lebih baik/bebas masalah. */
  higherIsBetter: boolean;
  /** Jumlah desimal untuk tampilan. */
  decimals: number;
}

export const METRIC_META: Record<MetricId, MetricMeta> = {
  density: {
    id: 'density',
    label: 'Kepadatan penduduk',
    description: 'Jumlah penduduk dibagi luas wilayah.',
    unit: 'jiwa/km²',
    higherIsBetter: false,
    decimals: 0,
  },
  facilityRatio: {
    id: 'facilityRatio',
    label: 'Fasilitas per 1.000 penduduk',
    description: 'Jumlah fasilitas kesehatan dibagi jumlah penduduk, dikali 1.000.',
    unit: 'per 1.000 jiwa',
    higherIsBetter: true,
    decimals: 2,
  },
  nearestDistance: {
    id: 'nearestDistance',
    label: 'Jarak ke rumah sakit terdekat',
    description: 'Jarak garis lurus dari titik pusat wilayah ke rumah sakit terdekat.',
    unit: 'km',
    higherIsBetter: false,
    decimals: 2,
  },
  coverage: {
    id: 'coverage',
    label: 'Cakupan radius 3 km',
    description:
      'Perkiraan persentase luas wilayah yang berada dalam radius 3 km dari fasilitas kesehatan mana pun. Dihitung dari sampel grid, bukan dari sebaran penduduk.',
    unit: '%',
    higherIsBetter: true,
    decimals: 1,
  },
  priorityScore: {
    id: 'priorityScore',
    label: 'Skor prioritas',
    description:
      'Gabungan berbobot dari kepadatan tinggi, rasio fasilitas rendah, dan jarak jauh. Skor tinggi berarti perlu perhatian lebih dahulu.',
    unit: 'skor 0–100',
    higherIsBetter: true,
    decimals: 1,
  },
  facilityCount: {
    id: 'facilityCount',
    label: 'Jumlah fasilitas',
    description: 'Banyaknya fasilitas kesehatan yang berada di dalam wilayah.',
    unit: 'fasilitas',
    higherIsBetter: true,
    decimals: 0,
  },
};