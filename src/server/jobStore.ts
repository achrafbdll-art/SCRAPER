import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { enrichWebsiteRow } from './enricher.ts';
import { runScrapeJob } from './scraper.ts';
import type { JobData, JobProgress, JobRecord, PlaceRow } from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

export const FULL_COLUMNS: Array<keyof PlaceRow> = [
  'input_id', 'link', 'title', 'category', 'address', 'open_hours', 'popular_times',
  'website', 'phone', 'plus_code', 'review_count', 'review_rating', 'reviews_per_rating',
  'latitude', 'longitude', 'cid', 'status', 'descriptions', 'reviews_link', 'thumbnail',
  'timezone', 'price_range', 'data_id', 'street_view_url', 'place_id', 'images',
  'reservations', 'order_online', 'menu', 'owner', 'complete_address',
  'credit_cards_accepted', 'about', 'user_reviews', 'user_reviews_extended', 'emails',
  'categories', 'email_host', 'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'x',
  'fb_pixel', 'google_ads_tag', 'analytics', 'bing_ads', 'linkedin_insight', 'tiktok_pixel',
  'cms', 'mobile_friendly', 'intent_score',
];

export const LEAD_COLUMNS: Array<keyof PlaceRow> = [
  'title', 'phone', 'emails', 'website', 'category', 'address', 'review_rating', 'review_count',
  'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'x',
  'email_host', 'cms', 'fb_pixel', 'google_ads_tag', 'analytics', 'intent_score',
];

export function csvSafe(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  const trimmed = s.trimStart();
  const guarded =
    trimmed.length > 0 && ['=', '+', '-', '@', '\t', '\r'].includes(trimmed[0]) ? `'${s}` : s;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function buildCsv(rows: PlaceRow[], columns: Array<keyof PlaceRow>): string {
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((col) => csvSafe(row[col])).join(','));
  return '\ufeff' + [header, ...lines].join('\r\n');
}

