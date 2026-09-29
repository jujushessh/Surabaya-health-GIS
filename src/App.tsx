/**
 * Cangkang aplikasi: navigasi, bilah atas, perutean, dan tema.
 *
 * Perutean memakai hash (`#peta`, `#analisis`, …) supaya aplikasi tetap dapat
 * di-hosting sebagai berkas statis tanpa aturan penulisan ulang URL di server.
 */

import { useCallback, useEffect, useState } from 'react';

import { StoreProvider, useStore } from './store/DataProvider';
import { MapPage } from './pages/MapPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { FacilitiesPage } from './pages/FacilitiesPage';
import { DataPage } from './pages/DataPage';
import { MethodologyPage } from './pages/MethodologyPage';
import { Notice } from './components/ui';
import {
  IconBook,
  IconChart,
  IconDatabase,
  IconList,
  IconMap,
  IconMoon,
  IconRefresh,
  IconSun,
} from './components/icons';
import { METRIC_META } from './types';
import { formatNumber, NO_DATA } from './lib/format';

type PageId = 'peta' | 'analisis' | 'fasilitas' | 'data' | 'metodologi';

interface PageDef {
  id: PageId;
  label: string;
  shortLabel: string;
  title: string;
  subtitle: string;
  /** Komponen ikon; semuanya menerima `size` dan `className`. */
  icon: typeof IconMap;
}

const PAGES: PageDef[] = [
  {
    id: 'peta',
    label: 'Peta sebaran',
    shortLabel: 'Peta',
    title: 'Peta sebaran dan aksesibilitas',
    subtitle: 'Sebaran fasilitas kesehatan terhadap kepadatan penduduk',
    icon: IconMap,
  },
  {
    id: 'analisis',
    label: 'Analisis wilayah',
    shortLabel: 'Analisis',
    title: 'Analisis wilayah',
    subtitle: 'Peringkat, sebaran nilai, dan skor prioritas',
    icon: IconChart,
  },
  {
    id: 'fasilitas',
    label: 'Daftar fasilitas',
    shortLabel: 'Fasilitas',
    title: 'Daftar fasilitas kesehatan',
    subtitle: 'Pencarian, penyaringan, dan rincian tiap fasilitas',
    icon: IconList,
  },
  {
    id: 'data',
    label: 'Data & sumber',
    shortLabel: 'Data',
    title: 'Data dan sumber',
    subtitle: 'Asal data, lisensi, mutu, serta impor dan ekspor',
    icon: IconDatabase,
  },
  {
    id: 'metodologi',
    label: 'Metodologi',
    shortLabel: 'Metode',
    title: 'Metodologi dan keterbatasan',
    subtitle: 'Cara setiap angka dihitung dan batas berlakunya',
    icon: IconBook,
  },
];

