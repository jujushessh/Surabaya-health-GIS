/**
 * Komponen grafik SVG.
 *
 * Aturan yang dipegang seluruh berkas ini:
 * - Satu sumbu nilai saja. Tidak pernah ada dua skala tegak pada satu plot.
 * - Batang tipis (maksimum 24 px), ujung data membulat 4 px, pangkal rata.
 * - Garis kisi berupa garis rambut solid satu langkah dari permukaan, tidak
 *   putus-putus.
 * - Legenda selalu ada bila serinya dua atau lebih; satu seri tidak perlu
 *   legenda karena judul sudah menyebut apa yang digambar.
 * - Label nilai dipasang selektif, tidak pada setiap titik.
 * - Teks memakai warna teks, bukan warna seri. Identitas dibawa oleh penanda
 *   berwarna di sebelah teks.
 * - Setiap grafik punya kembaran berupa tabel, sehingga nilainya selalu dapat
 *   dibaca tanpa hover dan tanpa bergantung pada warna.
 * - Fokus keyboard memberi keterangan yang sama dengan hover.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconTable, IconChart } from './icons';
import { formatNumber } from '../lib/format';

/* -------------------------------------------------------------------------- */
/* Tooltip bersama                                                             */
/* -------------------------------------------------------------------------- */

interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * Keterangan mengikuti penunjuk. Karena posisinya tetap (fixed), ia tidak
 * terpotong oleh kontainer yang menggulir.
 */
function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;
  return (
    <div
      className="tooltip"
      style={{ left: state.x + 14, top: state.y + 14 }}
      role="presentation"
    >
      {state.content}
    </div>
  );
}

function useTooltip() {
  const [state, setState] = useState<TooltipState | null>(null);

  const show = useCallback((event: { clientX: number; clientY: number }, content: ReactNode) => {
    setState({ x: event.clientX, y: event.clientY, content });
  }, []);

  const hide = useCallback(() => setState(null), []);

  return { tooltip: state, show, hide };
}

/** Satu baris keterangan: nilainya menonjol, namanya sekunder. */
function TooltipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="tooltip__row">
      {color ? <span className="tooltip__key" style={{ background: color }} /> : null}
      <span>{label}</span>
      <span className="tooltip__value">{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bingkai grafik: sakelar grafik / tabel                                      */
/* -------------------------------------------------------------------------- */

interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Isi grafik. */
  children: ReactNode;
  /** Tabel padanan grafik — wajib, supaya tidak ada nilai yang terkunci di balik hover. */
  table: ReactNode;
  /** Keterangan legenda, bila serinya lebih dari satu. */
  legend?: ReactNode;
  actions?: ReactNode;
  /** Tinggi area grafik; tabel mengabaikannya. */
  height?: number;
}

/**
 * Pembungkus grafik dengan pintu masuk tabel.
 *
 * Kolom dan tabel dirender dari data yang sama, jadi keduanya tidak mungkin
 * menampilkan angka yang berbeda.
 */
