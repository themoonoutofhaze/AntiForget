import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const serverSrcDir = path.dirname(currentFile);
const projectRootDir = path.resolve(serverSrcDir, '..', '..');
const resolveAppPath = (value, fallback) => {
  const picked = value || fallback;
  if (path.isAbsolute(picked)) {
    return picked;
  }
  return path.resolve(projectRootDir, picked);
};

export const config = {
  port: Number(process.env.PORT || process.env.APP_SERVER_PORT || 8787),
  dbPath: resolveAppPath(process.env.APP_DB_PATH, './server_data/smartrevision.db'),
  uploadsRoot: resolveAppPath(process.env.LOCAL_FILE_STORAGE_PATH, './server_data/uploads'),
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || 'http://localhost:5173',
  encryptionKey: process.env.APP_ENCRYPTION_KEY || '',
  google: {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI || 'http://localhost:8787/api/app/drive/callback',
  },
};

export const hasGoogleDriveConfig = () =>
  Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri);
