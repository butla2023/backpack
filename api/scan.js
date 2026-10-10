// /api/scan — Gmail-backed school-mail analysis.
//   GET  -> { connected: true, email } or 401 (lets the frontend show sign-in state)
//   POST -> reads the encrypted session cookie, refreshes the token if needed,
//           fetches recent school-related mail, runs the same AI pipeline as the
//           frontend demo, and returns { digest, todos, events } in the exact
//           shapes index.html renders.
// Privacy: only gmail.readonly is requested. Email bodies and tokens are never
// logged; only counts and generic error messages reach the logs.

import { decryptSession, encryptSession } from './auth/callback.js';

const COOKIE_NAME = 'backpack_session';
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GMAIL_QUERY =
  'newer_than:30d (school OR teacher OR principal OR PTA OR "permission slip" OR "field trip" OR fundraiser OR classroom OR homework OR attendance OR campus)';
const MAX_LIST = 50;
const MAX_EMAILS = 30;
const MAX_FLYERS = 5;

// Exact prompt the frontend demo uses, so server results match its rendering.
const PIPELINE_PROMPT =
  'You are helping a busy parent understand school communications. Analyze the supplied school emails and flyer images. Ignore anything unrelated to school. Classify each relevant item as action, event, or fyi. Summarize in plain language. Extract concrete tasks with deadlines and events with dates, times, and locations. Deduplicate repeated tasks or events. Return ONLY valid JSON with this exact shape: {"digest":[{"sender":"","initials":"","subject":"","summary":"","type":"action|event|fyi","label":"Action needed|Event|FYI","meta":[""]}],"todos":[{"id":"short-unique-id","title":"","source":"","deadline":"","urgent":false}],"events":[{"date":"day number or short date","month":"3-letter month","title":"","description":"","time":"","location":""}]}. Do not invent missing details; use "Not listed" when needed. School content follows:\n\n';

function b64urlToB64(s) {
  return s.replace(/-/g, '+').replace(/_/g, '/');
}

function getSession(req) {
  const header = req.headers.cookie || '';
  const pair = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE_NAME}=`));
  if (!pair) return null;
  try {
    return decryptSession(decodeURIComponent(pair.slice(COOKIE_NAME.length + 1)));
  } catch {
    return null;
  }
}

function setSessionCookie(res, session) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(encryptSession(session))}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${30 * 24 * 3600}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function gmail(path, accessToken, params) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (r.status === 401) throw new Error('reauth');
  if (!r.ok) throw new Error(`gmail request failed (${r.status})`);
  return r.json();
}

async function refreshAccessToken(session) {
  if (session.expiry - Date.now() > 60000) return session;
  if (!session.refresh_token) throw new Error('reauth');
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: session.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) throw new Error('reauth');
  const t = await r.json();
  session.access_token = t.access_token;
  session.expiry = Date.now() + (t.expires_in || 3600) * 1000;
  return session;
}

function headerOf(payload, name) {
  const h = (payload.headers || []).find((x) => x.name && x.name.toLowerCase() === name);
  return h ? h.value : '';
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Walk MIME parts: prefer text/plain, fall back to stripped text/html.
// Collect up to MAX_FLYERS image attachments (ids only; bytes fetched later).
function extractContent(payload) {
  let plain = '';
  let html = '';
  const images = [];
  (function walk(part) {
    if (!part) return;
    const mime = part.mimeType || '';
    const data = part.body && part.body.data;
    if (mime === 'text/plain' && data && !plain) {
      plain = Buffer.from(b64urlToB64(data), 'base64').toString('utf8');
    } else if (mime === 'text/html' && data && !html) {
      html = Buffer.from(b64urlToB64(data), 'base64').toString('utf8');
    }
    if (mime.startsWith('image/') && part.body && part.body.attachmentId && images.length < MAX_FLYERS) {
      images.push({ mimeType: mime, attachmentId: part.body.attachmentId, filename: part.filename || 'flyer' });
    }
    (part.parts || []).forEach(walk);
  })(payload);
  return { text: plain || stripHtml(html), images };
}

async function downloadImages(messageId, images, accessToken) {
  const parts = [];
  for (const img of images) {
    try {
      const att = await gmail(`/users/me/messages/${messageId}/attachments/${img.attachmentId}`, accessToken);
      if (att && att.data) parts.push({ inlineData: { mimeType: img.mimeType, data: b64urlToB64(att.data) } });
    } catch {
      // Skip an unreadable attachment; the email text still gets analyzed.
    }
    if (parts.length >= MAX_FLYERS) break;
  }
  return parts;
}

async function runPipeline(emailText, imageParts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini is not configured on the server.');
  const parts = [{ text: PIPELINE_PROMPT + emailText }];
  for (const p of imageParts) parts.push(p);
  const r = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.15, responseMimeType: 'application/json' } }),
  });
  const result = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((result && result.error && result.error.message) || 'The AI request could not be completed.');
  const raw = ((result.candidates || [])[0] || {}).content;
  const text = ((raw && raw.parts) || []).map((p) => p.text || '').join('');
  const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ''));
  if (!Array.isArray(parsed.digest) || !Array.isArray(parsed.todos) || !Array.isArray(parsed.events)) {
    throw new Error('The response did not include all three lists.');
  }
  return {
    digest: parsed.digest.slice(0, 30),
    todos: parsed.todos.slice(0, 30).map((t, i) => ({ ...t, id: t.id || `task-${i}` })),
    events: parsed.events.slice(0, 30),
  };
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  if (req.method === 'GET') {
    res.status(200).json({ connected: true, email: session.email || 'unknown' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  try {
    const live = await refreshAccessToken(session);
    setSessionCookie(res, live); // persist refreshed expiry
    const accessToken = live.access_token;

    const list = await gmail('/users/me/messages', accessToken, { q: GMAIL_QUERY, maxResults: String(MAX_LIST) });
    const ids = ((list && list.messages) || []).slice(0, MAX_EMAILS).map((m) => m.id);
    if (!ids.length) {
      res.status(200).json({ digest: [], todos: [], events: [] });
      return;
    }

    const emailTexts = [];
    const imageParts = [];
    let n = 0;
    for (const id of ids) {
      n += 1;
      const msg = await gmail(`/users/me/messages/${id}`, accessToken, { format: 'full' });
      const payload = msg.payload || {};
      const { text, images } = extractContent(payload);
      const body = (text || '').slice(0, 6000);
      emailTexts.push(
        `EMAIL ${n}\nFrom: ${headerOf(payload, 'from')}\nSubject: ${headerOf(payload, 'subject')}\nDate: ${headerOf(payload, 'date')}\n\n${body}\n\n---\n`
      );
      if (imageParts.length < MAX_FLYERS && images.length) {
        const more = await downloadImages(id, images, accessToken);
        for (const p of more) {
          if (imageParts.length < MAX_FLYERS) imageParts.push(p);
        }
      }
    }

    const result = await runPipeline(emailTexts.join('\n'), imageParts);
    res.status(200).json(result);
  } catch (err) {
    if (err && err.message === 'reauth') {
      res.status(401).json({ error: 'Please sign in with Google again.' });
      return;
    }
    // Generic message only: never leak tokens, bodies, or upstream details.
    res.status(500).json({ error: 'The Gmail scan could not be completed. Please try again.' });
  }
}
