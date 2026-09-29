/**
 * Geometri murni: jarak, titik-dalam-poligon, luas, titik representatif, dan
 * indeks spasial untuk pencarian tetangga terdekat.
 *
 * Semua fungsi di berkas ini deterministik dan tidak menyentuh DOM, sehingga
 * dapat diuji langsung. Tidak ada dependensi eksternal agar hasil analisis
 * dapat diaudit.
 */

import type { BBox, LatLon, LinearRing, PolygonCoords, Position, RegionGeometry } from '../types';

/** Radius rata-rata bumi (km), sesuai sistem referensi WGS84. */
export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Bungkus bujur ke rentang [-180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Jarak lingkaran besar antara dua titik (km). */
export function haversineKm(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Satu titik pada jarak `distanceKm` dari `from` mengikuti arah `bearingDeg`. */
export function destinationPoint(from: LatLon, bearingDeg: number, distanceKm: number): LatLon {
  const angular = distanceKm / EARTH_RADIUS_KM;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(from.lat);
  const lon1 = toRad(from.lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lon: normalizeLon(toDeg(lon2)) };
}

/** Cincin poligon yang mendekati lingkaran berjari-jari `radiusKm`. */
export function bufferCircleKm(center: LatLon, radiusKm: number, steps = 64): LatLon[] {
  const ring: LatLon[] = [];
  const safeSteps = Math.max(8, steps);
  for (let i = 0; i < safeSteps; i += 1) {
    ring.push(destinationPoint(center, (360 * i) / safeSteps, radiusKm));
  }
  return ring;
}

/**
 * Uji titik di dalam cincin dengan ray casting (aturan ganjil-genap).
 * Titik yang tepat berada di perbatasan dapat menghasilkan nilai mana pun —
 * pemanggil tidak boleh bergantung pada perilaku di batas.
 */
export function pointInRing(point: LatLon, ring: LinearRing): boolean {
  const x = point.lon;
  const y = point.lat;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > y !== yj > y;
    if (!straddles) continue;
    const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (x < xCross) inside = !inside;
  }

  return inside;
}

/** Semua poligon (outer + holes) dari sebuah geometri wilayah. */
export function polygonsOf(geom: RegionGeometry): PolygonCoords[] {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

/** Uji titik di dalam geometri, memperhitungkan lubang (holes). */
export function pointInGeometry(point: LatLon, geom: RegionGeometry): boolean {
  for (const polygon of polygonsOf(geom)) {
    if (polygon.length === 0) continue;
    if (!pointInRing(point, polygon[0])) continue;
    let inHole = false;
    for (let h = 1; h < polygon.length; h += 1) {
      if (pointInRing(point, polygon[h])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

export function emptyBBox(): BBox {
  return { minLat: Infinity, minLon: Infinity, maxLat: -Infinity, maxLon: -Infinity };
}

export function extendBBox(box: BBox, lat: number, lon: number): BBox {
  return {
    minLat: Math.min(box.minLat, lat),
    minLon: Math.min(box.minLon, lon),
    maxLat: Math.max(box.maxLat, lat),
    maxLon: Math.max(box.maxLon, lon),
  };
}

export function bboxOfPositions(positions: Position[]): BBox {
  let box = emptyBBox();
  for (const [lon, lat] of positions) box = extendBBox(box, lat, lon);
  return box;
}

export function geometryBBox(geom: RegionGeometry): BBox {
  let box = emptyBBox();
  for (const polygon of polygonsOf(geom)) {
    for (const ring of polygon) {
      for (const position of ring) box = extendBBox(box, position[1], position[0]);
    }
  }
  return box;
}

export function bboxCenter(box: BBox): LatLon {
  return { lat: (box.minLat + box.maxLat) / 2, lon: (box.minLon + box.maxLon) / 2 };
}

/**
 * Luas poligon pada bola (km²), memakai pendekatan kelebihan bola.
 * Cukup teliti untuk wilayah seukuran kota dan tidak memerlukan proyeksi.
 */
export function ringAreaKm2(ring: LinearRing): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [lonA, latA] = ring[j];
    const [lonB, latB] = ring[i];
    total += toRad(lonB - lonA) * (2 + Math.sin(toRad(latA)) + Math.sin(toRad(latB)));
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

/** Luas geometri wilayah (km²): jumlah poligon, dikurangi lubang. */
export function geometryAreaKm2(geom: RegionGeometry): number {
  let total = 0;
  for (const polygon of polygonsOf(geom)) {
    if (polygon.length === 0) continue;
    let area = ringAreaKm2(polygon[0]);
    for (let h = 1; h < polygon.length; h += 1) area -= ringAreaKm2(polygon[h]);
    total += Math.max(0, area);
  }
  return total;
}

/**
 * Luas berarah (planar) dari cincin dalam derajat, dipakai untuk mencari
 * sentroid. Nilai absolutnya tidak bermakna sebagai luas fisik.
 */
function signedPlanarArea(ring: LinearRing): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    sum += xj * yi - xi * yj;
  }
  return sum / 2;
}

/**
 * Sentroid planar dari seluruh bagian poligon terbesar, dalam koordinat
 * derajat (dihitung pada lintang rata-rata agar lonjakan bujur tidak
 * mendistorsi bentuk).
 */
function planarCentroid(geom: RegionGeometry): LatLon {
  const polygons = polygonsOf(geom).filter((polygon) => polygon.length > 0);
  if (polygons.length === 0) return { lat: 0, lon: 0 };

  const reference = bboxCenter(geometryBBox(geom));
  const lonScale = Math.max(1e-6, Math.cos(toRad(reference.lat)));

  let best: { lat: number; lon: number } | null = null;
  let bestArea = -1;

  for (const polygon of polygons) {
    let areaSum = 0;
    let latSum = 0;
    let lonSum = 0;

    for (let h = 0; h < polygon.length; h += 1) {
      const ring = polygon[h];
      const signed = signedPlanarArea(ring) * lonScale;
      // Lubang mengurangi luas, jadi ikut dihitung dengan tanda berlawanan.
      const weight = h === 0 ? signed : -Math.abs(signed);

      let cx = 0;
      let cy = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const cross = xj * yi - xi * yj;
        cx += (xj + xi) * cross;
        cy += (yj + yi) * cross;
      }
      const denominator = 6 * signedPlanarArea(ring);
      if (denominator === 0) continue;

      areaSum += weight;
      lonSum += (cx / denominator) * weight;
      latSum += (cy / denominator) * weight;
    }

    if (Math.abs(areaSum) > Math.abs(bestArea)) {
      bestArea = areaSum;
      if (areaSum !== 0) {
        best = { lat: latSum / areaSum, lon: lonSum / areaSum };
      }
    }
  }

  return best ?? reference;
}

/**
 * Titik representatif wilayah yang dijamin berada di dalam poligon.
 *
 * Sentroid poligon cekung bisa jatuh di luar wilayah, dan itu akan membuat
 * perhitungan jarak terdekat salah. Karena itu sentroid diuji lebih dahulu,
 * lalu dicari titik di dalam lewat pencarian grid deterministik.
 */
export function pointOnSurface(geom: RegionGeometry): LatLon {
  const centroid = planarCentroid(geom);
  if (pointInGeometry(centroid, geom)) return centroid;

  const box = geometryBBox(geom);
  const steps = 48;
  let best: LatLon | null = null;
  let bestScore = Infinity;
  const lonScale = Math.max(1e-6, Math.cos(toRad(centroid.lat)));

  for (let i = 1; i < steps; i += 1) {
    const lat = box.minLat + ((box.maxLat - box.minLat) * i) / steps;
    for (let j = 1; j < steps; j += 1) {
      const lon = box.minLon + ((box.maxLon - box.minLon) * j) / steps;
      const candidate = { lat, lon };
      if (!pointInGeometry(candidate, geom)) continue;
      const dLat = lat - centroid.lat;
      const dLon = (lon - centroid.lon) * lonScale;
      const score = dLat * dLat + dLon * dLon;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return best ?? bboxCenter(box);
}

/**
 * Indeks spasial grid sederhana untuk pencarian fasilitas terdekat.
 *
 * Tanpa indeks, pencarian terdekat untuk ribuan titik grid akan memeriksa
 * seluruh fasilitas setiap kali. Indeks ini membatasi pemeriksaan pada petak
 * di sekitar titik query dan melebar sampai jarak aman terpenuhi.
 */
export class SpatialIndex<T extends LatLon> {
  private readonly cells = new Map<string, T[]>();
  private readonly cellDeg: number;

  constructor(
    private readonly items: T[],
    cellDeg = 0.02,
  ) {
    this.cellDeg = cellDeg;
    for (const item of items) {
      const key = this.keyFor(item.lat, item.lon);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(item);
      else this.cells.set(key, [item]);
    }
  }

  private keyFor(lat: number, lon: number): string {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lon / this.cellDeg)}`;
  }

  /** Perkiraan jarak minimum ke tepi petak berikutnya, dipakai untuk berhenti melebar. */
  private cellFloorKm(ring: number, lat: number): number {
    const degrees = Math.max(0, ring - 1) * this.cellDeg;
    // 111,32 km per derajat lintang; bujur menyusut mengikuti kosinus lintang.
    const lonKm = 111.32 * Math.max(0.05, Math.cos(toRad(lat)));
    return Math.min(degrees * 111.32, degrees * lonKm);
  }

  /**
   * Fasilitas terdekat dari titik query. `filter` dipakai untuk membatasi
   * jenis fasilitas tanpa membangun indeks baru.
   */
  nearest(lat: number, lon: number, filter?: (item: T) => boolean): { item: T; km: number } | null {
    if (this.items.length === 0) return null;
    const baseLat = Math.floor(lat / this.cellDeg);
    const baseLon = Math.floor(lon / this.cellDeg);

    let best: T | null = null;
    let bestKm = Infinity;
    const maxRing = 200;

    for (let ring = 0; ring <= maxRing; ring += 1) {
      // Semua isi petak pada cincin ini sudah diperiksa; kalau jarak aman
      // melebihi kandidat terbaik, tidak ada yang bisa mengalahkannya.
      if (best !== null && this.cellFloorKm(ring, lat) > bestKm) break;

      for (let dLat = -ring; dLat <= ring; dLat += 1) {
        for (let dLon = -ring; dLon <= ring; dLon += 1) {
          // Hanya sisir tepi cincin; bagian dalam sudah diperiksa sebelumnya.
          if (Math.max(Math.abs(dLat), Math.abs(dLon)) !== ring) continue;
          const bucket = this.cells.get(`${baseLat + dLat}:${baseLon + dLon}`);
          if (!bucket) continue;
          for (const item of bucket) {
            if (filter && !filter(item)) continue;
            const km = haversineKm({ lat, lon }, item);
            if (km < bestKm) {
              bestKm = km;
              best = item;
            }
          }
        }
      }
    }

    return best === null ? null : { item: best, km: bestKm };
  }
}

/** Titik-titik grid berjarak `stepKm` yang berada di dalam geometri wilayah. */
export function gridPointsInGeometry(
  geom: RegionGeometry,
  stepKm = 0.5,
  maxPoints = 600,
): LatLon[] {
  const box = geometryBBox(geom);
  const midLat = (box.minLat + box.maxLat) / 2;
  const latStep = stepKm / 111.32;
  const lonStep = stepKm / (111.32 * Math.max(0.05, Math.cos(toRad(midLat))));

  const points: LatLon[] = [];
  // Grid digeser setengah langkah agar titik tidak jatuh pas di garis batas.
  for (let lat = box.minLat + latStep / 2; lat <= box.maxLat; lat += latStep) {
    for (let lon = box.minLon + lonStep / 2; lon <= box.maxLon; lon += lonStep) {
      if (points.length >= maxPoints) return points;
      const candidate = { lat, lon };
      if (pointInGeometry(candidate, geom)) points.push(candidate);
    }
  }
  return points;
}

/** Apakah dua bbox bersinggungan. */
export function bboxIntersects(a: BBox, b: BBox): boolean {
  return !(a.maxLat < b.minLat || a.minLat > b.maxLat || a.maxLon < b.minLon || a.minLon > b.maxLon);
}