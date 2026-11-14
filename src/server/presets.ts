import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { CityPreset, GridCell } from './types.ts';

const PRESETS_DIR = path.resolve(process.cwd(), 'data', 'presets');
const UA = 'google-maps-scraper-kit/2.0 (node-server)';

const FOLD_MAP: Record<string, string> = {
  'ł': 'l',
  'ø': 'o',
  'đ': 'd',
  'ı': 'i',
  'ß': 'ss',
  'æ': 'ae',
  'œ': 'oe',
  'þ': 'th',
};

export function foldText(input: string): string {
  const mapped = input
    .toLowerCase()
    .replace(/[łøđıßæœþ]/g, (ch) => FOLD_MAP[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  return mapped.replace(/[\W_]+/g, ' ').trim();
}

interface CityEntry extends CityPreset {
  folded: string;
}

let cachedCities: CityEntry[] | null = null;
let cachedBusinessTypes: string[] | null = null;

export function getBusinessTypes(): string[] {
  if (cachedBusinessTypes) return cachedBusinessTypes;
  try {
    const raw = fs.readFileSync(path.join(PRESETS_DIR, 'business-types.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cachedBusinessTypes = parsed.filter((x): x is string => typeof x === 'string');
      return cachedBusinessTypes;
    }
  } catch {
    // Fallback list if preset file is missing
  }
  cachedBusinessTypes = ['Dentists', 'Restaurants', 'Coffee Shops', 'Plumbers', 'Roofing Contractors', 'Gyms'];
  return cachedBusinessTypes;
}

function loadCities(): CityEntry[] {
  if (cachedCities) return cachedCities;
  const entries: CityEntry[] = [];
  try {
    const gz = fs.readFileSync(path.join(PRESETS_DIR, 'cities.tsv.gz'));
    const txt = zlib.gunzipSync(gz).toString('utf-8');
    for (const line of txt.split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 5) continue;
      const [name, admin, cc, lat, lon] = parts;
      const labelParts = [name];
      if (admin && admin !== name) labelParts.push(admin);
      labelParts.push(cc);
      const label = labelParts.join(', ');
      entries.push({
        folded: foldText(label),
        label,
        lat,
        lon,
        country: cc,
      });
    }
  } catch (err) {
    console.warn('Could not load cities.tsv.gz:', err instanceof Error ? err.message : err);
  }
  cachedCities = entries;
  return cachedCities;
}

export function findCities(query: string, limit = 20): CityPreset[] {
  const raw = query.trim();
  const q = foldText(raw);
  if (raw && !q) return [];
  const all = loadCities();
  const out: CityPreset[] = [];
  for (const entry of all) {
    const match = q ? entry.folded.startsWith(q) : entry.country === 'US';
    if (match) {
      out.push({
        label: entry.label,
        lat: entry.lat,
        lon: entry.lon,
        country: entry.country,
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}

export interface GeocodeResult {
  label: string;
  lat: string;
  lon: string;
  country: string;
  boundingbox?: [number, number, number, number];
}

export async function geocodePlace(place: string): Promise<GeocodeResult | null> {
  const q = place.trim();
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const hits = (await res.json()) as Array<{
      display_name?: string;
      lat?: string;
      lon?: string;
      boundingbox?: [string, string, string, string];
      address?: { country_code?: string };
    }>;
    if (!hits || !hits.length || !hits[0].lat || !hits[0].lon) return null;
    const hit = hits[0];
    const bbox =
      Array.isArray(hit.boundingbox) && hit.boundingbox.length === 4
        ? ([
            parseFloat(hit.boundingbox[0]),
            parseFloat(hit.boundingbox[1]),
            parseFloat(hit.boundingbox[2]),
            parseFloat(hit.boundingbox[3]),
          ] as [number, number, number, number])
        : undefined;
    return {
      label: q,
      lat: String(hit.lat),
      lon: String(hit.lon),
      country: (hit.address?.country_code || '').toUpperCase(),
      boundingbox: bbox && bbox.every(Number.isFinite) ? bbox : undefined,
    };
  } catch {
    return null;
  }
}

export function gridCells(bbox: [number, number, number, number], n: number): GridCell[] {
  const [s, nn, w, e] = bbox;
  const dlat = (nn - s) / n;
  const dlon = (e - w) / n;
  const mPerDeg = (6371000 * Math.PI) / 180;
  const cells: GridCell[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lat = s + (i + 0.5) * dlat;
      const lon = w + (j + 0.5) * dlon;
      const cos = Math.cos((lat * Math.PI) / 180);
      const width = Math.max(1.0, dlon * mPerDeg * cos);
      const diag = Math.hypot(dlat * mPerDeg, width);
      const zoom = Math.round(Math.log2((156543.03 * cos * 1000) / width));
      cells.push({
        lat: lat.toFixed(6),
        lon: lon.toFixed(6),
        radius: Math.max(1000, Math.ceil((1.15 * diag) / 2)),
        zoom: Math.min(17, Math.max(11, zoom)),
        bbox: [s + i * dlat, s + (i + 1) * dlat, w + j * dlon, w + (j + 1) * dlon],
      });
    }
  }
  return cells;
}

export function fallbackBbox(lat: number, lon: number, radiusMeters = 12000): [number, number, number, number] {
  const dLat = radiusMeters / 111320;
  const dLon = radiusMeters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lat + dLat, lon - dLon, lon + dLon];
}
