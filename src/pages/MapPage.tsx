/**
 * Halaman Peta — eksplorasi sebaran dan aksesibilitas secara spasial.
 *
 * Tata letak: bilah filter satu baris di atas, peta mengisi sisa ruang, panel
 * detail wilayah di sisi kanan (menjadi lembar bawah pada layar kecil).
 */

import { useMemo, useState } from 'react';

import { initialMetricFor, useStore } from '../store/DataProvider';
import { MapCanvas, basemapOptions, type BasemapId } from '../components/MapCanvas';
import { FilterBar } from '../components/FilterBar';
import { RegionPanel } from '../components/RegionPanel';
import { FACILITY_KIND_META, METRIC_META } from '../types';
import { rankByMetric } from '../lib/metrics';
import type { ClassMethod } from '../lib/classify';
import { formatDistance, formatNumber, formatPercent, NO_DATA } from '../lib/format';

/**
 * Metode pengelompokan kelas choropleth yang boleh dipilih pengguna.
 *
 * Keduanya punya sifat yang berlawanan dan itu justru gunanya. Pada data yang
 * banyak nilainya kembar, kuantil dapat menumpuk hampir semua wilayah ke satu
 * kelas sehingga peta tampak seragam; natural breaks (Jenks) memecahnya pada
 * celah nilai yang nyata, tetapi bisa menghasilkan kelas yang sangat timpang.
 * Karena keduanya bisa menyesatkan pada data yang berbeda, pilihan ini
 * diserahkan ke pengguna alih-alih ditetapkan di dalam kode — sekaligus
 * memenuhi janji pada halaman Metodologi.
 */
const CLASS_METHODS: { id: ClassMethod; label: string; hint: string }[] = [
  {
    id: 'quantile',
    label: 'Kuantil',
    hint: 'Setiap kelas berisi jumlah wilayah yang hampir seimbang. Baik untuk melihat peringkat relatif.',
  },
  {
    id: 'jenks',
    label: 'Natural breaks',
    hint: 'Batas kelas diletakkan pada celah nilai yang nyata. Baik untuk memperlihatkan kelompok yang memang terpisah.',
  },
];

