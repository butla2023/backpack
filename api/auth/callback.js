 // GET /api/auth/callback — completes Google OAuth2, then sets an encrypted session cookie.
//
// REQUIRED VERCEL ENV VARS (Project Settings -> Environment Variables):
//   GOOGLE_CLIENT_ID      Google Cloud OAuth client ID (Web application)
//   GOOGLE_CLIENT_SECRET  Google Cloud OAuth client secret (never exposed to the browser)
//   GEMINI_API_KEY        Google AI Studio API key (used server-side by /api/scan)
//   SESSION_SECRET        Any random string, 32+ characters (encrypts the session cookie)
//
// GOOGLE CLOUD CONSOLE SETUP (done once by the site owner):
//   1. Create a project, enable the Gmail API.
//   2. OAuth consent screen -> add yourself as a test user, add the
//      https://www.googleapis.com/auth/gmail.readonly scope.
//   3. Credentials -> Create OAuth client ID -> Web application ->
//      Authorized redirect URI: https://backpack-olive.vercel.app/api/auth/callback
//   4. Paste the client ID and secret into the Vercel env vars above.

import crypto from 'node:crypto';

const REDIRECT_URI = 'https://backpack-olive.vercel.app/api/auth/callback';
const COOKIE_NAME = 'backpack_session';

// AES-256-GCM with a key derived from SESSION_SECRET. Layout: iv(12) | tag(16) | ciphertext.
function getKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured.');
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSession(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSession(value) {
  const buf = Buffer.from(value, 'base64');
  if (buf.length < 29) throw new Error('bad session');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

function setSessionCookie(res, value, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`token exchange failed (${r.status})`);
  return r.json();
}

async function fetchEmail(accessToken) {
  const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`userinfo failed (${r.status})`);
  const info = await r.json();
  return info.email || 'unknown';
}

export default async function handler(req, res) {
  try {
    const code = req.query && req.query.code;
    if (!code) throw new Error('missing code');
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error('OAuth is not configured on the server.');
    }
    const tokens = await exchangeCode(code);
    if (!tokens.access_token) throw new Error('no access token returned');
    const email = await fetchEmail(tokens.access_token);
    // Never log tokens or email bodies. Only the encrypted cookie leaves the server.
    const session = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expiry: Date.now() + (tokens.expires_in || 3600) * 1000,
      email,
    };
    setSessionCookie(res, encryptSession(session), 30 * 24 * 3600);
    res.writeHead(302, { Location: '/?auth=success' });
    res.end();
  } catch (err) {
    res.writeHead(302, { Location: '/?auth=error' });
    res.end();
  }
}
