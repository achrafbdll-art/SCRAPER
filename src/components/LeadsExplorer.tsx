import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Loader2, Mail, Search, Send } from 'lucide-react';
import type { JobRecord, PlaceRow } from '../types';
import { GmailComposerModal, type EmailRecipient } from './GmailComposerModal';
import { LeadDetailDrawer } from './LeadDetailDrawer';

interface LeadsExplorerProps {
  jobs: JobRecord[];
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  onGoToScraper: () => void;
  onRefreshJobs?: () => Promise<void> | void;
  gmailUserEmail: string | null;
  needsAuth: boolean;
  isLoggingIn: boolean;
  onGoogleSignIn: () => Promise<void>;
  onLogout: () => Promise<void>;
  onAuthExpired: () => void;
}

type SortMode = 'default' | 'rating' | 'reviews' | 'intent';

function num(v: unknown): number {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function csvSafeCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  const trimmed = s.trimStart();
  const guarded =
    trimmed.length > 0 && ['=', '+', '-', '@', '\t', '\r'].includes(trimmed[0]) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function getRowKey(r: PlaceRow, idx: number): string {
  return r.place_id || r.cid || `${r.title}-${idx}`;
}

function extractRecipientsFromRows(list: PlaceRow[]): EmailRecipient[] {
  const seen = new Set<string>();
  const out: EmailRecipient[] = [];
  for (const r of list) {
    if (!r.emails) continue;
    for (const part of r.emails.split(',')) {
      const clean = part.trim();
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) {
        seen.add(key);
        out.push({
          email: clean,
          businessName: r.title,
          category: r.category,
        });
      }
    }
  }
  return out;
}

