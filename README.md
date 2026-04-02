<p align="center">
  <img src="icon.svg" width="128" height="128" alt="AntiForget Logo">
</p>

# AntiForget (Web App) v1.0.0

AntiForget is an expert-level active learning platform designed to help you master complex topics through AI-assisted synthesis and spaced repetition. It transforms your raw documents into structured knowledge maps and interactive recall sessions.

## Core Features

- **Distillation Tray**: Upload and summarize source files (PDF, DOCX, etc.) into concise, actionable summaries.
- **Knowledge Graph**: A visual map to connect topics, tags, and ideas, helping you see the "big picture" of your learning.
- **Socratic Arena**: AI-assisted active recall sessions that simulate oral exams or deep questioning to test your understanding.
- **FSRS Spaced Repetition**: Uses the Free Spaced Repetition Scheduler (FSRS) to optimize your review intervals for maximum retention.
- **Secure Data Persistence**: Full PostgreSQL backend support with encrypted credential storage and WebAuthn (Passkey) sign-in.
- **Hybrid Storage**: Flexible file persistence using either local server storage or Google Drive integration.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7, Tailwind CSS, Lucide Icons.
- **Backend**: Express.js (Node.js), PostgreSQL (via `pg`).
- **AI/LLM**: Support for Mistral, Groq, NVIDIA, and OpenRouter via server-side proxy.
- **Authentication**: Google OAuth 2.0 and Passkeys (WebAuthn).
- **Storage**: Local filesystem or Google Drive API.

## Setup Guide

### 1. Prerequisite: Database
Ensure you have a PostgreSQL instance running. You can use a local installation or a cloud provider like Supabase.

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/themoonoutofhaze/AntiForget.git
cd AntiForget

# Install dependencies
npm install
```

### 3. Environment Configuration
Copy the template and fill in your secrets:
```bash
cp .env.example .env
```
Key required variables:
- `DATABASE_URL`: Your PostgreSQL connection string.
- `APP_ENCRYPTION_KEY` & `APP_JWT_SECRET`: Random 64-character hex strings.
- `VITE_GOOGLE_CLIENT_ID`: Your Google OAuth client ID.

### 4. Database Migration (Optional)
If you are coming from an older SQLite version, migrate your data:
```bash
npm run db:migrate:sqlite-to-postgres:truncate
npm run db:validate:sqlite-to-postgres
```

### 5. Start the Application
```bash
# Run both frontend and backend in development mode
npm run dev
```
The app will be available at `http://localhost:5173`.

## Google Drive Integration
To enable cloud storage for your uploads:
1. Enable the **Google Drive API** in your Google Cloud Console.
2. Create an OAuth 2.0 Client ID (Web Application).
3. Add `http://localhost:8787/api/app/drive/callback` to your **Authorized redirect URIs**.
4. Fill in `GOOGLE_DRIVE_CLIENT_ID`, `SECRET`, and `REDIRECT_URI` in your `.env`.
3. Add `http://localhost:8787/api/app/drive/callback` as an authorized redirect URI.
4. Set `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and `GOOGLE_DRIVE_REDIRECT_URI`.
5. In app Settings, choose Google Drive and click Connect Drive.

## Docker And Cloud Run

This repo can run as a single Cloud Run container.

1. Keep Google login optional. If you do not set `VITE_GOOGLE_CLIENT_ID` at build time, the app falls back to passkey sign-in only.
2. Provide runtime secrets only through Cloud Run environment variables or Secret Manager. Do not commit a real `.env` file.
3. The backend requires `DATABASE_URL` and is designed for managed PostgreSQL (Supabase recommended for this project).
4. Build the image from the repo root `Dockerfile` and deploy it on Cloud Run with port `8080`.
5. Set `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `APP_JWT_SECRET`, `FRONTEND_BASE_URL`, and any optional Google Drive or AI provider keys in the Cloud Run service configuration.

Recommended deployment setup:

1. Create a Supabase project and copy its PostgreSQL connection string.
2. Store the connection string as a secret (for example, in Google Secret Manager).
3. Inject that secret into Cloud Run as `DATABASE_URL`.
4. Set `FRONTEND_BASE_URL=https://antiforget.app` for production.

If you want Google sign-in in production, create a separate Google OAuth client for your deployed domain and pass `VITE_GOOGLE_CLIENT_ID` at image build time.

## Passkey Notes

Passkey support is implemented with WebAuthn in-browser.
For this project it stores passkey account metadata locally for app login UX.

- Works best in secure contexts (HTTPS or localhost).
- Browser/device must support `PublicKeyCredential`.
- Production-grade verification normally requires a backend challenge verification flow.

## AI Provider Keys

Review Coach supports GLM, Groq, Mistral, and DeepSeek.
You can pick your provider and save keys from Settings.

Keys are stored encrypted in the `api_credentials` table and are only used server-side when calling provider APIs.
They are not returned back to the frontend after saving.

## Puter.js Integration

This app now loads Puter.js from:

```html
<script src="https://js.puter.com/v2/"></script>
```

You can verify it in-app from **Settings -> Puter.js** by clicking **Test Puter AI**.

Client helper functions are available in `src/utils/puter.ts`:

- `isPuterAvailable()`
- `puterChat(prompt, options)`

## Data Tables

Database engine: PostgreSQL (via `DATABASE_URL`)

Main tables:

- `users`
- `topics`
- `topic_relations`
- `fsrs_records`
- `user_preferences`
- `api_credentials`
- `file_assets`
- `drive_connections`

## File Storage Provider

Source files are stored in `google-drive` only (via Google Drive API after OAuth connect).

## Build

```bash
npm run build
```
