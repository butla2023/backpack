# Backpack

A school-email organizer for busy parents. Paste school emails in (or load the built-in samples), and Backpack turns them into a plain-language digest, a checkable to-do list with deadlines, and an activities list sorted by date.

## Try it

Open `index.html` in any browser, or use the hosted demo: https://muse.ai/s/backpack-vo67xcx0fxq0c5

Click **Load sample emails**, paste your free Gemini API key (from Google AI Studio), and hit **Analyze**.

## How it works

- Each email is summarized in 1–2 sentences for a busy parent and classified: **Action needed** / **Event** / **FYI**
- Action items are extracted with deadlines and merged into one deduplicated checklist (check-offs persist in `localStorage`)
- Events are extracted with date, time, and location, sorted chronologically
- Flyer images can be attached and are read with Gemini's vision capabilities

## Privacy

This is a static page — no backend. Pasted emails and your API key never leave the browser except for the calls to the Gemini API needed for analysis. The key is not stored.

## Disclosure

Built with AI-assisted coding (Muse) during the Ensign BUILD 2026 hackathon. All work was done during the event.
