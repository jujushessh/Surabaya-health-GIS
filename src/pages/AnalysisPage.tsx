/**
 * Halaman Analisis — peringkat wilayah, sebaran, hubungan antarmetrik, dan
 * skor prioritas dengan bobot yang dapat diubah.
 *
 * Semua angka di halaman ini berasal dari satu mesin metrik yang sama dengan
 * halaman peta, sehingga tidak mungkin ada dua nilai berbeda untuk wilayah
 * dan metrik yang sama.
 */

import { useMemo } from 'react';

import { initialMetricFor, useStore } from '../store/DataProvider';
import { FilterBar } from '../components/FilterBar';
import {
  BarRankChart,
  ChartCard,
  ChartLegend,
  Histogram,
  ScatterChart,
  type HistogramBin,
} from '../components/charts';
import { Notice, StatTile } from '../components/ui';
import { METRIC_META, type FacilityKind } from '../types';
import { rankByMetric, checkLevelConsistency } from '../lib/metrics';
import { colorsFor, METRIC_NOTES } from '../lib/palette';
import { toCsv, downloadText } from '../lib/io';
import { formatNumber, formatRatioPercent, formatDistance, NO_DATA } from '../lib/format';
import { todayIso } from '../lib/format';
import { IconDownload, IconSliders } from '../components/icons';

const TOP_N = 15;

