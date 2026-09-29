# Metodologi — SIG Sebaran & Aksesibilitas Fasilitas Kesehatan Kota Surabaya

Dokumen ini menjelaskan dari mana setiap angka berasal, bagaimana ia dihitung, dan
apa yang **tidak** dapat disimpulkan darinya. Halaman Metodologi di dalam aplikasi
memuat penjelasan yang sama dalam bentuk yang dapat dicetak.

Tanggal akses data pada versi ini: **28 September 2026**.

---

## 1. Data yang dipakai

### 1.1 Batas wilayah administratif

| | |
|---|---|
| Sumber | OpenStreetMap, diambil lewat Overpass API |
| Lisensi | ODbL 1.0 — © kontributor OpenStreetMap |
| Relasi kota | `rel/8225862` (`admin_level=5`, "Surabaya") |
| Tingkat kecamatan | `admin_level=6` |
| Tingkat kelurahan | `admin_level=7` |
| Tanggal akses | 2026-09-28 |
| Jumlah terbaca | **31 kecamatan, 154 kelurahan** |

Relasi batas OSM berbentuk daftar potongan garis (way) yang belum tersambung.
Skrip `scripts/fetch-boundaries.mjs` merangkainya kembali menjadi cincin tertutup
sebelum dapat dipakai.

**Verifikasi level.** Kueri mengembalikan 1583 relasi: 31 pada `admin_level=6`,
154 pada `admin_level=7`, dan 1398 pada `admin_level=9`. Level 9 di Kota Surabaya
adalah **RW (Rukun Warga)**, bukan kelurahan — namanya berbentuk "RW 01"…"RW 11".
Hanya level 7 yang dipakai sebagai kelurahan. Jumlah 154 sejalan dengan 153
kelurahan resmi Kota Surabaya; selisih satu wajar karena OSM adalah data komunitas
yang dapat mendahului atau tertinggal dari penetapan resmi.

**Nama kembar.** Dua kelurahan bernama "Wonorejo" — di Kecamatan Rungkut dan di
Kecamatan Tegalsari. Nama boleh sama, tetapi ID internal harus unik, sehingga ID
keduanya dibedakan memakai ID OSM. Pada impor angka penduduk, keduanya dibedakan
lewat kolom `kecamatan_induk`; tanpa kolom itu baris ditolak sebagai ambigu, bukan
dipasang ke wilayah yang salah.

### 1.2 Fasilitas kesehatan

| | |
|---|---|
| Sumber | OpenStreetMap, diambil lewat Overpass API |
| Lisensi | ODbL 1.0 — © kontributor OpenStreetMap |
| Kotak pembatas | `-7.4, 112.55, -7.13, 112.95` |
| Tanggal akses | 2026-09-28 |
| Jumlah terbaca | **484 fasilitas** |

| Jenis | Jumlah |
|---|---|
| Klinik / puskesmas (`amenity=clinic`, `healthcare=centre`) | 324 |
| Rumah sakit (`amenity=hospital`) | 95 |
| Apotek (`amenity=pharmacy`) | 57 |
| Praktik dokter (`amenity=doctors`, `healthcare=doctor`) | 8 |
| Pos kesehatan (`amenity=health_post`, `healthcare=health_post`) | 0 |

11 fasilitas tidak memiliki nama pada sumber asal dan diberi label "(tanpa nama)".

> **Angka-apotek 57 untuk kota sebesar Surabaya hampir pasti jauh lebih rendah dari
> kenyataan.** Ini bukan kesalahan skrip, melainkan gambaran ketidaklengkapan
> OpenStreetMap: apotek kecil jarang dipetakan. Angka ini harus dibaca sebagai
> "apotek yang sudah dipetakan di OSM", bukan "apotek yang ada".

### 1.3 Jumlah penduduk