export function MapPage() {
  const { data, settings, metrics, classification, actions } = useStore();
  const [basemap, setBasemap] = useState<BasemapId>('standar');
  const [showFacilities, setShowFacilities] = useState(true);
  const [coverageRadius, setCoverageRadius] = useState<number | null>(null);

  const bundle = data.bundle;

  const regions = useMemo(
    () => (bundle ? bundle.regions.filter((region) => region.level === settings.level) : []),
    [bundle, settings.level],
  );

  /** Jumlah fasilitas per jenis, sebelum filter jenis diterapkan. */
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const facility of bundle?.facilities ?? []) {
      counts[facility.kind] = (counts[facility.kind] ?? 0) + 1;
    }
    return counts as Record<keyof typeof FACILITY_KIND_META, number>;
  }, [bundle]);

  const selectedRegion = useMemo(
    () => regions.find((region) => region.id === settings.highlightId) ?? null,
    [regions, settings.highlightId],
  );

  const selectedEntry = settings.highlightId
    ? (metrics?.byId.get(settings.highlightId) ?? null)
    : null;

  const ranking = useMemo(
    () => (metrics ? rankByMetric(metrics, settings.level, settings.metric) : []),
    [metrics, settings.level, settings.metric],
  );

  const selectedRank = useMemo(() => {
    if (!settings.highlightId) return null;
    const found = ranking.find((row) => row.regionId === settings.highlightId);
    return found?.rank ?? null;
  }, [ranking, settings.highlightId]);

  const populationAvailable = useMemo(() => {
    if (!bundle) return false;
    return bundle.regions.some((region) => region.population !== null);
  }, [bundle]);

  if (!bundle || !metrics) return null;

  return (
    /*
     * Pembungkus ini bukan hiasan. Sebelumnya halaman mengembalikan fragment
     * kosong, sehingga bilah filter dan wadah peta menjadi anak langsung dari
     * .app__content. Tetapi .app__content bukan flex container — anak-anaknya
     * tersusun sebagai blok biasa, dan .map-layout yang memakai
     * height: 100% menghitung tinggi terhadap SELURUH tinggi konten, bukan
     * sisa ruang di bawah bilah filter. Akibatnya peta melampaui dasar
     * jendela: panel legenda yang ditempelkan di dasar peta ikut terdorong
     * keluar layar dan terpotong.
     *
     * Dengan pembungkus flex ber-min-height: 0 ini, .map-layout mendapat
     * flex: 1 dan tinggi 100% miliknya dihitung terhadap sisa ruang yang
     * benar — yaitu tinggi konten dikurangi bilah filter di atasnya.
     */
    <div className="map-page">
      <FilterBar
        level={settings.level}
        metric={settings.metric}
        activeKinds={settings.kinds}
        kindCounts={kindCounts}
        theme={settings.theme}
        basemap={basemap}
        onLevel={(level) => actions.update({ level, highlightId: null })}
        onMetric={(metric) => actions.update({ metric })}
        onToggleKind={actions.toggleKind}
        onTheme={(theme) => actions.update({ theme })}
        onBasemap={setBasemap}
        onReset={() => {
          actions.update({
            level: 'kecamatan',
            metric: initialMetricFor(bundle.regions),
            highlightId: null,
          });
          actions.resetWeights();
        }}
        populationAvailable={populationAvailable}
        showBasemap
      />

      {/* Kontrol tambahan khusus peta, tetap satu baris di atas peta. */}
      <div className="filterbar" style={{ paddingTop: 8, paddingBottom: 8 }}>
        <div className="filterbar__group">
          <button
            type="button"
            className="chip"
            aria-pressed={showFacilities}
            onClick={() => setShowFacilities((value) => !value)}
          >
            Tampilkan penanda fasilitas
          </button>
        </div>

        <div className="filterbar__group">
          <span className="filterbar__label">Cakupan radius</span>
          <div className="segmented" role="group" aria-label="Radius cakupan">
            {[null, 1, 3, 5].map((radius) => (
              <button
                key={String(radius)}
                type="button"
                className="segmented__option"
                aria-pressed={coverageRadius === radius}
                onClick={() => setCoverageRadius(radius)}
              >
                {radius === null ? 'Mati' : `${radius} km`}
              </button>
            ))}
          </div>
        </div>

        <div className="filterbar__group">
          <span className="filterbar__label">Kelas peta</span>
          <div className="segmented" role="group" aria-label="Metode pengelompokan kelas">
            {CLASS_METHODS.map((option) => (
              <button
                key={option.id}
                type="button"
                className="segmented__option"
                aria-pressed={settings.classMethod === option.id}
                title={option.hint}
                onClick={() => actions.update({ classMethod: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="filterbar__label" htmlFor="class-count" style={{ marginLeft: 4 }}>
            Jumlah
          </label>
          <select
            id="class-count"
            className="select"
            style={{ width: 'auto' }}
            value={settings.classCount}
            onChange={(event) => actions.update({ classCount: Number(event.target.value) })}
          >
            {[3, 4, 5, 6, 7].map((count) => (
              <option key={count} value={count}>
                {count} kelas
              </option>
            ))}
          </select>
        </div>

        <div className="filterbar__spacer" />

        {selectedRegion ? (
          <div className="filterbar__group">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => actions.update({ highlightId: null })}
            >
              Bersihkan pilihan wilayah
            </button>
          </div>
        ) : null}
      </div>

      <div className={`map-layout${selectedRegion ? '' : ' map-layout--panel-hidden'}`} style={{ flex: 1, minHeight: 0 }}>
        <div className="map-pane">
          <MapCanvas
            regions={regions}
            level={settings.level}
            metrics={metrics}
            classification={classification}
            metric={settings.metric}
            facilities={bundle.facilities}
            activeKinds={settings.kinds}
            selectedId={settings.highlightId}
            onSelect={(regionId) => actions.update({ highlightId: regionId })}
            theme={settings.theme}
            basemap={basemap}
            showFacilities={showFacilities}
            coverageRadius={coverageRadius}
          />

          {coverageRadius !== null && !selectedRegion ? (
            <div className="map-overlay map-overlay--layers" style={{ top: 'auto', bottom: 14 }}>
              <div className="legend__note" style={{ marginTop: 0 }}>
                Pilih sebuah wilayah untuk melihat lingkaran radius {coverageRadius} km di sekitarnya.
                Cakupan pada panel dihitung dari sampel titik di dalam wilayah, bukan dari lingkaran
                ini.
              </div>
            </div>
          ) : null}
        </div>

        {selectedRegion ? (
          <RegionPanel
            region={selectedRegion}
            entry={selectedEntry}
            facilities={bundle.facilities.filter((facility) =>
              settings.kinds.includes(facility.kind),
            )}
            theme={settings.theme}
            rank={selectedRank}
            rankTotal={regions.length}
            onClose={() => actions.update({ highlightId: null })}
            onShowInList={() => {
              /* Tabel peringkat ada di halaman Analisis; arahkan ke sana. */
              window.location.hash = '#analisis';
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ringkasan angka kota untuk ditampilkan pada halaman peta sebagai konteks.
 * Dipisahkan agar halaman peta tetap ringkas saat panel detail terbuka.
 */
export function CitySummary() {
  const { data, metrics, settings } = useStore();
  if (!data.bundle || !metrics) return null;

  const meta = METRIC_META[settings.metric];
  const rows = metrics.regions.filter((region) => region.level === settings.level);

  const values = rows
    .map((region) => metrics.byId.get(region.id)?.values[settings.metric] ?? null)
    .filter((value): value is number => value !== null);

  const totalFacilities = metrics.usedFacilities.length;

  const average = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const worstDistance = Math.max(
    ...rows.map((region) => metrics.byId.get(region.id)?.values.nearestDistance ?? 0),
    0,
  );

  return (
    <div className="grid grid--kpi" style={{ marginBottom: 0 }}>
      <div className="card stat">
        <div className="stat__label">Wilayah {settings.level}</div>
        <div className="stat__value">{formatNumber(rows.length)}</div>
      </div>
      <div className="card stat">
        <div className="stat__label">Fasilitas aktif</div>
        <div className="stat__value">{formatNumber(totalFacilities)}</div>
        <div className="stat__note">Sesuai filter jenis yang sedang aktif</div>
      </div>
      <div className="card stat">
        <div className="stat__label">Rata-rata {meta.label.toLowerCase()}</div>
        <div className="stat__value">
          {average === null ? NO_DATA : formatNumber(average, meta.decimals)}
          {average !== null ? <span className="stat__unit">{meta.unit}</span> : null}
        </div>
      </div>
      <div className="card stat">
        <div className="stat__label">Jarak terjauh ke fasilitas</div>
        <div className="stat__value">
          {rows.length === 0 ? NO_DATA : formatDistance(worstDistance)}
        </div>
        <div className="stat__note">Dari titik pusat wilayah</div>
      </div>
    </div>
  );
}

/** Keterangan cakupan dalam bentuk persentase, dipakai halaman analisis. */
export function coverageLabel(value: number | null): string {
  return formatPercent(value);
}

export { basemapOptions };