export function AnalysisPage() {
  const { data, settings, metrics, classification, actions } = useStore();

  const bundle = data.bundle;

  /** Jumlah fasilitas per jenis, sebelum filter diterapkan. */
  const counts = useMemo(() => {
    const result = {} as Record<FacilityKind, number>;
    for (const facility of bundle?.facilities ?? []) {
      result[facility.kind] = (result[facility.kind] ?? 0) + 1;
    }
    return result;
  }, [bundle]);

  const ranking = useMemo(
    () => (metrics ? rankByMetric(metrics, settings.level, settings.metric) : []),
    [metrics, settings.level, settings.metric],
  );

  /** Sepuluh wilayah dengan nilai tertinggi menurut arah metrik. */
  const topRows = useMemo(() => {
    const usable = ranking.filter((row) => row.value !== null);
    return usable.slice(0, TOP_N).map((row) => ({
      id: row.regionId,
      label: row.name,
      value: row.value as number,
      note: metrics?.byId.get(row.regionId)?.parentName ?? undefined,
    }));
  }, [ranking, settings.metric, metrics]);

  /** Sebaran nilai ke dalam kelas yang sama dengan choropleth. */
  const histogram = useMemo<HistogramBin[]>(() => {
    if (!classification || classification.classes.length === 0) return [];
    const meta = METRIC_META[settings.metric];
    return classification.classes.map((cls) => ({
      label: `${formatNumber(cls.min, meta.decimals)}–${formatNumber(cls.max, meta.decimals)}`,
      count: cls.count,
      min: cls.min,
      max: cls.max,
    }));
  }, [classification, settings.metric]);

  /** Data diagram sebar: kepadatan terhadap rasio fasilitas. */
  const scatter = useMemo(() => {
    if (!metrics) return [];
    return metrics.regions
      .filter((region) => region.level === settings.level)
      .map((region) => {
        const entry = metrics.byId.get(region.id);
        if (!entry) return null;
        const density = entry.values.density;
        const ratio = entry.values.facilityRatio;
        if (density === null || ratio === null) return null;
        return {
          id: region.id,
          label: region.name,
          x: density,
          y: ratio,
          size: entry.population ?? undefined,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [metrics, settings.level]);

  /** Periksa apakah kecamatan konsisten dengan jumlah kelurahannya. */
  const consistency = useMemo(() => (metrics ? checkLevelConsistency(metrics) : []), [metrics]);

  const populationAvailable = useMemo(
    () => (bundle ? bundle.regions.some((region) => region.population !== null) : false),
    [bundle],
  );

  if (!bundle || !metrics || !classification) return null;

  const meta = METRIC_META[settings.metric];
  const palette = colorsFor(settings.theme);

  const totalPopulation = bundle.regions
    .filter((region) => region.level === settings.level && region.population !== null)
    .reduce((acc, region) => acc + (region.population ?? 0), 0);

  const regionsWithData = ranking.filter((row) => row.value !== null).length;

  /** Unduh tabel peringkat lengkap sebagai CSV. */
  function exportRanking() {
    const headers = [
      'wilayah',
      'level',
      'kecamatan_induk',
      'peringkat',
      `nilai_${settings.metric}`,
      'satuan',
      'penduduk',
      'luas_km2',
      'jumlah_fasilitas',
      'jarak_terdekat_km',
      'cakupan_3km_persen',
      'skor_prioritas',
    ];

    const rows = ranking.map((row) => {
      const entry = metrics!.byId.get(row.regionId);
      return [
        row.name,
        settings.level,
        entry?.parentName ?? '',
        row.rank ?? '',
        row.value ?? '',
        meta.unit,
        entry?.population ?? '',
        entry?.areaKm2 ?? '',
        entry?.counts.total ?? '',
        entry?.access.nearestAnyKm ?? '',
        entry?.access.coverage[3] ?? '',
        entry?.priority?.score ?? '',
      ];
    });

    downloadText(
      `peringkat-${settings.metric}-${settings.level}-${todayIso()}.csv`,
      toCsv(headers, rows),
    );
  }

  return (
    <div className="page">
      <FilterBar
        level={settings.level}
        metric={settings.metric}
        activeKinds={settings.kinds}
        kindCounts={counts}
        theme={settings.theme}
        basemap="standar"
        onLevel={(level) => actions.update({ level, highlightId: null })}
        onMetric={(metric) => actions.update({ metric })}
        onToggleKind={actions.toggleKind}
        onTheme={(theme) => actions.update({ theme })}
        onBasemap={() => undefined}
        onReset={() => {
          actions.update({
            level: 'kecamatan',
            metric: initialMetricFor(bundle.regions),
            highlightId: null,
          });
          actions.resetWeights();
        }}
        populationAvailable={populationAvailable}
      />

      <div className="grid grid--kpi">
        <StatTile
          label={`Wilayah ${settings.level}`}
          value={formatNumber(ranking.length)}
          note={
            regionsWithData < ranking.length
              ? `${formatNumber(regionsWithData)} memiliki nilai yang dapat dihitung`
              : 'Seluruh wilayah memiliki nilai'
          }
        />
        <StatTile
          label="Fasilitas aktif"
          value={formatNumber(metrics.usedFacilities.length)}
          note="Sesuai filter jenis"
        />
        <StatTile
          label="Menggunakan angka penduduk"
          value={
            populationAvailable
              ? formatNumber(bundle.regions.filter((r) => r.level === settings.level && r.population !== null).length)
              : 'Belum tersedia'
          }
          missing={!populationAvailable}
          note={
            populationAvailable && totalPopulation > 0
              ? `Total ${formatNumber(totalPopulation)} jiwa`
              : 'Isi lewat template penduduk pada halaman Data'
          }
        />
        <StatTile
          label={meta.label}
          value={
            topRows.length > 0 ? formatNumber(topRows[0].value, meta.decimals) : NO_DATA
          }
          unit={meta.unit}
          note={topRows.length > 0 ? `Tertinggi: ${topRows[0].label}` : undefined}
        />
      </div>

      {!populationAvailable ? (
        <Notice tone="warning" title="Metrik berbasis penduduk belum dapat dihitung">
          <p>
            Kepadatan penduduk, rasio fasilitas per 1.000 penduduk, cakupan berbobot, dan skor
            prioritas memerlukan angka penduduk. Selama angka itu belum ada, nilai-nilainya
            ditampilkan sebagai "data tidak tersedia" — bukan nol, karena nol berarti terukur dan
            hasilnya nol.
          </p>
          <p>
            Jarak ke fasilitas terdekat dan cakupan radius tetap dapat dihitung karena hanya
            memerlukan lokasi fasilitas dan bentuk wilayah.
          </p>
        </Notice>
      ) : null}

      <ChartCard
        title={`Peringkat ${TOP_N} wilayah teratas — ${meta.label}`}
        subtitle={`Satuan ${meta.unit}. ${METRIC_NOTES[settings.metric]} Meliputi ${formatNumber(
          metrics.usedFacilities.length,
        )} fasilitas pada ${settings.level}.`}
        height={320}
        actions={
          <button type="button" className="btn btn--sm" onClick={exportRanking}>
            <IconDownload size={15} />
            Unduh CSV
          </button>
        }
        legend={
          <ChartLegend
            items={[
              {
                label: `Wilayah ${settings.level}`,
                color: settings.theme === 'dark' ? palette.series[0] : palette.series[0],
              },
            ]}
          />
        }
        table={
          <RankTable
            ranking={ranking}
            metricLabel={meta.label}
            decimals={meta.decimals}
            unit={meta.unit}
            onSelect={(id) => actions.update({ highlightId: id })}
          />
        }
      >
        <BarRankChart
          data={topRows}
          unit={meta.label}
          format={(value) => formatNumber(value, meta.decimals)}
          color={palette.series[0]}
          noteLabel="Kecamatan induk"
        />
      </ChartCard>

      <div className="grid grid--halves">
        <ChartCard
          title="Sebaran nilai antarwilayah"
          subtitle={`Jumlah ${settings.level} pada setiap kelas nilai ${meta.label.toLowerCase()}.`}
          height={280}
          table={
            <SimpleTable
              headers={['Kelas', `Jumlah ${settings.level}`]}
              rows={histogram.map((bin) => [bin.label, formatNumber(bin.count)])}
            />
          }
        >
          <Histogram
            bins={histogram}
            unit={meta.unit}
            format={(value) => formatNumber(value, meta.decimals)}
            countNoun={settings.level}
          />
        </ChartCard>

        <ChartCard
          title="Kepadatan penduduk dan ketersediaan fasilitas"
          subtitle="Setiap titik adalah satu wilayah. Sumbu tegak berisi fasilitas per 1.000 penduduk."
          height={340}
          table={
            <SimpleTable
              headers={['Wilayah', 'Penduduk/km²', 'Fasilitas per 1.000 penduduk']}
              rows={scatter.map((point) => [
                point.label,
                formatNumber(point.x),
                formatNumber(point.y, 2),
              ])}
            />
          }
        >
          {scatter.length === 0 ? (
            <Notice tone="info">
              Diagram ini memerlukan angka penduduk. Isi angka penduduk lalu impor lewat halaman Data.
            </Notice>
          ) : (
            <ScatterChart
              data={scatter}
              xLabel="Kepadatan penduduk (jiwa/km²)"
              yLabel="Fasilitas per 1.000 penduduk"
              formatX={(value) => formatNumber(value)}
              formatY={(value) => formatNumber(value, 2)}
              onSelect={(id) => actions.update({ highlightId: id })}
            />
          )}
        </ChartCard>
      </div>

      <WeightPanel />

      <ChartCard
        title="Peringkat berdasarkan skor prioritas"
        subtitle="Skor tinggi berarti kepadatan tinggi, fasilitas sedikit, dan jarak jauh. Bobot komponen dapat diubah di atas."
        height={320}
        table={
          <SimpleTable
            headers={['Peringkat', 'Wilayah', 'Skor', 'Kepadatan', 'Kelangkaan fasilitas', 'Jarak']}
            rows={(metrics.priorityByLevel[settings.level] ?? [])
              .slice(0, TOP_N)
              .map((result, index) => {
                const entry = metrics.byId.get(result.regionId);
                return [
                  formatNumber(index + 1),
                  entry?.name ?? result.regionId,
                  result.score === null ? NO_DATA : formatNumber(result.score, 1),
                  result.components.density === null
                    ? NO_DATA
                    : formatNumber(result.components.density * 100, 0),
                  result.components.scarcity === null
                    ? NO_DATA
                    : formatNumber(result.components.scarcity * 100, 0),
                  result.components.distance === null
                    ? NO_DATA
                    : formatNumber(result.components.distance * 100, 0),
                ];
              })}
          />
        }
      >
        <BarRankChart
          data={(metrics.priorityByLevel[settings.level] ?? [])
            .filter((result) => result.score !== null)
            .slice(0, TOP_N)
            .map((result) => ({
              id: result.regionId,
              label: metrics.byId.get(result.regionId)?.name ?? result.regionId,
              value: result.score as number,
              note: metrics.byId.get(result.regionId)?.parentName ?? undefined,
            }))}
          unit="skor prioritas"
          format={(value) => formatNumber(value, 1)}
          color={palette.series[1]}
          noteLabel="Kecamatan induk"
        />
      </ChartCard>

      {consistency.length > 0 ? (
        <Notice tone="warning" title={`${consistency.length} kecamatan tidak konsisten dengan jumlah kelurahannya`}>
          <p>
            Penduduk, luas, atau jumlah fasilitas pada kecamatan berbeda lebih dari 2% dari jumlah
            kelurahan penyusunnya. Perbedaan ini biasanya berasal dari batas wilayah yang bertumpang
            tindih atau kelurahan yang belum terhubung ke kecamatan induk.
          </p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {consistency.slice(0, 5).map((issue) => (
              <li key={`${issue.kecamatanId}-${issue.field}`}>
                {issue.kecamatanName} — {issue.field === 'population' ? 'penduduk' : issue.field === 'areaKm2' ? 'luas' : 'jumlah fasilitas'}:{' '}
                langsung {formatNumber(issue.direct ?? 0, issue.field === 'areaKm2' ? 2 : 0)}, jumlah
                kelurahan {formatNumber(issue.aggregated ?? 0, issue.field === 'areaKm2' ? 2 : 0)} (
                {formatNumber(issue.differencePct, 1)}%)
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Komponen pendukung                                                          */
/* -------------------------------------------------------------------------- */

interface RankTableProps {
  ranking: { regionId: string; name: string; value: number | null; rank: number | null }[];
  metricLabel: string;
  decimals: number;
  unit: string;
  onSelect: (id: string) => void;
}

function RankTable({ ranking, metricLabel, decimals, unit, onSelect }: RankTableProps) {
  const { metrics } = useStore();

  if (ranking.length === 0) {
    return <div className="empty"><div className="empty__body">Tidak ada wilayah untuk ditampilkan.</div></div>;
  }

  return (
    <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
      <table className="data">
        <caption>{metricLabel}, seluruh wilayah menurut peringkat ({unit})</caption>
        <thead>
          <tr>
            <th scope="col">Peringkat</th>
            <th scope="col">Wilayah</th>
            <th scope="col" className="num">
              {metricLabel}
            </th>
            <th scope="col" className="num">
              Penduduk
            </th>
            <th scope="col" className="num">
              Fasilitas
            </th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((row) => {
            const entry = metrics?.byId.get(row.regionId);
            return (
              <tr key={row.regionId}>
                <td>
                  {row.rank === null ? (
                    <span className="cell-muted">—</span>
                  ) : (
                    <span className="rank-badge">{row.rank}</span>
                  )}
                </td>
                <td className="cell-name">
                  <button type="button" className="link-btn" onClick={() => onSelect(row.regionId)}>
                    {row.name}
                  </button>
                </td>
                <td className="num">
                  {row.value === null ? (
                    <span className="cell-muted">Data tidak tersedia</span>
                  ) : (
                    formatNumber(row.value, decimals)
                  )}
                </td>
                <td className="num">
                  {entry?.population === null || entry?.population === undefined ? (
                    <span className="cell-muted">—</span>
                  ) : (
                    formatNumber(entry.population)
                  )}
                </td>
                <td className="num">{formatNumber(entry?.counts.total ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) {
    return <div className="empty"><div className="empty__body">Tidak ada data untuk ditampilkan.</div></div>;
  }

  return (
    <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
      <table className="data">
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={header} scope="col" className={index === 0 ? undefined : 'num'}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={cellIndex === 0 ? 'cell-name' : 'num'}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Panel bobot skor prioritas.
 *
 * Bobot sengaja ditampilkan dan dapat diubah supaya skor tidak menjadi kotak
 * hitam: pembaca laporan dapat menguji sendiri seberapa besar kesimpulan
 * bergantung pada pilihan bobot ini.
 */
function WeightPanel() {
  const { settings, actions, metrics } = useStore();
  const total =
    settings.weights.density + settings.weights.scarcity + settings.weights.distance;

  const rows: { key: keyof typeof settings.weights; label: string; hint: string }[] = [
    { key: 'density', label: 'Kepadatan penduduk', hint: 'Penduduk padat menaikkan skor' },
    { key: 'scarcity', label: 'Kelangkaan fasilitas', hint: 'Fasilitas sedikit menaikkan skor' },
    { key: 'distance', label: 'Jarak ke fasilitas', hint: 'Jarak jauh menaikkan skor' },
  ];

  return (
    <section className="card">
      <div className="card__header">
        <div>
          <h3 className="card__title">
            <IconSliders size={15} /> Bobot skor prioritas
          </h3>
          <div className="card__subtitle">
            Bobot dinormalisasi otomatis, jadi jumlahnya tidak harus 100%. Wilayah yang datanya tidak
            lengkap dihitung hanya dari komponen yang tersedia.
          </div>
        </div>
        <button type="button" className="btn btn--sm" onClick={actions.resetWeights}>
          Kembalikan bawaan
        </button>
      </div>

      <div className="card__body">
        {rows.map((row) => (
          <div className="weight-row" key={row.key}>
            <label className="weight-row__label" htmlFor={`weight-${row.key}`}>
              {row.label}
              <div className="stat__note" style={{ marginTop: 0 }}>{row.hint}</div>
            </label>
            <input
              id={`weight-${row.key}`}
              className="slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.weights[row.key]}
              onChange={(event) =>
                actions.update({
                  weights: { ...settings.weights, [row.key]: Number(event.target.value) },
                })
              }
            />
            <span className="weight-row__value">
              {formatRatioPercent(settings.weights[row.key] / Math.max(total, 0.0001), 0)}
            </span>
          </div>
        ))}

        {total === 0 ? (
          <Notice tone="warning">
            Semua bobot bernilai nol, sehingga skor prioritas tidak dapat dihitung. Naikkan minimal
            satu bobot.
          </Notice>
        ) : null}

        {metrics && (metrics.priorityByLevel[settings.level] ?? []).some((r) => r.score === null) ? (
          <Notice tone="info">
            {(metrics.priorityByLevel[settings.level] ?? []).filter((r) => r.score === null).length}{' '}
            wilayah tidak memiliki skor karena seluruh komponennya memerlukan angka penduduk yang
            belum tersedia.
          </Notice>
        ) : null}
      </div>
    </section>
  );
}

export { formatDistance };