/**
 * Penyimpan status aplikasi.
 *
 * Tanggung jawab yang dipegang di sini:
 * - Memuat dataset, atau beralih ke data contoh hanya bila diminta pengguna.
 * - Menyimpan seluruh pengaturan tampilan: level wilayah, metrik, filter jenis
 *   fasilitas, bobot skor prioritas, metode klasifikasi, dan tema.
 * - Menghitung metrik sekali per kombinasi masukan, lalu membagikannya ke
 *   seluruh halaman supaya angka antarpanel selalu konsisten.
 * - Menyediakan aksi impor yang tidak merusak data lama ketika gagal.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type {
  DataBundle,
  Facility,
  FacilityKind,
  MetricId,
  Region,
  RegionLevel,
} from '../types';
import { FACILITY_KINDS } from '../types';
import { loadDataset, demoBundle, DatasetError } from '../lib/dataset';
import { DEFAULT_WEIGHTS, type PriorityWeights } from '../lib/priority';
import { classifyMetric, computeMetrics, type MetricsResult } from '../lib/metrics';
import type { ClassMethod } from '../lib/classify';
import { MAX_CHOROPLETH_CLASSES } from '../lib/constants';
import type { Classification } from '../lib/classify';
import type { ImportIssue, ImportResult } from '../lib/io';

export type ThemeMode = 'light' | 'dark';

export interface ViewSettings {
  level: RegionLevel;
  metric: MetricId;
  /** Jenis fasilitas yang disertakan. Selalu berisi minimal satu jenis. */
  kinds: FacilityKind[];
  weights: PriorityWeights;
  classMethod: ClassMethod;
  classCount: number;
  theme: ThemeMode;
  /** Metrik yang tidak boleh dihitung karena penduduknya belum ada, tetap ditampilkan tetapi ditandai. */
  highlightId: string | null;
}

const DEFAULT_SETTINGS: ViewSettings = {
  level: 'kecamatan',
  metric: 'density',
  // Tiga jenis yang diminta pengguna; bentuk penandanya berbeda satu sama lain.
  kinds: ['hospital', 'clinic', 'pharmacy'],
  weights: DEFAULT_WEIGHTS,
  classMethod: 'quantile',
  classCount: 5,
  theme: 'light',
  highlightId: null,
};

interface DataState {
  status: 'memuat' | 'siap' | 'galat';
  bundle: DataBundle | null;
  error: { message: string; guidance: string[] } | null;
  isDemo: boolean;
}

interface FinanceActions {
  /** Muat ulang dataset dari berkas. */
  reload: () => Promise<void>;
  /** Pakai data contoh. Selalu butuh tindakan sadar pengguna. */
  useDemo: () => void;
  /** Ganti sebagian isi dataset lewat impor yang sudah tervalidasi. */
  applyImport: (result: ImportResult<Region | Facility>, kind: 'regions' | 'facilities') => void;
  /** Kembalikan dataset ke kondisi berkas semula. */
  resetToSource: () => void;
}

interface SettingsActions {
  update: (patch: Partial<ViewSettings>) => void;
  toggleKind: (kind: FacilityKind) => void;
  resetWeights: () => void;
}

interface StoreValue {
  data: DataState;
  settings: ViewSettings;
  metrics: MetricsResult | null;
  classification: Classification | null;
  actions: FinanceActions & SettingsActions;
}

const StoreContext = createContext<StoreValue | null>(null);

/** Berapa banyak metrik yang tetap dapat dihitung tanpa angka penduduk. */
export function metricNeedsPopulation(metric: MetricId): boolean {
  return (
    metric === 'density' ||
    metric === 'facilityRatio' ||
    metric === 'priorityScore'
  );
}

/** Apakah ada minimal satu wilayah yang sudah punya angka penduduk. */
export function populationAvailableIn(regions: Region[]): boolean {
  return regions.some((region) => region.population !== null);
}

/**
 * Metrik awal untuk ditampilkan.
 *
 * Metrik baku aplikasi adalah kepadatan penduduk, tetapi metrik itu butuh
 * angka penduduk. Selama angka penduduk belum diisi, seluruh wilayah akan
 * tampil abu-abu tanpa kelas sama sekali — peta terlihat rusak padahal
 * datanya memang belum ada. Karena itu bila penduduk belum tersedia,
 * tampilan awal jatuh ke metrik yang bisa dihitung sekarang.
 *
 * Jarak ke fasilitas terdekat dipilih sebagai pengganti karena ia yang paling
 * dekat maknanya dengan aksesibilitas, sasaran utama aplikasi ini.
 */
