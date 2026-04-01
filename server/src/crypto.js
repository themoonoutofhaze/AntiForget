import crypto from 'node:crypto';
import { config } from './config.js';

const ALGO = 'aes-256-gcm';

const getKeyBuffer = () => {
  const raw = config.encryptionKey.trim();
  if (!raw) {
    throw new Error('APP_ENCRYPTION_KEY is required. Use a 32-byte secret string.');
  }

  // If key is hex-encoded 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  // Derive fixed-size key from arbitrary passphrase.
  return crypto.createHash('sha256').update(raw).digest();
};

export const encryptText = (plainText) => {
  const iv = crypto.randomBytes(12);
  const key = getKeyBuffer();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
};

export const decryptText = ({ ciphertext, iv, tag }) => {
  const key = getKeyBuffer();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
};
