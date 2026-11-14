import dns from 'node:dns/promises';
import net from 'node:net';
import type { PlaceRow } from './types.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_BODY_BYTES = 1_200_000;
const FETCH_TIMEOUT_MS = 9500;

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPublicIP(ip: string): boolean {
  const clean = ip.split('%')[0].toLowerCase();
  if (net.isIPv4(clean)) return !isPrivateIPv4(clean);
  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return false;
    if (clean.startsWith('::ffff:')) {
      const v4 = clean.slice(7);
      if (net.isIPv4(v4)) return !isPrivateIPv4(v4);
    }
    if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) return false;
    return true;
  }
  return false;
}

const publicHostCache = new Map<string, boolean>();

export async function isPublicHost(hostname: string): Promise<boolean> {
  if (!hostname) return false;
  const key = hostname.toLowerCase();
  const cached = publicHostCache.get(key);
  if (cached !== undefined) return cached;
  if (net.isIP(key)) {
    const ok = isPublicIP(key);
    publicHostCache.set(key, ok);
    return ok;
  }
  try {
    const addrs = await dns.lookup(key, { all: true });
    const ok = addrs.length > 0 && addrs.every((a) => isPublicIP(a.address));
    if (publicHostCache.size > 1024) publicHostCache.clear();
    publicHostCache.set(key, ok);
    return ok;
  } catch {
    return false;
  }
}

async function fetchHtmlSingle(url: string, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'): Promise<{ html: string; finalUrl: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`);
  } catch {
    return { html: '', finalUrl: '' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { html: '', finalUrl: '' };
  if (!(await isPublicHost(parsed.hostname))) return { html: '', finalUrl: '' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': UA,
        Accept: accept,
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { html: '', finalUrl: res.url || parsed.toString() };
    const finalUrl = res.url || parsed.toString();
    try {
      const finalParsed = new URL(finalUrl);
      if (!(await isPublicHost(finalParsed.hostname))) return { html: '', finalUrl: '' };
    } catch {
      return { html: '', finalUrl: '' };
    }
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype && !/(html|text|json|xml|javascript)/.test(ctype)) {
      return { html: '', finalUrl };
    }
    const reader = res.body?.getReader();
    if (!reader) return { html: await res.text(), finalUrl };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const slice = total + value.length > MAX_BODY_BYTES ? value.subarray(0, MAX_BODY_BYTES - total) : value;
      chunks.push(slice);
      total += slice.length;
    }
    reader.cancel().catch(() => {});
    return { html: Buffer.concat(chunks).toString('utf-8'), finalUrl };
  } catch {
    return { html: '', finalUrl: '' };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHomepage(url: string): Promise<{ html: string; finalUrl: string }> {
  if (!url) return { html: '', finalUrl: '' };
  const normalized = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
  const initial = await fetchHtmlSingle(normalized);
  if (initial.html) return initial;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname;
    const otherHost = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
    const otherScheme = parsed.protocol === 'http:' ? 'https:' : 'http:';
    const tail = `${parsed.pathname}${parsed.search}`;
    const variants = [
      `${otherScheme}//${host}${tail}`,
      `${parsed.protocol}//${otherHost}${tail}`,
      `${otherScheme}//${otherHost}${tail}`,
    ];
    for (const v of variants) {
      const res = await fetchHtmlSingle(v);
      if (res.html) return res;
    }
  } catch {
    return { html: '', finalUrl: '' };
  }
  return { html: '', finalUrl: '' };
}

export function siteHost(url: string): string {
  try {
    const h = new URL(url.includes('://') ? url : `http://${url}`).hostname.toLowerCase();
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return '';
  }
}

