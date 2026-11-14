import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
export const SUGGESTED_GMAIL_ACCOUNT = 'achrafbdll@gmail.com';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({
  login_hint: SUGGESTED_GMAIL_ACCOUNT,
  prompt: 'select_account',
});

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void,
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Impossible de récupérer le jeton d’accès Gmail.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const getCurrentGmailUser = (): User | null => {
  return auth.currentUser;
};

export const clearAccessToken = () => {
  cachedAccessToken = null;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function encodeBase64Url(str: string): string {
  return utf8ToBase64(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeMimeSubject(subject: string): string {
  const clean = sanitizeHeader(subject);
  if (/[^\x20-\x7E]/.test(clean)) {
    return `=?UTF-8?B?${utf8ToBase64(clean)}?=`;
  }
  return clean;
}

export interface SendGmailPayload {
  accessToken: string;
  fromEmail: string;
  toEmail: string;
  bccEmails?: string[];
  subject: string;
  body: string;
}

export async function sendGmailMessage(payload: SendGmailPayload): Promise<{ id: string }> {
  const { accessToken, fromEmail, toEmail, bccEmails, subject, body } = payload;

  const headers: string[] = [];
  if (fromEmail) {
    headers.push(`From: ${sanitizeHeader(fromEmail)}`);
  }
  headers.push(`To: ${sanitizeHeader(toEmail)}`);
  if (bccEmails && bccEmails.length > 0) {
    headers.push(`Bcc: ${bccEmails.map(sanitizeHeader).join(', ')}`);
  }
  headers.push(`Subject: ${encodeMimeSubject(subject)}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: base64');

  const normalizedBody = body.replace(/\r?\n/g, '\r\n');
  const base64Body = utf8ToBase64(normalizedBody);
  const wrappedBody = base64Body.match(/.{1,76}/g)?.join('\r\n') || '';

  const rawMime = `${headers.join('\r\n')}\r\n\r\n${wrappedBody}`;
  const raw = encodeBase64Url(rawMime);

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    let errDetail = `Erreur Gmail API (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string; status?: string } };
      if (errJson?.error?.message) {
        errDetail = errJson.error.message;
      }
    } catch {
      // ignore json parse failure
    }
    const err = new Error(errDetail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return (await res.json()) as { id: string };
}
