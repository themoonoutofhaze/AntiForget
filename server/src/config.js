if (!process.env.APP_ENCRYPTION_KEY || !process.env.APP_ENCRYPTION_KEY.trim()) {
  throw new Error(
    'APP_ENCRYPTION_KEY environment variable is required but not set. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

if (!process.env.APP_JWT_SECRET || !process.env.APP_JWT_SECRET.trim()) {
  throw new Error(
    'APP_JWT_SECRET environment variable is required but not set. ' +
    'It MUST be different from APP_ENCRYPTION_KEY. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
  throw new Error(
    'DATABASE_URL environment variable is required but not set. ' +
    'Use a PostgreSQL connection string, e.g. postgresql://user:pass@host:5432/dbname'
  );
}

export const config = {
  port: Number(process.env.PORT || process.env.APP_SERVER_PORT || 8787),
  databaseUrl: process.env.DATABASE_URL.trim(),
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || 'http://localhost:5173',
  encryptionKey: process.env.APP_ENCRYPTION_KEY.trim(),
  jwtSecret: process.env.APP_JWT_SECRET.trim(),
  google: {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI || 'http://localhost:8787/api/app/drive/callback',
  },
};

export const hasGoogleDriveConfig = () =>
  Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri);