**Belum tersedia.** Angka penduduk resmi (BPS Kota Surabaya / portal open data)
tidak diambil otomatis. Skrip `scripts/fetch-population.mjs` mencoba membaca tabel
daring, tetapi struktur tabel berubah-ubah dan satu tabel sering memuat beberapa
tahun sekaligus — menebak kolom berisiko menghasilkan angka yang salah namun
terlihat meyakinkan. Karena itu skrip hanya membuat template berisi nama wilayah
yang benar, lalu **berhenti dan meminta angka diisi manual dari publikasi resmi**.

Konsekuensinya: kepadatan penduduk, rasio fasilitas per 1.000 penduduk, dan skor
prioritas belum dapat dihitung. Aplikasi menandainya "data tidak tersedia" — bukan
nol. Mengisi angka nol akan membuat wilayah tampak tidak berpenduduk, yang jauh
lebih menyesatkan daripada mengakui datanya belum ada.

Cara mengisi: buka `data/templates/penduduk-template.csv`, isi kolom `penduduk`
(sebutkan juga `tahun`), lalu impor lewat halaman **Data** pada aplikasi.

---

## 2. Cara setiap angka dihitung

### 2.1 Luas wilayah

Luas dihitung dari poligon pada permukaan bola memakai pendekatan kelebihan bola,
bukan pada proyeksi datar — agar tidak terjadi distorsi pada wilayah seukuran kota.
Satuan km². Lubang (mis. poligon dalam poligon) dikurangkan.

Total luas 31 kecamatan hasil hitung: **338,8 km²**, sejalan dengan luas daratan
Kota Surabaya yang lazim dirujuk (± 333–350 km², bergantung sumber dan apakah
wilayah laut/pesisir dihitung).

Luas tidak pernah diisi dari ingatan: bila luas resmi tersedia, ia disimpan
terpisah sebagai pembanding (`area_official_km2`), bukan menggantikan hasil hitung.
Selisih di atas 5% antara keduanya dicatat sebagai catatan kualitas.

### 2.2 Titik representatif wilayah

Setiap wilayah diwakili satu titik yang **dijamin berada di dalam poligonnya**.
Sentroid biasa tidak cukup: pada poligon cekung (banyak wilayah Surabaya berbentuk
tidak beraturan karena mengikuti sungai dan rel), sentroid dapat jatuh di luar
wilayah. Bila itu terjadi, titik di dalam terdekat dicari lewat sisiran grid yang
deterministik.

Penting untuk diketahui: memakai satu titik untuk mewakili seluruh wilayah adalah
penyederhanaan. Wilayah berbentuk memanjang dapat punya titik pusat yang dekat
fasilitas sementara ujung lainnya jauh.

### 2.3 Kepadatan penduduk

```
kepadatan = jumlah penduduk ÷ luas wilayah (km²)     → jiwa per km²
```

Bernilai `null` — ditampilkan sebagai "data tidak tersedia" — bila penduduk belum
diisi, atau bila luas nol. Tidak pernah `Infinity`, tidak pernah `0` yang keliru.

### 2.4 Rasio fasilitas

```
rasio = (jumlah fasilitas ÷ jumlah penduduk) × 1.000   → per 1.000 penduduk
```

Bernilai `null` bila penduduk tidak tersedia **atau** bernilai nol. Wilayah tanpa
fasilitas mendapat nilai `0` yang sah — itu memang nol fasilitas, bukan data hilang.

### 2.5 Jarak ke fasilitas terdekat

Jarak garis lurus (great-circle) dari titik representatif wilayah ke fasilitas
terdekat, dihitung dengan rumus haversine:

```
a = sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2)
d = 2R · asin(√a)        dengan R = 6371,0088 km
```

Dihitung terpisah untuk setiap jenis fasilitas, dan juga untuk jenis apa pun.
Pencarian tetangga terdekat memakai indeks spasial berbasis grid, bukan pencarian
menyeluruh, agar tetap cepat untuk ratusan wilayah × ratusan fasilitas.

