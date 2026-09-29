/**
 * Komponen dasar: dialog, catatan, kartu angka.
 *
 * Dialog di sini menangani hal-hal yang sering terlewat: fokus dipindahkan ke
 * dalam dialog saat dibuka, Tab berputar di dalamnya, Escape menutup, dan
 * fokus dikembalikan ke elemen pemicu saat ditutup.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { IconAlert, IconClose, IconInfo } from './icons';
import { formatNumber } from '../lib/format';

/* -------------------------------------------------------------------------- */
/* Dialog                                                                      */
/* -------------------------------------------------------------------------- */

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Lebar maksimum dialog, dalam piksel. */
  maxWidth?: number;
  /** Bila true, latar tidak menutup dialog (untuk alur yang butuh keputusan). */
  persistent?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  maxWidth = 620,
  persistent = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const subtitleId = useId();

  // Simpan elemen yang memicu dialog supaya fokus dapat dikembalikan.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Pindahkan fokus ke elemen pertama yang dapat difokuskan di dalam dialog.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dialog).focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Kunci gulir latar selama dialog terbuka.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && !persistent) {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose, persistent],
  );

  if (!open) return null;

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        // Hanya tutup bila klik benar-benar mulai dari latar, bukan dari isi
        // dialog yang kebetulan berakhir di latar.
        if (event.target === event.currentTarget && !persistent) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div className="dialog__header">
          <div>
            <div className="dialog__title" id={titleId}>
              {title}
            </div>
            {subtitle ? (
              <div className="dialog__subtitle" id={subtitleId}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Tutup dialog">
            <IconClose size={17} />
          </button>
        </div>

        <div className="dialog__body">{children}</div>

        {footer ? <div className="dialog__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Catatan                                                                     */
/* -------------------------------------------------------------------------- */

export type NoticeTone = 'info' | 'warning' | 'critical' | 'demo';

interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  /** Ikon diganti otomatis menurut nada, kecuali ditentukan lain. */
  icon?: ReactNode;
}

export function Notice({ tone = 'info', title, children, icon }: NoticeProps) {
  const defaultIcon =
    tone === 'critical' || tone === 'warning' ? <IconAlert size={16} /> : <IconInfo size={16} />;

  return (
    <div className={`notice notice--${tone}`}>
      <span className="notice__icon">{icon ?? defaultIcon}</span>
      <div className="notice__body">
        {title ? <div className="notice__title">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Kartu angka                                                                 */
/* -------------------------------------------------------------------------- */

interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  /** Menandai bahwa nilainya tidak tersedia, bukan nol. */
  missing?: boolean;
  hero?: boolean;
}

export function StatTile({ label, value, unit, note, missing, hero }: StatTileProps) {
  return (
    <div className={hero ? 'card stat stat--hero' : 'card stat'}>
      <div className="stat__label">{label}</div>
      <div
        className={`stat__value${hero ? ' stat__value--hero' : ''}`}
        style={missing ? { color: 'var(--ui-text-muted)', fontWeight: 500, fontStyle: 'italic', fontSize: hero ? '1.5rem' : '1.1rem' } : undefined}
      >
        {value}
        {unit && !missing ? <span className="stat__unit">{unit}</span> : null}
      </div>
      {note ? <div className="stat__note">{note}</div> : null}
    </div>
  );
}

interface MeterProps {
  label: string;
  value: number;
  max: number;
  /** Teks nilai yang sudah diformat. */
  display: string;
  note?: string;
}

/** Meter sederhana: batang terisi di atas jalur yang merupakan langkah lebih terang dari ramp yang sama. */
export function Meter({ label, value, max, display, note }: MeterProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span className="metric-row__label">{label}</span>
        <span className="metric-row__value">{display}</span>
      </div>
      <div
        className="bar-track"
        style={{ marginTop: 6 }}
        role="meter"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${display}`}
      >
        <div className="bar-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      {note ? <div className="stat__note">{note}</div> : null}
    </div>
  );
}

/** Baris metrik dengan penanganan nilai kosong yang eksplisit. */
export function MetricRow({
  label,
  value,
  missing,
  hint,
}: {
  label: string;
  value: string;
  missing?: boolean;
  hint?: string;
}) {
  return (
    <div className="metric-row">
      <div>
        <div className="metric-row__label">{label}</div>
        {hint ? <div className="stat__note" style={{ marginTop: 2 }}>{hint}</div> : null}
      </div>
      <div className={missing ? 'metric-row__value metric-row__value--missing' : 'metric-row__value'}>
        {value}
      </div>
    </div>
  );
}

/** Hitung mundur angka untuk judul yang memerlukan pemisah ribuan. */
export function CountBadge({ value }: { value: number }) {
  return <span className="chip__count">{formatNumber(value)}</span>;
}