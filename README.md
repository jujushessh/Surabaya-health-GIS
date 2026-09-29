# SIG Sebaran & Aksesibilitas Fasilitas Kesehatan Kota Surabaya

Sistem informasi geografis berbasis web untuk memetakan sebaran dan aksesibilitas fasilitas kesehatan (rumah sakit, klinik, apotek) terhadap kepadatan penduduk Kota Surabaya.

## Fitur utama

- **Peta interaktif** dengan choropleth kepadatan penduduk, rasio fasilitas, jarak terdekat, dan cakupan radius
- **Analisis peringkat** wilayah berdasarkan metrik yang dipilih, dengan diagram batang dan histogram
- **Skor prioritas** yang bobotnya dapat diubah untuk menggabungkan kepadatan, kelangkaan fasilitas, dan jarak
- **Daftar fasilitas lengkap** dengan pencarian dan penyaringan jenis
- **Halaman metodologi** yang menjelaskan cara setiap angka dihitung dan keterbatasannya
- **Impor/ekspor CSV** untuk data penduduk dan fasilitas

## Status data pada versi ini

Data diambil dari OpenStreetMap pada **28 September 2026** dan tersimpan di dalam
repositori, sehingga aplikasi dapat dijalankan tanpa jaringan.

| | |
|---|---|
| Kecamatan | 31 (cocok dengan jumlah resmi Kota Surabaya) |
| Kelurahan | 154 (jumlah resmi 153; selisih satu wajar untuk data komunitas) |
| Fasilitas kesehatan | 484 — klinik 324, rumah sakit 95, apotek 57, praktik dokter 8 |
| Fasilitas di luar semua poligon wilayah | 40 (8,3%) — tetap disimpan, tidak dibuang diam-diam |
| Angka penduduk | **belum diisi** — lihat catatan di bawah |

Dua hal yang perlu diketahui sebelum membaca angkanya:

1. **Angka penduduk belum ada.** Karena itu kepadatan, rasio fasilitas, dan skor
   prioritas belum dapat dihitung. Aplikasi membuka peta pada **jarak ke fasilitas
   terdekat** — metrik yang memang bisa dihitung dari data yang tersedia — dan
   menandai metrik lain sebagai "perlu angka penduduk". Wilayah tanpa data
   ditampilkan sebagai "data tidak tersedia" dengan arsir abu, bukan sebagai 0.
2. **Angka apotek 57 hampir pasti jauh lebih rendah dari kenyataan.** Ini
   ketidaklengkapan OpenStreetMap, bukan kesalahan skrip. Bacalah sebagai
   "apotek yang sudah dipetakan di OSM", bukan "apotek yang ada".

