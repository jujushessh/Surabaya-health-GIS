/**
 * Peta utama (Leaflet).
 *
 * Catatan penting tentang batas tiga jenis di peta:
 * Peta adalah bentuk "semua pasangan" — dua penanda jenis apa pun dapat
 * bersebelahan. Pada uji buta warna semua-pasangan, hanya tiga slot warna
 * pertama yang lolos ambang. Karena itu peta hanya menggambar tiga jenis yang
 * diminta pengguna (rumah sakit, klinik, apotek), dan tiap jenis tetap
 * dibedakan lewat **bentuk penanda** di samping warna, sehingga identitas
 * tidak pernah bergantung pada warna saja.
 *
 * Jenis tambahan (praktik dokter, pos kesehatan) tetap ada di data dan dapat
 * ditelusuri di halaman Fasilitas, tempat identitasnya berupa teks — bukan
 * warna.
 */

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { Facility, FacilityKind, MetricId, Region, RegionLevel } from '../types';
import { FACILITY_KIND_META, METRIC_META } from '../types';
import type { Classification } from '../lib/classify';
import type { MetricsResult } from '../lib/metrics';
import { METRIC_NOTES, colorsFor, sequentialStep, KIND_SHAPE } from '../lib/palette';
import { formatNumber } from '../lib/format';
import type { ThemeMode } from '../store/DataProvider';

/** Tiga jenis yang aman digambar bersamaan di peta. */
const MAP_KINDS: FacilityKind[] = ['hospital', 'clinic', 'pharmacy'];

