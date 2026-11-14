import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface OpenApiSpec {
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, { summary?: string; requestBody?: unknown }>>;
}

const SAMPLE_CURL = `curl -X POST http://localhost:3000/api/v1/jobs \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Dentists in Austin, TX",
    "keywords": ["Dentists in Austin, TX"],
    "lang": "en",
    "country": "us",
    "lat": "30.2672",
    "lon": "-97.7431",
    "depth": 3,
    "grid": 1,
    "max_time": 300,
    "email": true,
    "socials": true,
    "tech": true
  }'`;

export function ApiDocsView() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/openapi.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSpec(d))
      .catch(() => {});
  }, []);

  const copyCurl = () => {
    navigator.clipboard.writeText(SAMPLE_CURL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {spec?.info?.title || 'Google Maps Scraper Kit Engine API'}
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          {spec?.info?.description ||
            'Programmatic REST endpoints for creating scrape jobs, polling progress, and downloading Full CSV, Leads CSV, or JSON.'}
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="text-xs font-medium text-slate-700">Quickstart cURL Request</span>
          <button
            type="button"
            onClick={copyCurl}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="overflow-x-auto p-4 font-mono text-xs text-slate-800 leading-relaxed">
          {SAMPLE_CURL}
        </pre>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Endpoints</h2>
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {Object.entries(spec?.paths || {}).map(([path, methods]) =>
            Object.entries(methods).map(([method, meta]) => (
              <div key={`${method}-${path}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-16 shrink-0 font-mono text-xs font-semibold uppercase text-blue-700">
                    {method}
                  </span>
                  <code className="font-mono text-xs font-medium text-slate-900 truncate">
                    {path}
                  </code>
                </div>
                <span className="text-xs text-slate-600">{meta.summary}</span>
              </div>
            )),
          )}
        </div>
      </section>
    </div>
  );
}
