import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Eye, Loader2, LogOut, Mail, Trash2 } from 'lucide-react';
import { ApiDocsView } from './components/ApiDocsView';
import { ComboboxPicker, type ComboboxOption } from './components/ComboboxPicker';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { LeadsExplorer } from './components/LeadsExplorer';
import { clearAccessToken, googleSignIn, initAuth, logout } from './lib/gmailAuth';
import type { CityPreset, JobRecord } from './types';

type ActiveTab = 'scraper' | 'leads' | 'api';

const STAGE_LABELS: Record<string, string> = {
  queued: 'Queued',
  search: 'Collecting places',
  reviews: 'Reading reviews',
  websites: 'Crawling websites',
  done: 'Complete',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting',
  working: 'Running',
  ok: 'Completed',
  failed: 'Failed',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('scraper');
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // Combobox presets
  const [businessTypes, setBusinessTypes] = useState<string[]>([]);
  const [whatQuery, setWhatQuery] = useState('');
  const [selectedWhats, setSelectedWhats] = useState<ComboboxOption<string>[]>([
    { key: 'Dentists', label: 'Dentists', value: 'Dentists' },
  ]);

  const [cityOptions, setCityOptions] = useState<CityPreset[]>([]);
  const [cityLoading, setCityLoading] = useState(false);
  const [selectedCities, setSelectedCities] = useState<ComboboxOption<CityPreset>[]>([
    {
      key: 'Austin, Texas, US',
      label: 'Austin, Texas, US',
      sublabel: 'US',
      value: { label: 'Austin, Texas, US', lat: '30.26715', lon: '-97.74306', country: 'US' },
    },
  ]);

  // Collect & configuration options
  const [collectEmail, setCollectEmail] = useState(true);
  const [collectSocials, setCollectSocials] = useState(true);
  const [collectTech, setCollectTech] = useState(true);
  const [verifyEmails, setVerifyEmails] = useState(false);
  const [gridSize, setGridSize] = useState(1);
  const [depth, setDepth] = useState(3);
  const [zoom, setZoom] = useState(15);
  const [lang, setLang] = useState('en');
  const [country, setCountry] = useState('');
  const [maxTime, setMaxTime] = useState(300);
  const [reviewsMax, setReviewsMax] = useState(0);
  const [proxiesText, setProxiesText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);

  // Gmail OAuth state (token cached in memory inside gmailAuth.ts)
  const [needsAuth, setNeedsAuth] = useState(true);
  const [gmailUserEmail, setGmailUserEmail] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const builderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user) => {
        setGmailUserEmail(user.email || null);
        setNeedsAuth(false);
      },
      () => {
        setGmailUserEmail(null);
        setNeedsAuth(true);
      },
    );
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setGmailUserEmail(result.user.email || null);
        setNeedsAuth(false);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Échec de la connexion Gmail.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGmailLogout = async () => {
    await logout();
    setGmailUserEmail(null);
    setNeedsAuth(true);
  };

  const handleAuthExpired = () => {
    clearAccessToken();
    setNeedsAuth(true);
  };

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/jobs');
      if (!res.ok) return;
      const data = (await res.json()) as JobRecord[];
      if (Array.isArray(data)) setJobs(data);
    } catch {
      // ignore transient poll error
    }
  }, []);

  useEffect(() => {
    void loadJobs();
    fetch('/api/v1/business-types')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (Array.isArray(list)) setBusinessTypes(list);
      })
      .catch(() => {});
  }, [loadJobs]);

  // Poll faster when any job is working/pending
  const hasActiveJob = jobs.some((j) => j.Status === 'working' || j.Status === 'pending');
  useEffect(() => {
    const timer = setInterval(loadJobs, hasActiveJob ? 1500 : 4500);
    return () => clearInterval(timer);
  }, [loadJobs, hasActiveJob]);

  // Fetch city suggestions
  useEffect(() => {
    let active = true;
    setCityLoading(true);
    fetch(`/api/v1/cities?q=${encodeURIComponent('')}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (active && Array.isArray(list)) setCityOptions(list);
      })
      .finally(() => {
        if (active) setCityLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleCitySearch = (q: string) => {
    setCityLoading(true);
    fetch(`/api/v1/cities?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (Array.isArray(list)) setCityOptions(list);
      })
      .finally(() => setCityLoading(false));
  };

  const handleAddCustomCity = async (raw: string) => {
    const res = await fetch(`/api/v1/geocode?q=${encodeURIComponent(raw)}`);
    if (!res.ok) {
      setStatusMsg({ text: `Could not geocode "${raw}". Try "City, State" or pick from suggestions.`, kind: 'error' });
      return;
    }
    const geo = (await res.json()) as CityPreset;
    const opt: ComboboxOption<CityPreset> = {
      key: geo.label,
      label: geo.label,
      sublabel: geo.country || undefined,
      value: geo,
    };
    setSelectedCities((prev) => (prev.some((p) => p.key === opt.key) ? prev : [...prev, opt]));
    setStatusMsg(null);
  };

  const filteredWhatOptions: ComboboxOption<string>[] = businessTypes
    .filter((t) => !whatQuery.trim() || t.toLowerCase().includes(whatQuery.trim().toLowerCase()))
    .slice(0, 25)
    .map((t) => ({ key: t, label: t, value: t }));

  const handleStartScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedWhats.length === 0 || selectedCities.length === 0) {
      setStatusMsg({
        text: 'Select at least one business type and one city before starting.',
        kind: 'error',
      });
      return;
    }

    const proxies = proxiesText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    setSubmitting(true);
    setStatusMsg(null);
    let started = 0;

    try {
      for (const city of selectedCities) {
        const keywords = selectedWhats.map((w) => `${w.value} in ${city.value.label}`);
        const name =
          keywords.length > 1
            ? `${keywords[0]} +${keywords.length - 1} more`.slice(0, 200)
            : keywords[0].slice(0, 200);

        const payload: Record<string, unknown> = {
          name,
          keywords,
          lang: (lang.trim() || 'en').toLowerCase(),
          country: (country.trim() || city.value.country || '').toLowerCase(),
          lat: city.value.lat,
          lon: city.value.lon,
          zoom: Number(zoom) || 15,
          depth: Number(depth) || 3,
          grid: Number(gridSize) || 1,
          max_time: Number(maxTime) || 300,
          email: collectEmail,
          verify_emails: collectEmail && verifyEmails,
          socials: collectSocials,
          tech: collectTech,
          reviews_max: Number(reviewsMax) || 0,
        };
        if (proxies.length > 0) payload.proxies = proxies;

        const res = await fetch('/api/v1/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { id?: string; message?: string };
        if (!res.ok) {
          setStatusMsg({
            text: `Could not start job: ${data.message || 'Validation failed'}`,
            kind: 'error',
          });
          return;
        }
        if (data.id) setSelectedJobId(data.id);
        started++;
      }

      setStatusMsg({
        text:
          started === 1
            ? 'Scrape started. Progress updates live in the Jobs queue.'
            : `Queued ${started} scrape jobs, one per city.`,
        kind: 'ok',
      });
      await loadJobs();
    } catch (err) {
      setStatusMsg({
        text: err instanceof Error ? err.message : 'Network error starting job',
        kind: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteJob = async (id: string) => {
    await fetch(`/api/v1/jobs/${id}`, { method: 'DELETE' });
    if (selectedJobId === id) setSelectedJobId(null);
    await loadJobs();
  };

  const handleEnrichJobEmails = async (id: string) => {
    const res = await fetch(`/api/v1/jobs/${id}/enrich-emails`, { method: 'POST' });
    const d = (await res.json()) as { targets?: number; message?: string };
    if (!res.ok) {
      setStatusMsg({ text: d.message || 'Could not enrich emails', kind: 'error' });
    } else {
      setStatusMsg({ text: `Scanning ${d.targets || 0} websites for emails...`, kind: 'ok' });
    }
    await loadJobs();
  };

  const handleInspectJob = (id: string) => {
    setSelectedJobId(id);
    setActiveTab('leads');
  };

  const formatProgressLine = (job: JobRecord) => {
    const p = job.Progress;
    if (!p) return STATUS_LABELS[job.Status] || job.Status;
    if (job.Status === 'pending') return 'Queued';
    if (job.Status !== 'working') {
      return `${STATUS_LABELS[job.Status] || job.Status} · ${p.places || 0} places`;
    }
    const stageText =
      p.stage === 'reviews' && p.reviews_total
        ? `Reading reviews ${p.reviews_done || 0}/${p.reviews_total}`
        : p.stage === 'websites' && p.websites_total
        ? `Crawling websites ${p.websites_done || 0}/${p.websites_total}`
        : `${STAGE_LABELS[p.stage] || 'Working'} (${Math.min((p.keywords_done || 0) + 1, p.keywords_total || 1)}/${p.keywords_total || 1})`;
    return `${stageText} · ${p.places || 0} places`;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* 3-Zone Top Bar Contract */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-3.5">
          <button
            type="button"
            onClick={() => setActiveTab('scraper')}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Maps Scraper Kit
          </button>

          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('scraper')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors ${
                activeTab === 'scraper'
                  ? 'text-slate-900 underline decoration-blue-600 decoration-2 underline-offset-8'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Scraper
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('leads')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors ${
                activeTab === 'leads'
                  ? 'text-slate-900 underline decoration-blue-600 decoration-2 underline-offset-8'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Leads Explorer
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('api')}
              className={`whitespace-nowrap shrink-0 py-1 transition-colors ${
                activeTab === 'api'
                  ? 'text-slate-900 underline decoration-blue-600 decoration-2 underline-offset-8'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              API Docs
            </button>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            {needsAuth || !gmailUserEmail ? (
              <GoogleSignInButton
                compact
                onClick={() => void handleGoogleSignIn()}
                loading={isLoggingIn}
                label="Connecter Gmail"
              />
            ) : (
              <div className="hidden sm:inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="max-w-[180px] truncate font-mono">{gmailUserEmail}</span>
                <button
                  type="button"
                  onClick={() => void handleGmailLogout()}
                  title="Déconnecter Gmail"
                  aria-label="Déconnecter Gmail"
                  className="text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setActiveTab('scraper');
                setTimeout(() => builderRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
              }}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              New Scrape
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {authError && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700"
          >
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="font-medium underline hover:no-underline shrink-0"
            >
              Fermer
            </button>
          </div>
        )}
        {activeTab === 'scraper' && (
          <div className="space-y-8">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                Google Maps Lead Extraction
              </h1>
              <p className="text-sm text-slate-600">
                Collect business listings, crawl websites for emails and social accounts, verify MX records, and score ad-pixel intent.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
              {/* Left Column: Job Builder */}
              <form
                ref={builderRef as unknown as React.RefObject<HTMLFormElement>}
                onSubmit={handleStartScrape}
                className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-6 space-y-5"
              >
                <ComboboxPicker
                  label="What (business categories or keywords)"
                  placeholder="e.g. Dentists, Roofing Contractors"
                  options={filteredWhatOptions}
                  selected={selectedWhats}
                  onSelect={(opt) => setSelectedWhats((prev) => [...prev, opt])}
                  onRemove={(k) => setSelectedWhats((prev) => prev.filter((x) => x.key !== k))}
                  onQueryChange={setWhatQuery}
                  allowCustom
                  customActionLabel="Add keyword"
                  onAddCustom={(raw) => {
                    const clean = raw.trim();
                    if (!clean) return;
                    setSelectedWhats((prev) =>
                      prev.some((p) => p.key.toLowerCase() === clean.toLowerCase())
                        ? prev
                        : [...prev, { key: clean, label: clean, value: clean }],
                    );
                  }}
                />

                <ComboboxPicker
                  label="Where (cities or regions)"
                  placeholder="e.g. Austin, London, Toronto"
                  options={cityOptions.map((c) => ({
                    key: c.label,
                    label: c.label,
                    sublabel: c.country,
                    value: c,
                  }))}
                  selected={selectedCities}
                  onSelect={(opt) => setSelectedCities((prev) => [...prev, opt])}
                  onRemove={(k) => setSelectedCities((prev) => prev.filter((x) => x.key !== k))}
                  onQueryChange={handleCitySearch}
                  allowCustom
                  customActionLabel="Geocode city"
                  onAddCustom={handleAddCustomCity}
                  loading={cityLoading}
                />

                {/* Enrichment Checkboxes */}
                <fieldset className="space-y-2.5 border-t border-slate-100 pt-4">
                  <legend className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Website Enrichment
                  </legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={collectEmail}
                        onChange={(e) => setCollectEmail(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      <span>Emails</span>
                    </label>
                    <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={collectSocials}
                        onChange={(e) => setCollectSocials(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      <span>Social profiles</span>
                    </label>
                    <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={collectTech}
                        onChange={(e) => setCollectTech(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      <span>Ad pixels &amp; CMS</span>
                    </label>
                    <label className="flex items-center gap-2.5 text-sm text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={verifyEmails}
                        disabled={!collectEmail}
                        onChange={(e) => setVerifyEmails(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-40"
                      />
                      <span className={!collectEmail ? 'text-slate-400' : ''}>Verify email MX</span>
                    </label>
                  </div>
                </fieldset>

                {/* Grid & Depth */}
                <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                  <label className="space-y-1.5">
                    <span className="block text-xs font-medium text-slate-700">
                      Grid scan
                    </span>
                    <select
                      value={gridSize}
                      onChange={(e) => setGridSize(Number(e.target.value))}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value={1}>1 × 1 (Single search)</option>
                      <option value={2}>2 × 2 (4 map tiles)</option>
                      <option value={3}>3 × 3 (9 map tiles)</option>
                    </select>
                  </label>

                  <label className="space-y-1.5">
                    <span className="block text-xs font-medium text-slate-700">
                      Depth (×20 places)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={depth}
                      onChange={(e) => setDepth(Math.max(1, Number(e.target.value) || 1))}
                      className="h-9 w-full rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-600 focus:outline-none"
                    />
                  </label>
                </div>

                {/* Collapsible Advanced Options */}
                <details className="group border-t border-slate-100 pt-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-slate-600 hover:text-slate-900">
                    <span>Location, reviews &amp; advanced limits</span>
                    <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <label className="space-y-1">
                      <span className="block text-xs text-slate-600">Zoom (1–21)</span>
                      <input
                        type="number"
                        min={1}
                        max={21}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value) || 15)}
                        className="h-9 w-full rounded-md border border-slate-300 px-2.5 font-mono text-sm tabular-nums"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-xs text-slate-600">Reviews / place (0–5)</span>
                      <input
                        type="number"
                        min={0}
                        max={5}
                        value={reviewsMax}
                        onChange={(e) => setReviewsMax(Math.min(5, Math.max(0, Number(e.target.value) || 0)))}
                        className="h-9 w-full rounded-md border border-slate-300 px-2.5 font-mono text-sm tabular-nums"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-xs text-slate-600">Language (2-letter)</span>
                      <input
                        type="text"
                        maxLength={2}
                        value={lang}
                        onChange={(e) => setLang(e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 px-2.5 font-mono text-sm"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-xs text-slate-600">Country (optional)</span>
                      <input
                        type="text"
                        maxLength={2}
                        placeholder="Auto"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="h-9 w-full rounded-md border border-slate-300 px-2.5 font-mono text-sm"
                      />
                    </label>
                    <label className="col-span-2 space-y-1">
                      <span className="block text-xs text-slate-600">Time limit (seconds)</span>
                      <input
                        type="number"
                        min={10}
                        max={86400}
                        value={maxTime}
                        onChange={(e) => setMaxTime(Number(e.target.value) || 300)}
                        className="h-9 w-full rounded-md border border-slate-300 px-2.5 font-mono text-sm tabular-nums"
                      />
                    </label>
                    <label className="col-span-2 space-y-1">
                      <span className="block text-xs text-slate-600">Proxies (one URL per line, optional)</span>
                      <textarea
                        rows={2}
                        value={proxiesText}
                        onChange={(e) => setProxiesText(e.target.value)}
                        placeholder="http://user:pass@proxy.example.com:8000"
                        className="w-full rounded-md border border-slate-300 p-2.5 font-mono text-xs"
                      />
                    </label>
                  </div>
                </details>

                <div className="pt-2 space-y-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {submitting ? 'Starting...' : 'Start scraping'}
                  </button>

                  {statusMsg && (
                    <p
                      role="status"
                      className={`text-xs ${
                        statusMsg.kind === 'error' ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    >
                      {statusMsg.text}
                    </p>
                  )}
                </div>
              </form>

              {/* Right Column: Live Jobs Queue */}
              <section className="lg:col-span-7 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">Jobs</h2>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
                  </span>
                </div>

                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {jobs.length === 0 ? (
                    <div className="p-12 text-center space-y-2">
                      <p className="text-sm font-medium text-slate-700">No scrape jobs yet</p>
                      <p className="text-xs text-slate-500">
                        Pick a business type and city on the left, then click Start scraping.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {jobs.map((job) => {
                        const isWorking = job.Status === 'working';
                        const hasPlaces = (job.Progress?.places || 0) > 0;
                        return (
                          <div key={job.ID} className="p-4 space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <div className="font-medium text-slate-900 text-sm truncate">
                                  {job.Name}
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                  <span
                                    className={
                                      job.Status === 'ok'
                                        ? 'font-medium text-emerald-700'
                                        : job.Status === 'failed'
                                        ? 'font-medium text-red-600'
                                        : job.Status === 'working'
                                        ? 'font-medium text-blue-700'
                                        : 'text-slate-600'
                                    }
                                  >
                                    {formatProgressLine(job)}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    {new Date(job.Date).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                {hasPlaces && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleInspectJob(job.ID)}
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                      Inspect
                                    </button>
                                    {job.Status === 'ok' && (
                                      <button
                                        type="button"
                                        onClick={() => void handleEnrichJobEmails(job.ID)}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
                                      >
                                        <Mail className="h-3.5 w-3.5" />
                                        Find Emails
                                      </button>
                                    )}
                                    <a
                                      href={`/api/v1/jobs/${job.ID}/download?format=leads`}
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      Leads CSV
                                    </a>
                                    <a
                                      href={`/api/v1/jobs/${job.ID}/download`}
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                                    >
                                      Full CSV
                                    </a>
                                    <a
                                      href={`/api/v1/jobs/${job.ID}/download?format=json`}
                                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                                    >
                                      JSON
                                    </a>
                                  </>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Delete ${job.Name}`}
                                  onClick={() => void handleDeleteJob(job.ID)}
                                  className="inline-flex items-center rounded-md border border-slate-200 p-1.5 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>

                            {isWorking && (
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full bg-blue-600 transition-all duration-300"
                                  style={{ width: `${Math.max(4, job.Progress?.percent || 4)}%` }}
                                />
                              </div>
                            )}

                            {job.Error && (
                              <p
                                className={`text-xs ${
                                  job.Status === 'failed' ? 'text-red-600' : 'text-amber-700'
                                }`}
                              >
                                {job.Error}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {activeTab === 'leads' && (
          <LeadsExplorer
            jobs={jobs}
            selectedJobId={selectedJobId}
            onSelectJob={setSelectedJobId}
            onGoToScraper={() => setActiveTab('scraper')}
            onRefreshJobs={loadJobs}
            gmailUserEmail={gmailUserEmail}
            needsAuth={needsAuth}
            isLoggingIn={isLoggingIn}
            onGoogleSignIn={handleGoogleSignIn}
            onLogout={handleGmailLogout}
            onAuthExpired={handleAuthExpired}
          />
        )}

        {activeTab === 'api' && <ApiDocsView />}
      </main>
    </div>
  );
}