> **Ini jarak lurus, bukan jarak tempuh.** Tidak memperhitungkan jaringan jalan,
> sungai, rel, kemacetan, atau moda transportasi. Sebuah wilayah dapat terlihat
> dekat padahal terhalang sungai tanpa jembatan. Untuk klaim aksesibilitas yang
> kuat, jarak lurus harus digantikan analisis jaringan jalan.

### 2.6 Cakupan radius (1 / 3 / 5 km)

Wilayah disampel dengan titik grid berjarak **0,5 km** yang berada di dalam
poligonnya (maksimum 600 titik per wilayah). Cakupan adalah persentase titik sampel
yang berada dalam radius tertentu dari fasilitas jenis apa pun.

```
cakupan(r) = (jumlah titik sampel dengan jarak ≤ r) ÷ (total titik sampel) × 100%
```

Hasilnya proporsi sampel grid, sehingga ketelitiannya terbatas pada kerapatan grid
dan **mendekati persentase luas, bukan persentase penduduk**. Wilayah berpenduduk
padat di satu sudut bisa tercatat cakupannya rendah meskipun hampir seluruh warga
terlayani, dan sebaliknya.

### 2.7 Skor prioritas (0–100)

Skor ini **alat bantu penyaringan, bukan keputusan otomatis.** Semakin tinggi,
semakin perlu perhatian. Tiga komponen digabung:

| Komponen | Arah | Bobot awal |
|---|---|---|
| Kepadatan penduduk | makin padat, makin tinggi skor | 0,40 |
| Kelangkaan fasilitas | makin rendah rasio, makin tinggi skor | 0,35 |
| Jarak ke fasilitas terdekat | makin jauh, makin tinggi skor | 0,25 |

Setiap komponen diubah menjadi skor 0–1 lewat skor-z yang dipetakan ke rentang
tetap, dengan pemangkasan pada ±2,5 simpangan baku. Pemangkasan ini menahan
pengaruh nilai ekstrem: wilayah dengan kepadatan yang jauh di atas rata-rata tidak
langsung mendominasi seluruh skor.

Bobot **ditampilkan di antarmuka dan dapat diubah**, dan seluruh nilai mentah
penyusun skor ikut ditampilkan agar setiap angka dapat ditelusuri kembali.
Wilayah dengan data tidak lengkap tetap mendapat skor selama minimal satu komponen
tersedia; komponen yang kosong diberi bobot nol dan dinormalisasi ulang, bukan
dianggap bernilai rendah.

---

## 3. Pengelompokan kelas pada choropleth

Dua metode tersedia dan dapat dipilih pengguna:

- **Kuantil** — setiap kelas berisi jumlah wilayah yang (hampir) seimbang. Baik
  untuk melihat peringkat relatif; buruk bila nilai banyak yang kembar.
- **Natural breaks (Jenks)** — kelas mengikuti pengelompokan alami nilai. Baik
  untuk memperlihatkan kelompok yang memang terpisah; dihitung secara eksak dengan
  pemrograman dinamis (bukan aproksimasi).

Jumlah kelas dibatasi **7**. Di atas itu, warna-warna bersebelahan mulai berbaur
dan pembaca berhenti membedakannya. Skala warna selalu **satu hue** dari terang ke
gelap (makin gelap = makin tinggi), bukan pelangi. Legenda selalu ditampilkan, dan
setiap nilai juga tersedia dalam bentuk tabel — warna tidak pernah menjadi
satu-satunya cara membaca nilai.

Pada peta, tiga jenis fasilitas utama (rumah sakit, klinik, apotek) dibedakan
lewat **warna sekaligus bentuk penanda**. Alasannya: peta termasuk bentuk diagram
"semua pasangan", dan pada uji buta warna hanya tiga slot warna pertama yang lolos
ambang di kedua mode. Bentuk penanda memberi kanal identitas kedua, sehingga
pengguna dengan buta warna total tetap dapat membedakan jenis.

---

## 4. Keterbatasan

