/**
 * Klien Overpass dan perakitan geometri relasi.
 *
 * Overpass mengembalikan relasi batas sebagai daftar potongan garis (way) yang
 * belum tersambung. Sebelum bisa dipakai, potongan-potongan itu harus
 * dirangkai menjadi cincin tertutup, lalu cincin dalam (lubang) dipasangkan
 * ke cincin luarnya.
 *
 * Fungsi geometri umum (luas, kotak pembatas, uji titik) tinggal di geo.mjs
 * dan diimpor dari sana, supaya rumusnya hanya ada di satu tempat.
 */

import { pointInRing, geometryBBox, ringAreaKm2, geometryAreaKm2, round7 } from './geo.mjs';

// Diekspor ulang agar pemanggil cukup mengimpor dari satu berkas.
export { pointInRing, geometryBBox, ringAreaKm2, geometryAreaKm2 };

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

const USER_AGENT =
  'surabaya-health-gis/1.0 (analisis aksesibilitas fasilitas kesehatan; penggunaan akademis)';

/** Panggil Overpass dengan percobaan berulang pada beberapa endpoint. */
export async function overpass(query, { timeoutMs = 240000, attempts = 3 } = {}) {
  const problems = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          problems.push(`${endpoint} -> HTTP ${response.status}`);
          continue;
        }

        const text = await response.text();
        if (text.trimStart().startsWith('<')) {
          // Overpass mengirim HTML saat kelebihan beban atau ada galat kueri.
          const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
          problems.push(`${endpoint} -> balasan bukan JSON: ${snippet}`);
          continue;
        }

        return JSON.parse(text);
      } catch (error) {
        const reason = error?.name === 'AbortError' ? `timeout setelah ${timeoutMs} ms` : error.message;
        problems.push(`${endpoint} -> ${reason}`);
      }
    }

    if (attempt < attempts) {
      const waitMs = 5000 * attempt;
      console.warn(`    percobaan ${attempt} gagal, menunggu ${waitMs / 1000} detik…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw new Error(`Semua endpoint Overpass gagal:\n  - ${problems.join('\n  - ')}`);
}

/**
 * Rangkai potongan garis menjadi cincin tertutup.
 *
 * Potongan disambung ketika ujungnya berimpit, dengan arah dibalik bila perlu.
 * Potongan yang tidak pernah menutup dikembalikan sebagai sisa agar bisa
 * dilaporkan, bukan dibuang diam-diam.
 */
export function assembleRings(ways) {
  const key = (point) => `${point.lat.toFixed(7)},${point.lon.toFixed(7)}`;
  const remaining = ways
    .filter((way) => Array.isArray(way.geometry) && way.geometry.length >= 2)
    .map((way) => ({ id: way.ref ?? way.id, points: [...way.geometry] }));

  const rings = [];
  const leftovers = [];

  while (remaining.length > 0) {
    const current = remaining.shift();
    let guard = 0;

    while (guard < 20000) {
      guard += 1;
      const start = current.points[0];
      const end = current.points[current.points.length - 1];

      if (key(start) === key(end) && current.points.length >= 4) break;

      const endKey = key(end);
      let joined = false;

      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        const candidateStart = candidate.points[0];
        const candidateEnd = candidate.points[candidate.points.length - 1];

        if (key(candidateStart) === endKey) {
          current.points = current.points.concat(candidate.points.slice(1));
          remaining.splice(i, 1);
          joined = true;
          break;
        }
        if (key(candidateEnd) === endKey) {
          current.points = current.points.concat([...candidate.points].reverse().slice(1));
          remaining.splice(i, 1);
          joined = true;
          break;
        }
      }

      if (!joined) break;
    }

    const start = current.points[0];
    const end = current.points[current.points.length - 1];
    if (key(start) === key(end) && current.points.length >= 4) {
      rings.push(current.points);
    } else {
      leftovers.push(current);
    }
  }

  return { rings, leftovers };
}

function planarArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += ring[j].lon * ring[i].lat - ring[i].lon * ring[j].lat;
  }
  return Math.abs(sum / 2);
}

/** Ubah cincin objek {lat,lon} menjadi larik posisi [lon,lat] yang tertutup. */
function toClosedPositions(ring) {
  const positions = ring.map((point) => [round7(point.lon), round7(point.lat)]);
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) positions.push([first[0], first[1]]);
  return positions;
}

/**
 * Susun cincin luar dan lubang menjadi koordinat MultiPolygon GeoJSON.
 * Cincin terbesar menjadi luar; cincin yang berada di dalamnya menjadi lubang.
 */
export function ringsToMultiPolygon(outerRings, innerRings = []) {
  const order = [...outerRings].sort((a, b) => planarArea(b) - planarArea(a));
  const holes = [...innerRings];

  return order.map((outer) => {
    // pointInRing bekerja dengan cincin berformat [lon, lat], sedangkan cincin
    // hasil rakitan masih berupa {lat, lon}. Konversi dilakukan sekali di sini.
    const outerPositions = toClosedPositions(outer);
    const assigned = [];

    for (let i = holes.length - 1; i >= 0; i -= 1) {
      const hole = holes[i];
      if (pointInRing(hole[0], outerPositions)) {
        assigned.push(hole);
        holes.splice(i, 1);
      }
    }

    return [outerPositions, ...assigned.map(toClosedPositions)];
  });
}

/** Ubah satu elemen Overpass (way atau relation) menjadi geometri GeoJSON. */
export function osmElementToGeometry(element) {
  if (element.type === 'way') {
    if (!Array.isArray(element.geometry)) return null;
    const ring = element.geometry.map((point) => ({ lat: point.lat, lon: point.lon }));
    if (ring.length < 4) return null;
    return { type: 'Polygon', coordinates: [[toClosedPositions(ring)]] };
  }

  if (element.type === 'relation') {
    const members = Array.isArray(element.members) ? element.members : [];
    const outerWays = members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry);
    const innerWays = members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry);

    const outer = assembleRings(outerWays);
    const inner = assembleRings(innerWays);

    if (outer.rings.length === 0) return null;

    const polygons = ringsToMultiPolygon(outer.rings, inner.rings);

    return polygons.length === 1
      ? { type: 'Polygon', coordinates: polygons[0] }
      : { type: 'MultiPolygon', coordinates: polygons };
  }

  return null;
}

/** Titik tengah kotak pembatas; hanya untuk keperluan pengurutan awal. */
export function planarCentroid(geometry) {
  const box = geometryBBox(geometry);
  return { lat: (box.minLat + box.maxLat) / 2, lon: (box.minLon + box.maxLon) / 2 };
}