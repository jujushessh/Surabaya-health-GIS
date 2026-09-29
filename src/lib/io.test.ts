/**
 * Tes impor dan ekspor data.
 *
 * Prinsip yang dijaga: impor yang gagal tidak boleh merusak data yang sudah ada,
 * dan berkas yang bermasalah harus dilaporkan per baris — bukan gagal diam-diam
 * atau, lebih buruk, diterima sebagian tanpa pemberitahuan.
 */

import { describe, expect, it } from 'vitest';
import {
  csvCell,
  describeIssues,
  importBoundariesGeojson,
  importFacilitiesCsv,
  importPopulationCsv,
  parseCsv,
  stripBom,
  tableFromCsv,
  toCsv,
} from './io';
import { CITY_BBOX } from './constants';
import type { BBox, Region } from '../types';

const BBOX: BBox = CITY_BBOX;

describe('stripBom', () => {
  it('membuang BOM di awal teks', () => {
    expect(stripBom('﻿name,kind')).toBe('name,kind');
  });

  it('membiarkan teks tanpa BOM apa adanya', () => {
    expect(stripBom('name,kind')).toBe('name,kind');
  });

  it('tidak membuang karakter di tengah', () => {
    expect(stripBom('a﻿b')).toBe('a﻿b');
  });
});

