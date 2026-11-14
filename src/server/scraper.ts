import { enrichWebsiteRow } from './enricher.ts';
import { emptyRow, parseBatch, parsePlaceReviews } from './mapsParser.ts';
import { fallbackBbox, geocodePlace, gridCells } from './presets.ts';
import type { GridCell, JobData, JobProgress, PlaceRow } from './types.ts';

const MAPS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAPS_COOKIE =
  'CONSENT=YES+cb.20210720-07-p0.en+FX+410; SOCS=CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiAo_CmBg';

function cameraDistanceMeters(lat: number, zoom: number): number {
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dist = Math.round((156543.03 * cos * 1024) / Math.pow(2, zoom));
  return Math.min(200000, Math.max(1200, dist));
}

function buildMapsBatchUrl(
  keyword: string,
  opts: { lat: string; lon: string; zoom: number; lang: string; country: string; offset: number },
): string {
  const latNum = Number(opts.lat);
  const lonNum = Number(opts.lon);
  const hasCoords = opts.lat !== '' && opts.lon !== '' && Number.isFinite(latNum) && Number.isFinite(lonNum);
  const lat = hasCoords ? latNum : 39.8283;
  const lon = hasCoords ? lonNum : -98.5795;
  const dist = hasCoords ? cameraDistanceMeters(lat, opts.zoom) : 50000;

  const pb =
    `!4m12!1m3!1d${dist}!2d${lon}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1` +
    `!7i20!8i${opts.offset}!10b1!12m8!1m1!18b1!2m3!5m1!6e2!20e3!10b1!16b1` +
    `!19m4!2m3!1i360!2i120!4i8!20m3!2m2!1i203!2i100!3m2!2i4!5b1!6m6!1m2!1i86!2i86!1m2!1i408!2i240`;

  const params = new URLSearchParams({
    tbm: 'map',
    authuser: '0',
    hl: opts.lang || 'en',
    q: keyword,
    pb,
  });
  if (opts.country) params.set('gl', opts.country);
  return `https://www.google.com/search?${params.toString()}`;
}

