import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  LogOut,
  Mail,
  Plus,
  Send,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  getAccessToken,
  sendGmailMessage,
  SUGGESTED_GMAIL_ACCOUNT,
} from '../lib/gmailAuth';
import { GoogleSignInButton } from './GoogleSignInButton';

export interface EmailRecipient {
  email: string;
  businessName?: string;
  category?: string;
}

interface GmailComposerModalProps {
  open: boolean;
  onClose: () => void;
  initialRecipients: EmailRecipient[];
  gmailUserEmail: string | null;
  needsAuth: boolean;
  isLoggingIn: boolean;
  onGoogleSignIn: () => Promise<void>;
  onLogout: () => Promise<void>;
  onAuthExpired: () => void;
}

type SendMode = 'single-bcc' | 'individual';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCC_BATCH_SIZE = 90;

function applyTemplate(text: string, recipient: EmailRecipient): string {
  return text
    .replace(/\{\{\s*entreprise\s*\}\}/gi, recipient.businessName || '')
    .replace(/\{\{\s*business\s*\}\}/gi, recipient.businessName || '')
    .replace(/\{\{\s*categorie\s*\}\}/gi, recipient.category || '')
    .replace(/\{\{\s*category\s*\}\}/gi, recipient.category || '');
}

export function GmailComposerModal({
  open,
  onClose,
  initialRecipients,
  gmailUserEmail,
  needsAuth,
  isLoggingIn,
  onGoogleSignIn,
  onLogout,
  onAuthExpired,
}: GmailComposerModalProps) {
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [extraEmail, setExtraEmail] = useState('');
  const [sendMode, setSendMode] = useState<SendMode>('single-bcc');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    sentCount: number;
    recipientCount: number;
    mode: SendMode;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const seen = new Set<string>();
    const deduped: EmailRecipient[] = [];
    for (const r of initialRecipients) {
      const clean = r.email.trim();
      const key = clean.toLowerCase();
      if (clean && EMAIL_RE.test(clean) && !seen.has(key)) {
        seen.add(key);
        deduped.push({ ...r, email: clean });
      }
    }
    setRecipients(deduped);
    setShowConfirm(false);
    setError(null);
    setSuccessInfo(null);
    setProgress(null);
  }, [open, initialRecipients]);

  if (!open) return null;

  const isAuthenticated = !needsAuth && Boolean(gmailUserEmail);

  const handleAddExtraEmail = () => {
    const clean = extraEmail.trim();
    if (!clean) return;
    if (!EMAIL_RE.test(clean)) {
      setError(`Adresse e-mail invalide : "${clean}"`);
      return;
    }
    if (recipients.some((r) => r.email.toLowerCase() === clean.toLowerCase())) {
      setExtraEmail('');
      return;
    }
    setRecipients((prev) => [...prev, { email: clean }]);
    setExtraEmail('');
    setError(null);
  };

  const handleRemoveRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r.email.toLowerCase() !== email.toLowerCase()));
  };

  const handleRequestSend = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isAuthenticated) {
      setError(`Connectez d'abord votre compte Gmail (${SUGGESTED_GMAIL_ACCOUNT}).`);
      return;
    }
    if (recipients.length === 0) {
      setError('Ajoutez au moins un destinataire valide.');
      return;
    }
    if (!subject.trim()) {
      setError("Veuillez saisir l'objet de l'e-mail.");
      return;
    }
    if (!body.trim()) {
      setError('Veuillez saisir le message à envoyer.');
      return;
    }

    setShowConfirm(true);
  };

  const handleConfirmAndSend = async () => {
    const token = await getAccessToken();
    if (!token || !gmailUserEmail) {
      onAuthExpired();
      setShowConfirm(false);
      setError('Votre session Gmail a expiré. Veuillez vous reconnecter avec Google.');
      return;
    }

    setSending(true);
    setError(null);

    try {
      if (recipients.length === 1) {
        setProgress({ done: 0, total: 1 });
        await sendGmailMessage({
          accessToken: token,
          fromEmail: gmailUserEmail,
          toEmail: recipients[0].email,
          subject: applyTemplate(subject.trim(), recipients[0]),
          body: applyTemplate(body, recipients[0]),
        });
        setProgress({ done: 1, total: 1 });
        setSuccessInfo({ sentCount: 1, recipientCount: 1, mode: 'single-bcc' });
      } else if (sendMode === 'single-bcc') {
        const batches: EmailRecipient[][] = [];
        for (let i = 0; i < recipients.length; i += BCC_BATCH_SIZE) {
          batches.push(recipients.slice(i, i + BCC_BATCH_SIZE));
        }
        setProgress({ done: 0, total: batches.length });
        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          await sendGmailMessage({
            accessToken: token,
            fromEmail: gmailUserEmail,
            toEmail: gmailUserEmail,
            bccEmails: batch.map((r) => r.email),
            subject: subject.trim(),
            body,
          });
          setProgress({ done: i + 1, total: batches.length });
        }
        setSuccessInfo({
          sentCount: batches.length,
          recipientCount: recipients.length,
          mode: 'single-bcc',
        });
      } else {
        setProgress({ done: 0, total: recipients.length });
        for (let i = 0; i < recipients.length; i++) {
          const r = recipients[i];
          await sendGmailMessage({
            accessToken: token,
            fromEmail: gmailUserEmail,
            toEmail: r.email,
            subject: applyTemplate(subject.trim(), r),
            body: applyTemplate(body, r),
          });
          setProgress({ done: i + 1, total: recipients.length });
        }
        setSuccessInfo({
          sentCount: recipients.length,
          recipientCount: recipients.length,
          mode: 'individual',
        });
      }
      setShowConfirm(false);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        onAuthExpired();
        setShowConfirm(false);
        setError(
          'Autorisation Gmail expirée ou insuffisante. Veuillez reconnecter votre compte Google et autoriser l’envoi d’e-mails.',
        );
      } else {
        setShowConfirm(false);
        setError(err instanceof Error ? err.message : "Échec lors de l'envoi via Gmail.");
      }
    } finally {
      setSending(false);
    }
  };

  const bccBatchCount = Math.max(1, Math.ceil(recipients.length / BCC_BATCH_SIZE));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[1px]">
      <div className="fixed inset-0" aria-hidden="true" onClick={() => !sending && onClose()} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Envoyer un e-mail via Gmail"
        className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Mail className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Envoyer un e-mail via Gmail
              </h2>
              <p className="text-xs text-slate-500">
                1 seul message envoyé directement depuis votre compte Gmail
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Gmail Account Connection Box */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            {isAuthenticated ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">Compte Gmail connecté</div>
                    <div className="truncate font-mono text-sm font-medium text-slate-900">
                      {gmailUserEmail}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={sending || isLoggingIn}
                    onClick={() => void onGoogleSignIn()}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Changer de compte
                  </button>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void onLogout()}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Déconnecter
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium text-slate-900">
                    Relier votre compte Gmail
                  </div>
                  <p className="text-xs text-slate-600">
                    Connectez <span className="font-mono font-medium">{SUGGESTED_GMAIL_ACCOUNT}</span> (ou votre compte Google) pour envoyer directement.
                  </p>
                </div>
                <GoogleSignInButton
                  onClick={() => void onGoogleSignIn()}
                  loading={isLoggingIn}
                  label="Sign in with Google"
                />
              </div>
            )}
          </div>

          {successInfo ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-center space-y-3">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-emerald-950">
                  {successInfo.sentCount === 1
                    ? 'E-mail envoyé avec succès !'
                    : `${successInfo.sentCount} e-mails envoyés avec succès !`}
                </h3>
                <p className="text-sm text-emerald-800">
                  {successInfo.mode === 'single-bcc' && successInfo.recipientCount > 1
                    ? `1 seul message groupé (Cci) envoyé à ${successInfo.recipientCount} destinataires depuis ${gmailUserEmail}.`
                    : `Envoyé à ${successInfo.recipientCount} destinataire${successInfo.recipientCount > 1 ? 's' : ''} depuis ${gmailUserEmail}.`}
                </p>
              </div>
              <div className="pt-2 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setSuccessInfo(null)}
                  className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-xs font-medium text-emerald-900 hover:bg-emerald-100 transition-colors"
                >
                  Écrire un autre e-mail
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
                >
                  Fermer
                </button>
              </div>
            </div>
          ) : showConfirm ? (
            /* Explicit User Confirmation Dialog Step (MANDATORY) */
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-700 shrink-0" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Confirmer l&apos;envoi via Gmail
                  </h3>
                  <p className="text-xs text-slate-600">
                    Vérifiez les détails ci-dessous avant d&apos;envoyer définitivement cet e-mail depuis votre compte Gmail.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 text-xs">
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-slate-500">Expéditeur</span>
                  <span className="font-mono font-medium text-slate-900">{gmailUserEmail}</span>
                </div>
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-slate-500">Mode d&apos;envoi</span>
                  <span className="font-medium text-slate-900">
                    {recipients.length === 1
                      ? 'Envoi direct (1 e-mail)'
                      : sendMode === 'single-bcc'
                      ? bccBatchCount === 1
                        ? `1 seul e-mail groupé en Cci (${recipients.length} destinataires)`
                        : `${bccBatchCount} lots groupés en Cci (${recipients.length} destinataires)`
                      : `${recipients.length} e-mails individuels (1 par prospect)`}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">
                      Destinataires ({recipients.length})
                    </span>
                  </div>
                  <div className="max-h-28 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-2 font-mono text-[11px] text-slate-700 space-y-0.5">
                    {recipients.map((r) => (
                      <div key={r.email} className="truncate">
                        {r.email}
                        {r.businessName ? ` — ${r.businessName}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-3.5 py-2.5 space-y-1">
                  <span className="text-slate-500">Objet</span>
                  <div className="font-medium text-slate-900">{subject}</div>
                </div>
                <div className="px-3.5 py-2.5 space-y-1">
                  <span className="text-slate-500">Message</span>
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap font-sans text-xs text-slate-800 leading-relaxed">
                    {body}
                  </pre>
                </div>
              </div>

              {sending && progress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-700">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                      Envoi en cours...
                    </span>
                    <span className="font-mono tabular-nums">
                      {progress.done} / {progress.total}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full bg-blue-600 transition-all"
                      style={{
                        width: `${Math.max(8, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => setShowConfirm(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Annuler / Modifier
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void handleConfirmAndSend()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {sending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Confirmer et envoyer
                </button>
              </div>
            </div>
          ) : (
            <form id="gmail-compose-form" onSubmit={handleRequestSend} className="space-y-4">
              {/* Recipients */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Destinataires ({recipients.length})
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="email"
                      value={extraEmail}
                      onChange={(e) => setExtraEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddExtraEmail();
                        }
                      }}
                      placeholder="Ajouter un e-mail..."
                      className="h-7 w-48 rounded-md border border-slate-300 px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAddExtraEmail}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Plus className="h-3 w-3" />
                      Ajouter
                    </button>
                  </div>
                </div>

                <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2.5">
                  {recipients.length === 0 ? (
                    <p className="text-xs text-slate-500">Aucun destinataire sélectionné.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {recipients.map((r) => (
                        <span
                          key={r.email}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs text-slate-800"
                        >
                          <span className="max-w-[210px] truncate" title={r.businessName || r.email}>
                            {r.email}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveRecipient(r.email)}
                            aria-label={`Retirer ${r.email}`}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Send Mode (when multiple recipients) */}
              {recipients.length > 1 && (
                <div className="space-y-2">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Mode d&apos;envoi
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label
                      className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${
                        sendMode === 'single-bcc'
                          ? 'border-blue-600 bg-blue-50/40'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="send-mode"
                        checked={sendMode === 'single-bcc'}
                        onChange={() => setSendMode('single-bcc')}
                        className="mt-0.5 text-blue-600"
                      />
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                          <Users className="h-3.5 w-3.5 text-blue-600" />
                          1 seul e-mail pour tous (Cci)
                        </div>
                        <p className="text-[11px] text-slate-600 leading-snug">
                          Envoie 1 seul e-mail avec tous les destinataires en copie cachée (BCC).
                        </p>
                      </div>
                    </label>

                    <label
                      className={`flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${
                        sendMode === 'individual'
                          ? 'border-blue-600 bg-blue-50/40'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="send-mode"
                        checked={sendMode === 'individual'}
                        onChange={() => setSendMode('individual')}
                        className="mt-0.5 text-blue-600"
                      />
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                          <Mail className="h-3.5 w-3.5 text-slate-600" />
                          1 e-mail par prospect
                        </div>
                        <p className="text-[11px] text-slate-600 leading-snug">
                          Même message envoyé séparément. Variable possible :{' '}
                          <code className="font-mono text-[10px]">{'{{entreprise}}'}</code>
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Subject */}
              <label className="block space-y-1.5">
                <span className="block text-xs font-medium text-slate-700">Objet</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Ex : Proposition de collaboration pour votre entreprise"
                  className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                />
              </label>

              {/* Message */}
              <label className="block space-y-1.5">
                <span className="block text-xs font-medium text-slate-700">Message</span>
                <textarea
                  rows={7}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Bonjour,&#10;&#10;Je vous contacte suite à..."
                  className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none leading-relaxed"
                />
              </label>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer Actions (when composing) */}
        {!showConfirm && !successInfo && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3.5">
            <span className="text-xs text-slate-500">
              {recipients.length === 0
                ? '0 destinataire'
                : recipients.length === 1
                ? '1 destinataire'
                : sendMode === 'single-bcc'
                ? `1 seul e-mail → ${recipients.length} destinataires (Cci)`
                : `${recipients.length} e-mails individuels`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                form="gmail-compose-form"
                disabled={!isAuthenticated || recipients.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Send className="h-3.5 w-3.5" />
                Envoyer l&apos;e-mail
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