describe('parseCsv', () => {
  it('memisah baris dan kolom', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('menghormati koma di dalam tanda kutip', () => {
    expect(parseCsv('name,address\n"RS A","Jl. X No. 1, Surabaya"')).toEqual([
      ['name', 'address'],
      ['RS A', 'Jl. X No. 1, Surabaya'],
    ]);
  });

  it('mendukung kutip ganda yang di-escape', () => {
    expect(parseCsv('a\n"kata ""kutip"" di sini"')).toEqual([['a'], ['kata "kutip" di sini']]);
  });

  it('menerima pemisah titik koma', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('menangani akhir baris CRLF', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('membuang baris kosong', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('membuang BOM di awal berkas', () => {
    expect(parseCsv('﻿a,b\n1,2')[0]).toEqual(['a', 'b']);
  });
});

describe('tableFromCsv', () => {
  it('memakai header sebagai kunci dan menormalkan huruf', () => {
    const table = tableFromCsv('Name,Kind\nRS A,hospital');
    expect(table.headers).toEqual(['name', 'kind']);
    expect(table.rows[0]).toEqual({ name: 'RS A', kind: 'hospital' });
  });

  it('mengisi kolom yang hilang dengan string kosong', () => {
    const table = tableFromCsv('a,b,c\n1,2');
    expect(table.rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('mengembalikan hasil kosong untuk teks kosong', () => {
    expect(tableFromCsv('')).toEqual({ headers: [], rows: [] });
  });

  it('merapikan spasi di ujung nilai', () => {
    const table = tableFromCsv('a\n  nilai  ');
    expect(table.rows[0].a).toBe('nilai');
  });
});

describe('csvCell', () => {
  it('membiarkan nilai biasa apa adanya', () => {
    expect(csvCell('RSUD')).toBe('RSUD');
  });

  it('mengapit nilai yang mengandung koma', () => {
    expect(csvCell('Jl. X, Surabaya')).toBe('"Jl. X, Surabaya"');
  });

  it('menggandakan tanda kutip di dalam nilai', () => {
    expect(csvCell('nama "khusus"')).toBe('"nama ""khusus"""');
  });

  it('menetralkan formula agar tidak dieksekusi spreadsheet', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('+cmd')).toBe('"\'+cmd"');
    expect(csvCell('-2+3')).toBe('"\'-2+3"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
  });

  it('mengubah nilai kosong menjadi string kosong', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('mengapit nilai yang mengandung baris baru', () => {
    expect(csvCell('baris1\nbaris2')).toBe('"baris1\nbaris2"');
  });
});

describe('toCsv', () => {
  it('menyisipkan BOM agar Excel membaca UTF-8', () => {
    expect(toCsv(['a'], [['1']]).charCodeAt(0)).toBe(0xfeff);
  });

  it('memakai akhir baris CRLF', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toContain('\r\n');
  });

  it('menulis header lalu baris data', () => {
    const csv = toCsv(['x', 'y'], [['1', '2']]);
    const lines = stripBom(csv).split('\r\n');
    expect(lines[0]).toBe('x,y');
    expect(lines[1]).toBe('1,2');
  });

  it('dapat dibaca kembali oleh parseCsv', () => {
    const csv = toCsv(['name', 'address'], [['RS A', 'Jl. X, Surabaya']]);
    const rows = parseCsv(csv);
    expect(rows[1]).toEqual(['RS A', 'Jl. X, Surabaya']);
  });
});

describe('importFacilitiesCsv', () => {
  const HEADER = 'id,name,kind,lat,lon,address,phone,operator,beds';

  it('menerima berkas yang sah', () => {
    const csv = `${HEADER}\nrs-1,RSUD A,hospital,-7.2458,112.7378,Jl. A,031-1,Pemkot,250`;
    const result = importFacilitiesCsv(csv, BBOX);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('RSUD A');
    expect(result.data[0].kind).toBe('hospital');
    expect(result.data[0].beds).toBe(250);
  });

  it('menolak berkas tanpa kolom wajib dan menyebut kolom yang terbaca', () => {
    const result = importFacilitiesCsv('foo,bar\n1,2', BBOX);
    expect(result.ok).toBe(false);
    expect(result.data).toEqual([]);
    expect(result.issues[0].message).toContain('name');
    expect(result.issues[0].message).toContain('foo');
  });

  it('menolak jenis fasilitas yang tidak dikenal', () => {
    const csv = `${HEADER}\nx,RS A,rumahsakit,-7.2458,112.7378,,,,`;
    const result = importFacilitiesCsv(csv, BBOX);
    expect(result.ok).toBe(false);
    expect(result.issues[0].field).toBe('kind');
  });

  it('menolak koordinat di luar batas kota', () => {
    const csv = `${HEADER}\nx,RS Jauh,hospital,-6.2,106.8,,,,`;
    const result = importFacilitiesCsv(csv, BBOX);
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('di luar batas');
  });

  it('menolak koordinat bukan angka', () => {
    const csv = `${HEADER}\nx,RS A,hospital,abc,def,,,,`;
    const result = importFacilitiesCsv(csv, BBOX);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('bukan angka'))).toBe(true);
  });

  it('menolak ID yang muncul lebih dari sekali', () => {
    const csv = [
      HEADER,
      'rs-1,RS A,hospital,-7.2458,112.7378,,,,',
      'rs-1,RS B,hospital,-7.246,112.738,,,,',
    ].join('\n');
    const result = importFacilitiesCsv(csv, BBOX);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('lebih dari sekali'))).toBe(true);
  });

  it('membuat ID otomatis bila kolom id kosong', () => {
    const csv = `${HEADER}\n,RS Tanpa Id,hospital,-7.2458,112.7378,,,,`;
    const result = importFacilitiesCsv(csv, BBOX);
    expect(result.ok).toBe(true);
    expect(result.data[0].id).not.toBe('');
    expect(result.data[0].id.startsWith('imp-')).toBe(true);
  });

  it('membuang baris cacat tanpa menggagalkan baris yang benar', () => {
    const csv = [
      HEADER,
      'rs-1,RS A,hospital,-7.2458,112.7378,,,,',
      'rs-2,,hospital,-7.246,112.738,,,,', // nama kosong
      'rs-3,RS C,hospital,-7.247,112.739,,,,',
    ].join('\n');
    const result = importFacilitiesCsv(csv, BBOX);
    expect(result.ok).toBe(false);
    expect(result.data.map((f) => f.id)).toEqual(['rs-1', 'rs-3']);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].row).toBe(2);
  });

  it('mengabaikan beds negatif', () => {
    const csv = `${HEADER}\nx,RS A,hospital,-7.2458,112.7378,,,,−5`;
    const result = importFacilitiesCsv(csv.replace('−5', '-5'), BBOX);
    expect(result.ok).toBe(true);
    expect(result.data[0].beds).toBeUndefined();
  });

  it('menerima koordinat di dalam batas meski di tepi', () => {
    const csv = `${HEADER}\nx,RS Tepi,hospital,${BBOX.minLat},${BBOX.minLon},,,,`;
    const result = importFacilitiesCsv(csv, BBOX);
    expect(result.ok).toBe(true);
  });
});