Cara mengisi angka penduduk ada di bagian [Menyiapkan data](#menyiapkan-data).

## Teknologi

- React 18 + TypeScript
- Vite (build statis, dapat di-hosting tanpa server)
- Leaflet untuk peta
- Overpass API (OpenStreetMap) untuk batas wilayah dan fasilitas

## Memulai

### Kebutuhan

- Node.js 20+
- npm 10+

### Instalasi

```bash
npm install
```

### Menyiapkan data

Aplikasi membutuhkan data batas wilayah dan fasilitas. Data diambil sekali dari OpenStreetMap dan disimpan secara lokal:

```bash
# 1. Ambil batas kecamatan dan kelurahan
npm run data:boundaries

# 2. Ambil fasilitas kesehatan
npm run data:facilities

# 3. Siapkan template angka penduduk
npm run data:population

# 4. Rakit dataset akhir
npm run data:build

# 5. Validasi
npm run data:validate

# Atau jalankan sekaligus:
npm run data:all
```

**Catatan penting:**

- Skrip `data:population` tidak mengambil angka penduduk otomatis. Ia hanya membuat template CSV yang sudah terisi nama wilayah resmi. Angka penduduk harus diisi dari publikasi BPS dan diimpor lewat halaman Data. Nama wilayah yang kembar (Kota Surabaya punya dua kelurahan bernama **Wonorejo**) dibedakan lewat kolom `kecamatan_induk`; tanpa kolom itu barisnya ditolak sebagai ambigu, bukan dipasang ke wilayah yang salah.
- Respons mentah Overpass disimpan di `data/raw/`, jadi menjalankan ulang skrip tidak memanggil jaringan lagi. Hapus berkas di folder itu untuk mengambil versi terbaru.
- Bila Overpass sedang sibuk (HTTP 504), jalankan ulang perintahnya. Data tidak pernah ditebak — bila gagal, aplikasi menampilkan panduan impor manual.

### Verifikasi level administratif

Batas wilayah diambil dari relasi OSM dengan tingkat yang **berbeda antar
provinsi**, jadi angka ini tidak boleh disalin ke proyek lain tanpa diperiksa ulang.
Untuk Kota Surabaya: kota = level 5, kecamatan = level 6, kelurahan = level 7.

Kueri mengembalikan 1583 relasi. Yang ber-level 9 ada 1398 buah dan **bukan
kelurahan** — namanya berbentuk "RW 01"…"RW 11", yaitu Rukun Warga. Skrip hanya
memakai level 7, sehingga "kelurahan" tidak diam-diam berisi RW.

### Menjalankan

```bash
npm run dev
```

Buka alamat yang dicetak di terminal (bawaannya `http://localhost:5173/`). Bila
port itu sedang dipakai, Vite otomatis pindah ke port berikutnya dan mencetak
alamat yang benar.

### Build produksi

```bash
npm run build
```

Hasilnya di folder `dist/` dapat di-hosting sebagai berkas statis (GitHub Pages, Netlify, Vercel, atau server file biasa).

## Struktur proyek

```
src/
├── App.tsx              # Cangkang aplikasi (navigasi, tema, perutean)
├── main.tsx             # Titik masuk
├── types.ts             # Model data inti
├── components/
│   ├── MapCanvas.tsx    # Peta Leaflet dengan choropleth dan penanda
│   ├── RegionPanel.tsx  # Panel rincian wilayah
│   ├── FilterBar.tsx    # Baris penyaring metrik dan jenis fasilitas
│   ├── charts.tsx       # Diagram batang, histogram, scatter
│   ├── ui.tsx           # Komponen dasar (dialog, kartu, meter)
│   └── icons.tsx        # Ikon SVG
├── pages/
│   ├── MapPage.tsx      # Halaman peta
│   ├── AnalysisPage.tsx # Halaman analisis dan peringkat
│   ├── FacilitiesPage.tsx # Daftar fasilitas
│   ├── DataPage.tsx     # Sumber data, mutu, impor/ekspor
│   └── MethodologyPage.tsx # Penjelasan metode
├── lib/
│   ├── geo.ts           # Fungsi geometri (haversine, point-in-polygon, luas)
│   ├── aggregate.ts     # Agregasi kelurahan→kecamatan
│   ├── access.ts        # Perhitungan jarak dan cakupan
│   ├── classify.ts      # Klasifikasi choropleth (kuantil, Jenks)
│   ├── priority.ts      # Skor prioritas
│   ├── palette.ts       # Palet warna (terang/gelap, kategorikal, sekuensial)
│   ├── format.ts        # Format angka, tanggal, jarak
│   ├── io.ts            # Impor/ekspor CSV
│   ├── dataset.ts       # Pemuatan dataset
│   └── metrics.ts       # Penghitung metrik utama
└── store/
    └── DataProvider.tsx # State global (data, pengaturan, metrik)

scripts/
├── fetch-boundaries.mjs # Ambil batas dari Overpass
├── fetch-facilities.mjs # Ambil fasilitas dari Overpass
├── fetch-population.mjs # Siapkan template penduduk
├── build-data.mjs       # Rakit dataset ke public/data/
└── validate-data.mjs    # Periksa konsistensi dan kelengkapan

public/data/             # Dataset akhir (dibuat oleh build-data)
```

## Metodologi

### Ukuran yang dihitung

| Metrik | Rumus | Keterangan |
|--------|-------|------------|
| Kepadatan penduduk | penduduk ÷ luas | jiwa/km² |
| Rasio fasilitas | (fasilitas ÷ penduduk) × 1000 | per 1.000 jiwa |
| Jarak terdekat | haversine ke fasilitas terdekat | km |
| Cakupan radius | titik grid dalam radius ÷ total titik | % |
| Skor prioritas | kombinasi berbobot skor-z | 0–100 |

### Keterbatasan

1. **Jarak garis lurus**, bukan jarak tempuh. Tidak memperhitungkan jalan, hambatan, atau moda transportasi.
2. **Fasilitas dari OpenStreetMap** — tidak lengkap, tidak resmi, tidak memuat kapasitas atau jam buka. Jumlahnya cenderung lebih rendah dari kenyataan.
3. **Ketiga jenis fasilitas disamakan bobotnya** — rumah sakit, klinik, dan apotek dihitung setara meski perannya berbeda.
4. **Titik pusat per wilayah** — ukuran jarak mengasumsikan seluruh wilayah diwakili satu titik; wilayah memanjang kurang terwakili.
5. **Cakupan berbasis sampel grid**, bukan sebaran penduduk — mendekati persentase luas, bukan persentase warga.
6. **Angka penduduk belum diisi**, sehingga kepadatan, rasio fasilitas, dan skor prioritas belum dapat dihitung pada versi ini.
7. **Batas wilayah dari OSM dapat berbeda tipis dari batas resmi pemerintah**, sehingga luas dan pemetaan fasilitas ke wilayah ikut berbeda tipis.
8. **40 fasilitas (8,3%) tidak terpetakan ke wilayah mana pun** — berada di dalam kotak pembatas kota tetapi di luar semua poligon. Jumlahnya tetap dilaporkan, bukan dibuang diam-diam.

Penjelasan lengkap ada di halaman Metodologi pada aplikasi dan di `docs/metodologi.md`.

## Pengembangan

### Tes unit

```bash
npm test          # sekali jalan, 233 tes
npm run test:watch
```

Tes mencakup geometri, agregasi (termasuk penelusuran fasilitas kelurahan →
kecamatan), aksesibilitas, klasifikasi choropleth, skor prioritas, pemformatan
angka, dan impor CSV yang tidak valid.

### Pemeriksaan tipe

```bash
npx tsc --noEmit
```

## Lisensi data

- **Batas wilayah dan fasilitas**: © OpenStreetMap contributors, lisensi ODbL 1.0
- **Angka penduduk**: BPS Kota Surabaya (perlu diimpor manual)

## Atribusi

Bila menggunakan hasil dari aplikasi ini, cantumkan:

> Data peta berasal dari © kontributor OpenStreetMap, berlisensi ODbL 1.0.

Sertakan juga tanggal akses dan daftar jenis fasilitas yang dipakai pada filter.
