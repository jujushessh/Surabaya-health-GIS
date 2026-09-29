/**
 * Halaman Metodologi — penjelasan cara angka dihitung, dan batasannya.
 *
 * Halaman ini disusun agar dapat dicetak apa adanya dan dilampirkan pada
 * tulisan akademis. Karena itu setiap rumus ditulis lengkap, setiap sumber
 * disebut dengan lisensinya, dan setiap keterbatasan dinyatakan terbuka
 * alih-alih disembunyikan di balik catatan kaki.
 */

import { useMemo } from 'react';

import { useStore } from '../store/DataProvider';
import { Notice } from '../components/ui';
import { DEFAULT_WEIGHTS } from '../lib/priority';
import { COVERAGE_RADII_KM } from '../lib/access';
import { formatNumber, formatRatioPercent, NO_DATA } from '../lib/format';
import { GRID_STEP_KM, MAX_CHOROPLETH_CLASSES } from '../lib/constants';
import { IconPrint } from '../components/icons';

export function MethodologyPage() {
  const { data, metrics, settings } = useStore();

  const bundle = data.bundle;

  /** Angka nyata dari dataset yang sedang dipakai, bukan contoh di dokumentasi. */
  const facts = useMemo(() => {
    if (!bundle) return null;
    const kecamatan = bundle.regions.filter((region) => region.level === 'kecamatan');
    const kelurahan = bundle.regions.filter((region) => region.level === 'kelurahan');
    const withPopulation = bundle.regions.filter((region) => region.population !== null);

    return {
      kecamatan: kecamatan.length,
      kelurahan: kelurahan.length,
      facilities: bundle.facilities.length,
      withPopulation: withPopulation.length,
      // Jumlah sampel titik untuk perhitungan cakupan. Diambil dari tabel
      // metrik per wilayah, bukan dari daftar wilayah, karena jumlah sampel
      // dihitung saat analisis aksesibilitas berjalan.
      samplePoints:
        metrics === null
          ? 0
          : [...metrics.byId.values()].reduce(
              (total, entry) => total + entry.access.samplePoints,
              0,
            ),
    };
  }, [bundle, metrics]);

  if (!bundle || !facts) return null;

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h2 className="page__title">Metodologi dan keterbatasan</h2>
          <p className="page__lede">
            Seluruh perhitungan berjalan di dalam peramban menggunakan fungsi murni yang dapat
            diuji. Tidak ada angka yang diketik manual ke dalam antarmuka, dan tidak ada data yang
            dikirim ke pihak ketiga.
          </p>
        </div>
        <button type="button" className="btn btn--sm no-print" onClick={() => window.print()}>
          <IconPrint size={15} />
          Cetak halaman ini
        </button>
      </header>

      <Notice tone="warning" title="Baca ini lebih dahulu">
        <p>
          Seluruh ukuran aksesibilitas di aplikasi ini adalah <strong>jarak garis lurus</strong>{' '}
          (jarak udara), bukan jarak tempuh atau waktu tempuh. Dua titik yang berjarak 1 km lurus
          dapat terpisah 5 km jalan karena sungai, rel kereta, atau jalan buntu. Angka di sini
          berguna untuk membandingkan wilayah satu sama lain, <em>bukan</em> untuk menyatakan
          berapa lama seseorang benar-benar sampai ke fasilitas kesehatan.
        </p>
      </Notice>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <h3 className="card__title">1. Data yang dipakai</h3>
        </div>
        <div className="card__body">
          <table className="data">
            <caption className="sr-only">Ringkasan cakupan dataset yang sedang dipakai</caption>
            <tbody>
              <tr>
                <th scope="row">Wilayah kecamatan</th>
                <td className="num">{formatNumber(facts.kecamatan)}</td>
              </tr>
              <tr>
                <th scope="row">Wilayah kelurahan</th>
                <td className="num">{formatNumber(facts.kelurahan)}</td>
              </tr>
              <tr>
                <th scope="row">Fasilitas kesehatan</th>
                <td className="num">{formatNumber(facts.facilities)}</td>
              </tr>
              <tr>
                <th scope="row">Wilayah yang sudah punya angka penduduk</th>
                <td className="num">
                  {formatNumber(facts.withPopulation)} dari{' '}
                  {formatNumber(bundle.regions.length)}{' '}
                  {facts.withPopulation === bundle.regions.length ? null : (
                    <span className="stat__note">
                      ({formatRatioPercent(facts.withPopulation / bundle.regions.length)})
                    </span>
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">Titik sampel untuk perhitungan cakupan</th>
                <td className="num">{formatNumber(facts.samplePoints)}</td>
              </tr>
            </tbody>
          </table>

          <p className="prose">
            Batas wilayah dan lokasi fasilitas berasal dari OpenStreetMap. Jumlah penduduk berasal
            dari publikasi Badan Pusat Statistik dan diisi melalui berkas terpisah, sehingga tahun
            rujukannya dapat dicatat dan diperiksa per wilayah. Daftar lengkap beserta lisensi dan
            tanggal aksesnya ada di halaman <strong>Data</strong>.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <h3 className="card__title">2. Cara setiap angka dihitung</h3>
          <div className="card__subtitle">
            Rumus ditulis lengkap supaya hasilnya dapat diperiksa ulang secara independen.
          </div>
        </div>

        <div className="card__body">
          <MethodBlock
            title="Kepadatan penduduk"
            unit="jiwa/km²"
          >
            <Formula>kepadatan = jumlah penduduk ÷ luas wilayah</Formula>
            <p>
              Luas wilayah dihitung dari geometri poligon memakai rumus luas pada bola, bukan dari
              angka luas yang diterbitkan. Selisih antara keduanya ditampilkan sebagai pemeriksaan
              mutu; selisih di atas 2% dicatat pada halaman Data.
            </p>
            <p className="method__note">
              Nilai ini tidak dapat dihitung untuk wilayah yang angka penduduknya belum tersedia,
              dan ditampilkan sebagai <em>{NO_DATA}</em> — bukan 0. Beda antara keduanya penting:
              nol berarti terukur dan hasilnya nol.
            </p>
          </MethodBlock>

          <MethodBlock title="Rasio fasilitas per 1.000 penduduk" unit="fasilitas/1.000 jiwa">
            <Formula>rasio = (jumlah fasilitas ÷ jumlah penduduk) × 1.000</Formula>
            <p>
              Pembilang mengikuti filter jenis fasilitas yang sedang aktif, sehingga angkanya
              konsisten dengan peta dan tabel di halaman lain.
            </p>
            <p className="method__note">
              Rasio ini mengukur <em>ketersediaan</em>, bukan keterjangkauan. Wilayah dengan rasio
              tinggi tetap bisa sulit dijangkau bila fasilitasnya menumpuk di satu sudut. Karena
              itu ukuran ini harus dibaca bersama jarak dan cakupan, bukan sendiri-sendiri.
            </p>
          </MethodBlock>

          <MethodBlock title="Jarak ke fasilitas terdekat" unit="km">
            <Formula>
              d = 2R · arcsin( √( sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2) ) ), R = 6371,0088 km
            </Formula>
            <p>
              Jarak dihitung dengan rumus haversine dari <strong>titik representatif</strong> tiap
              wilayah ke fasilitas terdekat. Titik representatif dipilih dijamin berada di dalam
              poligon wilayah, bukan sekadar titik tengah kotak pembatasnya — untuk wilayah
              berbentuk cembung, titik tengah dapat jatuh di luar wilayah dan membuat seluruh
              perhitungan jarak melenceng tanpa gejala yang terlihat.
            </p>
            <p className="method__note">
              Satu titik per wilayah tentu menyederhanakan kenyataan: wilayah yang panjang dan
              sempit diwakili satu titik saja. Karena itu disediakan pula ukuran cakupan di bawah,
              yang memakai banyak titik.
            </p>
          </MethodBlock>

          <MethodBlock title="Cakupan radius" unit="%">
            <Formula>
              cakupan(r) = jumlah titik sampel yang berjarak ≤ r dari fasilitas mana pun ÷ jumlah
              seluruh titik sampel × 100%
            </Formula>
            <p>
              Titik sampel disebar pada grid teratur berjarak {GRID_STEP_KM} km di dalam poligon
              setiap wilayah, dibatasi maksimum 600 titik per wilayah agar tetap cepat di peramban.
              Radius yang dihitung: {COVERAGE_RADII_KM.map((r) => `${r} km`).join(', ')}.
            </p>
            <p className="method__note">
              Karena sampelnya tersebar merata di atas wilayah, angka ini mendekati{' '}
              <em>persentase luas</em> yang tercakup, bukan persentase penduduk. Tanpa sebaran
              penduduk per blok, keduanya tidak dapat disamakan. Wilayah yang sangat padat di satu
              sisi dapat memperoleh cakupan tinggi meskipun bagian terbesar warganya di luar
              radius.
            </p>
          </MethodBlock>

          <MethodBlock title="Skor prioritas" unit="skor 0–100">
            <Formula>
              skor = 100 × ( w₁·Z(kepadatan) + w₂·Z(kelangkaan fasilitas) + w₃·Z(jarak) ) ÷ (w₁ +
              w₂ + w₃)
            </Formula>
            <p>
              Setiap komponen diubah lebih dahulu menjadi skor-z, lalu dipetakan ke rentang 0–1
              dengan pembatasan pada ±2,5 simpangan baku. Pembatasan ini disengaja: tanpa itu, satu
              wilayah yang ekstrem dapat menarik seluruh skala sehingga wilayah lain tampak seragam.
            </p>
            <p>
              Kelangkaan fasilitas adalah kebalikan dari rasio fasilitas, sehingga rasio rendah
              menghasilkan skor tinggi. Bobot bawaan:{' '}
              <strong>kepadatan {formatRatioPercent(DEFAULT_WEIGHTS.density)}</strong>,{' '}
              <strong>kelangkaan {formatRatioPercent(DEFAULT_WEIGHTS.scarcity)}</strong>,{' '}
              <strong>jarak {formatRatioPercent(DEFAULT_WEIGHTS.distance)}</strong>. Bobot ini dapat
              diubah di halaman Analisis dan tidak tersembunyi di dalam kode.
            </p>
            <p className="method__note">
              Bobot dinormalisasi ulang di atas komponen yang tersedia saja. Bila angka penduduk
              belum ada untuk suatu wilayah, komponen kepadatan dan kelangkaan dikeluarkan dari
              hitungan wilayah itu dan sisa bobotnya dibagi proporsional. Wilayah seperti itu
              ditandai, dan komponen yang tidak dipakai dicantumkan pada panel rinciannya — skornya
              tidak boleh dibandingkan langsung dengan wilayah yang komponennya lengkap.
            </p>
          </MethodBlock>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <h3 className="card__title">3. Pengelompokan kelas pada peta</h3>
        </div>
        <div className="card__body">
          <p className="prose">
            Warna pada peta memakai satu hue dengan tingkat kecerahan bertingkat, dari terang
            (nilai rendah) ke gelap (nilai tinggi). Satu hue dipakai karena warnanya menyatakan{' '}
            <em>besar-kecil</em>, bukan jenis. Maksimum {MAX_CHOROPLETH_CLASSES} kelas, dan batas
            kelasnya selalu ditampilkan pada legenda.
          </p>
          <p className="prose">
            Dua metode tersedia dan hasilnya berbeda, jadi sebutkan yang mana yang dipakai:
          </p>
          <ul className="prose-list">
            <li>
              <strong>Kuantil</strong> — setiap kelas berisi jumlah wilayah yang sama. Baik untuk
              membandingkan peringkat, tetapi batas kelas bisa sangat rapat di wilayah yang
              nilainya berdekatan, sehingga perbedaan kecil tampak dramatis.
            </li>
            <li>
              <strong>Natural breaks (Jenks)</strong> — batas kelas diletakkan pada celah alami
              data. Baik untuk melihat pola sebaran, tetapi kelas dapat menjadi sangat tidak
              seimbang (satu kelas berisi satu wilayah).
            </li>
          </ul>
          <p className="prose">
            Wilayah yang nilainya tidak tersedia digambar dengan garis putus-putus abu-abu, bukan
            dengan warna kelas paling terang. Ini disengaja: kalau digambar seperti nilai rendah,{' '}
            <em>tidak ada data</em> akan terbaca sebagai <em>nilainya kecil</em>.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <h3 className="card__title">4. Keterbatasan yang harus disebutkan</h3>
        </div>
        <div className="card__body">
          <ol className="limits">
            <li>
              <strong>Jarak garis lurus, bukan jarak tempuh.</strong> Tidak ada jaringan jalan,
              waktu tempuh, biaya, atau moda angkutan dalam perhitungan ini. Sungai dan rel kereta
              tidak dianggap sebagai penghalang.
            </li>
            <li>
              <strong>Fasilitas dari pemetaan komunitas.</strong> OpenStreetMap tidak lengkap dan
              tidak resmi. Fasilitas yang belum dipetakan tidak muncul sama sekali, sehingga
              wilayah dapat tampak kekurangan fasilitas padahal hanya kurang terdata. Tidak ada
              informasi kapasitas, jam buka, jenis layanan, atau apakah fasilitas masih beroperasi.
            </li>
            <li>
              <strong>Ketiga jenis fasilitas disamakan bobotnya.</strong> Rumah sakit, klinik, dan
              apotek dihitung setara, padahal kemampuan layanannya sangat berbeda. Rasio dan
              cakupan tidak membedakan tingkat rujukan.
            </li>
            <li>
              <strong>Satu titik pusat per wilayah.</strong> Ukuran jarak terdekat mengasumsikan
              seluruh wilayah diwakili titik pusatnya, sehingga tidak menangkap ketidakmerataan
              di dalam wilayah.
            </li>
            <li>
              <strong>Cakupan diukur dari sampel grid, bukan dari sebaran penduduk.</strong> Angka
              cakupan mendekati persentase luas, bukan persentase warga.
            </li>
            <li>
              <strong>Tahun data penduduk bisa tidak sama antar wilayah</strong> bila diisi dari
              publikasi yang berbeda. Tahun rujukan disimpan dan ditampilkan per wilayah agar
              ketidakseragaman ini terlihat, bukan tersembunyi.
            </li>
            <li>
              <strong>Batas wilayah dari OpenStreetMap dapat berbeda</strong> dari batas
              administratif resmi, terutama pada wilayah yang berbatasan dengan kabupaten lain atau
              di pesisir.
            </li>
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="card">
        <div className="card__header">
          <h3 className="card__title">5. Cara mengutip hasil ini</h3>
        </div>
        <div className="card__body">
          <p className="prose">
            Saat melaporkan hasil, sebutkan minimal: sumber batas wilayah dan tanggal aksesnya,
            sumber angka penduduk beserta tahunnya, daftar jenis fasilitas yang disertakan pada
            filter, metode pengelompokan kelas, dan bobot skor prioritas yang dipakai. Semua nilai
            tersebut dapat diunduh sebagai CSV dari halaman Data atau Analisis dengan filter yang
            sedang aktif.
          </p>
          <Notice tone="info" title="Atribusi yang wajib dicantumkan">
            <p>
              Data peta berasal dari © kontributor OpenStreetMap, berlisensi ODbL. Sertakan
              atribusi ini pada setiap peta atau tabel turunan yang dipublikasikan. Ubin peta dasar
              juga memiliki ketentuan atribusinya masing-masing dan sudah dicantumkan di sudut peta.
            </p>
          </Notice>

          <div className="meta-line">
            Skema data <code>{bundle.version}</code>
            {bundle.generatedAt ? (
              <>
                {' · '}dirakit {bundle.generatedAt.slice(0, 10)}
              </>
            ) : null}
            {' · '}filter aktif: {settings.kinds.length} jenis fasilitas, level {settings.level}
          </div>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Potongan tampilan                                                          */
/* -------------------------------------------------------------------------- */

function MethodBlock({
  title,
  unit,
  children,
}: {
  title: string;
  unit: string;
  children: React.ReactNode;
}) {
  return (
    <article className="method">
      <header className="method__head">
        <h4 className="method__title">{title}</h4>
        <span className="method__unit">{unit}</span>
      </header>
      <div className="method__body">{children}</div>
    </article>
  );
}

/** Rumus ditampilkan sebagai blok tersendiri agar mudah disalin ke naskah. */
function Formula({ children }: { children: React.ReactNode }) {
  return <pre className="formula">{children}</pre>;
}