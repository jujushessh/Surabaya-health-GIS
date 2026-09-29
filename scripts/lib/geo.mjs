/**
 * Geometri untuk skrip data (JavaScript).
 *
 * Ini adalah padanan dari src/lib/geo.ts. Duplikasi disengaja: skrip Node tidak
 * dapat mengimpor TypeScript secara langsung, dan menambahkan langkah build
 * hanya untuk berbagi beberapa fungsi akan membuat alur data lebih rapuh.
 * Kedua berkas harus diubah bersamaan bila rumusnya berubah.
 */

export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg) => (deg * Math.PI) / 180;

export function haversineKm(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point.lat !== yj > point.lat) {
      const cross = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (point.lon < cross) inside = !inside;
    }
  }
  return inside;
}

function polygonsOf(geometry) {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

export function pointInGeometry(point, geometry) {
  for (const polygon of polygonsOf(geometry)) {
    if (!polygon.length) continue;
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

export function geometryBBox(geometry) {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lat < minLat) minLat = lat;
        if (lon < minLon) minLon = lon;
        if (lat > maxLat) maxLat = lat;
        if (lon > maxLon) maxLon = lon;
      }
    }
  }
  return { minLat, minLon, maxLat, maxLon };
}

/**
 * Luas poligon pada bola (km²), memakai pendekatan kelebihan bola.
 * Cukup teliti untuk wilayah seukuran kota tanpa perlu proyeksi.
 */
export function ringAreaKm2(ring) {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [lonA, latA] = ring[j];
    const [lonB, latB] = ring[i];
    total += toRad(lonB - lonA) * (2 + Math.sin(toRad(latA)) + Math.sin(toRad(latB)));
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

/** Luas geometri GeoJSON (km²): jumlah poligon, dikurangi lubang. */
export function geometryAreaKm2(geometry) {
  let total = 0;
  for (const polygon of polygonsOf(geometry)) {
    if (!polygon.length) continue;
    let area = ringAreaKm2(polygon[0]);
    for (let h = 1; h < polygon.length; h += 1) area -= ringAreaKm2(polygon[h]);
    total += Math.max(0, area);
  }
  return total;
}

function signedPlanarArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    sum += xj * yi - xi * yj;
  }
  return sum / 2;
}

/**
 * Titik representatif yang dijamin berada di dalam wilayah.
 *
 * Sentroid poligon cekung dapat jatuh di luar wilayah; bila itu terjadi,
 * dicari titik di dalam terdekat lewat sisiran grid yang deterministik.
 */
export function pointOnSurface(geometry) {
  const box = geometryBBox(geometry);
  const reference = { lat: (box.minLat + box.maxLat) / 2, lon: (box.minLon + box.maxLon) / 2 };
  const lonScale = Math.max(1e-6, Math.cos(toRad(reference.lat)));

  const polygons = polygonsOf(geometry).filter((polygon) => polygon.length > 0);

  let best = null;
  let bestArea = -1;

  for (const polygon of polygons) {
    let areaSum = 0;
    let latSum = 0;
    let lonSum = 0;

    for (let h = 0; h < polygon.length; h += 1) {
      const ring = polygon[h];
      const signed = signedPlanarArea(ring) * lonScale;
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
      if (areaSum !== 0) best = { lat: latSum / areaSum, lon: lonSum / areaSum };
    }
  }

  if (best && pointInGeometry(best, geometry)) return best;

  // Sisiran grid: cari titik di dalam yang paling dekat dengan sentroid.
  const anchor = best ?? reference;
  const steps = 64;
  let fallback = null;
  let fallbackScore = Infinity;

  for (let i = 1; i < steps; i += 1) {
    const lat = box.minLat + ((box.maxLat - box.minLat) * i) / steps;
    for (let j = 1; j < steps; j += 1) {
      const lon = box.minLon + ((box.maxLon - box.minLon) * j) / steps;
      const candidate = { lat, lon };
      if (!pointInGeometry(candidate, geometry)) continue;
      const dLat = lat - anchor.lat;
      const dLon = (lon - anchor.lon) * lonScale;
      const score = dLat * dLat + dLon * dLon;
      if (score < fallbackScore) {
        fallbackScore = score;
        fallback = candidate;
      }
    }
  }

  return fallback ?? reference;
}

export function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

export function round7(value) {
  return Math.round(value * 1e7) / 1e7;
}