/**
 * Alat bantu: mencari ID relasi batas administratif yang benar.
 *
 * Skrip pengambilan batas butuh ID relasi yang tepat, dan ID tersebut tidak
 * bisa ditebak: angka yang terlihat masuk akal bisa saja menunjuk ke relasi
 * lain yang sama sekali tidak berkaitan (pernah terjadi — relasi yang dicoba
 * hanya mengembalikan 45 elemen). Skrip ini menanyakan langsung ke Overpass
 * relasi apa saja yang ada pada tingkat administratif tertentu di sekitar
 * Kota Surabaya, lalu menampilkan jumlah anggota tiap relasi sebagai penanda
 * apakah relasi itu memang batas wilayah yang sesungguhnya.
 *
 * Jalankan: node scripts/find-boundary-relation.mjs
 */

import { overpass, OVERPASS_ENDPOINTS } from './lib/osm.mjs';
import { heading, info, warn, fail } from './lib/io.mjs';

heading('Mencari relasi batas administratif Kota Surabaya');

const QUERIES = [
  {
    label: 'admin_level 5 (kota) dengan nama mengandung "Surabaya"',
    query: `
      [out:json][timeout:180];
      rel["boundary"="administrative"]["admin_level"="5"]["name"~"Surabaya",i];
      out tags center;
    `,
  },
  {
    label: 'admin_level 5 atau 6 di sekitar pusat kota',
    query: `
      [out:json][timeout:180];
      rel["boundary"="administrative"]["admin_level"~"^(5|6)$"](around:30000,-7.2575,112.7521);
      out tags center;
    `,
  },
  {
    label: 'admin_level 7 (kecamatan) di sekitar pusat kota',
    query: `
      [out:json][timeout:180];
      rel["boundary"="administrative"]["admin_level"="7"](around:30000,-7.2575,112.7521);
      out tags center;
    `,
  },
];

for (const { label, query } of QUERIES) {
  info('');
  info(`— ${label}`);

  let result;
  try {
    result = await overpass(query);
  } catch (error) {
    warn(`  Gagal: ${error.message}`);
    continue;
  }

  const relations = (result.elements ?? []).filter((element) => element.type === 'relation');
  if (relations.length === 0) {
    warn('  Tidak ada relasi yang cocok.');
    continue;
  }

  for (const relation of relations.slice(0, 40)) {
    const tags = relation.tags ?? {};
    const members = relation.members?.length ?? 0;
    const center = relation.center
      ? `${relation.center.lat.toFixed(4)},${relation.center.lon.toFixed(4)}`
      : '—';
    info(
      `  rel/${relation.id}  anggota=${String(members).padStart(4)}  pusat=${center}  ` +
        `admin_level=${tags.admin_level ?? '?'}  ${tags.name ?? '(tanpa nama)'}`,
    );
  }
  if (relations.length > 40) info(`  … dan ${relations.length - 40} relasi lain.`);
}

info('');
info('Pakai ID dengan jumlah anggota besar (ratusan sampai ribuan) — batas kota');
info('yang sebenarnya tersusun dari banyak potongan garis. Angka kecil berarti');
info('relasi itu bukan batas wilayah.');
info('');
info(`Endpoint yang tersedia: ${OVERPASS_ENDPOINTS.join(', ')}`);

process.exit(0);