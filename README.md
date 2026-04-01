# AntiForget (Web App)

AntiForget is a web app for active learning with three core workflows:

- Upload & Summarize: upload source files and create concise summaries
- Topic Map: connect topics visually
- Review Coach: run timed AI-assisted recall sessions with spaced repetition

This version persists user data through a backend API with SQLite tables, and supports file storage in either a local server folder or Google Drive.

## Tech Stack

- React 19 + TypeScript
- Vite 7
- Tailwind CSS
- Express API server
- SQLite database
- Google OAuth (via `@react-oauth/google`)
- Puter.js (frontend AI access)
- Passkey sign-in (WebAuthn)
- GLM / Groq / Mistral APIs (for review coaching)
- Encrypted API key storage (server-side)
- Local folder / Google Drive file persistence

## Setup

1. Install dependencies:

```bash
npm install
```

2. Add environment variables:

```bash
cp .env.example .env
```

Set Google OAuth + backend settings in `.env`:

```env
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
APP_SERVER_PORT=8787
APP_DB_PATH=./server_data/smartrevision.db
LOCAL_FILE_STORAGE_PATH=./server_data/uploads
FRONTEND_BASE_URL=http://localhost:5173
APP_ENCRYPTION_KEY=replace-with-a-long-random-secret
```

Optional Google Drive storage support:

```env
GOOGLE_DRIVE_CLIENT_ID=...
GOOGLE_DRIVE_CLIENT_SECRET=...
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:8787/api/app/drive/callback
```

3. Start backend API server:

```bash
npm run dev:server
```

4. Start frontend dev server:

```bash
npm run dev
```

The frontend uses `/api/app/*` and Vite proxies those requests to `http://localhost:8787` in development.

## Google Login Configuration

Create credentials in Google Cloud Console:

1. Create or select a project.
2. Configure OAuth consent screen.
3. Create OAuth Client ID of type "Web application".
4. Add your dev origin (for example `http://localhost:5173`) to Authorized JavaScript origins.
5. Copy the client ID into `VITE_GOOGLE_CLIENT_ID`.

## Google Drive Storage Configuration

If you enable Google Drive as the file provider:

1. Use the same Google Cloud project (or another one).
2. Enable Google Drive API.
3. Add `http://localhost:8787/api/app/drive/callback` as an authorized redirect URI.
4. Set `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and `GOOGLE_DRIVE_REDIRECT_URI`.
5. In app Settings, choose Google Drive and click Connect Drive.

## Docker And Cloud Run

This repo can run as a single Cloud Run container.

1. Keep Google login optional. If you do not set `VITE_GOOGLE_CLIENT_ID` at build time, the app falls back to passkey sign-in only.
2. Provide runtime secrets only through Cloud Run environment variables or Secret Manager. Do not commit a real `.env` file.
3. The current backend uses SQLite and local file storage. That is fine for a demo or single-instance deployment, but Cloud Run filesystem storage is ephemeral. For durable data, move the database and file uploads to managed storage before production use.
4. Build the image from the repo root `Dockerfile` and deploy it on Cloud Run with port `8080`.
5. Set `APP_ENCRYPTION_KEY`, `FRONTEND_BASE_URL`, and any optional Google Drive or AI provider keys in the Cloud Run service configuration.

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

Optional environment variables:

```env
VITE_AI_PROVIDER=glm

# GLM
VITE_GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
VITE_GLM_MODEL=glm-4.7-flash

# Groq
VITE_GROQ_BASE_URL=https://api.groq.com/openai/v1/chat/completions
VITE_GROQ_MODEL=openai/gpt-oss-120b

# Mistral
VITE_MISTRAL_BASE_URL=https://api.mistral.ai/v1/chat/completions
VITE_MISTRAL_MODEL=magistral-small-latest

# DeepSeek
VITE_DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions
VITE_DEEPSEEK_MODEL=deepseek-chat
```

Provider calls are made from the backend API (`/api/app/ai/tutor`) so API keys stay server-side.

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

Database file: `server_data/smartrevision.db`

Main tables:

- `users`
- `topics`
- `topic_relations`
- `fsrs_records`
- `user_preferences`
- `api_credentials`
- `file_assets`
- `drive_connections`

## File Storage Providers

From Settings, users can choose where source files are saved:

- `local`: files go to `LOCAL_FILE_STORAGE_PATH` (default `server_data/uploads`)
- `google-drive`: files upload via Google Drive API after OAuth connect

## Build

```bash
npm run build
```
