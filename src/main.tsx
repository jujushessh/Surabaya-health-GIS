/**
 * Titik masuk aplikasi.
 *
 * Tema awal ditentukan sebelum React dipasang supaya tidak ada kedipan warna
 * terang saat halaman pertama dibuka dalam mode gelap.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

/** Preferensi tema pengguna; dipakai sebagai nilai awal, bukan sebagai pengunci. */
function initialTheme(): 'light' | 'dark' {
  try {
    const stored = window.localStorage.getItem('sig-tema');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Penyimpanan dapat diblokir; abaikan dan pakai preferensi sistem.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

document.documentElement.dataset.theme = initialTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Elemen #root tidak ditemukan pada index.html.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Simpan perubahan tema agar pilihan pengguna bertahan antar kunjungan.
const observer = new MutationObserver(() => {
  const theme = document.documentElement.dataset.theme;
  if (theme !== 'light' && theme !== 'dark') return;
  try {
    window.localStorage.setItem('sig-tema', theme);
  } catch {
    // Diabaikan: tema tetap berlaku untuk sesi ini.
  }
});

observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});