export function downloadSlug(job: JobRecord): string {
  const base = (job.Name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'results'}-${job.ID.slice(0, 8)}`;
}

export function maskProxies(proxies: string[]): string[] {
  return proxies.map((raw) => {
    try {
      const u = new URL(raw);
      if (u.password || u.username) {
        u.username = u.username ? '***' : '';
        u.password = u.password ? '***' : '';
      }
      return u.toString();
    } catch {
      return raw.replace(/\/\/[^@/]+@/, '//***:***@');
    }
  });
}

const LANG_RE = /^[A-Za-z]{2}$/;
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f]/;

function isCleanText(v: unknown): v is string {
  return typeof v === 'string' && !CONTROL_RE.test(v);
}

function asInt(body: Record<string, unknown>, key: string, def: number, lo: number, hi: number, label: string): number {
  const raw = body[key] ?? def;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < lo || raw > hi) {
    throw new Error(`invalid ${label}: a whole number from ${lo} to ${hi}`);
  }
  return raw;
}

function asBool(body: Record<string, unknown>, key: string, def = false): boolean {
  const raw = body[key];
  if (raw === undefined || raw === null) return def;
  if (typeof raw !== 'boolean') {
    throw new Error(`invalid ${key}: true or false`);
  }
  return raw;
}

export function validateJobBody(body: unknown): { name: string; data: JobData } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('the body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (!isCleanText(b.name) || !b.name.trim()) throw new Error('missing name');
  if (b.name.length > 200) throw new Error('invalid name: 200 characters at most');

  if (!Array.isArray(b.keywords) || b.keywords.length === 0) throw new Error('missing keywords');
  if (
    b.keywords.length > 500 ||
    !b.keywords.every((k) => isCleanText(k) && k.trim().length > 0 && k.length <= 500)
  ) {
    throw new Error('invalid keywords: 1 to 500 non-empty strings of up to 500 characters');
  }

  if (b.lang === undefined || b.lang === null || b.lang === '') throw new Error('missing lang');
  if (typeof b.lang !== 'string' || !LANG_RE.test(b.lang)) throw new Error('invalid lang');

  let country = '';
  if (b.country !== undefined && b.country !== null && b.country !== '') {
    if (typeof b.country !== 'string' || !LANG_RE.test(b.country)) {
      throw new Error('invalid country: a 2-letter country code such as us or de');
    }
    country = b.country.toLowerCase();
  }

  const hasLat = b.lat !== undefined && b.lat !== null && b.lat !== '';
  const hasLon = b.lon !== undefined && b.lon !== null && b.lon !== '';
  if (hasLat !== hasLon) throw new Error('missing geo coordinates');

  let lat = '';
  let lon = '';
  if (hasLat && hasLon) {
    const fLat = Number(b.lat);
    const fLon = Number(b.lon);
    if (
      typeof b.lat === 'boolean' ||
      typeof b.lon === 'boolean' ||
      !Number.isFinite(fLat) ||
      !Number.isFinite(fLon) ||
      fLat < -90 ||
      fLat > 90 ||
      fLon < -180 ||
      fLon > 180
    ) {
      throw new Error('invalid geo coordinates');
    }
    lat = String(fLat);
    lon = String(fLon);
  }

  if (b.max_time === undefined || b.max_time === null || b.max_time === 0) {
    throw new Error('missing max time');
  }

  const proxies: string[] = [];
  if (b.proxies !== undefined && b.proxies !== null) {
    if (!Array.isArray(b.proxies)) throw new Error('invalid proxies: list of URLs');
    for (const p of b.proxies) {
      if (typeof p !== 'string' || !/^(https?|socks5h?):\/\/.+/.test(p.trim())) {
        throw new Error('invalid proxy URL: must start with http://, https://, socks5://, or socks5h://');
      }
      proxies.push(p.trim());
    }
  }

  return {
    name: b.name.trim(),
    data: {
      keywords: b.keywords.map((k: string) => k.trim()),
      lang: b.lang.toLowerCase(),
      country,
      lat,
      lon,
      zoom: asInt(b, 'zoom', 15, 1, 21, 'zoom'),
      radius: asInt(b, 'radius', 10000, 0, 1e9, 'radius'),
      depth: asInt(b, 'depth', 5, 1, 1000, 'depth'),
      max_time: asInt(b, 'max_time', 600, 1, 86400, 'max time'),
      grid: asInt(b, 'grid', 1, 1, 4, 'grid'),
      fast_mode: asBool(b, 'fast_mode', false),
      email: asBool(b, 'email', true),
      verify_emails: asBool(b, 'verify_emails', false),
      socials: asBool(b, 'socials', true),
      tech: asBool(b, 'tech', true),
      browser_sites: asBool(b, 'browser_sites', false),
      reviews_max: asInt(b, 'reviews_max', 0, 0, 5, 'reviews_max'),
      proxies,
    },
  };
}

class JobStore {
  private jobs = new Map<string, JobRecord>();
  private rows = new Map<string, PlaceRow[]>();
  private cancelled = new Set<string>();
  private running = false;

  constructor() {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(JOBS_FILE)) return;
      const list = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8')) as JobRecord[];
      if (!Array.isArray(list)) return;
      for (const job of list) {
        // Recover interrupted jobs from prior session cleanly
        if (job.Status === 'working') {
          job.Status = 'pending';
          job.Progress = { ...job.Progress, stage: 'queued' };
        }
        this.jobs.set(job.ID, job);
        const rPath = path.join(RESULTS_DIR, `${job.ID}.json`);
        if (fs.existsSync(rPath)) {
          try {
            const loadedRows = JSON.parse(fs.readFileSync(rPath, 'utf-8')) as PlaceRow[];
            if (Array.isArray(loadedRows)) this.rows.set(job.ID, loadedRows);
          } catch {
            // skip corrupt rows file
          }
        }
      }
      this.saveJobsIndex();
      this.pump();
    } catch {
      // start clean if corrupt
    }
  }

  private saveJobsIndex(): void {
    try {
      const list = [...this.jobs.values()].sort((a, b) => b.Date.localeCompare(a.Date));
      fs.writeFileSync(JOBS_FILE, JSON.stringify(list, null, 2));
    } catch {
      // ignore disk write issues
    }
  }

  private saveJobRows(id: string, rows: PlaceRow[]): void {
    try {
      fs.writeFileSync(path.join(RESULTS_DIR, `${id}.json`), JSON.stringify(rows));
    } catch {
      // ignore disk write issues
    }
  }

  private redact(job: JobRecord): JobRecord {
    return {
      ...job,
      Data: {
        ...job.Data,
        proxies: maskProxies(job.Data.proxies || []),
      },
    };
  }

  list(): JobRecord[] {
    return [...this.jobs.values()]
      .sort((a, b) => b.Date.localeCompare(a.Date))
      .map((j) => this.redact(j));
  }

  get(id: string): JobRecord | null {
    const job = this.jobs.get(id);
    return job ? this.redact(job) : null;
  }

  getRows(id: string): PlaceRow[] | null {
    if (!this.jobs.has(id)) return null;
    return this.rows.get(id) || [];
  }

  create(name: string, data: JobData): string {
    const id = crypto.randomUUID();
    const record: JobRecord = {
      ID: id,
      Name: name,
      Date: new Date().toISOString(),
      Status: 'pending',
      Data: data,
      Error: '',
      Progress: {
        keywords_done: 0,
        keywords_total: data.keywords.length * (data.grid > 1 && data.lat ? data.grid * data.grid : 1),
        places: 0,
        percent: 0,
        stage: 'queued',
      },
    };
    this.jobs.set(id, record);
    this.rows.set(id, []);
    this.saveJobsIndex();
    this.pump();
    return id;
  }

  delete(id: string): boolean {
    if (!this.jobs.has(id)) return false;
    this.cancelled.add(id);
    this.jobs.delete(id);
    this.rows.delete(id);
    this.saveJobsIndex();
    try {
      const rPath = path.join(RESULTS_DIR, `${id}.json`);
      if (fs.existsSync(rPath)) fs.unlinkSync(rPath);
    } catch {
      // ignore
    }
    return true;
  }

  private pump(): void {
    if (this.running) return;
    const next = [...this.jobs.values()]
      .filter((j) => j.Status === 'pending')
      .sort((a, b) => a.Date.localeCompare(b.Date))[0];
    if (!next) return;

    this.running = true;
    void this.executeJob(next).finally(() => {
      this.running = false;
      this.pump();
    });
  }

  private async executeJob(job: JobRecord): Promise<void> {
    if (this.cancelled.has(job.ID)) return;
    job.Status = 'working';
    job.Progress = { ...job.Progress, stage: 'search', percent: 2 };
    this.saveJobsIndex();

    try {
      const { rows, warning } = await runScrapeJob(job.Data, {
        jobName: job.Name,
        isCancelled: () => this.cancelled.has(job.ID) || !this.jobs.has(job.ID),
        onProgress: (patch: Partial<JobProgress>) => {
          if (!this.jobs.has(job.ID)) return;
          job.Progress = { ...job.Progress, ...patch };
        },
        onRows: (latestRows: PlaceRow[]) => {
          if (!this.jobs.has(job.ID)) return;
          this.rows.set(job.ID, latestRows);
        },
      });

      if (this.cancelled.has(job.ID) || !this.jobs.has(job.ID)) return;
      this.rows.set(job.ID, rows);
      this.saveJobRows(job.ID, rows);
      job.Status = 'ok';
      job.Error = warning;
      job.Progress = { ...job.Progress, places: rows.length, percent: 100, stage: 'done' };
      this.saveJobsIndex();
    } catch (err) {
      if (this.cancelled.has(job.ID) || !this.jobs.has(job.ID)) return;
      job.Status = 'failed';
      job.Error = err instanceof Error ? err.message : 'Job failed unexpectedly';
      this.saveJobsIndex();
    }
  }

  async startEmailEnrichment(id: string): Promise<{ started: boolean; targets: number; reason?: string }> {
    const job = this.jobs.get(id);
    if (!job) return { started: false, targets: 0, reason: 'job not found' };
    if (job.Status === 'working' || job.Status === 'pending') {
      return { started: false, targets: 0, reason: 'job is already running' };
    }
    const rows = this.rows.get(id) || [];
    const targets = rows.filter((r) => Boolean(r.website) && !r.emails);
    if (targets.length === 0) {
      return { started: false, targets: 0, reason: 'all rows with websites already have emails' };
    }

    job.Status = 'working';
    job.Data.email = true;
    job.Error = '';
    job.Progress = {
      ...job.Progress,
      stage: 'websites',
      websites_done: 0,
      websites_total: targets.length,
      percent: 5,
    };
    this.saveJobsIndex();

    void (async () => {
      let done = 0;
      let cursor = 0;
      const concurrency = Math.min(8, targets.length);
      const workers = Array.from({ length: concurrency }, async () => {
        while (!this.cancelled.has(id) && this.jobs.has(id)) {
          const idx = cursor++;
          if (idx >= targets.length) break;
          await enrichWebsiteRow(targets[idx], {
            email: true,
            socials: true,
            verifyEmails: job.Data.verify_emails,
            tech: job.Data.tech,
            deepEmail: true,
          });
          done++;
          job.Progress = {
            ...job.Progress,
            stage: 'websites',
            websites_done: done,
            websites_total: targets.length,
            percent: Math.min(98, Math.max(5, Math.round((done / targets.length) * 95))),
          };
        }
      });
      await Promise.all(workers);
      if (!this.cancelled.has(id) && this.jobs.has(id)) {
        this.saveJobRows(id, rows);
        job.Status = 'ok';
        job.Progress = { ...job.Progress, stage: 'done', percent: 100 };
        this.saveJobsIndex();
      }
    })();

    return { started: true, targets: targets.length };
  }
}

export const jobStore = new JobStore();
