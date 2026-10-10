# Backpack

A school-email organizer for busy parents. It finds school-related emails and flyers in Gmail and turns them into a plain-language digest, a checkable to-do list with deadlines, and an activities list sorted by date.

## Try it

Live site: https://backpack-olive.vercel.app/

Two ways to use it:

- **Paste emails (no sign-in):** click **Load sample emails** or paste your own school emails, add a free Gemini API key (from Google AI Studio), and hit **Analyze**. Everything runs in your browser; the key is never saved.
- **Sign in with Google:** connect your Gmail (read-only access) and **Scan my Gmail** reads your real school emails and flyers, analyzed server-side.

## How it works

- Each email is summarized in 1–2 sentences for a busy parent and classified: **Action needed** / **Event** / **FYI**
- Action items are extracted with deadlines and merged into one deduplicated checklist
- Events are extracted with date, time, and location, sorted chronologically
- Flyer images are read with Gemini's vision capabilities

## Self-hosting the full-stack version

The repo is a Vercel-ready full-stack app: static frontend + Node serverless functions (`api/`), zero npm dependencies.

1. **Google Cloud Console:** create a project, enable the **Gmail API**, set up the OAuth consent screen (add yourself as a test user, add the `https://www.googleapis.com/auth/gmail.readonly` scope), then create an **OAuth client ID** (Web application) with authorized redirect URI `https://<your-domain>/api/auth/callback`.
2. **Vercel → Project Settings → Environment Variables:** set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, and `SESSION_SECRET` (any random 32+ character string). Redeploy.
3. Open the site, click **Sign in with Google**, grant read-only Gmail access, and scan.

## Privacy

- Only the `gmail.readonly` Gmail scope is ever requested.
- OAuth tokens live in an encrypted, httpOnly session cookie; the client secret and Gemini key stay server-side in environment variables, never in the repo.
- Email bodies are processed in memory for the scan and never logged or retained.

## Disclosure

Built with AI-assisted coding (Muse) during the Ensign BUILD 2026 hackathon. All work was done during the event.