const JUNK_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.css', '.js', '.woff', '.woff2', '.ttf'];
const JUNK_DOMAINS = [
  'example', 'sentry', 'wixpress', 'wix.com', 'godaddy', 'squarespace', 'wordpress',
  'domain.com', 'email.com', 'yourdomain', 'mysite.com', 'schema.org', 'w3.org', 'sentry.io',
  'linktr.ee', 'linkin.bio', 'beacons.ai', 'officite', 'shopify.com', 'myshopify.com',
  'gov', 'mil', 'hubspot', 'mailchimp', 'constantcontact', 'sendgrid', 'yext', 'birdeye', 'podium', 'zocdoc',
  'cloudflare.com', 'googleapis.com', 'gstatic.com', 'ingest.sentry.io', 'squarespace-mail.com',
];
const JUNK_LOCALS = new Set([
  'name', 'email', 'user', 'you', 'someone', 'example', 'username',
  'youremail', 'yourname', 'firstname', 'lastname', 'sample', 'test',
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster',
  'abuse', 'phishing', 'spoof', 'spam', 'fraud', 'dmca', 'hostmaster', 'webmaster',
]);
const PREFERRED_LOCALS = ['contact', 'info', 'hello', 'bonjour', 'hi', 'support', 'sales', 'booking', 'office', 'admin', 'team', 'service'];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,15}/g;
const MAILTO_RE = /mailto:([^"'>\s?&]+)/gi;
const CF_EMAIL_RE = /(?:data-cfemail=["']|\/cdn-cgi\/l\/email-protection#)([0-9a-fA-F]{6,})/gi;
const OBFUSCATED_EMAIL_RE =
  /([A-Za-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\[arrobase\]|\(arrobase\)|\[@\])\s*([A-Za-z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\[point\]|\(point\)|\.)\s*([A-Za-z]{2,15})/gi;
const TOKEN_LOCAL_RE = /^[0-9a-f]{16,}$/;

function decodeCfEmail(hex: string): string {
  if (hex.length < 4 || hex.length % 2 !== 0) return '';
  const key = parseInt(hex.slice(0, 2), 16);
  if (Number.isNaN(key)) return '';
  let out = '';
  for (let i = 2; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16) ^ key;
    out += String.fromCharCode(code);
  }
  return out;
}

function decodeHtmlAndEscapes(raw: string): string {
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&#(\d{2,4});/g, (_, dec) => {
      const code = Number(dec);
      return code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
    })
    .replace(/&#x([0-9a-f]{2,4});/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
    })
    .replace(/\\u0040/gi, '@')
    .replace(/\\u002e/gi, '.')
    .replace(/\\u003[ce]|\\u0022|\\u0027|\\u0026/gi, ' ');
}

function isJunkDomain(dom: string): boolean {
  const labels = dom.split('.');
  return JUNK_DOMAINS.some((j) => (j.includes('.') ? dom === j || dom.endsWith(`.${j}`) : labels.includes(j)));
}

export function isRealEmail(email: string): boolean {
  const lower = email.toLowerCase().trim().replace(/\.+$/, '');
  const at = lower.lastIndexOf('@');
  if (at <= 0) return false;
  const local = lower.slice(0, at);
  const dom = lower.slice(at + 1);
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,15}$/.test(lower)) return false;
  if (local.length > 64 || dom.length > 120) return false;
  if (/^\d+x\d+$/.test(local) || /@\d/.test(lower)) return false;
  if (JUNK_EXT.some((ext) => lower.endsWith(ext))) return false;
  if (TOKEN_LOCAL_RE.test(local)) return false;
  if (JUNK_LOCALS.has(local) || isJunkDomain(dom)) return false;
  return true;
}

export function findEmails(html: string, host = ''): string[] {
  if (!html) return [];
  const candidates = new Set<string>();

  // 1. Decode Cloudflare protected emails before entity decoding
  CF_EMAIL_RE.lastIndex = 0;
  for (const m of html.matchAll(CF_EMAIL_RE)) {
    const decoded = decodeCfEmail(m[1]).toLowerCase().trim();
    if (isRealEmail(decoded)) candidates.add(decoded);
  }

  // 2. Decode HTML numeric entities & JSON unicode escapes
  const decoded = decodeHtmlAndEscapes(html);

  MAILTO_RE.lastIndex = 0;
  for (const m of decoded.matchAll(MAILTO_RE)) {
    try {
      const addr = decodeURIComponent(m[1]).trim().toLowerCase().replace(/^mailto:/, '');
      if (isRealEmail(addr)) candidates.add(addr);
    } catch {
      // skip malformed
    }
  }

  EMAIL_RE.lastIndex = 0;
  for (const m of decoded.matchAll(EMAIL_RE)) {
    const addr = m[0].toLowerCase();
    if (isRealEmail(addr)) candidates.add(addr);
  }

  OBFUSCATED_EMAIL_RE.lastIndex = 0;
  for (const m of decoded.matchAll(OBFUSCATED_EMAIL_RE)) {
    const addr = `${m[1]}@${m[2]}.${m[3]}`.toLowerCase();
    if (isRealEmail(addr)) candidates.add(addr);
  }

  const list = [...candidates];
  list.sort((a, b) => {
    const aOwn = host && (a.endsWith(`@${host}`) || a.endsWith(`.${host}`)) ? 0 : 1;
    const bOwn = host && (b.endsWith(`@${host}`) || b.endsWith(`.${host}`)) ? 0 : 1;
    if (aOwn !== bOwn) return aOwn - bOwn;
    const aPref = PREFERRED_LOCALS.some((p) => a.startsWith(`${p}@`)) ? 0 : 1;
    const bPref = PREFERRED_LOCALS.some((p) => b.startsWith(`${p}@`)) ? 0 : 1;
    return aPref - bPref;
  });

  return list.slice(0, 5);
}