describe('importPopulationCsv', () => {
  const regions: Region[] = [
    {
      id: 'kec-gubeng',
      name: 'Gubeng',
      level: 'kecamatan',
      parentId: null,
      parentName: null,
      population: null,
      populationYear: null,
      areaKm2: null,
      areaOfficialKm2: null,
      centroid: { lat: -7.26, lon: 112.75 },
      bbox: { minLat: -7.3, minLon: 112.7, maxLat: -7.2, maxLon: 112.8 },
      geometry: { type: 'Polygon', coordinates: [[]] },
      notes: [],
    },
    {
      id: 'kel-airlangga',
      name: 'Airlangga',
      level: 'kelurahan',
      parentId: 'kec-gubeng',
      parentName: 'Gubeng',
      population: null,
      populationYear: null,
      areaKm2: null,
      areaOfficialKm2: null,
      centroid: { lat: -7.26, lon: 112.75 },
      bbox: { minLat: -7.3, minLon: 112.7, maxLat: -7.2, maxLon: 112.8 },
      geometry: { type: 'Polygon', coordinates: [[]] },
      notes: [],
    },
    {
      id: 'kel-wonorejo-rungkut',
      name: 'Wonorejo',
      level: 'kelurahan',
      parentId: 'kec-rungkut',
      parentName: 'Rungkut',
      population: null,
      populationYear: null,
      areaKm2: null,
      areaOfficialKm2: null,
      centroid: { lat: -7.3, lon: 112.8 },
      bbox: { minLat: -7.35, minLon: 112.75, maxLat: -7.25, maxLon: 112.85 },
      geometry: { type: 'Polygon', coordinates: [[]] },
      notes: [],
    },
    {
      id: 'kel-wonorejo-tegalsari',
      name: 'Wonorejo',
      level: 'kelurahan',
      parentId: 'kec-tegalsari',
      parentName: 'Tegalsari',
      population: null,
      populationYear: null,
      areaKm2: null,
      areaOfficialKm2: null,
      centroid: { lat: -7.27, lon: 112.73 },
      bbox: { minLat: -7.3, minLon: 112.7, maxLat: -7.25, maxLon: 112.78 },
      geometry: { type: 'Polygon', coordinates: [[]] },
      notes: [],
    },
  ];

  it('menyocokkan nama wilayah tanpa membedakan huruf besar/kecil', () => {
    const result = importPopulationCsv('wilayah,penduduk\nGUBENG,100000', regions);
    expect(result.ok).toBe(true);
    expect(result.data[0].regionId).toBe('kec-gubeng');
    expect(result.data[0].population).toBe(100000);
  });

  it('mengabaikan awalan "Kecamatan"/"Kelurahan" pada nama', () => {
    const result = importPopulationCsv('wilayah,penduduk\nKecamatan Gubeng,100000', regions);
    expect(result.ok).toBe(true);
    expect(result.data[0].regionId).toBe('kec-gubeng');
  });

  it('membaca tahun dan luas bila ada', () => {
    const result = importPopulationCsv('wilayah,penduduk,tahun,luas_km2\nGubeng,100000,2023,7.5', regions);
    expect(result.data[0].year).toBe(2023);
    expect(result.data[0].areaKm2).toBe(7.5);
  });

  it('memberi null untuk tahun dan luas bila kosong', () => {
    const result = importPopulationCsv('wilayah,penduduk,tahun,luas_km2\nGubeng,100000,,', regions);
    expect(result.data[0].year).toBeNull();
    expect(result.data[0].areaKm2).toBeNull();
  });

  it('menolak wilayah yang tidak ada dan menyebut namanya', () => {
    const result = importPopulationCsv('wilayah,penduduk\nKecamatan Fiktif,1', regions);
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('Fiktif');
  });

  it('meminta kolom level ketika nama wilayah ambigu', () => {
    const result = importPopulationCsv('wilayah,penduduk\nWonorejo,5000', regions);
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('ditemukan di 2 wilayah');
  });

  it('membedakan nama kembar memakai kolom kecamatan_induk', () => {
    const result = importPopulationCsv(
      'wilayah,kecamatan_induk,penduduk\nWonorejo,Rungkut,5000',
      regions,
    );
    expect(result.ok).toBe(true);
    expect(result.data[0].regionId).toBe('kel-wonorejo-rungkut');
  });

  it('membedakan nama kembar memakai awalan Kecamatan', () => {
    const result = importPopulationCsv(
      'wilayah,kecamatan_induk,penduduk\nWonorejo,Kecamatan Tegalsari,6000',
      regions,
    );
    expect(result.ok).toBe(true);
    expect(result.data[0].regionId).toBe('kel-wonorejo-tegalsari');
  });

  it('tetap melaporkan ambigu bila kecamatan_induk tidak cocok', () => {
    const result = importPopulationCsv(
      'wilayah,kecamatan_induk,penduduk\nWonorejo,Kecamatan Fiktif,5000',
      regions,
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('ditemukan di 2 wilayah');
  });

  it('menerima nama yang ambigu bila kolom level diisi', () => {
    const withLevel = importPopulationCsv('wilayah,level,penduduk\nWonorejo,kelurahan,5000', regions);
    // Dua kelurahan Wonorejo tetap ambigu → harus diminta dibedakan lebih lanjut.
    expect(withLevel.ok).toBe(false);
    expect(withLevel.issues[0].message).toContain('ditemukan di 2 wilayah');
  });

  it('memilih wilayah yang benar ketika namanya unik pada level itu', () => {
    const result = importPopulationCsv('wilayah,level,penduduk\nAirlangga,kelurahan,20000', regions);
    expect(result.ok).toBe(true);
    expect(result.data[0].regionId).toBe('kel-airlangga');
  });

  it('menolak angka penduduk negatif', () => {
    const result = importPopulationCsv('wilayah,penduduk\nGubeng,-5', regions);
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('negatif');
  });

  it('menolak angka penduduk yang bukan angka', () => {
    const result = importPopulationCsv('wilayah,penduduk\nGubeng,banyak', regions);
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('bukan angka');
  });

  it('menolak wilayah yang muncul dua kali dalam satu berkas', () => {
    const result = importPopulationCsv('wilayah,penduduk\nGubeng,1\nGubeng,2', regions);
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('lebih dari sekali');
  });

  it('menolak berkas tanpa kolom wajib', () => {
    const result = importPopulationCsv('nama,jumlah\nGubeng,1', regions);
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('wilayah');
  });

  it('mengembalikan data kosong bila seluruh baris cacat', () => {
    const result = importPopulationCsv('wilayah,penduduk\nFiktif,1\nGubeng,x', regions);
    expect(result.ok).toBe(false);
    expect(result.data).toEqual([]);
  });
});

describe('importBoundariesGeojson', () => {
  const feature = (overrides: Record<string, unknown> = {}) => ({
    type: 'Feature',
    properties: { name: 'Gubeng', level: 'kecamatan', ...overrides },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [112.7, -7.3],
          [112.8, -7.3],
          [112.8, -7.2],
          [112.7, -7.2],
          [112.7, -7.3],
        ],
      ],
    },
  });

  it('membaca FeatureCollection yang sah', () => {
    const text = JSON.stringify({ type: 'FeatureCollection', features: [feature()] });
    const result = importBoundariesGeojson(text);
    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Gubeng');
    expect(result.data[0].level).toBe('kecamatan');
  });

  it('menolak JSON yang rusak dengan pesan yang jelas', () => {
    const result = importBoundariesGeojson('{bukan json');
    expect(result.ok).toBe(false);
    expect(result.data).toEqual([]);
    expect(result.issues[0].message).toContain('bukan JSON');
  });

  it('menolak JSON yang sah tetapi bukan FeatureCollection', () => {
    const result = importBoundariesGeojson(JSON.stringify({ type: 'Feature' }));
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('FeatureCollection');
  });

  it('menolak geometri yang bukan poligon', () => {
    const bad = { type: 'FeatureCollection', features: [{ ...feature(), geometry: { type: 'Point', coordinates: [112.7, -7.3] } }] };
    const result = importBoundariesGeojson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toContain('Polygon');
  });

  it('menolak fitur tanpa nama', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [feature({ name: '' })],
    });
    const result = importBoundariesGeojson(text);
    expect(result.ok).toBe(false);
    expect(result.issues[0].field).toBe('name');
  });

  it('menolak ID ganda', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [feature({ id: 'sama' }), feature({ id: 'sama', name: 'Lain' })],
    });
    const result = importBoundariesGeojson(text);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('lebih dari sekali'))).toBe(true);
  });

  it('membaca nama wilayah dengan kunci alternatif', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { nama: 'Airlangga' },
          geometry: feature().geometry,
        },
      ],
    });
    const result = importBoundariesGeojson(text);
    expect(result.data[0].name).toBe('Airlangga');
  });

  it('membaca angka penduduk bila disertakan', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [feature({ population: 100000, population_year: 2023 })],
    });
    const result = importBoundariesGeojson(text);
    expect(result.data[0].population).toBe(100000);
    expect(result.data[0].populationYear).toBe(2023);
  });

  it('membiarkan penduduk kosong sebagai null, bukan nol', () => {
    const text = JSON.stringify({ type: 'FeatureCollection', features: [feature()] });
    const result = importBoundariesGeojson(text);
    expect(result.data[0].population).toBeNull();
  });

  it('membuang BOM pada berkas GeoJSON', () => {
    const text = `﻿${JSON.stringify({ type: 'FeatureCollection', features: [feature()] })}`;
    const result = importBoundariesGeojson(text);
    expect(result.ok).toBe(true);
  });
});

describe('describeIssues', () => {
  it('mengembalikan string kosong bila tidak ada masalah', () => {
    expect(describeIssues([])).toBe('');
  });

  it('menyebut nomor baris dan nama kolom', () => {
    const text = describeIssues([{ row: 3, field: 'lat', message: 'bukan angka' }]);
    expect(text).toContain('Baris 3');
    expect(text).toContain('lat');
    expect(text).toContain('bukan angka');
  });

  it('memakai "Berkas" untuk masalah tingkat berkas (baris 0)', () => {
    expect(describeIssues([{ row: 0, message: 'kolom kurang' }])).toContain('Berkas');
  });

  it('meringkas daftar yang panjang', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ row: i + 1, message: 'x' }));
    const text = describeIssues(many, 6);
    expect(text).toContain('dan 4 masalah lain');
  });
});