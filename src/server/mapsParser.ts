import type { PlaceRow } from './types.ts';

function dig(node: unknown, path: number[]): unknown {
  let cur: unknown = node;
  for (const idx of path) {
    if (!Array.isArray(cur) || idx >= cur.length || cur[idx] === null || cur[idx] === undefined) {
      return undefined;
    }
    cur = cur[idx];
  }
  return cur;
}

function asList(node: unknown, path: number[]): unknown[] {
  const val = dig(node, path);
  return Array.isArray(val) ? val : [];
}

function cleanText(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\u202f/g, ' ').trim() : '';
}

const TRACKING_PARAMS = ['utm_', 'gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid'];

export function cleanWebsite(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (TRACKING_PARAMS.some((prefix) => lower.startsWith(prefix))) {
        parsed.searchParams.delete(key);
        changed = true;
      }
    }
    if (parsed.hash && !parsed.hash.startsWith('#/') && !parsed.hash.startsWith('#!')) {
      parsed.hash = '';
      changed = true;
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

function plainUrl(url: unknown, schemes: string[] = ['https']): boolean {
  if (typeof url !== 'string' || url.length > 1000 || /[\s\x00-\x1f]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return schemes.includes(parsed.protocol.replace(':', '')) && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

const OLC = '23456789CFGHJMPQRVWX';

export function plusCode(latRaw: unknown, lonRaw: unknown): string {
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  const clampedLat = Math.min(Math.max(lat, -90), 90);
  let y = Math.min(Math.floor(Math.round((clampedLat + 90) * 8000 * 1e6) / 1e6), 180 * 8000 - 1);
  let x = Math.floor(Math.round((((lon + 180) % 360 + 360) % 360) * 8000 * 1e6) / 1e6) % (360 * 8000);
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = OLC[y % 20] + OLC[x % 20] + code;
    y = Math.floor(y / 20);
    x = Math.floor(x / 20);
  }
  return `${code.slice(0, 8)}+${code.slice(8)}`;
}

function parseOpenHours(days: unknown): string {
  if (!Array.isArray(days)) return '';
  const week = new Map<number, { name: string; spans: string[] }>();
  for (const d of days) {
    if (!Array.isArray(d) || d.length < 4 || typeof d[0] !== 'string' || typeof d[1] !== 'number') continue;
    const spans = asList(d, [3])
      .map((x) => (Array.isArray(x) && x.length > 0 ? cleanText(x[0]) : ''))
      .filter(Boolean);
    week.set(d[1], { name: d[0], spans });
  }
  if (week.size === 0) return '';
  const sorted: Record<string, string[]> = {};
  for (const [, entry] of [...week.entries()].sort((a, b) => a[0] - b[0])) {
    sorted[entry.name] = entry.spans;
  }
  return JSON.stringify(sorted);
}

function parseImages(entity: unknown): string {
  const found: Array<{ title: string; image: string }> = [];
  const seen = new Set<string>();
  const groups: Array<[unknown[], number[], number[]]> = [
    [asList(entity, [171, 0]), [3, 0, 6, 0], [2]],
    [asList(entity, [37, 0]), [6, 0], []],
    [asList(entity, [72, 0]), [6, 0], []],
  ];
  for (const [items, urlPath, titlePath] of groups) {
    for (const item of items) {
      const url = dig(item, urlPath);
      if (typeof url !== 'string' || !plainUrl(url) || seen.has(url)) continue;
      seen.add(url);
      const title = titlePath.length ? cleanText(dig(item, titlePath)) : '';
      found.push({ title, image: url });
      if (found.length >= 20) return JSON.stringify(found);
    }
  }
  return found.length ? JSON.stringify(found) : '';
}

function parseCompleteAddress(entity: unknown): string {
  const parts = dig(entity, [183, 1]);
  if (!Array.isArray(parts)) return '';
  const map: Record<string, number> = {
    borough: 0,
    street: 1,
    city: 3,
    postal_code: 4,
    state: 5,
    country: 6,
  };
  const out: Record<string, string> = {};
  let hasAny = false;
  for (const [key, idx] of Object.entries(map)) {
    const val = idx < parts.length ? cleanText(parts[idx]) : '';
    out[key] = val;
    if (val) hasAny = true;
  }
  return hasAny ? JSON.stringify(out) : '';
}

function parseAbout(entity: unknown): { about: string; cards: string } {
  const groups: Array<{ id: string; name: string; options: Array<{ name: string; enabled: boolean; values?: string[] }> }> = [];
  const cards: string[] = [];
  for (const g of asList(entity, [100, 1])) {
    if (!Array.isArray(g)) continue;
    const gid = cleanText(dig(g, [0]));
    const opts: Array<{ name: string; enabled: boolean; values?: string[] }> = [];
    for (const o of asList(g, [2])) {
      const name = cleanText(dig(o, [1]));
      if (!name) continue;
      const values = asList(o, [2, 4, 1, 0, 0])
        .map((x) => cleanText(dig(x, [2])) || cleanText(dig(x, [3])))
        .filter(Boolean);
      const on = dig(o, [2, 1, 0, 0]) === 1;
      const same = opts.find((x) => x.name === name);
      if (same) {
        same.enabled = same.enabled || on;
        for (const v of values) {
          if (!same.values) same.values = [];
          if (!same.values.includes(v)) same.values.push(v);
        }
      } else {
        opts.push(values.length ? { name, enabled: on, values } : { name, enabled: on });
      }
      if (gid === 'payments' && name === 'Credit cards') {
        for (const v of values) {
          if (!cards.includes(v)) cards.push(v);
        }
      }
    }
    if (gid || opts.length) {
      groups.push({ id: gid, name: cleanText(dig(g, [1])), options: opts });
    }
  }
  return {
    about: groups.length ? JSON.stringify(groups) : '',
    cards: cards.join(', '),
  };
}

function parseLinkSources(nodes: unknown, linkPath: number[], sourcePath: number[]): string {
  if (!Array.isArray(nodes)) return '';
  const out: Array<{ link: string; source: string }> = [];
  for (const item of nodes) {
    const url = dig(item, linkPath);
    const src = cleanText(dig(item, sourcePath));
    if (typeof url === 'string' && src && plainUrl(url, ['https', 'http']) && !out.some((x) => x.link === url)) {
      out.push({ link: url, source: src });
    }
  }
  return out.length ? JSON.stringify(out) : '';
}

function parseMenu(entity: unknown): string {
  const url = dig(entity, [38, 0]);
  const src = cleanText(dig(entity, [38, 1]));
  return typeof url === 'string' && plainUrl(url, ['https', 'http']) ? JSON.stringify({ link: url, source: src }) : '';
}

const FIELDS: Record<string, number[]> = {
  title: [11],
  category: [13, 0],
  address: [18],
  website: [7, 0],
  phone: [178, 0, 0],
  review_rating: [4, 7],
  review_count: [4, 8],
  reviews_link: [4, 3, 0],
  latitude: [9, 2],
  longitude: [9, 3],
  place_id: [78],
  data_id: [10],
  status: [203, 1, 4, 0],
  thumbnail: [72, 0, 0, 6, 0],
  timezone: [30],
  price_range: [4, 2],
  descriptions: [32, 1, 1],
};

export function emptyRow(): PlaceRow {
  return {
    input_id: '',
    link: '',
    title: '',
    category: '',
    categories: '',
    address: '',
    open_hours: '',
    popular_times: '',
    website: '',
    phone: '',
    plus_code: '',
    review_count: '',
    review_rating: '',
    reviews_per_rating: '',
    latitude: '',
    longitude: '',
    cid: '',
    status: '',
    descriptions: '',
    reviews_link: '',
    thumbnail: '',
    timezone: '',
    price_range: '',
    data_id: '',
    street_view_url: '',
    place_id: '',
    images: '',
    reservations: '',
    order_online: '',
    menu: '',
    owner: '',
    complete_address: '',
    credit_cards_accepted: '',
    about: '',
    user_reviews: '',
    user_reviews_extended: '',
    emails: '',
  };
}

export function parseEntity(entity: unknown): Partial<PlaceRow> {
  const out: Partial<PlaceRow> = {};
  for (const [key, path] of Object.entries(FIELDS)) {
    const val = dig(entity, path);
    if ((typeof val === 'string' || typeof val === 'number') && val !== '') {
      (out as Record<string, unknown>)[key] = key === 'website' ? cleanWebsite(String(val)) : String(val);
    }
  }
  const cats = dig(entity, [13]);
  if (Array.isArray(cats)) {
    const joined = cats.filter((x): x is string => typeof x === 'string' && x.length > 0).join(' | ');
    if (joined) out.categories = joined;
  }
  const hours = parseOpenHours(dig(entity, [203, 0]));
  if (hours) out.open_hours = hours;
  const imgs = parseImages(entity);
  if (imgs) out.images = imgs;
  const { about, cards } = parseAbout(entity);
  if (about) out.about = about;
  if (cards) out.credit_cards_accepted = cards;
  const addr = parseCompleteAddress(entity);
  if (addr) out.complete_address = addr;
  const res = parseLinkSources(dig(entity, [46]), [0], [1]);
  if (res) out.reservations = res;
  const orderGroup = asList(entity, [75, 0]).find((g) => dig(g, [0]) === 3);
  const ord = parseLinkSources(dig(orderGroup, [2]), [1, 2, 0], [0, 0]);
  if (ord) out.order_online = ord;
  const m = parseMenu(entity);
  if (m) out.menu = m;

  if (out.data_id && out.data_id.includes(':')) {
    const hex = out.data_id.split(':')[1];
    try {
      out.cid = BigInt(hex).toString();
    } catch {
      // ignore invalid hex
    }
  }
  if (out.latitude && out.longitude) {
    out.plus_code = plusCode(out.latitude, out.longitude);
  }
  if (out.title && out.data_id) {
    const q = encodeURIComponent(out.title);
    const pidPart = out.place_id ? `!19s${out.place_id}` : '';
    out.link = `https://www.google.com/maps/place/${q}/data=!4m7!3m6!1s${out.data_id}!8m2!3d${out.latitude || 0}!4d${out.longitude || 0}${pidPart}`;
  }
  return out;
}

export function parseBatch(body: string): Partial<PlaceRow>[] {
  const clean = body.startsWith(")]}'") ? body.split('\n').slice(1).join('\n') || body.slice(4) : body;
  let data: unknown;
  try {
    data = JSON.parse(clean);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const rows: Partial<PlaceRow>[] = [];
  // Format 1: tbm=map with pb= returns results at data[0][1][1..n][14]
  const list1 = dig(data, [0, 1]);
  if (Array.isArray(list1)) {
    for (const item of list1) {
      const entity = dig(item, [14]);
      if (Array.isArray(entity)) {
        const parsed = parseEntity(entity);
        if (parsed.title) rows.push(parsed);
      }
    }
  }
  if (rows.length > 0) return rows;

  // Format 2: older batch format at data[64][i][1]
  const list2 = dig(data, [64]);
  if (Array.isArray(list2)) {
    for (const item of list2) {
      const entity = dig(item, [1]);
      if (Array.isArray(entity)) {
        const parsed = parseEntity(entity);
        if (parsed.title) rows.push(parsed);
      }
    }
  }
  return rows;
}

export function parsePlaceReviews(body: string, limit: number): { reviews_per_rating?: string; user_reviews?: string } {
  const clean = body.startsWith(")]}'") ? body.split('\n').slice(1).join('\n') || body.slice(4) : body;
  let data: unknown;
  try {
    data = JSON.parse(clean);
  } catch {
    return {};
  }
  const entity = dig(data, [6]);
  if (!Array.isArray(entity)) return {};
  const out: { reviews_per_rating?: string; user_reviews?: string } = {};

  const hist = dig(entity, [175, 3]);
  if (Array.isArray(hist) && hist.length === 5 && hist.every((n) => typeof n === 'number')) {
    const obj: Record<string, number> = {};
    hist.forEach((n, idx) => {
      obj[String(idx + 1)] = n;
    });
    out.reviews_per_rating = JSON.stringify(obj);
  }

  const reviews: Array<{ Rating: number; When: string; Description: string }> = [];
  for (const r of asList(entity, [175, 9, 0, 0])) {
    const rating = dig(r, [0, 2, 0, 0]);
    const text = cleanText(dig(r, [0, 2, 15, 0, 0]));
    if (typeof rating === 'number') {
      reviews.push({
        Rating: rating,
        When: cleanText(dig(r, [0, 1, 6])),
        Description: text,
      });
      if (reviews.length >= limit) break;
    }
  }
  if (reviews.length > 0) {
    out.user_reviews = JSON.stringify(reviews);
  }
  return out;
}