const SKIP_HANDLES = new Set([
  'share', 'sharer', 'intent', 'login', 'signup', 'home', 'watch', 'privacy', 'terms', 'help', 'about', 'policies', 'p', 'reel', 'reels', 'explore',
]);

const SOCIAL_REGEXES: Record<'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube' | 'x', RegExp> = {
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._-]+)\/?/gi,
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9._-]+)\/?/gi,
  linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([A-Za-z0-9._-]+)\/?/gi,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]+)\/?/gi,
  youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)([A-Za-z0-9._-]+)\/?/gi,
  x: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,30})\/?/gi,
};

export function findSocials(html: string): Partial<Record<'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube' | 'x', string>> {
  const out: Partial<Record<'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube' | 'x', string>> = {};
  if (!html) return out;
  for (const [net, rx] of Object.entries(SOCIAL_REGEXES) as Array<[keyof typeof SOCIAL_REGEXES, RegExp]>) {
    rx.lastIndex = 0;
    for (const m of html.matchAll(rx)) {
      const handle = m[1].toLowerCase();
      if (SKIP_HANDLES.has(handle)) continue;
      if (net === 'facebook' && (/^\d+$/.test(handle) || handle.length < 3)) continue;
      out[net] = m[0].replace(/["'\\]+$/, '');
      break;
    }
  }
  return out;
}

const CONTACT_HREF_RE = /<a\s[^>]{0,600}?href\s*=\s*["']([^"']{1,500})["'][^>]*>([\s\S]{0,400}?)<\/a>/gi;
const SKIP_EXTERNAL_HOSTS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'youtube.com', 'twitter.com', 'x.com',
  'google.com', 'yelp.com', 'tripadvisor.com', 'opentable.com', 'doordash.com', 'ubereats.com', 'grubhub.com',
  'toasttab.com', 'squareup.com', 'square.site', 'shopify.com', 'wix.com', 'squarespace.com', 'wordpress.org',
  'apple.com', 'play.google.com', 'youtube.be', 'youtu.be',
];

function isExternalNoiseHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return SKIP_EXTERNAL_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

const HIGH_PRIORITY_PAGE_RE = /\b(contact|contact-us|contactez|nous-contacter|mentions-legales|legal|impressum|privacy|confidentialite|faq|catering|events|about|a-propos|qui-sommes-nous|team|equipe|support|help|info|book|appointments|locations)\b/i;

export function findCandidateSubpages(html: string, baseUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`);
  } catch {
    return [];
  }
  const baseRoot = siteHost(base.toString());
  const prioritized: Array<{ url: string; score: number }> = [];
  const seen = new Set<string>([base.toString().replace(/\/$/, '')]);

  const addCandidate = (rawUrl: string, score: number) => {
    const clean = rawUrl.split('#')[0];
    const norm = clean.replace(/\/$/, '');
    if (seen.has(norm)) return;
    seen.add(norm);
    prioritized.push({ url: clean, score });
  };

  // If the listing points to a deep path (e.g. /locations/austin), check root homepage first
  if (base.pathname && base.pathname !== '/') {
    addCandidate(base.origin + '/', 100);
  }

  CONTACT_HREF_RE.lastIndex = 0;
  for (const m of html.matchAll(CONTACT_HREF_RE)) {
    const href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('tel:') || href.startsWith('mailto:')) {
      continue;
    }
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const combined = `${href} ${label}`;
    if (!HIGH_PRIORITY_PAGE_RE.test(combined)) continue;

    try {
      const resolved = new URL(href, base);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
      if (/\.(pdf|jpg|jpeg|png|webp|svg|zip|mp4)$/i.test(resolved.pathname)) continue;
      const targetRoot = siteHost(resolved.toString());
      const sameSite = targetRoot === baseRoot;
      if (!sameSite && isExternalNoiseHost(resolved.hostname)) continue;

      let score = sameSite ? 50 : 25;
      if (/contact|contactez|nous-contacter/i.test(combined)) score += 40;
      else if (/mentions-legales|legal|impressum|privacy|confidentialite/i.test(combined)) score += 30;
      else if (/faq|catering|events|book|support|info/i.test(combined)) score += 20;
      else if (/about|a-propos|team|equipe/i.test(combined)) score += 15;

      addCandidate(resolved.toString(), score);
    } catch {
      // ignore invalid URL
    }
  }

  // Fallback standard paths on the business's origin
  const standardPaths = [
    ['/contact', 45],
    ['/contact-us', 42],
    ['/contactez-nous', 40],
    ['/pages/contact', 38],
    ['/pages/faq', 35],
    ['/mentions-legales', 34],
    ['/about', 30],
    ['/about-us', 28],
    ['/privacy-policy', 24],
    ['/policies/privacy-policy', 22],
  ] as const;

  for (const [p, score] of standardPaths) {
    addCandidate(`${base.origin}${p}`, score);
  }

  prioritized.sort((a, b) => b.score - a.score);
  return prioritized.map((x) => x.url).slice(0, 8);
}

const mxCache = new Map<string, string>();

export async function lookupMxHost(domain: string): Promise<string> {
  if (!domain) return '';
  const d = domain.toLowerCase();
  const cached = mxCache.get(d);
  if (cached !== undefined) return cached;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(d)}&type=MX`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return '';
    const ans = (await res.json()) as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
    const mx = (ans.Answer || [])
      .filter((a) => a.type === 15 && a.data)
      .map((a) => a.data!.toLowerCase())
      .join(' ');
    let host = '';
    if (ans.Status === 3) {
      host = 'nxdomain';
    } else if (!mx) {
      host = ans.Status === 0 ? 'none' : '';
    } else if (mx.includes('google.com') || mx.includes('googlemail.com')) {
      host = 'google_workspace';
    } else if (mx.includes('outlook.com')) {
      host = 'microsoft_365';
    } else {
      host = 'other';
    }
    if (host) {
      if (mxCache.size > 4096) mxCache.clear();
      mxCache.set(d, host);
    }
    return host;
  } catch {
    return '';
  }
}

