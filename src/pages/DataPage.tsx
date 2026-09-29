/**
 * Halaman Data — sumber, lisensi, mutu data, dan impor/ekspor.
 *
 * Halaman ini adalah tempat pertanggungjawaban data. Setiap angka yang tampil
 * di halaman lain berasal dari salah satu berkas yang didaftarkan di sini,
 * lengkap dengan tanggal akses dan lisensinya, sehingga klaim pada tulisan
 * akademis dapat ditelusuri.
 */

import { useMemo, useRef, useState } from 'react';

import { useStore } from '../store/DataProvider';
import { Modal, Notice, StatTile } from '../components/ui';
import {
  importPopulationCsv,
  importFacilitiesCsv,
  importBoundariesGeojson,
  describeIssues,
  downloadText,
  toCsv,
  FACILITY_CSV_HEADERS,
  POPULATION_CSV_HEADERS,
  type ImportIssue,
} from '../lib/io';
import { formatDate, formatNumber, formatPercent, formatRatioPercent, formatArea, NO_DATA, todayIso } from '../lib/format';
import { checkLevelConsistency } from '../lib/metrics';
import {
  IconAlert,
  IconDatabase,
  IconDownload,
  IconPrint,
  IconUpload,
  IconRefresh,
} from '../components/icons';

type ImportKind = 'fasilitas' | 'penduduk' | 'batas';

const IMPORT_LABEL: Record<ImportKind, string> = {
  fasilitas: 'CSV fasilitas',
  penduduk: 'CSV angka penduduk',
  batas: 'GeoJSON batas wilayah',
};