export function LeadsExplorer({
  jobs,
  selectedJobId,
  onSelectJob,
  onGoToScraper,
  onRefreshJobs,
  gmailUserEmail,
  needsAuth,
  isLoggingIn,
  onGoogleSignIn,
  onLogout,
  onAuthExpired,
}: LeadsExplorerProps) {
  const [rows, setRows] = useState<PlaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [noWebsite, setNoWebsite] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [hasEmail, setHasEmail] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [minReviews, setMinReviews] = useState(0);
  const [sortBy, setSortBy] = useState<SortMode>('default');
  const [activeRow, setActiveRow] = useState<PlaceRow | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState('');
  const [copiedEmails, setCopiedEmails] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerRecipients, setComposerRecipients] = useState<EmailRecipient[]>([]);

  const jobsWithPlaces = useMemo(
    () => jobs.filter((j) => (j.Progress?.places || 0) > 0 || j.Status === 'ok'),
    [jobs],
  );

  const effectiveJobId = selectedJobId || jobsWithPlaces[0]?.ID || jobs[0]?.ID || null;
  const effectiveJob = jobs.find((j) => j.ID === effectiveJobId) || null;

  useEffect(() => {
    setSelectedKeys(new Set());
    if (!effectiveJobId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/v1/jobs/${effectiveJobId}/rows`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Failed to load job rows');
        return (await r.json()) as { rows: PlaceRow[] };
      })
      .then((d) => {
        if (!cancelled) setRows(d.rows || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load rows');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    effectiveJobId,
    effectiveJob?.Progress?.places,
    effectiveJob?.Progress?.websites_done,
    effectiveJob?.Status,
  ]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (noWebsite && r.website) return false;
      if (hasPhone && !r.phone) return false;
      if (hasEmail && !r.emails) return false;
      if (minRating > 0 && num(r.review_rating) < minRating) return false;
      if (minReviews > 0 && num(r.review_count) < minReviews) return false;
      if (q) {
        const hay = `${r.title} ${r.category} ${r.address} ${r.emails} ${r.website}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'rating') {
      out.sort((a, b) => num(b.review_rating) - num(a.review_rating));
    } else if (sortBy === 'reviews') {
      out.sort((a, b) => num(b.review_count) - num(a.review_count));
    } else if (sortBy === 'intent') {
      out.sort((a, b) => num(b.intent_score) - num(a.intent_score));
    }
    return out;
  }, [rows, search, noWebsite, hasPhone, hasEmail, minRating, minReviews, sortBy]);

  const summary = useMemo(() => {
    const list = filtered;
    const rated = list.map((r) => num(r.review_rating)).filter((x) => x > 0);
    return {
      total: list.length,
      phones: list.filter((r) => Boolean(r.phone)).length,
      emails: list.filter((r) => Boolean(r.emails)).length,
      noSite: list.filter((r) => !r.website).length,
      ads: list.filter((r) => r.fb_pixel === 'yes' || r.google_ads_tag === 'yes').length,
      avgRating: rated.length ? (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1) : '—',
    };
  }, [filtered]);

  const missingEmailCount = useMemo(
    () => rows.filter((r) => Boolean(r.website) && !r.emails).length,
    [rows],
  );

  const allFilteredEmails = useMemo(() => {
    const set = new Set<string>();
    for (const r of filtered) {
      if (!r.emails) continue;
      for (const part of r.emails.split(',')) {
        const clean = part.trim();
        if (clean) set.add(clean);
      }
    }
    return [...set];
  }, [filtered]);

  const selectedFilteredRows = useMemo(
    () => filtered.filter((r, idx) => selectedKeys.has(getRowKey(r, idx))),
    [filtered, selectedKeys],
  );

  const bulkRecipients = useMemo(
    () =>
      extractRecipientsFromRows(
        selectedFilteredRows.length > 0 ? selectedFilteredRows : filtered,
      ),
    [selectedFilteredRows, filtered],
  );

  const allFilteredKeys = useMemo(
    () => filtered.map((r, idx) => getRowKey(r, idx)),
    [filtered],
  );

  const allVisibleSelected =
    allFilteredKeys.length > 0 && allFilteredKeys.every((k) => selectedKeys.has(k));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(allFilteredKeys));
    }
  };

  const toggleSelectRow = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleOpenBulkComposer = () => {
    if (bulkRecipients.length === 0) return;
    setComposerRecipients(bulkRecipients);
    setComposerOpen(true);
  };

  const handleCopyEmails = () => {
    if (allFilteredEmails.length === 0) return;
    navigator.clipboard.writeText(allFilteredEmails.join('\n')).then(() => {
      setCopiedEmails(true);
      setTimeout(() => setCopiedEmails(false), 1800);
    });
  };

  const handleEnrichMissingEmails = async () => {
    if (!effectiveJobId) return;
    setEnriching(true);
    setEnrichMsg('');
    try {
      const res = await fetch(`/api/v1/jobs/${effectiveJobId}/enrich-emails`, { method: 'POST' });
      const data = (await res.json()) as { targets?: number; message?: string };
      if (!res.ok) {
        setEnrichMsg(data.message || 'Could not start email search');
      } else {
        setEnrichMsg(`Scanning ${data.targets || 0} websites for emails...`);
        await onRefreshJobs?.();
      }
    } catch {
      setEnrichMsg('Network error starting email enrichment');
    } finally {
      setEnriching(false);
    }
  };

  const exportFilteredCsv = () => {
    const cols: Array<keyof PlaceRow> = [
      'title', 'phone', 'emails', 'website', 'category', 'address', 'review_rating', 'review_count',
      'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'x',
      'email_host', 'cms', 'fb_pixel', 'google_ads_tag', 'analytics', 'intent_score',
    ];
    const header = cols.join(',');
    const lines = filtered.map((r) => cols.map((c) => csvSafeCell(r[c])).join(','));
    const blob = new Blob(['\ufeff' + [header, ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${effectiveJob?.Name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'leads'}-filtered.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (jobs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-20 text-center space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">No scrape results yet</h2>
        <p className="text-sm text-slate-600">
          Launch a scrape from the Scraper tab to collect Google Maps businesses, emails, social profiles, and ad signals.
        </p>
        <button
          type="button"
          onClick={onGoToScraper}
          className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
        >
          Configure First Scrape
        </button>
      </div>
    );
  }

  const isJobRunning = effectiveJob?.Status === 'working' || effectiveJob?.Status === 'pending';

  return (
    <div className="space-y-6">
      {/* Header & Job Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="job-select" className="text-sm font-medium text-slate-700">
            Dataset
          </label>
          <select
            id="job-select"
            value={effectiveJobId || ''}
            onChange={(e) => {
              setEnrichMsg('');
              onSelectJob(e.target.value);
            }}
            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
          >
            {jobs.map((j) => (
              <option key={j.ID} value={j.ID}>
                {j.Name} ({j.Progress?.places || 0} places)
              </option>
            ))}
          </select>
          {isJobRunning && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {effectiveJob?.Progress?.stage === 'websites' && effectiveJob?.Progress?.websites_total
                ? `Crawling websites ${effectiveJob.Progress.websites_done || 0}/${effectiveJob.Progress.websites_total}`
                : 'Updating...'}
            </span>
          )}
          {!isJobRunning && enrichMsg && (
            <span className="text-xs text-slate-600">{enrichMsg}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {missingEmailCount > 0 && !isJobRunning && (
            <button
              type="button"
              disabled={enriching}
              onClick={() => void handleEnrichMissingEmails()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Mail className="h-3.5 w-3.5" />
              Find Missing Emails ({missingEmailCount})
            </button>
          )}
          <button
            type="button"
            disabled={bulkRecipients.length === 0}
            onClick={handleOpenBulkComposer}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
            {selectedFilteredRows.length > 0
              ? `Envoyer 1 e-mail (${bulkRecipients.length} sélectionnés)`
              : `Envoyer 1 e-mail à tous (${bulkRecipients.length})`}
          </button>
          <button
            type="button"
            disabled={allFilteredEmails.length === 0}
            onClick={handleCopyEmails}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {copiedEmails ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copiedEmails ? 'Copied' : `Copy Emails (${allFilteredEmails.length})`}
          </button>
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={exportFilteredCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Export Filtered CSV ({filtered.length})
          </button>
        </div>
      </div>

      {/* Summary Metric Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {[
          { label: 'Matching Leads', value: summary.total },
          { label: 'With Phone', value: summary.phones },
          { label: 'With Email', value: summary.emails },
          { label: 'No Website', value: summary.noSite },
          { label: 'Running Ads', value: summary.ads },
          { label: 'Avg Rating', value: summary.avgRating },
        ].map((stat) => (
          <div key={stat.label} className="px-4 py-3">
            <div className="text-xs text-slate-500">{stat.label}</div>
            <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name, category, email, address..."
            className="h-9 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
        </div>

        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none px-2 py-1.5 rounded-md hover:bg-slate-50">
          <input
            type="checkbox"
            checked={hasEmail}
            onChange={(e) => setHasEmail(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
          />
          Has email
        </label>

        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none px-2 py-1.5 rounded-md hover:bg-slate-50">
          <input
            type="checkbox"
            checked={hasPhone}
            onChange={(e) => setHasPhone(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
          />
          Has phone
        </label>

        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer select-none px-2 py-1.5 rounded-md hover:bg-slate-50">
          <input
            type="checkbox"
            checked={noWebsite}
            onChange={(e) => setNoWebsite(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
          />
          No website
        </label>

        <select
          aria-label="Minimum rating"
          value={minRating}
          onChange={(e) => setMinRating(Number(e.target.value))}
          className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
        >
          <option value={0}>Any rating</option>
          <option value={4}>4.0+ stars</option>
          <option value={4.5}>4.5+ stars</option>
        </select>

        <select
          aria-label="Minimum reviews"
          value={minReviews}
          onChange={(e) => setMinReviews(Number(e.target.value))}
          className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
        >
          <option value={0}>Any reviews</option>
          <option value={10}>10+ reviews</option>
          <option value={50}>50+ reviews</option>
          <option value={100}>100+ reviews</option>
        </select>

        <select
          aria-label="Sort results"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortMode)}
          className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none"
        >
          <option value="default">Sort: Default</option>
          <option value="intent">Sort: Intent score</option>
          <option value="reviews">Sort: Most reviews</option>
          <option value="rating">Sort: Highest rating</option>
        </select>
      </div>

      {/* Data Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {error ? (
          <div className="p-8 text-center text-sm text-red-600">{error}</div>
        ) : loading && rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading scraped leads...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            {rows.length === 0
              ? 'No places collected for this job yet.'
              : 'No leads match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="w-10 px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      aria-label="Sélectionner tous les prospects filtrés"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                    />
                  </th>
                  <th className="px-4 py-2.5">Business</th>
                  <th className="px-4 py-2.5">Phone</th>
                  <th className="px-4 py-2.5">Emails</th>
                  <th className="px-4 py-2.5">Website / Stack</th>
                  <th className="px-4 py-2.5 text-right">Rating</th>
                  <th className="px-4 py-2.5 text-right">Reviews</th>
                  <th className="px-4 py-2.5 text-right">Intent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r, idx) => {
                  const key = getRowKey(r, idx);
                  const isChecked = selectedKeys.has(key);
                  const ads: string[] = [];
                  if (r.fb_pixel === 'yes') ads.push('Meta');
                  if (r.google_ads_tag === 'yes') ads.push('Google Ads');
                  if (r.tiktok_pixel === 'yes') ads.push('TikTok');
                  return (
                    <tr
                      key={key}
                      onClick={() => setActiveRow(r)}
                      className={`cursor-pointer hover:bg-slate-50/80 transition-colors ${
                        isChecked ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <td
                        className="px-3 py-2.5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner ${r.title}`}
                          checked={isChecked}
                          onChange={() => toggleSelectRow(key)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                        />
                      </td>
                      <td className="px-4 py-2.5 max-w-[260px]">
                        <div className="font-medium text-slate-900 truncate">{r.title}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {r.category || 'Business'}
                          {r.address ? ` · ${r.address}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs text-slate-700 tabular-nums">
                        {r.phone || '—'}
                      </td>
                      <td className="px-4 py-2.5 max-w-[220px]">
                        <div className="truncate font-mono text-xs text-slate-800">
                          {r.emails || '—'}
                        </div>
                        {r.email_host && (
                          <div className="text-[11px] text-slate-500">{r.email_host}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 max-w-[220px]">
                        {r.website ? (
                          <a
                            href={r.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline max-w-full"
                          >
                            <span className="truncate">
                              {r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                            </span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">No website</span>
                        )}
                        {(r.cms || ads.length > 0) && (
                          <div className="text-[11px] text-slate-500 truncate">
                            {[r.cms, ...ads].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-800 tabular-nums whitespace-nowrap">
                        {r.review_rating || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {r.review_count || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {typeof r.intent_score === 'number' ? r.intent_score : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LeadDetailDrawer
        row={activeRow}
        onClose={() => setActiveRow(null)}
        onSendEmail={(emails, row) => {
          setActiveRow(null);
          setComposerRecipients(
            emails.map((email) => ({
              email,
              businessName: row.title,
              category: row.category,
            })),
          );
          setComposerOpen(true);
        }}
      />

      <GmailComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        initialRecipients={composerRecipients}
        gmailUserEmail={gmailUserEmail}
        needsAuth={needsAuth}
        isLoggingIn={isLoggingIn}
        onGoogleSignIn={onGoogleSignIn}
        onLogout={onLogout}
        onAuthExpired={onAuthExpired}
      />
    </div>
  );
}