const TECH_PATTERNS = {
  fb_pixel: /connect\.facebook\.net\/[^"']{0,300}fbevents\.js|fbq\(/i,
  google_ads_tag: /googleadservices\.com|AW-\d{6,}|googleads\.g\.doubleclick\.net/i,
  analytics: /googletagmanager\.com\/gtag|gtag\(|UA-\d{4,}|G-[A-Z0-9]{6,}/i,
  bing_ads: /bat\.bing\.com|window\.uetq/i,
  linkedin_insight: /snap\.licdn\.com|_linkedin_partner_id/i,
  tiktok_pixel: /analytics\.tiktok\.com|ttq\.load\(/i,
};

const CMS_PATTERNS: Array<[string, RegExp]> = [
  ['wordpress', /\/wp-content\/|\/wp-includes\//i],
  ['shopify', /cdn\.shopify\.com|shopify\.theme/i],
  ['wix', /static\.wixstatic\.com|_wixcss|wix\.com/i],
  ['squarespace', /static1\.squarespace|squarespace\.com/i],
  ['webflow', /webflow\.com/i],
];

const VIEWPORT_RE = /<meta[^>]{1,500}name=["']viewport["']/i;

export function findTechSignals(html: string): Partial<PlaceRow> {
  if (!html) return {};
  const out: Partial<PlaceRow> = {};
  for (const [key, rx] of Object.entries(TECH_PATTERNS)) {
    (out as Record<string, string>)[key] = rx.test(html) ? 'yes' : 'no';
  }
  const cmsMatch = CMS_PATTERNS.find(([, rx]) => rx.test(html));
  out.cms = cmsMatch ? cmsMatch[0] : '';
  out.mobile_friendly = VIEWPORT_RE.test(html) ? 'yes' : 'no';
  return out;
}

export function computeIntentScore(row: Partial<PlaceRow>): number {
  let score = 0;
  if (row.fb_pixel === 'yes') score += 35;
  if (row.google_ads_tag === 'yes') score += 25;
  if (row.analytics === 'yes') score += 10;
  const reviews = Number(String(row.review_count || '0').replace(/,/g, '')) || 0;
  if (reviews >= 50) score += 15;
  else if (reviews >= 10) score += 8;
  const rating = Number(row.review_rating || '0') || 0;
  if (rating >= 4.0) score += 10;
  if (row.emails) score += 5;
  return score;
}

function mergeEmails(existing: string[], found: string[], host: string): string[] {
  const combined = [...new Set([...existing, ...found])];
  combined.sort((a, b) => {
    const aOwn = host && (a.endsWith(`@${host}`) || a.endsWith(`.${host}`)) ? 0 : 1;
    const bOwn = host && (b.endsWith(`@${host}`) || b.endsWith(`.${host}`)) ? 0 : 1;
    if (aOwn !== bOwn) return aOwn - bOwn;
    const aPref = PREFERRED_LOCALS.some((p) => a.startsWith(`${p}@`)) ? 0 : 1;
    const bPref = PREFERRED_LOCALS.some((p) => b.startsWith(`${p}@`)) ? 0 : 1;
    return aPref - bPref;
  });
  return combined.slice(0, 5);
}

export async function enrichWebsiteRow(
  row: PlaceRow,
  opts: { email: boolean; socials: boolean; verifyEmails: boolean; tech: boolean; deepEmail?: boolean },
): Promise<void> {
  if (!row.website) {
    if (opts.tech && row.intent_score === undefined) row.intent_score = computeIntentScore(row);
    return;
  }

  // If listing website itself is a social profile URL
  const directSocials = findSocials(row.website);
  if (opts.socials) {
    for (const [k, v] of Object.entries(directSocials)) {
      if (v) (row as unknown as Record<string, unknown>)[k] = v;
    }
  }
  if (Object.keys(directSocials).length > 0) {
    if (opts.tech && row.intent_score === undefined) row.intent_score = computeIntentScore(row);
    return;
  }

  const { html: homepage, finalUrl } = await fetchHomepage(row.website);
  if (!homepage) {
    if (opts.tech && row.intent_score === undefined) row.intent_score = computeIntentScore(row);
    return;
  }

  const baseForSubpages = finalUrl || row.website;
  const host = siteHost(baseForSubpages) || siteHost(row.website);

  if (opts.socials) {
    const found = findSocials(homepage);
    for (const [k, v] of Object.entries(found)) {
      if (v && !(row as unknown as Record<string, unknown>)[k]) {
        (row as unknown as Record<string, unknown>)[k] = v;
      }
    }
  }

  if (opts.tech) {
    const signals = findTechSignals(homepage);
    Object.assign(row, signals);
  }

  if (opts.email) {
    let emails = row.emails
      ? row.emails.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    emails = mergeEmails(emails, findEmails(homepage, host), host);

    const hasOwnDomainEmail = emails.some((e) => host && (e.endsWith(`@${host}`) || e.endsWith(`.${host}`)));

    // Crawl candidate subpages in fast batches of 3 until we find emails (preferring own-domain)
    if (!hasOwnDomainEmail && (emails.length === 0 || opts.deepEmail)) {
      const subpages = findCandidateSubpages(homepage, baseForSubpages);
      for (let i = 0; i < subpages.length; i += 3) {
        const batch = subpages.slice(i, i + 3);
        const results = await Promise.all(batch.map((u) => fetchHtmlSingle(u)));
        for (const { html: subHtml } of results) {
          if (!subHtml) continue;
          emails = mergeEmails(emails, findEmails(subHtml, host), host);
          if (opts.socials) {
            const subSocials = findSocials(subHtml);
            for (const [k, v] of Object.entries(subSocials)) {
              if (v && !(row as unknown as Record<string, unknown>)[k]) {
                (row as unknown as Record<string, unknown>)[k] = v;
              }
            }
          }
        }
        if (emails.length > 0 && (!opts.deepEmail || emails.some((e) => host && e.endsWith(`@${host}`)))) {
          break;
        }
      }
    }

    // WordPress REST API fallback if still no emails and WordPress detected
    if (emails.length === 0 && (/\/wp-content\/|\/wp-includes\//i.test(homepage) || opts.deepEmail)) {
      try {
        const origin = new URL(baseForSubpages.startsWith('http') ? baseForSubpages : `https://${baseForSubpages}`).origin;
        const { html: wpJson } = await fetchHtmlSingle(`${origin}/wp-json/wp/v2/pages?per_page=10`, 'application/json');
        if (wpJson) {
          emails = mergeEmails(emails, findEmails(wpJson, host), host);
        }
      } catch {
        // ignore wp-json errors
      }
    }

    if (emails.length > 0) {
      if (opts.verifyEmails) {
        const checked = await Promise.all(
          emails.map(async (e) => {
            const dom = e.split('@')[1] || '';
            const mx = await lookupMxHost(dom);
            return { email: e, mx };
          }),
        );
        const valid = checked.filter((x) => x.mx !== 'nxdomain');
        row.emails = valid.map((x) => x.email).join(', ');
        row.email_host = valid.find((x) => x.mx)?.mx || '';
      } else {
        row.emails = emails.join(', ');
        // Populate email_host asynchronously for primary email's domain if not yet set
        if (!row.email_host && emails[0]) {
          const dom = emails[0].split('@')[1] || '';
          const mx = await lookupMxHost(dom);
          if (mx && mx !== 'nxdomain') row.email_host = mx;
        }
      }
    }
  }

  if (opts.tech) {
    row.intent_score = computeIntentScore(row);
  }
}