export function ChartCard({
  title,
  subtitle,
  children,
  table,
  legend,
  actions,
  height,
}: ChartCardProps) {
  const [mode, setMode] = useState<'chart' | 'table'>('chart');

  return (
    <section className="card">
      <div className="card__header">
        <div style={{ minWidth: 0 }}>
          <h3 className="card__title">{title}</h3>
          {subtitle ? <div className="card__subtitle">{subtitle}</div> : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {actions}
          <div className="view-toggle no-print" role="group" aria-label={`Tampilan ${title}`}>
            <button
              type="button"
              aria-pressed={mode === 'chart'}
              onClick={() => setMode('chart')}
              title="Tampilkan grafik"
            >
              <IconChart size={14} />
              <span className="sr-only">Grafik</span>
            </button>
            <button
              type="button"
              aria-pressed={mode === 'table'}
              onClick={() => setMode('table')}
              title="Tampilkan tabel"
            >
              <IconTable size={14} />
              <span className="sr-only">Tabel</span>
            </button>
          </div>
        </div>
      </div>

      <div className="card__body">
        {mode === 'chart' ? (
          <div style={height ? { minHeight: height } : undefined}>
            {legend}
            {children}
          </div>
        ) : (
          table
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Bagan batang peringkat (horizontal)                                         */
/* -------------------------------------------------------------------------- */

export interface BarDatum {
  id: string;
  label: string;
  value: number;
  /** Sub-label opsional, mis. nama kecamatan induk. */
  note?: string;
}

interface BarRankChartProps {
  data: BarDatum[];
  /** Satuan untuk keterangan. */
  unit: string;
  /** Format nilai yang ditampilkan di ujung batang. */
  format: (value: number) => string;
  /** Warna batang; satu seri, jadi satu warna. */
  color?: string;
  onSelect?: (id: string) => void;
  /** Label baris tambahan di keterangan. */
  noteLabel?: string;
}

/**
 * Peringkat wilayah sebagai batang horizontal.
 *
 * Satu seri, jadi tidak ada legenda: judul kartu sudah menyebut yang digambar.
 * Nilai dipasang di ujung setiap batang — karena itu sumbu nilai tidak perlu
 * digambar, dan tidak ada satu pun angka yang hanya bisa dibaca lewat hover.
 */
export function BarRankChart({
  data,
  unit,
  format,
  color = 'var(--series-1)',
  onSelect,
  noteLabel,
}: BarRankChartProps) {
  const { tooltip, show, hide } = useTooltip();

  const max = useMemo(() => Math.max(...data.map((d) => d.value), 0), [data]);
  if (data.length === 0 || max <= 0) {
    return <div className="empty"><div className="empty__body">Tidak ada nilai untuk digambar.</div></div>;
  }

  const BAR = 18;
  const GAP = 8;
  const LABEL_WIDTH = 172;
  const VALUE_WIDTH = 96;
  const width = 640;
  const plotWidth = width - LABEL_WIDTH - VALUE_WIDTH;
  const height = data.length * (BAR + GAP) + 8;

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Bagan batang peringkat, ${data.length} wilayah teratas, satuan ${unit}`}
        style={{ minWidth: 480 }}
        onMouseLeave={hide}
      >
        {data.map((datum, index) => {
          const y = index * (BAR + GAP) + 4;
          const barWidth = max > 0 ? (datum.value / max) * plotWidth : 0;
          const safeBarWidth = Math.max(2, barWidth);

          return (
            <g key={datum.id}>
              {/* Nama wilayah: teks memakai warna teks, bukan warna seri. */}
              <text
                x={LABEL_WIDTH - 10}
                y={y + BAR / 2}
                textAnchor="end"
                dominantBaseline="middle"
                className="chart__label"
                style={{ fontVariantNumeric: 'normal' }}
              >
                {datum.label.length > 24 ? `${datum.label.slice(0, 23)}…` : datum.label}
              </text>

              {/* Batang: pangkal rata di kiri, ujung membulat 4 px. */}
              <path
                className="chart__bar"
                d={roundedRightBar(LABEL_WIDTH, y, safeBarWidth, BAR, 4)}
                fill={color}
                tabIndex={0}
                onMouseMove={(event) => {
                  show(event, (
                    <>
                      <div className="tooltip__title">{datum.label}</div>
                      {datum.note ? <TooltipRow label={noteLabel ?? 'Wilayah induk'} value={datum.note} /> : null}
                      <TooltipRow label={unit} value={format(datum.value)} color={color} />
                    </>
                  ));
                }}
                onFocus={(event) => {
                  const box = (event.target as SVGElement).getBoundingClientRect();
                  show({ clientX: box.right, clientY: box.top }, (
                    <>
                      <div className="tooltip__title">{datum.label}</div>
                      <TooltipRow label={unit} value={format(datum.value)} color={color} />
                    </>
                  ));
                }}
                onBlur={hide}
                onMouseLeave={hide}
                onKeyDown={(event) => {
                  if (onSelect && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onSelect(datum.id);
                  }
                }}
                onClick={onSelect ? () => onSelect(datum.id) : undefined}
                style={onSelect ? { cursor: 'pointer' } : undefined}
              >
                <title>{`${datum.label}: ${format(datum.value)} ${unit}`}</title>
              </path>

              {/* Nilai di ujung batang: batang selalu punya ruang bebas di sini. */}
              <text
                x={LABEL_WIDTH + safeBarWidth + 8}
                y={y + BAR / 2}
                dominantBaseline="middle"
                className="chart__label"
                style={{ fontWeight: 600, fill: 'var(--data-text)' }}
              >
                {format(datum.value)}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip state={tooltip} />
    </>
  );
}

/** Batang dengan ujung kanan membulat dan pangkal kiri rata. */
function roundedRightBar(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2);
  return [
    `M ${x} ${y}`,
    `H ${x + width - r}`,
    `A ${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `V ${y + height - r}`,
    `A ${r} ${r} 0 0 1 ${x + width - r} ${y + height}`,
    `H ${x}`,
    'Z',
  ].join(' ');
}

/* -------------------------------------------------------------------------- */
/* Histogram sebaran nilai                                                     */
/* -------------------------------------------------------------------------- */

export interface HistogramBin {
  label: string;
  count: number;
  min: number;
  max: number;
}

interface HistogramProps {
  bins: HistogramBin[];
  unit: string;
  format: (value: number) => string;
  /** Nama hal yang dihitung, mis. "wilayah". */
  countNoun?: string;
}

/**
 * Sebaran nilai antarwilayah.
 *
 * Kolom, satu seri. Nilai di atas kolom dilewati karena jumlah kolom sedikit
 * dan setiap nilai sudah terbaca di sumbu tegak; keterangan muncul saat
 * penunjuk diarahkan.
 */
export function Histogram({ bins, unit, format, countNoun = 'wilayah' }: HistogramProps) {
  const { tooltip, show, hide } = useTooltip();

  if (bins.length === 0) {
    return <div className="empty"><div className="empty__body">Tidak ada nilai untuk digambar.</div></div>;
  }

  const width = 640;
  const height = 240;
  const margin = { top: 12, right: 12, bottom: 42, left: 46 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const bandWidth = plotWidth / bins.length;
  // Batang tidak pernah mengisi penuh slotnya; sisa lebar menjadi udara.
  const barWidth = Math.min(24, bandWidth * 0.62);

  const ticks = niceTicks(maxCount, 4);

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Histogram sebaran nilai, satuan ${unit}`}
        style={{ minWidth: 440 }}
        onMouseLeave={hide}
      >
        {/* Garis kisi: rambut, solid, satu langkah dari permukaan. */}
        {ticks.map((tick) => {
          const y = margin.top + plotHeight - (tick / maxCount) * plotHeight;
          return (
            <g key={tick}>
              <line
                className="chart__grid"
                x1={margin.left}
                x2={width - margin.right}
                y1={y}
                y2={y}
              />
              <text
                className="chart__tick"
                x={margin.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}

        {bins.map((bin, index) => {
          const x = margin.left + index * bandWidth + (bandWidth - barWidth) / 2;
          const barHeight = (bin.count / maxCount) * plotHeight;
          const y = margin.top + plotHeight - barHeight;

          return (
            <g key={bin.label}>
              <path
                className="chart__bar"
                d={roundedTopBar(x, y, barWidth, Math.max(barHeight, bin.count > 0 ? 2 : 0), 4)}
                fill="var(--series-1)"
                tabIndex={0}
                onMouseMove={(event) =>
                  show(event, (
                    <>
                      <div className="tooltip__title">{bin.label}</div>
                      <TooltipRow label={countNoun} value={formatNumber(bin.count)} />
                      <TooltipRow label="Rentang" value={`${format(bin.min)} – ${format(bin.max)}`} color="var(--series-1)" />
                    </>
                  ))
                }
                onFocus={(event) => {
                  const box = (event.target as SVGElement).getBoundingClientRect();
                  show({ clientX: box.left, clientY: box.top }, (
                    <>
                      <div className="tooltip__title">{bin.label}</div>
                      <TooltipRow label={countNoun} value={formatNumber(bin.count)} color="var(--series-1)" />
                    </>
                  ));
                }}
                onBlur={hide}
              >
                <title>{`${bin.label}: ${formatNumber(bin.count)} ${countNoun}`}</title>
              </path>

              <text
                className="chart__axis-label"
                x={x + barWidth / 2}
                y={height - margin.bottom + 15}
                textAnchor="middle"
              >
                {bin.label}
              </text>
            </g>
          );
        })}

        {/* Sumbu datar: rambut, solid. */}
        <line
          className="chart__axis"
          x1={margin.left}
          x2={width - margin.right}
          y1={margin.top + plotHeight}
          y2={margin.top + plotHeight}
        />
      </svg>
      <Tooltip state={tooltip} />
    </>
  );
}

/** Kolom dengan ujung atas membulat dan pangkal rata. */
function roundedTopBar(x: number, y: number, width: number, height: number, radius: number): string {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  return [
    `M ${x} ${y + height}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    `H ${x + width - r}`,
    `A ${r} ${r} 0 0 1 ${x + width} ${y + r}`,
    `V ${y + height}`,
    'Z',
  ].join(' ');
}

/** Titik sumbu yang angkanya bulat, supaya mudah dibaca. */
function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = candidates.find((c) => c >= rough) ?? magnitude * 10;

  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(value);
  return ticks;
}

/* -------------------------------------------------------------------------- */
/* Diagram sebar: dua metrik sekaligus                                          */
/* -------------------------------------------------------------------------- */

export interface ScatterDatum {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Ukuran penanda opsional; dipakai untuk jumlah penduduk. */
  size?: number;
}

interface ScatterProps {
  data: ScatterDatum[];
  xLabel: string;
  yLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  onSelect?: (id: string) => void;
}

/**
 * Diagram sebar untuk melihat hubungan dua metrik.
 *
 * Satu seri, jadi tidak ada legenda. Setiap titik punya lingkaran sasaran
 * transparan yang jauh lebih besar dari penandanya, karena penanda 8 px
 * terlalu kecil untuk dijadikan sasaran penunjuk.
 */
export function ScatterChart({ data, xLabel, yLabel, formatX, formatY, onSelect }: ScatterProps) {
  const { tooltip, show, hide } = useTooltip();

  const xMax = Math.max(...data.map((d) => d.x), 1);
  const yMax = Math.max(...data.map((d) => d.y), 1);

  const width = 640;
  const height = 320;
  const margin = { top: 14, right: 18, bottom: 48, left: 62 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  if (data.length === 0) {
    return <div className="empty"><div className="empty__body">Tidak ada wilayah dengan kedua nilai yang lengkap.</div></div>;
  }

  const xTicks = niceTicks(xMax, 4);
  const yTicks = niceTicks(yMax, 4);

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Diagram sebar ${yLabel} terhadap ${xLabel}`}
        style={{ minWidth: 460 }}
        onMouseLeave={hide}
      >
        {yTicks.map((tick) => {
          const y = margin.top + plotHeight - (tick / yMax) * plotHeight;
          return (
            <g key={`y${tick}`}>
              <line className="chart__grid" x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
              <text className="chart__tick" x={margin.left - 8} y={y} textAnchor="end" dominantBaseline="middle">
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}

        {xTicks.map((tick) => {
          const x = margin.left + (tick / xMax) * plotWidth;
          return (
            <text
              key={`x${tick}`}
              className="chart__tick"
              x={x}
              y={margin.top + plotHeight + 16}
              textAnchor="middle"
            >
              {formatNumber(tick)}
            </text>
          );
        })}

        <line
          className="chart__axis"
          x1={margin.left}
          x2={width - margin.right}
          y1={margin.top + plotHeight}
          y2={margin.top + plotHeight}
        />
        <line
          className="chart__axis"
          x1={margin.left}
          x2={margin.left}
          y1={margin.top}
          y2={margin.top + plotHeight}
        />

        {data.map((datum) => {
          const cx = margin.left + (datum.x / xMax) * plotWidth;
          const cy = margin.top + plotHeight - (datum.y / yMax) * plotHeight;

          return (
            <g
              key={datum.id}
              tabIndex={0}
              role="button"
              aria-label={`${datum.label}: ${yLabel} ${formatY(datum.y)}, ${xLabel} ${formatX(datum.x)}`}
              onMouseMove={(event) =>
                show(event, (
                  <>
                    <div className="tooltip__title">{datum.label}</div>
                    <TooltipRow label={xLabel} value={formatX(datum.x)} color="var(--series-1)" />
                    <TooltipRow label={yLabel} value={formatY(datum.y)} />
                  </>
                ))
              }
              onFocus={() => show({ clientX: cx, clientY: cy + 300 }, (
                <>
                  <div className="tooltip__title">{datum.label}</div>
                  <TooltipRow label={xLabel} value={formatX(datum.x)} color="var(--series-1)" />
                  <TooltipRow label={yLabel} value={formatY(datum.y)} />
                </>
              ))}
              onBlur={hide}
              onKeyDown={(event) => {
                if (onSelect && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onSelect(datum.id);
                }
              }}
              onClick={onSelect ? () => onSelect(datum.id) : undefined}
              style={onSelect ? { cursor: 'pointer' } : undefined}
            >
              {/* Sasaran transparan yang lebih besar dari penandanya. */}
              <circle className="chart__hit" cx={cx} cy={cy} r={16} />
              {/* Cincin permukaan 2 px agar penanda tetap terbaca saat bertumpuk. */}
              <circle cx={cx} cy={cy} r={5.5} fill="var(--data-surface)" />
              <circle cx={cx} cy={cy} r={4} fill="var(--series-1)" />
            </g>
          );
        })}

        <text className="chart__axis-label" x={margin.left + plotWidth / 2} y={height - 8} textAnchor="middle">
          {xLabel}
        </text>
        <text
          className="chart__axis-label"
          transform={`translate(14 ${margin.top + plotHeight / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yLabel}
        </text>
      </svg>
      <Tooltip state={tooltip} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Batang bertumpuk sederhana (komposisi jenis fasilitas)                      */
/* -------------------------------------------------------------------------- */

export interface StackSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface StackedBarProps {
  segments: StackSegment[];
  total: number;
  totalLabel: string;
}

/**
 * Satu batang bertumpuk horizontal untuk komposisi.
 *
 * Setiap segmen dipisahkan celah 2 px berwarna permukaan, bukan garis tepi.
 * Label hanya dipasang di dalam segmen yang lebarnya benar-benar cukup;
 * sisanya mengandalkan legenda dan tabel.
 */
export function StackedBar({ segments, total, totalLabel }: StackedBarProps) {
  const { tooltip, show, hide } = useTooltip();

  if (total <= 0) {
    return <div className="empty"><div className="empty__body">Tidak ada fasilitas untuk ditampilkan.</div></div>;
  }

  const width = 640;
  const height = 30;
  const GAP = 2;

  let cursor = 0;
  const laid = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const raw = (segment.value / total) * width;
      const x = cursor;
      cursor += raw;
      return { ...segment, x, width: raw };
    });

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Komposisi ${totalLabel}: ${laid.map((s) => `${s.label} ${s.value}`).join(', ')}`}
        onMouseLeave={hide}
      >
        {laid.map((segment, index) => {
          const isFirst = index === 0;
          const isLast = index === laid.length - 1;
          const drawWidth = Math.max(1, segment.width - (isLast ? 0 : GAP));
          // Hanya segmen terluar yang membulat; sisanya rata agar celah 2 px
          // yang memisahkan, bukan bentuk ujungnya.
          const radius = 4;
          const x = segment.x;
          const d = isFirst
            ? roundedLeftBar(x, 6, drawWidth, 18, radius)
            : isLast
              ? roundedRightBar(x, 6, drawWidth, 18, radius)
              : `M ${x} 6 H ${x + drawWidth} V 24 H ${x} Z`;

          // Label dipasang hanya bila benar-benar muat dengan lapang.
          const estimate = segment.label.length * 5.6 + 26;
          const fits = drawWidth > estimate;

          return (
            <g key={segment.key}>
              <path
                d={d}
                fill={segment.color}
                tabIndex={0}
                onMouseMove={(event) =>
                  show(event, (
                    <>
                      <div className="tooltip__title">{totalLabel}</div>
                      <TooltipRow
                        label={segment.label}
                        value={`${formatNumber(segment.value)} (${((segment.value / total) * 100).toFixed(1)}%)`}
                        color={segment.color}
                      />
                    </>
                  ))
                }
                onFocus={(event) => {
                  const box = (event.target as SVGElement).getBoundingClientRect();
                  show({ clientX: box.left, clientY: box.bottom }, (
                    <>
                      <div className="tooltip__title">{totalLabel}</div>
                      <TooltipRow label={segment.label} value={formatNumber(segment.value)} color={segment.color} />
                    </>
                  ));
                }}
                onBlur={hide}
              >
                <title>{`${segment.label}: ${formatNumber(segment.value)}`}</title>
              </path>

              {fits ? (
                <text
                  x={x + drawWidth / 2}
                  y={15}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    // Teks di dalam isian berwarna: pilih hitam atau putih
                    // menurut terang gelapnya isian itu.
                    fill: pickInk(segment.color),
                    pointerEvents: 'none',
                  }}
                >
                  {segment.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <Tooltip state={tooltip} />
    </>
  );
}

function roundedLeftBar(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2);
  return [
    `M ${x + width} ${y}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 0 ${x} ${y + r}`,
    `V ${y + height - r}`,
    `A ${r} ${r} 0 0 0 ${x + r} ${y + height}`,
    `H ${x + width}`,
    'Z',
  ].join(' ');
}

/**
 * Pilih warna teks di atas sebuah isian.
 * Nilai hex dibaca langsung; untuk variabel CSS dipakai asumsi terang.
 */
function pickInk(color: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return '#ffffff';
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? '#0b0b0b' : '#ffffff';
}

/* -------------------------------------------------------------------------- */
/* Legenda                                                                     */
/* -------------------------------------------------------------------------- */

export function ChartLegend({ items }: { items: { label: string; color: string; shape?: string }[] }) {
  // Legenda hanya bermakna bila ada dua seri atau lebih.
  if (items.length < 2) return null;

  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span className="chart-legend__item" key={item.label}>
          <span className="chart-legend__swatch" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Ukuran grafik yang disesuaikan dengan lebar jendela, untuk tata letak yang rapat. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  return [ref, width];
}