1. **Jarak garis lurus, bukan jarak tempuh.** Tidak memperhitungkan jaringan jalan,
   hambatan geografis, atau moda transportasi.
2. **Fasilitas dari OpenStreetMap — data komunitas, bukan data resmi.** Tidak
   lengkap, tidak dijamin ketepatannya, dan tidak memuat kapasitas, jam operasional,
   atau jenis layanan. Jumlahnya cenderung **lebih rendah** dari kenyataan.
3. **Ketiga jenis utama disamakan bobotnya** dalam perhitungan jarak dan cakupan
   "jenis apa pun". Padahal rumah sakit, klinik, dan apotek memiliki peran yang
   sangat berbeda. Filter jenis disediakan untuk memisahkannya.
4. **Satu titik pusat mewakili seluruh wilayah.** Wilayah luas dan memanjang kurang
   terwakili; gunakan gambar cakupan grid untuk melihat sebarannya.
5. **Cakupan berbasis grid mendekati persentase luas, bukan persentase penduduk.**
   Tidak ada pembobotan kepadatan pada perhitungan cakupan.
6. **Angka penduduk belum terisi** pada versi ini, sehingga kepadatan, rasio
   fasilitas, dan skor prioritas belum dapat dihitung.
7. **Batas wilayah dari OSM dapat berbeda sedikit dari batas resmi pemerintah**,
   sehingga luas dan pemetaan fasilitas ke wilayah dapat berbeda tipis dari dokumen
   resmi.
8. **40 fasilitas (8,3%) tidak terpetakan ke wilayah mana pun.** Titik-titik ini
   berada di dalam kotak pembatas kota tetapi di luar semua poligon kecamatan/
   kelurahan — biasanya di tepi kota yang cakupan batas OSM-nya belum rapat.
   Fasilitas tetap disimpan dan dilaporkan jumlahnya, bukan dibuang diam-diam.

---

## 5. Memeriksa ulang hasil

Seluruh perhitungan berjalan di sisi klien (peramban pengguna). Tidak ada data yang
dikirim ke pihak ketiga, kecuali permintaan Overpass saat menjalankan skrip
pengambilan data.

```bash
npm install
npm run data:boundaries   # batas wilayah dari OSM
npm run data:facilities   # fasilitas dari OSM
npm run data:population   # template penduduk (angka diisi manual)
npm run data:build        # rakit dataset akhir
npm run data:validate     # periksa konsistensi dan kelengkapan
npm test                  # 184 tes unit
```

Respons mentah Overpass disimpan di `data/raw/` sehingga setiap angka dapat
menelusuri kembali ke sumbernya tanpa memanggil ulang jaringan:
`overpass-boundaries-raw.json` dan `overpass-facilities-raw.json`. Hapus berkas
tersebut untuk mengambil versi terbaru.

Validator (`data:validate`) memeriksa hal-hal yang membuat angka menyesatkan:
titik representatif yang jatuh di luar wilayahnya, fasilitas yang diklaim berada di
wilayah padahal koordinatnya di luar, ID wilayah kembar, kelurahan tanpa kecamatan
induk, luas di luar rentang wajar, dan angka penduduk di luar rentang masuk akal.
Validator mengembalikan kode keluar 1 bila menemukan masalah berat.

---

## 6. Sitasi dan atribusi

Bila hasil aplikasi ini dipakai dalam tulisan akademis, cantumkan:

> Data batas wilayah dan fasilitas kesehatan berasal dari © kontributor
> OpenStreetMap, berlisensi ODbL 1.0, diakses pada 28 September 2026 melalui
> Overpass API.

Sertakan juga daftar jenis fasilitas yang dipakai pada filter saat ekspor, dan
sebutkan bahwa aksesibilitas dihitung berdasarkan jarak garis lurus.

Atribusi OpenStreetMap bersifat **wajib** menurut lisensi ODbL 1.0 dan juga
ditampilkan di dalam aplikasi, bukan hanya di dokumentasi ini.