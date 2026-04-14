<p align="center">
  <img src="icon.svg" width="128" height="128" alt="AntiForget Logo">
</p>

# AntiForget (Web App) v1.1.1

AntiForget is an AI-native study system that combines topic distillation, graph-based knowledge mapping, and FSRS-driven revision workflows.

## What's New In v1.1.1

- Revision chat now supports append-only topic learning notes.
- In Socratic Arena results chat, you can add learned insights to the topic summary without replacing existing notes.
- Added two capture paths for learning notes: per AI reply and manual note entry.
- Deploy script image tag updated to `v1.1.1`.

## Core Features

- Distillation Tray:
  - Create or edit topic summaries from text or uploaded source files.
  - Attach PDF/DOC/DOCX study files (Google Drive-backed file storage).
  - Link topics while authoring to build graph relationships.
- Knowledge Graph:
  - Visual node-edge knowledge map for topics and relationships.
  - Supports evolving topic structure over time.
- Socratic Arena:
  - AI-generated revision questions with grading and answer feedback.
  - Post-quiz AI follow-up chat for remediation and reinforcement.
  - Lightning mode (shorter checks) and unrecorded practice mode.
  - Append learning notes from chat into topic summaries.
- FSRS Revision Engine:
  - Scheduled review flow using FSRS records per topic.
  - Daily revision limits, daily topic limits, and question difficulty controls.
  - Weak question history persistence per topic for targeted practice.
- Notifications And Reminders:
  - Revision reminder enable/time settings and push-notification support.
- Security And Auth:
  - Google sign-in and password/passkey (WebAuthn) auth flows.
  - Server-side encrypted API credential storage.
- AI Provider Orchestration:
  - Supports OpenAI, Claude, Gemini, OpenRouter, NVIDIA, Groq, Mistral, and Puter.
  - Provider/model fallback and user-configured revision model preferences.

## Tech Stack

- Frontend: React 19, TypeScript, Vite 7, Tailwind CSS.
- Backend: Node.js, Express, PostgreSQL.
- Data: Topic graph + FSRS state in relational tables.
- Auth: JWT session auth, Google OAuth, WebAuthn passkeys.
- AI: Multi-provider server proxy + optional Puter runtime.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables in `.env` (database, encryption/jwt secrets, and optional provider keys).

3. Run development servers:

```bash
npm run dev
```

4. Build production assets:

```bash
npm run build
```

## Database Migration

For projects migrating from legacy SQLite data:

```bash
npm run db:migrate:sqlite-to-postgres:truncate
npm run db:validate:sqlite-to-postgres
```

## Google Drive Storage

To use source-file uploads with Drive-backed storage:

1. Enable Google Drive API in your Google Cloud project.
2. Configure OAuth credentials.
3. Set `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and `GOOGLE_DRIVE_REDIRECT_URI`.
4. Connect Drive from app Settings.

## Deployment

- Build and deploy with the included shell script:

```bash
./deploy.sh
```

- Script defaults now publish image tag `v1.1.1`.

## Notes

- API keys are encrypted at rest and used server-side only.
- Passkeys require secure context (HTTPS or localhost).
