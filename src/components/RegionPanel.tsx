/**
 * Panel detail wilayah.
 *
 * Prinsip yang dipegang: setiap angka disertai asal-usulnya. Nilai yang tidak
 * dapat dihitung ditulis "data tidak tersedia" beserta alasannya, bukan
 * ditampilkan sebagai nol. Catatan kualitas data dari proses perakitan ikut
 * ditampilkan, sehingga keterbatasan sumber terlihat oleh pembaca laporan.
 */

import type { Facility, Region } from '../types';
import { FACILITY_KIND_META, METRIC_META } from '../types';
import type { RegionMetrics } from '../lib/metrics';
import { formatArea, formatDistance, formatNumber, formatPercent, NO_DATA } from '../lib/format';
import { facilitiesWithin } from '../lib/access';
import { colorsFor, KIND_SHAPE } from '../lib/palette';
import { IconAlert, IconClose } from './icons';
import { MetricRow, Notice } from './ui';
import type { ThemeMode } from '../store/DataProvider';

interface RegionPanelProps {
  region: Region;
  entry: RegionMetrics | null;
  facilities: Facility[];
  theme: ThemeMode;
  rank: number | null;
  rankTotal: number;
  onClose: () => void;
  onShowInList: (regionId: string) => void;
}

export function RegionPanel({
  region,
  entry,
  facilities,
  theme,
  rank,
  rankTotal,
  onClose,
  onShowInList,
}: RegionPanelProps) {
  const palette = colorsFor(theme);

  const nearest = entry ? facilitiesWithin(region.centroid, facilities, 5) : [];
  // Metrik yang memerlukan angka penduduk ditandai secara eksplisit agar
  // pembaca tidak menyimpulkan "tidak ada fasilitas" dari nilai yang kosong.
  const populationMissing = region.population === null;

  return (
    <aside className="region-panel" aria-label={`Detail wilayah ${region.name}`}>
      <div className="region-panel__header" style={{ position: 'relative' }}>
        <button
          type="button"
          className="btn btn--ghost btn--icon region-panel__close"
          onClick={onClose}
          aria-label="Tutup panel detail"
        >
          <IconClose size={16} />
        </button>

        <h2 className="region-panel__title">{region.name}</h2>
        <div className="region-panel__meta">
          {region.level === 'kecamatan'
            ? 'Kecamatan'
            : `Kelurahan${region.parentName ? ` · Kecamatan ${region.parentName}` : ''}`}
          {rank !== null ? ` · Peringkat ${formatNumber(rank)} dari ${formatNumber(rankTotal)}` : ''}
        </div>
      </div>

      <div className="region-panel__body">
        {populationMissing ? (
          <Notice tone="warning" title="Angka penduduk belum tersedia">
            <p>
              Wilayah ini belum memiliki angka penduduk, sehingga kepadatan, rasio fasilitas, dan skor
              prioritas tidak dapat dihitung. Ini bukan berarti angkanya nol.
            </p>
            <p>
              Isi angka dari BPS Kota Surabaya pada berkas{' '}
              <code>data/templates/penduduk-template.csv</code>, lalu impor lewat halaman Data.
            </p>
          </Notice>
        ) : null}

        <div>
          <div className="section-title" style={{ marginBottom: 6 }}>
            Kependudukan dan wilayah
          </div>
          <MetricRow
            label="Jumlah penduduk"
            value={region.population === null ? NO_DATA : `${formatNumber(region.population)} jiwa`}
            missing={region.population === null}
            hint={
              region.populationYear
                ? `Tahun rujukan ${region.populationYear}`
                : populationMissing
                  ? 'Belum ada tahun rujukan'
                  : undefined
            }
          />
          <MetricRow
            label="Luas wilayah"
            value={formatArea(region.areaKm2)}
            missing={region.areaKm2 === null}
            hint="Dihitung dari poligon batas wilayah"
          />
          {region.areaOfficialKm2 !== null ? (
            <MetricRow
              label="Luas menurut sumber resmi"
              value={formatArea(region.areaOfficialKm2)}
              hint="Sebagai pembanding luas hasil hitungan poligon"
            />
          ) : null}
          <MetricRow
            label="Kepadatan penduduk"
            value={
              entry?.values.density === null || !entry
                ? NO_DATA
                : `${formatNumber(entry.values.density)} jiwa/km²`
            }
            missing={!entry || entry.values.density === null}
          />
        </div>

        <div>
          <div className="section-title" style={{ marginBottom: 6 }}>
            Fasilitas kesehatan
          </div>
          {entry ? (
            <>
              {(Object.keys(FACILITY_KIND_META) as (keyof typeof FACILITY_KIND_META)[]).map((kind) => {
                const meta = FACILITY_KIND_META[kind];
                const count = entry.counts[kind];
                return (
                  <MetricRow key={kind} label={meta.label} value={formatNumber(count)} />
                );
              })}
              <MetricRow label="Total fasilitas" value={formatNumber(entry.counts.total)} />
              <MetricRow
                label="Fasilitas per 1.000 penduduk"
                value={
                  entry.values.facilityRatio === null
                    ? NO_DATA
                    : formatNumber(entry.values.facilityRatio, 2)
                }
                missing={entry.values.facilityRatio === null}
                hint="Dihitung dari seluruh jenis fasilitas yang sedang aktif"
              />
            </>
          ) : (
            <MetricRow label="Total fasilitas" value={NO_DATA} missing />
          )}
        </div>

        <div>
          <div className="section-title" style={{ marginBottom: 6 }}>
            Aksesibilitas
          </div>
          {entry ? (
            <>
              <MetricRow
                label="Jarak terdekat (semua jenis)"
                value={formatDistance(entry.access.nearestAnyKm)}
                missing={entry.access.nearestAnyKm === null}
                hint="Jarak garis lurus dari titik pusat wilayah"
              />
              {entry.access.nearest.map((item) => {
                const meta = FACILITY_KIND_META[item.kind];
                if (!item.km) return null;
                return (
                  <MetricRow
                    key={item.kind}
                    label={`Terdekat: ${meta.label}`}
                    value={formatDistance(item.km)}
                    hint={item.facilityName ?? undefined}
                  />
                );
              })}
              <MetricRow
                label="Cakupan radius 1 km"
                value={formatPercent(entry.access.coverage[1])}
                missing={entry.access.coverage[1] === null}
              />
              <MetricRow
                label="Cakupan radius 3 km"
                value={formatPercent(entry.access.coverage[3])}
                missing={entry.access.coverage[3] === null}
              />
              <MetricRow
                label="Cakupan radius 5 km"
                value={formatPercent(entry.access.coverage[5])}
                missing={entry.access.coverage[5] === null}
                hint={`Perkiraan dari ${formatNumber(entry.access.samplePoints)} titik sampel berjarak 500 m`}
              />
            </>
          ) : (
            <MetricRow label="Jarak terdekat" value={NO_DATA} missing />
          )}

          <div className="details" style={{ marginTop: 12 }}>
            <details>
              <summary>Cara aksesibilitas dihitung</summary>
              <ul>
                <li>
                  Jarak memakai <strong>jarak garis lurus</strong>, bukan jarak tempuh jaringan jalan.
                  Wilayah yang terhalang sungai atau tanpa jalan tembus dapat terlihat lebih dekat
                  daripada kenyataan.
                </li>
                <li>Titik ukur adalah titik representatif wilayah yang dijamin berada di dalam poligon.</li>
                <li>
                  Cakupan dihitung dari sampel titik berjarak 500 m di dalam wilayah, jadi nilainya
                  perkiraan dengan ketelitian terbatas pada kerapatan sampel.
                </li>
              </ul>
            </details>
          </div>
        </div>

        {entry?.priority ? (
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>
              Skor prioritas
            </div>
            <MetricRow
              label="Skor (0–100, makin tinggi makin perlu perhatian)"
              value={
                entry.priority.score === null ? NO_DATA : formatNumber(entry.priority.score, 1)
              }
              missing={entry.priority.score === null}
            />
            <MetricRow
              label="Komponen: kepadatan penduduk"
              value={
                entry.priority.components.density === null
                  ? NO_DATA
                  : formatNumber(entry.priority.components.density * 100, 0)
              }
              missing={entry.priority.components.density === null}
              hint="Skor 0–100 relatif terhadap wilayah lain pada level yang sama"
            />
            <MetricRow
              label="Komponen: kelangkaan fasilitas"
              value={
                entry.priority.components.scarcity === null
                  ? NO_DATA
                  : formatNumber(entry.priority.components.scarcity * 100, 0)
              }
              missing={entry.priority.components.scarcity === null}
            />
            <MetricRow
              label="Komponen: jarak ke fasilitas"
              value={
                entry.priority.components.distance === null
                  ? NO_DATA
                  : formatNumber(entry.priority.components.distance * 100, 0)
              }
              missing={entry.priority.components.distance === null}
            />
            {entry.priority.missing.length > 0 ? (
              <div className="stat__note" style={{ marginTop: 6 }}>
                Skor dihitung hanya dari komponen yang datanya tersedia. Komponen yang kosong:{' '}
                {entry.priority.missing.join(', ')}.
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <div className="section-title" style={{ marginBottom: 6 }}>
            Fasilitas terdekat
          </div>
          {nearest.length === 0 ? (
            <p className="stat__note">
              Tidak ada fasilitas yang sedang aktif dalam jarak 5 km dari titik pusat wilayah.
            </p>
          ) : (
            <ul className="facility-list">
              {nearest.map(({ facility, km }) => {
                const meta = FACILITY_KIND_META[facility.kind];
                return (
                  <li className="facility-list__item" key={facility.id}>
                    <span
                      className="chip__mark"
                      style={{
                        background: palette.series[meta.slot],
                        borderRadius: KIND_SHAPE[facility.kind] === 'circle' ? '50%' : undefined,
                      }}
                    />
                    <span className="facility-list__name" title={facility.name}>
                      {facility.name}
                    </span>
                    <span className="facility-list__distance">{formatDistance(km)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {region.notes.length > 0 ? (
          <div className="details">
            <details>
              <summary>
                <IconAlert size={13} />
                <span style={{ marginLeft: 5 }}>Catatan kualitas data ({region.notes.length})</span>
              </summary>
              <ul>
                {region.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}

        <div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => onShowInList(region.id)}
            style={{ width: '100%' }}
          >
            Lihat di tabel peringkat
          </button>
        </div>

        <div className="stat__note">
          Satuan metrik: {METRIC_META.density.unit}, {METRIC_META.facilityRatio.unit},{' '}
          {METRIC_META.nearestDistance.unit}, {METRIC_META.coverage.unit}.
        </div>
      </div>
    </aside>
  );
}