export function DataPage() {
  const { data, actions, metrics } = useStore();
  const [issueDialog, setIssueDialog] = useState<{ kind: ImportKind; issues: ImportIssue[] } | null>(
    null,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<ImportKind>('fasilitas');
  const fileRef = useRef<HTMLInputElement>(null);

  const bundle = data.bundle;

  /**
   * Perbandingan nilai kecamatan yang dihitung langsung dengan penjumlahan
   * kelurahannya. Memakai hasil metrik dari store supaya angkanya persis sama
   * dengan yang tampil di halaman peta dan analisis.
   */
  const consistency = useMemo(
    () => (metrics ? checkLevelConsistency(metrics) : []),
    [metrics],
  );

  if (!bundle) return null;

  const quality = bundle.quality;
  const populationShare =
    quality.regionsTotal > 0 ? quality.regionsWithPopulation / quality.regionsTotal : null;

  const kecamatan = bundle.regions.filter((region) => region.level === 'kecamatan');
  const kelurahan = bundle.regions.filter((region) => region.level === 'kelurahan');

  async function handleFile(file: File) {
    setSuccess(null);
    const text = await file.text();

    if (pendingKind === 'fasilitas') {
      const result = importFacilitiesCsv(text);
      if (result.ok) {
        actions.applyImport(result, 'facilities');
        setSuccess(
          `${formatNumber(result.data.length)} fasilitas diimpor dari ${file.name}. Fasilitas dengan ID yang sama diganti, sisanya ditambahkan.`,
        );
      } else {
        setIssueDialog({ kind: 'fasilitas', issues: result.issues });
      }
      return;
    }

    if (pendingKind === 'penduduk') {
      const result = importPopulationCsv(text, bundle!.regions);
      if (result.ok) {
        const patches = result.data;
        actions.applyImport(
          {
            ok: true,
            issues: [],
            data: bundle!.regions
              .filter((region) => patches.some((patch) => patch.regionId === region.id))
              .map((region) => {
                const patch = patches.find((item) => item.regionId === region.id)!;
                return {
                  ...region,
                  population: patch.population,
                  populationYear: patch.year,
                  areaOfficialKm2: patch.areaKm2,
                };
              }),
          },
          'regions',
        );
        setSuccess(
          `${formatNumber(patches.length)} wilayah diperbarui angka penduduknya dari ${file.name}.`,
        );
      } else {
        setIssueDialog({ kind: 'penduduk', issues: result.issues });
      }
      return;
    }

    const result = importBoundariesGeojson(text);
    if (result.ok) {
      actions.applyImport(result, 'regions');
      setSuccess(`${formatNumber(result.data.length)} wilayah batas diimpor dari ${file.name}.`);
    } else {
      setIssueDialog({ kind: 'batas', issues: result.issues });
    }
  }

  function exportPopulation() {
    const rows = bundle!.regions.map((region) => [
      region.name,
      region.level,
      region.population ?? '',
      region.populationYear ?? '',
      region.areaOfficialKm2 ?? '',
    ]);
    downloadText(
      `penduduk-surabaya-${todayIso()}.csv`,
      toCsv([...POPULATION_CSV_HEADERS], rows),
    );
  }

  function exportRegions() {
    const rows = bundle!.regions.map((region) => {
      const entry = metrics?.byId.get(region.id) ?? null;
      return [
        region.id,
        region.name,
        region.level,
        region.parentName ?? '',
        region.population ?? '',
        region.populationYear ?? '',
        region.areaKm2 ?? '',
        entry?.values.density ?? '',
        entry?.values.facilityRatio ?? '',
        entry?.values.nearestDistance ?? '',
        entry?.values.facilityCount ?? '',
        entry?.values.priorityScore ?? '',
      ];
    });

    downloadText(
      `ringkasan-wilayah-${todayIso()}.csv`,
      toCsv(
        [
          'id',
          'wilayah',
          'level',
          'kecamatan_induk',
          'penduduk',
          'tahun_penduduk',
          'luas_km2',
          'kepadatan_jiwa_per_km2',
          'fasilitas_per_1000_penduduk',
          'jarak_terdekat_km',
          'jumlah_fasilitas',
          'skor_prioritas',
        ],
        rows,
      ),
    );
  }

  function exportFacilitiesTemplate() {
    downloadText(
      'contoh-fasilitas.csv',
      toCsv(
        [...FACILITY_CSV_HEADERS],
        [
          [
            'rs-contoh-1',
            'RSUD Contoh',
            'hospital',
            -7.2458,
            112.7378,
            'Jl. Contoh No. 1',
            '031-0000000',
            'Pemerintah Kota',
            250,
          ],
          [
            'klinik-contoh-1',
            'Klinik Contoh',
            'clinic',
            -7.2601,
            112.7502,
            'Jl. Contoh No. 2',
            '',
            'Swasta',
            '',
          ],
        ],
      ),
    );
  }

  function exportPopulationTemplate() {
    // Template ini sengaja memuat nama wilayah yang benar dengan angka kosong:
    // mengosongkan lebih jujur daripada mengisi angka yang tidak diketahui.
    // Kolom kecamatan_induk dikosongkan karena tidak perlu untuk kecamatan;
    // gunanya adalah membedakan kelurahan bernama kembar (mis. dua "Wonorejo").
    downloadText(
      'penduduk-template.csv',
      toCsv(
        [...POPULATION_CSV_HEADERS],
        kecamatan.map((region) => [region.name, '', 'kecamatan', '', '', '']),
      ),
    );
  }

  return (
    <div className="page">
      <div className="grid grid--kpi">
        <StatTile label="Wilayah kecamatan" value={formatNumber(kecamatan.length)} />
        <StatTile label="Wilayah kelurahan" value={formatNumber(kelurahan.length)} />
        <StatTile
          label="Fasilitas"
          value={formatNumber(quality.facilitiesTotal)}
          note={`${formatNumber(quality.facilitiesUnassignedToKelurahan)} tidak terpetakan ke kelurahan`}
        />
        <StatTile
          label="Wilayah dengan angka penduduk"
          value={populationShare === null ? NO_DATA : formatRatioPercent(populationShare)}
          note={`${formatNumber(quality.regionsWithPopulation)} dari ${formatNumber(quality.regionsTotal)} wilayah`}
          missing={populationShare === null}
        />
      </div>

      {data.isDemo ? (
        <Notice tone="demo" title="Aplikasi sedang memakai data contoh">
          <p>
            Semua angka di halaman lain saat ini berasal dari data buatan, bukan Kota Surabaya.
            Muat ulang dataset dari berkas untuk kembali ke data sebenarnya.
          </p>
          <div className="notice__actions">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                void actions.reload();
              }}
            >
              Muat ulang dari berkas
            </button>
          </div>
        </Notice>
      ) : null}

      {quality.regionsWithPopulation < quality.regionsTotal ? (
        <Notice tone="warning" title="Sebagian wilayah belum punya angka penduduk">
          <p>
            Kepadatan, rasio fasilitas per 1.000 penduduk, dan skor prioritas hanya dapat dihitung
            untuk wilayah yang angka penduduknya tersedia. Wilayah lain ditandai{' '}
            <em>{NO_DATA}</em> — bukan nol, karena nol berarti terukur dan hasilnya nol. Unduh
            template di bawah, isi dari publikasi BPS, lalu impor kembali.
          </p>
          <div className="notice__actions">
            <button type="button" className="btn btn--sm" onClick={exportPopulationTemplate}>
              <IconDownload size={14} />
              Unduh template penduduk
            </button>
          </div>
        </Notice>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Sumber data                                                       */}
      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              <IconDatabase size={16} /> Sumber data
            </h3>
            <div className="card__subtitle">
              Dicatat saat penyiapan data. Sertakan daftar ini pada bagian metodologi tulisan.
            </div>
          </div>
          <button type="button" className="btn btn--sm" onClick={() => window.print()}>
            <IconPrint size={15} />
            Cetak
          </button>
        </div>

        <div className="card__body">
          {bundle.datasets.length === 0 ? (
            <div className="empty">
              <div className="empty__title">Metadata sumber tidak tersedia</div>
              <div className="empty__body">
                Berkas metadata.json tidak memuat daftar dataset. Rakit ulang dengan{' '}
                <code>npm run data:build</code>.
              </div>
            </div>
          ) : (
            bundle.datasets.map((dataset) => (
              <article key={dataset.id} className="source-item">
                <h4 className="source-item__title">{dataset.title}</h4>
                <dl className="source-item__meta">
                  <div>
                    <dt>Sumber</dt>
                    <dd>{dataset.source || '—'}</dd>
                  </div>
                  <div>
                    <dt>Lisensi</dt>
                    <dd>{dataset.license || '—'}</dd>
                  </div>
                  <div>
                    <dt>Tanggal akses</dt>
                    <dd>{dataset.accessedAt ? formatDate(dataset.accessedAt) : '—'}</dd>
                  </div>
                  <div>
                    <dt>Jumlah catatan</dt>
                    <dd className="num">{formatNumber(dataset.recordCount)}</dd>
                  </div>
                  {dataset.url ? (
                    <div>
                      <dt>URL</dt>
                      <dd>
                        <a href={dataset.url} target="_blank" rel="noreferrer noopener">
                          {dataset.url}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {dataset.notes.length > 0 ? (
                  <ul className="source-item__list">
                    {dataset.notes.map((note, index) => (
                      <li key={index}>{note}</li>
                    ))}
                  </ul>
                ) : null}

                {dataset.limitations.length > 0 ? (
                  <div className="source-item__limits">
                    <div className="source-item__limits-title">
                      <IconAlert size={14} /> Keterbatasan
                    </div>
                    <ul className="source-item__list">
                      {dataset.limitations.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))
          )}

          <div className="meta-line">
            Versi skema <code>{bundle.version}</code>
            {bundle.generatedAt ? (
              <>
                {' · '}Dataset dirakit {formatDate(bundle.generatedAt)}
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Impor                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              <IconUpload size={16} /> Impor data sendiri
            </h3>
            <div className="card__subtitle">
              Ganti atau lengkapi data dengan berkas resmi. Berkas yang tidak valid ditolak
              seluruhnya — data yang sedang dipakai tidak akan berubah.
            </div>
          </div>
        </div>

        <div className="card__body">
          <div className="field">
            <label className="field__label" htmlFor="import-kind">
              Jenis berkas
            </label>
            <select
              id="import-kind"
              className="select"
              value={pendingKind}
              onChange={(event) => setPendingKind(event.target.value as ImportKind)}
            >
              {(Object.keys(IMPORT_LABEL) as ImportKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {IMPORT_LABEL[kind]}
                </option>
              ))}
            </select>
          </div>

          <div className="dropzone">
            <div className="dropzone__title">
              Pilih berkas {pendingKind === 'batas' ? 'GeoJSON' : 'CSV'}
            </div>
            <p className="dropzone__hint">{IMPORT_HINT[pendingKind]}</p>
            <input
              ref={fileRef}
              type="file"
              accept={pendingKind === 'batas' ? '.geojson,.json,application/geo+json' : '.csv,text/csv'}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = '';
              }}
            />
            <button type="button" className="btn btn--primary" onClick={() => fileRef.current?.click()}>
              <IconUpload size={15} />
              Pilih berkas
            </button>
          </div>

          {success ? (
            <Notice tone="info" title="Impor berhasil">
              <p>{success}</p>
            </Notice>
          ) : null}

          <div className="template-row">
            <span className="template-row__label">Template & contoh:</span>
            <button type="button" className="btn btn--sm" onClick={exportFacilitiesTemplate}>
              <IconDownload size={14} />
              CSV fasilitas
            </button>
            <button type="button" className="btn btn--sm" onClick={exportPopulationTemplate}>
              <IconDownload size={14} />
              CSV penduduk
            </button>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Ekspor hasil                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              <IconDownload size={16} /> Ekspor hasil
            </h3>
            <div className="card__subtitle">
              Hasil ekspor memakai pemisah koma dengan BOM UTF-8, sehingga terbaca benar di Excel
              berbahasa Indonesia.
            </div>
          </div>
        </div>

        <div className="card__body">
          <div className="template-row">
            <span className="template-row__label">Berkas:</span>
            <button type="button" className="btn btn--sm" onClick={exportRegions}>
              <IconDownload size={14} />
              Ringkasan per wilayah
            </button>
            <button type="button" className="btn btn--sm" onClick={exportPopulation}>
              <IconDownload size={14} />
              Tabel penduduk
            </button>
          </div>
          <p className="stat__note" style={{ marginTop: 10 }}>
            Ringkasan per wilayah memuat metrik untuk filter jenis fasilitas dan bobot prioritas
            yang sedang aktif. Ubah filter di halaman Peta atau Analisis untuk mengekspor kombinasi
            lain.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Mutu data                                                         */}
      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">Mutu data</h3>
            <div className="card__subtitle">
              Angka-angka yang harus disebutkan saat melaporkan hasil, agar pembaca tahu apa yang
              hilang.
            </div>
          </div>
        </div>

        <div className="card__body">
          <table className="data">
            <caption className="sr-only">Pemeriksaan mutu data</caption>
            <tbody>
              <QualityRow
                label="Fasilitas tanpa nama di sumber"
                value={quality.facilitiesWithoutName}
                total={quality.facilitiesTotal}
              />
              <QualityRow
                label="Fasilitas di luar batas wilayah"
                value={quality.facilitiesOutsideBoundary}
                total={quality.facilitiesTotal}
                note="Dibuang saat perakitan, tidak ikut dihitung"
              />
              <QualityRow
                label="Fasilitas tidak terpetakan ke kelurahan"
                value={quality.facilitiesUnassignedToKelurahan}
                total={quality.facilitiesTotal}
                note="Diperkirakan berada di luar batas atau tepat di perbatasan"
              />
              <QualityRow
                label="Wilayah dengan luas poligon jauh dari luas resmi"
                value={quality.regionsWithAreaMismatch}
                total={quality.regionsTotal}
                note="Selisih di atas 2%"
              />
              <QualityRow
                label="Wilayah tanpa angka penduduk"
                value={quality.regionsTotal - quality.regionsWithPopulation}
                total={quality.regionsTotal}
              />
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Konsistensi antar level                                           */}
      {/* ---------------------------------------------------------------- */}
      {consistency.length > 0 ? (
        <Notice tone="warning" title="Selisih angka antara kecamatan dan kelurahan">
          <p>
            Nilai yang dihitung langsung pada tingkat kecamatan berbeda dari penjumlahan
            kelurahan-kelurahannya pada {formatNumber(consistency.length)} kasus. Penyebab paling
            umum: fasilitas yang tidak berhasil dipetakan ke kelurahan, atau geometri kelurahan yang
            tidak menutup penuh wilayah kecamatan.
          </p>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data">
              <caption className="sr-only">Daftar selisih antar tingkat wilayah</caption>
              <thead>
                <tr>
                  <th scope="col">Kecamatan</th>
                  <th scope="col">Ukuran</th>
                  <th scope="col" className="num">
                    Nilai langsung
                  </th>
                  <th scope="col" className="num">
                    Jumlah kelurahan
                  </th>
                  <th scope="col" className="num">
                    Selisih
                  </th>
                </tr>
              </thead>
              <tbody>
                {consistency.slice(0, 12).map((item, index) => (
                  <tr key={index}>
                    <td>{item.kecamatanName}</td>
                    <td className="cell-muted">{CONSISTENCY_LABEL[item.field]}</td>
                    <td className="num">{formatMeasure(item.field, item.direct)}</td>
                    <td className="num">{formatMeasure(item.field, item.aggregated)}</td>
                    <td className="num">
                      {item.differencePct === null
                        ? NO_DATA
                        : formatPercent(item.differencePct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Notice>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Alur penyiapan                                                    */}
      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <div>
            <h3 className="card__title">
              <IconRefresh size={16} /> Menyiapkan ulang data
            </h3>
            <div className="card__subtitle">
              Seluruh pengambilan data dijalankan sekali di komputer, bukan saat halaman dibuka.
              Aplikasi tidak pernah menghubungi pihak ketiga selain saat perintah ini dijalankan.
            </div>
          </div>
        </div>

        <div className="card__body">
          <ol className="steps">
            <li>
              <code>npm run data:boundaries</code>
              <span>Batas kecamatan dan kelurahan dari relasi administratif OpenStreetMap.</span>
            </li>
            <li>
              <code>npm run data:facilities</code>
              <span>Rumah sakit, klinik, apotek, praktik dokter, dan pos kesehatan melalui Overpass API.</span>
            </li>
            <li>
              <code>npm run data:population</code>
              <span>
                Menyiapkan template angka penduduk berisi nama wilayah resmi. Angka penduduk tidak
                ditebak oleh skrip.
              </span>
            </li>
            <li>
              <code>npm run data:build</code>
              <span>Perakitan, penautan kelurahan ke kecamatan, dan perhitungan luas dari geometri.</span>
            </li>
            <li>
              <code>npm run data:validate</code>
              <span>Pemeriksaan akhir: geometri, sentroid di dalam wilayah, dan kewajaran angka.</span>
            </li>
          </ol>
        </div>
      </section>

      <Modal
        open={issueDialog !== null}
        title={`Impor ${issueDialog ? IMPORT_LABEL[issueDialog.kind] : ''} ditolak`}
        subtitle="Tidak ada satu baris pun yang diterapkan. Perbaiki berkas lalu coba lagi."
        onClose={() => setIssueDialog(null)}
        maxWidth={680}
        footer={
          <button type="button" className="btn btn--primary" onClick={() => setIssueDialog(null)}>
            Mengerti
          </button>
        }
      >
        {issueDialog ? (
          <>
            <Notice tone="critical" title={`${formatNumber(issueDialog.issues.length)} masalah ditemukan`}>
              <p>
                Data yang sedang dipakai tidak diubah. Berikut masalah yang perlu diperbaiki, dalam
                urutan kemunculannya di berkas.
              </p>
            </Notice>
            <ul className="issue-list">
              {issueDialog.issues.slice(0, 40).map((issue, index) => (
                <li key={index}>
                  <span className="issue-list__where">
                    {issue.row > 0 ? `Baris ${issue.row}` : 'Berkas'}
                    {issue.field ? ` · ${issue.field}` : ''}
                  </span>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
            {issueDialog.issues.length > 40 ? (
              <p className="stat__note">
                … dan {formatNumber(issueDialog.issues.length - 40)} masalah lain.
              </p>
            ) : null}
            <details className="details" style={{ marginTop: 12 }}>
              <summary>Salin daftar masalah sebagai teks</summary>
              <pre className="code-block">{describeIssues(issueDialog.issues, 200)}</pre>
            </details>
          </>
        ) : null}
      </Modal>
    </div>
  );
}

const IMPORT_HINT: Record<ImportKind, string> = {
  fasilitas:
    'Kolom wajib: name, kind, lat, lon. Kolom kind berisi salah satu dari: hospital, clinic, pharmacy, doctor, health_post. Koordinat di luar batas Kota Surabaya ditolak karena hampir selalu berarti kolom tertukar.',
  penduduk:
    'Kolom wajib: wilayah, penduduk. Kolom opsional: level (kecamatan/kelurahan), tahun, luas_km2. Nama wilayah dicocokkan tanpa membedakan huruf besar/kecil dan awalan seperti "Kecamatan".',
  batas:
    'FeatureCollection GeoJSON dengan geometri Polygon atau MultiPolygon. Properti yang dikenali: name, level, id, parent_id, parent_name, population.',
};

function QualityRow({
  label,
  value,
  total,
  note,
}: {
  label: string;
  value: number;
  total: number;
  note?: string;
}) {
  const share = total > 0 ? value / total : null;
  return (
    <tr>
      <th scope="row" style={{ fontWeight: 500 }}>
        {label}
        {note ? <div className="stat__note">{note}</div> : null}
      </th>
      <td className="num">{formatNumber(value)}</td>
      <td className="num" style={{ width: 90 }}>
        {share === null ? NO_DATA : formatRatioPercent(share)}
      </td>
    </tr>
  );
}

const CONSISTENCY_LABEL: Record<string, string> = {
  population: 'Jumlah penduduk',
  areaKm2: 'Luas wilayah',
  facilityCount: 'Jumlah fasilitas',
};

/** Format angka selisih konsistensi menurut jenis ukurannya. */
function formatMeasure(field: string, value: number | null): string {
  if (value === null) return NO_DATA;
  if (field === 'areaKm2') return formatArea(value);
  return formatNumber(Math.round(value));
}