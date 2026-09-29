/**
 * Tes pemformatan angka.
 *
 * Yang dijaga di sini bukan sekadar kerapian tampilan, melainkan satuan.
 * Bobot prioritas disimpan sebagai rasio (0,4) sementara cakupan disimpan
 * sebagai persen (85,2). Keduanya pernah diformat dengan fungsi yang sama,
 * sehingga bobot terbaca "0,4%" padahal maksudnya 40%. Tes di bawah mengunci
 * pembedaan itu: `formatPercent` menerima persen, `formatRatioPercent`
 * menerima rasio dan mengalikannya sendiri.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_DATA,
  formatCompact,
  formatDate,
  formatDistance,
  formatNumber,
  formatPercent,
  formatRatioPercent,
  formatRank,
  formatSignedPercent,
  formatWithUnit,
  todayIso,
} from './format';

describe('formatNumber', () => {
  it('memakai pemisah ribuan gaya Indonesia', () => {
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('memakai koma sebagai pemisah desimal', () => {
    expect(formatNumber(1234.5, 1)).toBe('1.234,5');
  });

  it('menampilkan "data tidak tersedia" untuk null, bukan 0', () => {
    expect(formatNumber(null)).toBe(NO_DATA);
    expect(formatNumber(undefined)).toBe(NO_DATA);
  });

  it('menampilkan nol sebagai angka, bukan sebagai data hilang', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('menolak NaN dan Infinity', () => {
    expect(formatNumber(NaN)).toBe(NO_DATA);
    expect(formatNumber(Infinity)).toBe(NO_DATA);
  });
});

describe('formatWithUnit', () => {
  it('menambahkan satuan di belakang angka', () => {
    expect(formatWithUnit(1234, 'jiwa/km²')).toBe('1.234 jiwa/km²');
  });

  it('tidak menempelkan satuan pada data yang tidak tersedia', () => {
    expect(formatWithUnit(null, 'jiwa/km²')).toBe(NO_DATA);
  });
});

describe('formatCompact', () => {
  it('meringkas jutaan', () => {
    expect(formatCompact(2_500_000)).toBe('2,5 jt');
  });

  it('meringkas puluhan ribu', () => {
    expect(formatCompact(45_000)).toBe('45,0 rb');
  });

  it('membiarkan angka kecil apa adanya', () => {
    expect(formatCompact(950)).toBe('950');
  });
});

describe('formatPercent', () => {
  it('membaca nilainya sebagai persen, bukan rasio', () => {
    // 85,2 berarti 85,2% — bukan 8520%.
    expect(formatPercent(85.2)).toBe('85,2%');
  });

  it('tidak mengalikan nilai dengan 100', () => {
    expect(formatPercent(40)).toBe('40,0%');
  });

  it('menghormati jumlah desimal yang diminta', () => {
    expect(formatPercent(85.234, 2)).toBe('85,23%');
    expect(formatPercent(85.234, 0)).toBe('85%');
  });

  it('menampilkan "data tidak tersedia" untuk null', () => {
    expect(formatPercent(null)).toBe(NO_DATA);
  });

  it('menampilkan nol persen sebagai angka', () => {
    expect(formatPercent(0)).toBe('0,0%');
  });
});

describe('formatRatioPercent', () => {
  it('mengalikan rasio 0–1 menjadi persen', () => {
    expect(formatRatioPercent(0.852)).toBe('85,2%');
  });

  it('membaca bobot prioritas dengan benar', () => {
    // Inilah kesalahan yang pernah terjadi: bobot 0,4 terbaca "0,4%".
    expect(formatRatioPercent(0.4)).toBe('40,0%');
    expect(formatRatioPercent(0.35)).toBe('35,0%');
    expect(formatRatioPercent(0.25)).toBe('25,0%');
  });

  it('membedakan 0,4 dari 0,35 pada satu desimal tidak mungkin — pakai dua', () => {
    // Dengan satu desimal keduanya terbaca "40,0%" dan "35,0%": masih terbedakan.
    // Yang tidak terbedakan adalah 0,4 dan 0,44; itu batas wajar pembulatan.
    expect(formatRatioPercent(0.4, 1)).not.toBe(formatRatioPercent(0.35, 1));
  });

  it('menampilkan "data tidak tersedia" untuk null', () => {
    expect(formatRatioPercent(null)).toBe(NO_DATA);
  });

  it('menangani rasio nol', () => {
    expect(formatRatioPercent(0)).toBe('0,0%');
  });

  it('sepakat dengan formatPercent setelah dikalikan', () => {
    expect(formatRatioPercent(0.125)).toBe(formatPercent(12.5));
  });
});

describe('formatDistance', () => {
  it('memakai kilometer untuk jarak satu km ke atas', () => {
    expect(formatDistance(3.42)).toBe('3,42 km');
  });

  it('memakai meter untuk jarak di bawah satu km', () => {
    expect(formatDistance(0.42)).toBe('420 m');
  });

  it('menampilkan "data tidak tersedia" untuk null', () => {
    expect(formatDistance(null)).toBe(NO_DATA);
  });
});

describe('formatDate', () => {
  it('membaca tanggal ISO gaya Indonesia', () => {
    expect(formatDate('2026-09-28')).toBe('28 September 2026');
  });

  it('mengabaikan bagian jam pada cap waktu', () => {
    expect(formatDate('2026-09-28T10:30:00Z')).toBe('28 September 2026');
  });

  it('menolak teks yang bukan tanggal', () => {
    expect(formatDate('bukan tanggal')).toBe(NO_DATA);
    expect(formatDate('')).toBe(NO_DATA);
    expect(formatDate(null)).toBe(NO_DATA);
  });
});

describe('todayIso', () => {
  it('menghasilkan tanggal dengan bentuk YYYY-MM-DD', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('memakai tanggal lokal, bukan UTC', () => {
    // Bila memakai UTC, pengguna di WIB akan melihat tanggal kemarin pada
    // dini hari. Selisihnya harus nol terhadap tanggal lokal peranti.
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    expect(todayIso()).toBe(local.toISOString().slice(0, 10));
  });
});

describe('formatRank', () => {
  it('menyebut peringkat dan jumlah total', () => {
    expect(formatRank(3, 154)).toBe('Peringkat 3 dari 154');
  });
});

describe('formatSignedPercent', () => {
  it('menambahkan tanda plus untuk nilai positif', () => {
    expect(formatSignedPercent(12.5)).toBe('+12,5%');
  });

  it('membiarkan tanda minus apa adanya', () => {
    expect(formatSignedPercent(-3.2)).toBe('-3,2%');
  });

  it('tidak menambahkan tanda untuk nol', () => {
    expect(formatSignedPercent(0)).toBe('0,0%');
  });

  it('menampilkan "data tidak tersedia" untuk null', () => {
    expect(formatSignedPercent(null)).toBe(NO_DATA);
  });
});
