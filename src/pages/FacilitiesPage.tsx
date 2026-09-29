/**
 * Halaman Fasilitas — daftar, pencarian, penyaringan, dan rincian fasilitas.
 *
 * Semua jenis fasilitas tampil di sini, termasuk praktik dokter dan pos
 * kesehatan yang tidak digambar di peta. Identitas jenis di sini dibawa oleh
 * teks dan bentuk penanda, bukan warna saja, sehingga tidak terikat batas
 * tiga warna yang berlaku pada peta.
 */

import { useMemo, useState } from 'react';

import { useStore } from '../store/DataProvider';
import { Notice, StatTile } from '../components/ui';
import { FACILITY_KINDS, FACILITY_KIND_META, type Facility, type FacilityKind } from '../types';
import { colorsFor, KIND_SHAPE } from '../lib/palette';
import { toCsv, downloadText } from '../lib/io';
import { formatNumber, formatDistance, NO_DATA, todayIso } from '../lib/format';
import { haversineKm } from '../lib/geo';
import { IconDownload, IconSearch } from '../components/icons';

const PAGE_SIZE = 50;

export function FacilitiesPage() {
  const { data, settings, actions } = useStore();
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<FacilityKind | 'semua'>('semua');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Facility | null>(null);

  const bundle = data.bundle;

  const counts = useMemo(() => {
    const result = {} as Record<FacilityKind, number>;
    for (const facility of bundle?.facilities ?? []) {
      result[facility.kind] = (result[facility.kind] ?? 0) + 1;
    }
    return result;
  }, [bundle]);

  const filtered = useMemo(() => {
    if (!bundle) return [];
    const needle = query.trim().toLowerCase();

    return bundle.facilities.filter((facility) => {
      if (kindFilter !== 'semua' && facility.kind !== kindFilter) return false;
      if (needle === '') return true;
      return (
        facility.name.toLowerCase().includes(needle) ||
        (facility.address ?? '').toLowerCase().includes(needle) ||
        (facility.operator ?? '').toLowerCase().includes(needle) ||
        (facility.regionName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [bundle, query, kindFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (!bundle) return null;

  const palette = colorsFor(settings.theme);
  const withoutName = bundle.facilities.filter((f) => f.name === '(tanpa nama)').length;
  const unassigned = bundle.quality.facilitiesUnassignedToKelurahan;

  /** Wilayah tempat fasilitas berada, untuk menghitung jarak pada panel rincian. */
  const regionOfDetail = detail
    ? bundle.regions.find((region) => region.id === detail.regionId) ?? null
    : null;

  function exportFacilities() {
    const headers = [
      'id',
      'nama',
      'jenis',
      'lintang',
      'bujur',
      'alamat',
      'telepon',
      'operator',
      'kelurahan',
      'sumber',
    ];

    const rows = filtered.map((facility) => [
      facility.id,
      facility.name,
      FACILITY_KIND_META[facility.kind].label,
      facility.lat,
      facility.lon,
      facility.address ?? '',
      facility.phone ?? '',
      facility.operator ?? '',
      facility.regionName ?? '',
      facility.source,
    ]);

    downloadText(`fasilitas-kesehatan-${todayIso()}.csv`, toCsv(headers, rows));
  }

  return (
    <div className="page">
      <div className="grid grid--kpi">
        <StatTile label="Total fasilitas" value={formatNumber(bundle.facilities.length)} />
        <StatTile
          label="Rumah sakit"
          value={formatNumber(counts.hospital ?? 0)}
          note="Digambar di peta"
        />
        <StatTile
          label="Klinik & puskesmas"
          value={formatNumber(counts.clinic ?? 0)}
          note="Digambar di peta"
        />
        <StatTile label="Apotek" value={formatNumber(counts.pharmacy ?? 0)} note="Digambar di peta" />
      </div>

      <div className="grid grid--kpi">
        <StatTile label="Praktik dokter" value={formatNumber(counts.doctor ?? 0)} note="Hanya di daftar ini" />
        <StatTile
          label="Pos kesehatan"
          value={formatNumber(counts.health_post ?? 0)}
          note="Hanya di daftar ini"
        />
        <StatTile
          label="Tanpa nama di sumber"
          value={formatNumber(withoutName)}
          note="Diberi label (tanpa nama)"
        />
        <StatTile
          label="Tidak terpetakan ke wilayah"
          value={formatNumber(unassigned)}
          note="Biasanya di luar batas atau tepat di perbatasan"
        />
      </div>

      <Notice tone="info" title="Tentang kelengkapan data fasilitas">
        <p>
          Data fasilitas di sini berasal dari OpenStreetMap, yaitu data yang dipetakan komunitas —
          bukan daftar resmi Dinas Kesehatan. Fasilitas yang belum dipetakan tidak muncul, sehingga
          jumlah sebenarnya umumnya lebih banyak daripada yang terlihat. Tidak ada informasi
          kapasitas, jam operasional, atau jenis layanan yang tersedia.
        </p>
      </Notice>

      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Daftar fasilitas</h3>
            <div className="card__subtitle">
              {formatNumber(filtered.length)} dari {formatNumber(bundle.facilities.length)} fasilitas
              ditampilkan
            </div>
          </div>
          <button type="button" className="btn btn--sm" onClick={exportFacilities}>
            <IconDownload size={15} />
            Unduh CSV
          </button>
        </div>

        <div className="card__body">
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 200 }}>
              <span
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ui-text-muted)',
                  pointerEvents: 'none',
                }}
              >
                <IconSearch size={15} />
              </span>
              <input
                className="input"
                style={{ paddingLeft: 32 }}
                type="search"
                placeholder="Cari nama, alamat, atau wilayah…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                aria-label="Cari fasilitas"
              />
            </div>

            <select
              className="select"
              style={{ width: 'auto', minWidth: 190 }}
              value={kindFilter}
              onChange={(event) => {
                setKindFilter(event.target.value as FacilityKind | 'semua');
                setPage(1);
              }}
              aria-label="Saring menurut jenis fasilitas"
            >
              <option value="semua">Semua jenis</option>
              {FACILITY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {FACILITY_KIND_META[kind].label} ({formatNumber(counts[kind] ?? 0)})
                </option>
              ))}
            </select>
          </div>

          {pageRows.length === 0 ? (
            <div className="empty">
              <div className="empty__title">Tidak ada fasilitas yang cocok</div>
              <div className="empty__body">
                Coba ubah kata pencarian atau pilih jenis fasilitas yang lain.
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <caption className="sr-only">
                  Daftar fasilitas kesehatan, halaman {safePage} dari {pageCount}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Jenis</th>
                    <th scope="col">Nama</th>
                    <th scope="col">Wilayah</th>
                    <th scope="col">Alamat</th>
                    <th scope="col" className="num">
                      Koordinat
                    </th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((facility) => {
                    const meta = FACILITY_KIND_META[facility.kind];
                    const shape = KIND_SHAPE[facility.kind];
                    return (
                      <tr key={facility.id}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                            <span
                              className={`chip__mark chip__mark--${shape}`}
                              style={{ background: palette.series[meta.slot] }}
                            />
                            <span className="cell-muted">{meta.label}</span>
                          </span>
                        </td>
                        <td className="cell-name">{facility.name}</td>
                        <td>
                          {facility.regionName ?? (
                            <span className="cell-muted">Tidak terpetakan</span>
                          )}
                        </td>
                        <td>
                          {facility.address ? (
                            facility.address
                          ) : (
                            <span className="cell-muted">—</span>
                          )}
                        </td>
                        <td className="num" style={{ fontSize: '0.75rem' }}>
                          {facility.lat.toFixed(5)}, {facility.lon.toFixed(5)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--sm"
                            onClick={() => setDetail(facility)}
                          >
                            Rincian
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pageCount > 1 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginTop: 12,
              }}
            >
              <span className="stat__note">
                Halaman {formatNumber(safePage)} dari {formatNumber(pageCount)}
              </span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                >
                  Berikutnya
                </button>
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {detail ? (
        <FacilityDetail
          facility={detail}
          distanceKm={regionOfDetail ? haversineKm(regionOfDetail.centroid, detail) : null}
          regionName={regionOfDetail?.name ?? null}
          onClose={() => setDetail(null)}
          onFocusRegion={() => {
            actions.update({ highlightId: detail.regionId, metric: 'facilityCount' });
            setDetail(null);
            window.location.hash = '#peta';
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel rincian fasilitas                                                     */
/* -------------------------------------------------------------------------- */

interface FacilityDetailProps {
  facility: Facility;
  distanceKm: number | null;
  regionName: string | null;
  onClose: () => void;
  onFocusRegion: () => void;
}

function FacilityDetail({
  facility,
  distanceKm,
  regionName,
  onClose,
  onFocusRegion,
}: FacilityDetailProps) {
  const meta = FACILITY_KIND_META[facility.kind];
  const { settings } = useStore();
  const palette = colorsFor(settings.theme);

  // Rincian ditampilkan sebagai lapisan tetap, bukan dialog, karena isinya
  // pendek dan sering dipakai sambil melihat daftar di belakangnya.
  return (
    <div className="overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        className="dialog"
        style={{ maxWidth: 520 }}
        role="dialog"
        aria-modal="true"
        aria-label={`Rincian fasilitas ${facility.name}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="dialog__header">
          <div>
            <div className="dialog__title">{facility.name}</div>
            <div className="dialog__subtitle" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span
                className={`chip__mark chip__mark--${KIND_SHAPE[facility.kind]}`}
                style={{ background: palette.series[meta.slot] }}
              />
              {meta.label}
            </div>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
            Tutup
          </button>
        </div>

        <div className="dialog__body">
          <DetailRow label="Wilayah" value={regionName ?? facility.regionName ?? 'Tidak terpetakan'} />
          <DetailRow
            label="Jarak dari titik pusat wilayah"
            value={distanceKm === null ? NO_DATA : formatDistance(distanceKm)}
          />
          <DetailRow label="Alamat" value={facility.address ?? 'Tidak tercatat di sumber'} />
          <DetailRow label="Telepon" value={facility.phone ?? 'Tidak tercatat di sumber'} />
          <DetailRow label="Operator" value={facility.operator ?? 'Tidak tercatat di sumber'} />
          <DetailRow
            label="Tempat tidur"
            value={facility.beds === undefined ? 'Tidak tercatat di sumber' : formatNumber(facility.beds)}
          />
          <DetailRow
            label="Koordinat"
            value={`${facility.lat.toFixed(6)}, ${facility.lon.toFixed(6)}`}
          />
          <DetailRow
            label="Sumber"
            value={
              facility.source === 'osm'
                ? `OpenStreetMap${facility.osmId ? ` (${facility.osmId})` : ''}`
                : facility.source === 'import'
                  ? 'Berkas yang diimpor'
                  : 'Data contoh'
            }
          />

          <Notice tone="info">
            <p>
              Data ini berasal dari pemetaan komunitas dan tidak memuat informasi kapasitas, jam
              operasional, atau jenis layanan. Untuk keperluan resmi, rujuk ke Dinas Kesehatan Kota
              Surabaya.
            </p>
          </Notice>
        </div>

        <div className="dialog__footer dialog__footer--split">
          <a
            className="btn btn--sm"
            href={`https://www.openstreetmap.org/?mlat=${facility.lat}&mlon=${facility.lon}#map=17/${facility.lat}/${facility.lon}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Buka di OpenStreetMap
          </a>
          {facility.regionId ? (
            <button type="button" className="btn btn--primary btn--sm" onClick={onFocusRegion}>
              Lihat wilayahnya di peta
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-row">
      <span className="metric-row__label">{label}</span>
      <span className="metric-row__value" style={{ fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}