/** Baca halaman dari hash URL; hash tak dikenal jatuh ke peta. */
function pageFromHash(): PageId {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  const found = PAGES.find((page) => page.id === raw);
  return found ? found.id : 'peta';
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const { data, settings, actions } = useStore();
  const [page, setPage] = useState<PageId>(pageFromHash);

  // Perutean berbasis hash: tombol maju/mundur peramban tetap bekerja.
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: PageId) => {
    window.location.hash = `#${next}`;
    setPage(next);
  }, []);

  // Tema dipasang pada elemen <html> supaya warna halaman di luar kartu
  // (latar, bilah gulir) ikut berubah, bukan hanya isi kartu.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const active = PAGES.find((item) => item.id === page) ?? PAGES[0];
  const isMapPage = page === 'peta';
  const ready = data.status === 'siap' && data.bundle !== null;

  return (
    <div className="app">
      <a className="skip-link" href="#konten-utama">
        Lompat ke isi utama
      </a>

      <aside className="app__sidebar">
        <div className="brand">
          <div className="brand__mark">
            <span className="brand__glyph" aria-hidden="true">
              <IconMap size={19} />
            </span>
            <div>
              <div className="brand__title">SIG Kesehatan</div>
              <div className="brand__subtitle">Kota Surabaya</div>
            </div>
          </div>
        </div>

        <nav className="nav" aria-label="Navigasi utama">
          {PAGES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="nav__item"
                aria-current={item.id === page ? 'page' : undefined}
                onClick={() => navigate(item.id)}
                disabled={!ready && item.id !== 'data' && item.id !== 'metodologi'}
              >
                <Icon size={17} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          {ready ? (
            <>
              <div className="sidebar-foot__line">
                {formatNumber(data.bundle!.regions.length)} wilayah ·{' '}
                {formatNumber(data.bundle!.facilities.length)} fasilitas
              </div>
              <div className="sidebar-foot__line sidebar-foot__line--muted">
                {data.isDemo ? 'Data contoh — bukan angka nyata' : 'Sumber: OpenStreetMap & BPS'}
              </div>
            </>
          ) : (
            <div className="sidebar-foot__line sidebar-foot__line--muted">Dataset belum termuat</div>
          )}
        </div>
      </aside>

      <div className="app__main">
        {/* Penanda mode contoh diletakkan di bilah atas, bukan di dalam halaman,
            supaya terlihat di semua halaman tanpa mengganggu tata letak peta
            yang memakai tinggi penuh. */}
        {data.isDemo ? (
          <div className="demo-bar" role="status">
            <strong>Mode data contoh.</strong> Angka dan bentuk wilayah bukan Kota Surabaya — hanya
            untuk memeriksa tampilan. Buka halaman Data untuk memuat data sebenarnya.
          </div>
        ) : null}

        <header className="topbar">
          <div className="topbar__heading">
            <h1 className="topbar__title">{active.title}</h1>
            <div className="topbar__subtitle">
              {ready ? active.subtitle : 'Menyiapkan data…'}
            </div>
          </div>

          <div className="topbar__actions">
            {ready ? (
              <span className="topbar__metric" title={METRIC_META[settings.metric].description}>
                <span className="topbar__metric-label">Metrik aktif</span>
                <span className="topbar__metric-value">
                  {METRIC_META[settings.metric].label}
                </span>
              </span>
            ) : null}

            <button
              type="button"
              className="btn btn--ghost btn--icon"
              onClick={() =>
                actions.update({ theme: settings.theme === 'light' ? 'dark' : 'light' })
              }
              aria-label={
                settings.theme === 'light' ? 'Ganti ke tema gelap' : 'Ganti ke tema terang'
              }
              title={settings.theme === 'light' ? 'Tema gelap' : 'Tema terang'}
            >
              {settings.theme === 'light' ? <IconMoon size={17} /> : <IconSun size={17} />}
            </button>
          </div>
        </header>

        <main
          className={`app__content${isMapPage && ready ? ' app__content--flush' : ''}`}
          id="konten-utama"
        >
          {renderPage()}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Navigasi utama (layar kecil)">
        {PAGES.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className="bottom-nav__item"
              aria-current={item.id === page ? 'page' : undefined}
              onClick={() => navigate(item.id)}
              disabled={!ready && item.id !== 'data' && item.id !== 'metodologi'}
            >
              <Icon size={18} />
              {item.shortLabel}
            </button>
          );
        })}
      </nav>
    </div>
  );

  function renderPage() {
    if (!ready) return <SetupScreen />;

    switch (page) {
      case 'peta':
        return <MapPage />;
      case 'analisis':
        return <AnalysisPage />;
      case 'fasilitas':
        return <FacilitiesPage />;
      case 'data':
        return <DataPage />;
      case 'metodologi':
        return <MethodologyPage />;
      default:
        return <MapPage />;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Layar penyiapan dan galat                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Ditampilkan selama dataset dimuat, dan ketika berkas dataset belum ada.
 *
 * Layar ini sengaja memberi langkah perbaikan yang konkret, bukan sekadar
 * "terjadi kesalahan": berkas data memang belum ada sampai skrip dijalankan.
 */
function SetupScreen() {
  const { data, actions } = useStore();

  if (data.status === 'memuat') {
    return (
      <div className="setup">
        <div className="empty">
          <div className="empty__title">Memuat dataset…</div>
          <div className="empty__body">
            Membaca batas wilayah, data fasilitas, dan metadata sumber dari berkas lokal.
          </div>
        </div>
      </div>
    );
  }

  const error = data.error;

  return (
    <div className="setup">
      <Notice tone="critical" title="Dataset belum dapat dimuat">
        <p>{error?.message ?? 'Terjadi galat yang tidak dikenal.'}</p>
        {error && error.guidance.length > 0 ? (
          <ul className="prose-list" style={{ marginTop: 8, marginBottom: 0 }}>
            {error.guidance.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        ) : null}
      </Notice>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card__body">
          <h2 className="method__title">Menyiapkan data untuk pertama kali</h2>
          <p className="prose">
            Jalankan perintah berikut di folder proyek. Tahap pertama dan kedua memerlukan koneksi
            internet karena mengambil data dari OpenStreetMap; setelah itu aplikasi berjalan
            sepenuhnya luring.
          </p>
          <ol className="steps">
            <li>
              <code>npm run data:boundaries</code>
              <span>Batas kecamatan dan kelurahan.</span>
            </li>
            <li>
              <code>npm run data:facilities</code>
              <span>Fasilitas kesehatan dari Overpass API.</span>
            </li>
            <li>
              <code>npm run data:population</code>
              <span>Menyiapkan template angka penduduk untuk diisi dari data BPS.</span>
            </li>
            <li>
              <code>npm run data:build</code>
              <span>Merakit dataset akhir ke folder public/data/.</span>
            </li>
          </ol>

          <div className="template-row">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                void actions.reload();
              }}
            >
              <IconRefresh size={15} />
              Coba muat ulang
            </button>
            <button type="button" className="btn" onClick={actions.useDemo}>
              Lihat tampilan dengan data contoh
            </button>
          </div>

          <p className="stat__note" style={{ marginTop: 10 }}>
            Data contoh berisi wilayah dan angka buatan. Tidak ada nilainya yang berasal dari Kota
            Surabaya, dan aplikasi akan menampilkan penanda selama mode ini aktif.
          </p>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card__body">
          <h2 className="method__title">Bila sumber data gagal diakses</h2>
          <p className="prose">
            Pengambilan otomatis bergantung pada layanan Overpass yang bisa sedang sibuk. Bila
            gagal, jalankan ulang perintahnya, atau siapkan berkas sendiri lalu impor lewat halaman
            Data setelah aplikasi terbuka dengan data contoh. Angka penduduk memang tidak diambil
            otomatis — skrip hanya menyiapkan template berisi nama wilayah resmi, karena angka
            penduduk harus dikutip dari publikasi BPS beserta tahunnya, bukan ditebak.
          </p>
          <p className="stat__note">
            Nilai yang tidak tersedia selalu ditulis <em>{NO_DATA}</em> dan tidak pernah ditampilkan
            sebagai 0.
          </p>
        </div>
      </section>
    </div>
  );
}