/** Sumber dasar peta. Atribusi wajib disertakan sesuai lisensi masing-masing. */
const BASEMAPS = {
  standar: {
    label: 'Peta standar',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  terang: {
    label: 'Peta terang',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
  },
  gelap: {
    label: 'Peta gelap',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
  },
} as const;

export type BasemapId = keyof typeof BASEMAPS;

interface MapCanvasProps {
  regions: Region[];
  level: RegionLevel;
  metrics: MetricsResult;
  classification: Classification | null;
  metric: MetricId;
  facilities: Facility[];
  activeKinds: FacilityKind[];
  selectedId: string | null;
  onSelect: (regionId: string | null) => void;
  theme: ThemeMode;
  basemap: BasemapId;
  showFacilities: boolean;
  /** Radius cakupan yang digambar sebagai lingkaran (km), bila diaktifkan. */
  coverageRadius: number | null;
}

/** Geometri GeoJSON dari data wilayah, dalam bentuk yang diterima Leaflet. */
function toFeatureCollection(regions: Region[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: regions.map((region) => ({
      type: 'Feature',
      id: region.id,
      properties: { id: region.id, name: region.name },
      geometry: region.geometry as unknown as GeoJSON.Geometry,
    })),
  };
}

/**
 * Penanda fasilitas.
 *
 * Warna dan bentuk sama-sama dipakai. Elemen dibuat lewat DOM, bukan string
 * HTML, sehingga nama fasilitas dari luar tidak pernah dapat menyisipkan
 * markup.
 */
function makeFacilityIcon(kind: FacilityKind, color: string, selected: boolean): L.DivIcon {
  const shape = KIND_SHAPE[kind];
  const size = selected ? 16 : 12;

  const element = document.createElement('span');
  element.style.display = 'block';
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;
  element.style.background = color;
  element.style.boxShadow = `0 0 0 2px ${selected ? '#ffffff' : 'rgba(255,255,255,0.85)'}`;

  if (shape === 'circle') {
    element.style.borderRadius = '50%';
  } else if (shape === 'square') {
    element.style.borderRadius = '2px';
  } else if (shape === 'diamond') {
    element.style.transform = 'rotate(45deg)';
    element.style.borderRadius = '1px';
  } else if (shape === 'triangle') {
    element.style.clipPath = 'polygon(50% 0, 100% 100%, 0 100%)';
  } else {
    element.style.clipPath =
      'polygon(38% 0, 62% 0, 62% 38%, 100% 38%, 100% 62%, 62% 62%, 62% 100%, 38% 100%, 38% 62%, 0 62%, 0 38%, 38% 38%)';
  }

  return L.divIcon({
    html: element,
    className: 'facility-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function MapCanvas({
  regions,
  level,
  metrics,
  classification,
  metric,
  facilities,
  activeKinds,
  selectedId,
  onSelect,
  theme,
  basemap,
  showFacilities,
  coverageRadius,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const choroplethRef = useRef<L.GeoJSON | null>(null);
  const facilityLayerRef = useRef<L.LayerGroup | null>(null);
  const radiusLayerRef = useRef<L.LayerGroup | null>(null);
  const suppressFitRef = useRef(false);

  const palette = colorsFor(theme);

  /**
   * Gaya dasar satu wilayah.
   *
   * Dipakai oleh `style:` saat layer dibuat maupun saat kursor keluar dari
   * sebuah wilayah, supaya `mouseout` dapat mengembalikan wilayah ke gayanya
   * yang semula. Sebelumnya `mouseout` selalu memakai opasitas wilayah
   * berdata, sehingga wilayah "belum ada data" berubah tampak seolah-olah
   * punya nilai setelah sekali disinggahi kursor.
   */
  const styleForRegion = useCallback(
    (regionId: string | undefined): L.PathOptions => {
      const entry = regionId ? metrics.byId.get(regionId) : undefined;
      const value = regionId && entry ? entry.values[metric] : null;
      const classes = classification?.classes ?? [];

      // Wilayah tanpa nilai diberi arsir abu, bukan warna kelas terendah,
      // supaya "belum ada data" tidak terbaca sebagai "nilai rendah".
      if (value === null || value === undefined || classes.length === 0) {
        return {
          fillColor: palette.textMuted,
          fillOpacity: 0.28,
          // Garis memakai abu yang sama dengan arsirnya. Sebelumnya memakai
          // warna permukaan (hampir putih pada tema terang), sehingga di atas
          // peta dasar yang juga terang batas wilayah tidak terlihat sama
          // sekali dan seluruh layer tampak tidak tergambar.
          color: palette.textMuted,
          weight: 1.4,
          dashArray: '4 3',
        };
      }

      const index = classIndexFor(value, classes);
      return {
        fillColor: sequentialStep(index, classes.length, theme),
        fillOpacity: 0.82,
        color: palette.surface,
        weight: 1.2,
      };
    },
    [metrics, metric, classification, theme, palette.textMuted, palette.surface],
  );

  // --- Inisialisasi peta (sekali) -----------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [-7.2575, 112.7521],
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
      // Peta memakai kanvas sendiri; gulir zoom dimatikan agar halaman dapat
      // digulir tanpa peta ikut memperbesar.
      scrollWheelZoom: false,
    });

    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

    mapRef.current = map;
    facilityLayerRef.current = L.layerGroup().addTo(map);
    radiusLayerRef.current = L.layerGroup().addTo(map);

    // Klik pada area kosong menghapus pilihan wilayah.
    map.on('click', () => onSelect(null));

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Sengaja hanya sekali; pilihan wilayah ditangani lewat handler terbaru
    // di bawah agar peta tidak dibangun ulang setiap kali pilihan berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Simpan handler terbaru tanpa membangun ulang peta.
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  // --- Ganti peta dasar ----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileRef.current) map.removeLayer(tileRef.current);

    const config = BASEMAPS[basemap];
    tileRef.current = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
    }).addTo(map);
  }, [basemap]);

  // --- Layer choropleth ----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (choroplethRef.current) map.removeLayer(choroplethRef.current);

    const layer = L.geoJSON(toFeatureCollection(regions), {
      style: (feature) => styleForRegion(feature?.properties?.id as string | undefined),
      onEachFeature: (feature, featureLayer) => {
        const id = feature.properties?.id as string;
        const name = feature.properties?.name as string;
        const entry = metrics.byId.get(id);
        const value = entry?.values[metric] ?? null;
        const meta = METRIC_META[metric];

        const valueText =
          value === null
            ? 'Data tidak tersedia'
            : `${formatNumber(value, meta.decimals)} ${meta.unit}`;

        featureLayer.bindTooltip(`${name}: ${valueText}`, { sticky: true, direction: 'top' });

        featureLayer.on({
          mouseover: (event) => {
            const target = event.target as L.Path;
            target.setStyle({ weight: 2.4, color: palette.textPrimary, fillOpacity: 0.92 });
            target.bringToFront();
          },
          mouseout: (event) => {
            const target = event.target as L.Path;
            target.setStyle(styleForRegion(id));
          },
          click: (event) => {
            L.DomEvent.stopPropagation(event);
            selectRef.current(id);
          },
        });
      },
    }).addTo(map);

    choroplethRef.current = layer;

    // Sesuaikan tampilan ke seluruh wilayah level aktif, kecuali bila
    // pengguna baru saja memilih wilayah (agar peta tidak melompat).
    if (!suppressFitRef.current) {
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    }
    suppressFitRef.current = false;
  }, [regions, metrics, classification, metric, theme, styleForRegion, palette.textPrimary]);

  // --- Sorot wilayah terpilih ---------------------------------------------
  useEffect(() => {
    const layer = choroplethRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;

    layer.eachLayer((featureLayer) => {
      const path = featureLayer as L.Path & { feature?: { properties?: { id?: string } } };
      const id = path.feature?.properties?.id;

      if (id === selectedId) {
        path.setStyle({ weight: 3, color: palette.textPrimary, fillOpacity: 0.95 });
        path.bringToFront();
      } else {
        // Wilayah yang tadinya terpilih harus dikembalikan ke gaya dasarnya,
        // bukan dibiarkan tebal. Tanpa cabang ini, wilayah yang batal dipilih
        // tetap terlihat tersorot meskipun pilihan sudah berpindah.
        path.setStyle(styleForRegion(id));
      }
    });
  }, [selectedId, styleForRegion, palette.textPrimary]);

  // --- Layer fasilitas -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const group = facilityLayerRef.current;
    if (!map || !group) return;

    group.clearLayers();
    if (!showFacilities) return;

    // Hanya tiga jenis utama yang digambar di peta; lihat catatan di kepala berkas.
    const drawable = facilities.filter((facility) => MAP_KINDS.includes(facility.kind));

    for (const facility of drawable) {
      const meta = FACILITY_KIND_META[facility.kind];
      const color = palette.series[meta.slot];
      const marker = L.marker([facility.lat, facility.lon], {
        icon: makeFacilityIcon(facility.kind, color, false),
        title: facility.name,
        alt: `${meta.label}: ${facility.name}`,
        keyboard: false,
        riseOnHover: true,
      });

      marker.bindTooltip(
        `<strong>${escapeHtml(facility.name)}</strong><br>${escapeHtml(meta.label)}${
          facility.address ? `<br>${escapeHtml(facility.address)}` : ''
        }`,
        { direction: 'top', offset: [0, -8] },
      );

      group.addLayer(marker);
    }
  }, [facilities, palette.series, showFacilities]);

  // --- Lingkaran radius cakupan -------------------------------------------
  useEffect(() => {
    const group = radiusLayerRef.current;
    if (!group) return;

    group.clearLayers();
    if (!coverageRadius || !selectedId) return;

    const region = regions.find((item) => item.id === selectedId);
    if (!region) return;

    const drawable = facilities.filter((facility) => activeKinds.includes(facility.kind));
    const center = region.centroid;

    // Digambar hanya untuk fasilitas yang benar-benar berada dalam radius,
    // supaya jumlah lingkaran tidak meledak di wilayah padat.
    for (const facility of drawable) {
      const dLat = (facility.lat - center.lat) * 111.32;
      const dLon = (facility.lon - center.lon) * 111.32 * Math.cos((center.lat * Math.PI) / 180);
      const distance = Math.sqrt(dLat * dLat + dLon * dLon);
      if (distance > coverageRadius * 4) continue;

      L.circle([facility.lat, facility.lon], {
        radius: coverageRadius * 1000,
        color: palette.series[FACILITY_KIND_META[facility.kind].slot],
        weight: 1,
        opacity: 0.5,
        fillColor: palette.series[FACILITY_KIND_META[facility.kind].slot],
        fillOpacity: 0.07,
        interactive: false,
      }).addTo(group);
    }
  }, [coverageRadius, selectedId, regions, facilities, activeKinds, palette.series]);

  // --- Terbang ke wilayah terpilih ----------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    if (level !== 'kelurahan') return;

    const region = regions.find((item) => item.id === selectedId);
    if (!region) return;

    // Hanya pada level kelurahan: pada level kecamatan, memilih wilayah tidak
    // perlu menggeser peta karena seluruh kota sudah terlihat.
    map.fitBounds(
      [
        [region.bbox.minLat, region.bbox.minLon],
        [region.bbox.maxLat, region.bbox.maxLon],
      ],
      { padding: [40, 40], maxZoom: 15 },
    );
  }, [selectedId, regions, level]);

  const note = METRIC_NOTES[metric];

  return (
    <div className="map-canvas" ref={containerRef} role="application" aria-label="Peta sebaran fasilitas kesehatan">
      {/* Keterangan skala warna */}
      <div className="map-overlay map-overlay--legend">
        <div className="legend__title">{METRIC_META[metric].label}</div>
        {classification && classification.classes.length > 0 ? (
          <>
            {classification.classes
              .map((cls, index) => ({ cls, index }))
              .slice()
              .reverse()
              .map(({ cls, index }) => (
                <div className="legend__row" key={`${cls.min}-${cls.max}`}>
                  <span
                    className="legend__swatch"
                    style={{
                      background: sequentialStep(index, classification.classes.length, theme),
                    }}
                  />
                  <span>
                    {formatNumber(cls.min, METRIC_META[metric].decimals)} –{' '}
                    {formatNumber(cls.max, METRIC_META[metric].decimals)}
                  </span>
                  <span className="legend__value">{formatNumber(cls.count)}</span>
                </div>
              ))}
            <div className="legend__row" style={{ marginTop: 4 }}>
              <span
                className="legend__swatch"
                style={{
                  background: palette.textMuted,
                  opacity: 0.18,
                  border: `1px dashed ${palette.textMuted}`,
                }}
              />
              <span>Data tidak tersedia</span>
            </div>
          </>
        ) : null}
        <div className="legend__note">{note}</div>
      </div>

      {/* Legenda jenis fasilitas, hanya muncul bila fasilitas digambar. */}
      {showFacilities ? (
        <div className="map-overlay map-overlay--layers">
          <div className="legend__title">Jenis fasilitas</div>
          {MAP_KINDS.filter((kind) => activeKinds.includes(kind)).map((kind) => {
            const meta = FACILITY_KIND_META[kind];
            const count = facilities.filter(
              (facility) => facility.kind === kind && activeKinds.includes(facility.kind),
            ).length;
            return (
              <div className="legend__row" key={kind}>
                <span
                  className="chip__mark"
                  style={{
                    background: palette.series[meta.slot],
                    clipPath: shapeClip(KIND_SHAPE[kind]),
                    borderRadius: KIND_SHAPE[kind] === 'circle' ? '50%' : undefined,
                  }}
                />
                <span>{meta.label}</span>
                <span className="legend__value">{formatNumber(count)}</span>
              </div>
            );
          })}
          <div className="legend__note">
            Bentuk penanda membedakan jenis selain warna, sehingga tetap terbaca oleh pengguna dengan
            buta warna.
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Indeks kelas untuk sebuah nilai; dipakai mewarnai poligon. */
function classIndexFor(
  value: number,
  classes: { min: number; max: number }[],
): number {
  for (let i = 0; i < classes.length; i += 1) {
    const cls = classes[i];
    if (i === 0 ? value >= cls.min && value <= cls.max : value > cls.min && value <= cls.max) {
      return i;
    }
  }
  return value <= classes[0].min ? 0 : classes.length - 1;
}

function shapeClip(shape: string): string | undefined {
  if (shape === 'triangle') return 'polygon(50% 0, 100% 100%, 0 100%)';
  if (shape === 'diamond') return 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)';
  if (shape === 'cross')
    return 'polygon(38% 0, 62% 0, 62% 38%, 100% 38%, 100% 62%, 62% 62%, 62% 100%, 38% 100%, 38% 62%, 0 62%, 0 38%, 38% 38%)';
  return undefined;
}

/**
 * Nama fasilitas berasal dari data luar, jadi harus dilolosikan sebelum masuk
 * ke tooltip Leaflet yang menerima string HTML.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Daftar peta dasar untuk pemilih di antarmuka. */
export function basemapOptions(): { id: BasemapId; label: string; suggestion: ThemeMode }[] {
  return [
    { id: 'standar', label: BASEMAPS.standar.label, suggestion: 'light' },
    { id: 'terang', label: BASEMAPS.terang.label, suggestion: 'light' },
    { id: 'gelap', label: BASEMAPS.gelap.label, suggestion: 'dark' },
  ];
}