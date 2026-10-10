// GET /api/auth/login — starts Google OAuth2 for read-only Gmail access.
// Redirects (302) to Google's consent screen. No secrets are exposed here;
// the client secret is only used server-side in api/auth/callback.js.

const REDIRECT_URI = 'https://backpack-olive.vercel.app/api/auth/callback';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export default function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    res.status(500).json({ error: 'OAuth is not configured on the server.' });
    return;
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  res.end();
}