export function initialMetricFor(regions: Region[], preferred: MetricId = 'density'): MetricId {
  if (!metricNeedsPopulation(preferred)) return preferred;
  if (populationAvailableIn(regions)) return preferred;
  return 'nearestDistance';
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DataState>({
    status: 'memuat',
    bundle: null,
    error: null,
    isDemo: false,
  });

  const [settings, setSettings] = useState<ViewSettings>(DEFAULT_SETTINGS);

  /** Sumber asli, dipakai untuk mengembalikan keadaan setelah impor. */
  const [sourceBundle, setSourceBundle] = useState<DataBundle | null>(null);

  const load = useCallback(async () => {
    setData((prev) => ({ ...prev, status: 'memuat', error: null }));
    try {
      const bundle = await loadDataset();
      setSourceBundle(bundle);
      setData({ status: 'siap', bundle, error: null, isDemo: false });
      // Peta dibuka pada metrik kepadatan penduduk. Bila angka penduduk belum
      // ada, metrik itu kosong untuk semua wilayah — alihkan tampilan awal ke
      // metrik yang memang bisa dihitung dari data yang tersedia.
      setSettings((prev) => ({ ...prev, metric: initialMetricFor(bundle.regions, prev.metric) }));
    } catch (error) {
      const isDatasetError = error instanceof DatasetError;
      setData({
        status: 'galat',
        bundle: null,
        error: {
          message: error instanceof Error ? error.message : 'Terjadi galat yang tidak dikenal.',
          guidance: isDatasetError
            ? (error as DatasetError).guidance
            : ['Coba muat ulang halaman.', 'Jalankan: npm run data:all'],
        },
        isDemo: false,
      });
    }
  }, []);

  // Pemuatan awal dijalankan sekali saat provider dipasang. Diletakkan di
  // dalam useEffect, bukan saat render, supaya tidak ada permintaan jaringan
  // yang terpicu dua kali pada mode pengembangan React.
  useEffect(() => {
    void load();
  }, [load]);

  const useDemo = useCallback(() => {
    const bundle = demoBundle();
    setData({ status: 'siap', bundle, error: null, isDemo: true });
  }, []);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  const resetToSource = useCallback(() => {
    if (sourceBundle) setData((prev) => ({ ...prev, bundle: sourceBundle, isDemo: false }));
  }, [sourceBundle]);

  const applyImport = useCallback(
    (result: ImportResult<Region | Facility>, kind: 'regions' | 'facilities') => {
      setData((prev) => {
        if (!prev.bundle) return prev;

        if (kind === 'regions') {
          const imported = result.data as Region[];
          const importedIds = new Set(imported.map((region) => region.id));

          // Data penduduk diperbarui bila ID-nya sama; wilayah baru ditambahkan.
          const merged = prev.bundle.regions.map((region) => {
            const replacement = imported.find((item) => item.id === region.id);
            return replacement
              ? {
                  ...region,
                  population: replacement.population,
                  populationYear: replacement.populationYear,
                  areaOfficialKm2: replacement.areaOfficialKm2,
                }
              : region;
          });

          const additions = imported.filter(
            (region) => !prev.bundle!.regions.some((existing) => existing.id === region.id),
          );

          void importedIds;

          return { ...prev, bundle: { ...prev.bundle, regions: [...merged, ...additions] }, isDemo: false };
        }

        const imported = result.data as Facility[];
        const importedIds = new Set(imported.map((facility) => facility.id));
        // Fasilitas dengan ID sama diganti, bukan diduplikasi.
        const kept = prev.bundle.facilities.filter((facility) => !importedIds.has(facility.id));

        return { ...prev, bundle: { ...prev.bundle, facilities: [...kept, ...imported] }, isDemo: false };
      });
    },
    [],
  );

  const update = useCallback((patch: Partial<ViewSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleKind = useCallback((kind: FacilityKind) => {
    setSettings((prev) => {
      const active = prev.kinds.includes(kind);
      // Minimal satu jenis harus tetap aktif; filter kosong akan menghasilkan
      // peta yang tampak rusak, bukan kosong.
      if (active && prev.kinds.length === 1) return prev;
      const kinds = active ? prev.kinds.filter((k) => k !== kind) : [...prev.kinds, kind];
      return { ...prev, kinds: FACILITY_KINDS.filter((k) => kinds.includes(k)) };
    });
  }, []);

  const resetWeights = useCallback(() => {
    setSettings((prev) => ({ ...prev, weights: DEFAULT_WEIGHTS }));
  }, []);

  // Metrik dihitung ulang hanya saat data, filter jenis, atau bobot berubah.
  const metrics = useMemo(() => {
    if (!data.bundle) return null;
    return computeMetrics(data.bundle.regions, data.bundle.facilities, {
      kindsFilter: settings.kinds,
      weights: settings.weights,
    });
  }, [data.bundle, settings.kinds, settings.weights]);

  const classification = useMemo(() => {
    if (!metrics) return null;
    return classifyMetric(
      metrics,
      settings.level,
      settings.metric,
      settings.classMethod,
      Math.min(settings.classCount, MAX_CHOROPLETH_CLASSES),
    );
  }, [metrics, settings.level, settings.metric, settings.classMethod, settings.classCount]);

  const value = useMemo<StoreValue>(
    () => ({
      data,
      settings,
      metrics,
      classification,
      actions: {
        reload,
        useDemo,
        applyImport,
        resetToSource,
        update,
        toggleKind,
        resetWeights,
      },
    }),
    [data, settings, metrics, classification, reload, useDemo, applyImport, resetToSource, update, toggleKind, resetWeights],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore dipakai di luar StoreProvider.');
  return value;
}

/** Ringkas masalah impor untuk ditampilkan pada antarmuka. */
export function summarizeIssues(issues: ImportIssue[]): string {
  if (issues.length === 0) return '';
  const first = issues[0];
  const where = first.row > 0 ? `baris ${first.row}` : 'berkas';
  const rest = issues.length > 1 ? ` (dan ${issues.length - 1} masalah lain)` : '';
  return `${where}: ${first.message}${rest}`;
}