async function fetchMapsBatch(
  keyword: string,
  opts: { lat: string; lon: string; zoom: number; lang: string; country: string; offset: number },
): Promise<{ rows: Partial<PlaceRow>[]; limited: boolean }> {
  const url = buildMapsBatchUrl(keyword, opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': MAPS_UA,
        'Accept-Language': `${opts.lang || 'en'}-US,${opts.lang || 'en'};q=0.9`,
        Cookie: MAPS_COOKIE,
      },
      signal: controller.signal,
    });
    if (res.status === 429) {
      return { rows: [], limited: true };
    }
    if (!res.ok) {
      return { rows: [], limited: false };
    }
    const text = await res.text();
    if (text.includes('unusual traffic') || text.includes('sorry/index')) {
      return { rows: [], limited: true };
    }
    return { rows: parseBatch(text), limited: false };
  } catch {
    return { rows: [], limited: false };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPlaceReviews(
  row: PlaceRow,
  opts: { lang: string; country: string; limit: number },
): Promise<void> {
  if (!row.data_id) return;
  const lat = Number(row.latitude) || 0;
  const lon = Number(row.longitude) || 0;
  const pb = `!1m14!1s${row.data_id}!3m8!1m3!1d10000!2d${lon}!3d${lat}!3m2!1i1024!2i768!4f13.1!12m3!1e1!2b1!4e2!16m1!1b1`;
  const params = new URLSearchParams({
    authuser: '0',
    hl: opts.lang || 'en',
    pb,
  });
  if (opts.country) params.set('gl', opts.country);
  const url = `https://www.google.com/maps/preview/place?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': MAPS_UA, Cookie: MAPS_COOKIE },
      signal: controller.signal,
    });
    if (!res.ok) return;
    const text = await res.text();
    const parsed = parsePlaceReviews(text, opts.limit);
    if (parsed.reviews_per_rating) row.reviews_per_rating = parsed.reviews_per_rating;
    if (parsed.user_reviews) row.user_reviews = parsed.user_reviews;
  } catch {
    // ignore single place review failure
  } finally {
    clearTimeout(timer);
  }
}

function rowDedupeKey(r: Partial<PlaceRow>): string {
  if (r.place_id) return `pid:${r.place_id}`;
  if (r.cid) return `cid:${r.cid}`;
  if (r.data_id) return `did:${r.data_id}`;
  return `ta:${(r.title || '').toLowerCase()}|${(r.address || '').toLowerCase()}`;
}

function inBbox(row: Partial<PlaceRow>, bbox: [number, number, number, number], margin = 0.12): boolean {
  const lat = Number(row.latitude);
  const lon = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;
  const [s, n, w, e] = bbox;
  const my = (n - s) * margin;
  const mx = (e - w) * margin;
  return lat >= s - my && lat <= n + my && lon >= w - mx && lon <= e + mx;
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<void>,
  shouldStop: () => boolean,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!shouldStop()) {
      const idx = cursor++;
      if (idx >= items.length) break;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

export async function runScrapeJob(
  data: JobData,
  opts: {
    jobName: string;
    onProgress: (p: Partial<JobProgress>) => void;
    onRows: (rows: PlaceRow[]) => void;
    isCancelled: () => boolean;
  },
): Promise<{ rows: PlaceRow[]; warning: string }> {
  const deadline = Date.now() + data.max_time * 1000;
  const timedOut = () => Date.now() >= deadline;
  const shouldStop = () => opts.isCancelled() || timedOut();

  // Build search tasks: keywords x grid tiles
  let cells: Array<GridCell | null> = [null];
  if (data.grid > 1 && data.lat && data.lon) {
    const geo = await geocodePlace(opts.jobName.replace(/^.*?\sin\s+/i, '').trim());
    const bbox =
      geo?.boundingbox || fallbackBbox(Number(data.lat), Number(data.lon), data.grid >= 3 ? 16000 : 12000);
    cells = gridCells(bbox, data.grid);
  }

  const tasks: Array<{ keyword: string; cell: GridCell | null }> = [];
  for (const keyword of data.keywords) {
    for (const cell of cells) {
      tasks.push({ keyword, cell });
    }
  }

  const totalTasks = tasks.length;
  const seen = new Set<string>();
  const rows: PlaceRow[] = [];
  const warnings: string[] = [];
  let tasksDone = 0;

  opts.onProgress({
    keywords_done: 0,
    keywords_total: totalTasks,
    places: 0,
    percent: 2,
    stage: 'search',
  });

  for (const task of tasks) {
    if (shouldStop()) break;
    const lat = task.cell ? task.cell.lat : data.lat;
    const lon = task.cell ? task.cell.lon : data.lon;
    const zoom = task.cell ? task.cell.zoom : data.zoom;

    let offset = 0;
    let emptyInARow = 0;
    for (let page = 0; page < data.depth; page++) {
      if (shouldStop()) break;
      const { rows: batch, limited } = await fetchMapsBatch(task.keyword, {
        lat,
        lon,
        zoom,
        lang: data.lang,
        country: data.country,
        offset,
      });

      if (limited) {
        warnings.push('Google Maps temporarily rate-limited a request; kept collected places.');
        break;
      }

      if (batch.length === 0) {
        emptyInARow++;
        if (emptyInARow >= 1) break;
      } else {
        emptyInARow = 0;
      }

      let addedThisBatch = 0;
      for (const partial of batch) {
        if (task.cell && !inBbox(partial, task.cell.bbox)) continue;
        const key = rowDedupeKey(partial);
        if (seen.has(key)) continue;
        seen.add(key);
        const full = { ...emptyRow(), ...partial, input_id: task.keyword };
        rows.push(full);
        addedThisBatch++;
      }

      opts.onRows([...rows]);
      offset += 20;

      // Update fine-grained progress inside search phase
      const hasPostPass = data.reviews_max > 0 || data.email || data.socials || data.tech;
      const searchWeight = hasPostPass ? 55 : 95;
      const taskFrac = (tasksDone + (page + 1) / Math.max(1, data.depth)) / Math.max(1, totalTasks);
      opts.onProgress({
        keywords_done: tasksDone,
        keywords_total: totalTasks,
        places: rows.length,
        percent: Math.min(searchWeight, Math.max(5, Math.round(taskFrac * searchWeight))),
        stage: 'search',
      });

      if (batch.length < 15 || (addedThisBatch === 0 && page > 0)) {
        break;
      }

      // Gentle delay between pagination requests
      await new Promise((r) => setTimeout(r, 350));
    }

    tasksDone++;
    opts.onProgress({
      keywords_done: tasksDone,
      keywords_total: totalTasks,
      places: rows.length,
      stage: 'search',
    });
  }

  if (timedOut() && tasksDone < totalTasks) {
    warnings.push(`Reached max time (${data.max_time}s) during search; kept ${rows.length} places.`);
  }

  // Reviews pass
  if (data.reviews_max > 0 && rows.length > 0 && !shouldStop()) {
    let reviewsDone = 0;
    opts.onProgress({
      stage: 'reviews',
      reviews_done: 0,
      reviews_total: rows.length,
      places: rows.length,
      percent: 60,
    });

    await runPool(
      rows,
      4,
      async (row) => {
        await fetchPlaceReviews(row, {
          lang: data.lang,
          country: data.country,
          limit: data.reviews_max,
        });
        reviewsDone++;
        const base = 60;
        const span = data.email || data.socials || data.tech ? 15 : 35;
        opts.onProgress({
          stage: 'reviews',
          reviews_done: reviewsDone,
          reviews_total: rows.length,
          percent: Math.min(95, base + Math.round((reviewsDone / rows.length) * span)),
        });
      },
      shouldStop,
    );
    opts.onRows([...rows]);
  }

  // Website enrichment pass (emails, MX check, socials, tech/intent_score)
  if ((data.email || data.socials || data.tech) && rows.length > 0 && !opts.isCancelled()) {
    const siteDeadline = Math.max(Date.now() + 45_000, deadline);
    const stopSites = () => opts.isCancelled() || Date.now() >= siteDeadline;
    const withSites = rows.filter((r) => Boolean(r.website));
    let websitesDone = 0;
    const startPct = data.reviews_max > 0 ? 75 : 58;

    opts.onProgress({
      stage: 'websites',
      websites_done: 0,
      websites_total: withSites.length,
      places: rows.length,
      percent: startPct,
    });

    await runPool(
      rows,
      10,
      async (row) => {
        await enrichWebsiteRow(row, {
          email: data.email,
          socials: data.socials,
          verifyEmails: data.verify_emails,
          tech: data.tech,
          deepEmail: data.email,
        });
        if (row.website) websitesDone++;
        const frac = withSites.length > 0 ? websitesDone / withSites.length : 1;
        opts.onProgress({
          stage: 'websites',
          websites_done: websitesDone,
          websites_total: withSites.length,
          percent: Math.min(98, startPct + Math.round(frac * (98 - startPct))),
        });
      },
      stopSites,
    );

    opts.onRows([...rows]);
  }

  opts.onProgress({
    keywords_done: tasksDone,
    keywords_total: totalTasks,
    places: rows.length,
    percent: 100,
    stage: 'done',
  });

  return { rows, warning: warnings.join(' ') };
}
