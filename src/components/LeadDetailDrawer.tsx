import { ExternalLink, Globe, Mail, MapPin, Phone, Send, Star, X } from 'lucide-react';
import type { PlaceRow } from '../types';

interface LeadDetailDrawerProps {
  row: PlaceRow | null;
  onClose: () => void;
  onSendEmail?: (emails: string[], row: PlaceRow) => void;
}

function safeJson<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function LeadDetailDrawer({ row, onClose, onSendEmail }: LeadDetailDrawerProps) {
  if (!row) return null;

  const hours = safeJson<Record<string, string[]>>(row.open_hours);
  const histogram = safeJson<Record<string, number>>(row.reviews_per_rating);
  const reviews = safeJson<Array<{ Rating: number; When: string; Description: string }>>(row.user_reviews);

  const socials = [
    { name: 'Instagram', url: row.instagram },
    { name: 'Facebook', url: row.facebook },
    { name: 'LinkedIn', url: row.linkedin },
    { name: 'TikTok', url: row.tiktok },
    { name: 'YouTube', url: row.youtube },
    { name: 'X', url: row.x },
  ].filter((s) => Boolean(s.url));

  const techSignals = [
    { label: 'Meta Pixel', active: row.fb_pixel === 'yes' },
    { label: 'Google Ads', active: row.google_ads_tag === 'yes' },
    { label: 'Google Analytics', active: row.analytics === 'yes' },
    { label: 'Bing Ads', active: row.bing_ads === 'yes' },
    { label: 'LinkedIn Insight', active: row.linkedin_insight === 'yes' },
    { label: 'TikTok Pixel', active: row.tiktok_pixel === 'yes' },
  ];

  const hasTechData = Boolean(
    row.cms || row.mobile_friendly || row.fb_pixel || row.google_ads_tag || row.analytics,
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-[1px]">
      <div
        className="fixed inset-0"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={row.title}
        className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 leading-snug">{row.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {row.category && <span>{row.category}</span>}
              {row.review_rating && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 font-medium text-slate-700 tabular-nums">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                    {row.review_rating}
                    {row.review_count ? ` (${row.review_count})` : ''}
                  </span>
                </>
              )}
              {row.status && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{row.status}</span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close lead details"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Contact & Location */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Contact and Location
            </h3>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              <div className="flex items-start gap-3 px-4 py-3 text-sm">
                <Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">Phone</div>
                  <div className="font-mono text-slate-900 tabular-nums">{row.phone || 'Not listed'}</div>
                </div>
              </div>

              <div className="flex items-start gap-3 px-4 py-3 text-sm">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>Emails</span>
                    {row.email_host && (
                      <span className="font-mono text-slate-600">MX: {row.email_host}</span>
                    )}
                  </div>
                  <div className="break-all font-mono text-slate-900">
                    {row.emails || 'None found'}
                  </div>
                  {row.emails && onSendEmail && (
                    <button
                      type="button"
                      onClick={() => {
                        const list = row.emails
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
                        if (list.length > 0) onSendEmail(list, row);
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                    >
                      <Send className="h-3 w-3" />
                      Envoyer un e-mail via Gmail
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 px-4 py-3 text-sm">
                <Globe className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">Website</div>
                  {row.website ? (
                    <a
                      href={row.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 break-all text-blue-700 hover:underline"
                    >
                      <span>{row.website}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  ) : (
                    <div className="text-slate-500">No website listed</div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 px-4 py-3 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">Address</div>
                  <div className="text-slate-900">{row.address || 'Not listed'}</div>
                  {(row.latitude || row.plus_code) && (
                    <div className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
                      {row.latitude}, {row.longitude}
                      {row.plus_code ? ` · ${row.plus_code}` : ''}
                    </div>
                  )}
                  {row.link && (
                    <a
                      href={row.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      Open in Google Maps
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Marketing & Tech Stack */}
          {hasTechData && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Website Tech &amp; Ad Signals
                </h3>
                {typeof row.intent_score === 'number' && (
                  <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                    Intent Score: {row.intent_score} / 100
                  </span>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500">CMS / Platform: </span>
                    <span className="font-medium text-slate-900 capitalize">
                      {row.cms || 'Custom / Unknown'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Mobile Viewport: </span>
                    <span className="font-medium text-slate-900">
                      {row.mobile_friendly === 'yes' ? 'Yes' : row.mobile_friendly === 'no' ? 'No' : 'Unknown'}
                    </span>
                  </div>
                </div>
                <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-2 text-xs">
                  {techSignals.map((sig) => (
                    <div key={sig.label} className="flex items-center justify-between py-0.5">
                      <span className="text-slate-600">{sig.label}</span>
                      <span
                        className={`font-mono font-medium ${
                          sig.active ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        {sig.active ? 'Detected' : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Social Profiles */}
          {socials.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Social Profiles
              </h3>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {socials.map((s) => (
                  <a
                    key={s.name}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors"
                  >
                    <span className="font-medium text-slate-800">{s.name}</span>
                    <span className="inline-flex items-center gap-1.5 text-xs text-blue-700 truncate max-w-[300px]">
                      <span className="truncate">{s.url}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Opening Hours */}
          {hours && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Opening Hours
              </h3>
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {Object.entries(hours).map(([day, spans]) => (
                  <div key={day} className="flex items-center justify-between px-4 py-2 text-xs">
                    <span className="font-medium text-slate-700">{day}</span>
                    <span className="font-mono text-slate-600 tabular-nums">
                      {spans.length > 0 ? spans.join(', ') : 'Closed'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Reviews */}
          {(histogram || (reviews && reviews.length > 0)) && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Reviews
              </h3>
              {histogram && (
                <div className="rounded-lg border border-slate-200 p-4 space-y-1.5">
                  {(['5', '4', '3', '2', '1'] as const).map((star) => {
                    const count = histogram[star] || 0;
                    const max = Math.max(1, ...Object.values(histogram));
                    const pct = Math.round((count / max) * 100);
                    return (
                      <div key={star} className="flex items-center gap-3 text-xs">
                        <span className="w-8 font-mono text-slate-600 tabular-nums">{star} ★</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-12 text-right font-mono text-slate-500 tabular-nums">
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {reviews && reviews.length > 0 && (
                <div className="space-y-2.5">
                  {reviews.map((rev, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-3.5 text-sm space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-mono font-medium text-slate-800 tabular-nums">
                          {rev.Rating} / 5
                        </span>
                        <span>{rev.When}</span>
                      </div>
                      {rev.Description && (
                        <p className="text-slate-700 leading-relaxed">{rev.Description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
