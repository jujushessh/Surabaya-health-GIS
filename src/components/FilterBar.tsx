/**
 * Bilah filter.
 *
 * Semua filter berada dalam satu baris di atas isi yang diaturnya, sehingga
 * setiap panel dan grafik di bawahnya selalu memakai potongan data yang sama.
 * Tidak ada filter yang diletakkan di dalam kartu grafik.
 */

import type { FacilityKind, MetricId, RegionLevel } from '../types';
import { FACILITY_KINDS, FACILITY_KIND_META, METRIC_META } from '../types';
import { colorsFor, KIND_SHAPE } from '../lib/palette';
import { formatNumber } from '../lib/format';
import type { BasemapId } from './MapCanvas';
import { IconSun, IconMoon, IconRefresh } from './icons';
import type { ThemeMode } from '../store/DataProvider';
import { metricNeedsPopulation } from '../store/DataProvider';

interface FilterBarProps {
  level: RegionLevel;
  metric: MetricId;
  activeKinds: FacilityKind[];
  kindCounts: Record<FacilityKind, number>;
  theme: ThemeMode;
  basemap: BasemapId;
  onLevel: (level: RegionLevel) => void;
  onMetric: (metric: MetricId) => void;
  onToggleKind: (kind: FacilityKind) => void;
  onTheme: (theme: ThemeMode) => void;
  onBasemap: (basemap: BasemapId) => void;
  onReset: () => void;
  /** Metrik yang tidak dapat dihitung karena angka penduduk belum ada. */
  populationAvailable: boolean;
  showBasemap?: boolean;
}

export function FilterBar({
  level,
  metric,
  activeKinds,
  kindCounts,
  theme,
  basemap,
  onLevel,
  onMetric,
  onToggleKind,
  onTheme,
  onBasemap,
  onReset,
  populationAvailable,
  showBasemap = false,
}: FilterBarProps) {
  const palette = colorsFor(theme);

  const metricOptions: MetricId[] = [
    'density',
    'facilityRatio',
    'nearestDistance',
    'coverage',
    'priorityScore',
    'facilityCount',
  ];

  return (
    <div className="filterbar" role="group" aria-label="Filter tampilan">
      <div className="filterbar__group">
        <span className="filterbar__label">Wilayah</span>
        <div className="segmented" role="group" aria-label="Level wilayah">
          <button
            type="button"
            className="segmented__option"
            aria-pressed={level === 'kecamatan'}
            onClick={() => onLevel('kecamatan')}
          >
            Kecamatan
          </button>
          <button
            type="button"
            className="segmented__option"
            aria-pressed={level === 'kelurahan'}
            onClick={() => onLevel('kelurahan')}
          >
            Kelurahan
          </button>
        </div>
      </div>

      <div className="filterbar__group">
        <label className="filterbar__label" htmlFor="metric-select">
          Metrik
        </label>
        <select
          id="metric-select"
          className="select"
          style={{ width: 'auto', minWidth: 210 }}
          value={metric}
          onChange={(event) => onMetric(event.target.value as MetricId)}
        >
          {metricOptions.map((id) => {
            const meta = METRIC_META[id];
            const unavailable = !populationAvailable && metricNeedsPopulation(id);
            // Tanda hanya ditulis pada metrik yang sedang dipilih. Bila
            // ditempelkan ke setiap opsi, daftar akan penuh keterangan yang
            // sama dan justru sulit dibaca.
            const mark = unavailable && id === metric ? ' — perlu angka penduduk' : '';
            return (
              <option key={id} value={id}>
                {meta.label}
                {mark}
              </option>
            );
          })}
        </select>
      </div>

      <div className="filterbar__group">
        <span className="filterbar__label">Jenis</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FACILITY_KINDS.map((kind) => {
            const meta = FACILITY_KIND_META[kind];
            const active = activeKinds.includes(kind);
            const shape = KIND_SHAPE[kind];
            return (
              <button
                key={kind}
                type="button"
                className="chip"
                aria-pressed={active}
                onClick={() => onToggleKind(kind)}
                title={
                  active
                    ? `Sembunyikan ${meta.label}`
                    : `Tampilkan ${meta.label}`
                }
              >
                <span
                  className={`chip__mark chip__mark--${shape}`}
                  style={{ background: active ? palette.series[meta.slot] : 'var(--ui-text-muted)' }}
                />
                {meta.label}
                <span className="chip__count">{formatNumber(kindCounts[kind] ?? 0)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="filterbar__spacer" />

      {showBasemap ? (
        <div className="filterbar__group">
          <label className="filterbar__label" htmlFor="basemap-select">
            Peta dasar
          </label>
          <select
            id="basemap-select"
            className="select"
            style={{ width: 'auto' }}
            value={basemap}
            onChange={(event) => onBasemap(event.target.value as BasemapId)}
          >
            <option value="standar">Standar OpenStreetMap</option>
            <option value="terang">Terang (CARTO)</option>
            <option value="gelap">Gelap (CARTO)</option>
          </select>
        </div>
      ) : null}

      <div className="filterbar__group">
        <button
          type="button"
          className="btn btn--icon"
          onClick={() => onTheme(theme === 'light' ? 'dark' : 'light')}
          aria-label={theme === 'light' ? 'Ganti ke mode gelap' : 'Ganti ke mode terang'}
          title={theme === 'light' ? 'Mode gelap' : 'Mode terang'}
        >
          {theme === 'light' ? <IconMoon size={17} /> : <IconSun size={17} />}
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onReset}
          aria-label="Kembalikan filter ke pengaturan awal"
          title="Kembalikan pengaturan awal"
        >
          <IconRefresh size={17} />
        </button>
      </div>
    </div>
  );
}