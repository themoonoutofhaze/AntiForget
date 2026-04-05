const API_BASE = '/api/app';

export const buildApiUrl = (path: string) => `${API_BASE}${path}`;

const parseError = (status: number, text: string) => {
  const body = (text || '').trim();
  const looksLikeHtml = body.startsWith('<!DOCTYPE html>') || body.startsWith('<html');
  const hasCannotPost = /cannot\s+(post|get|put|patch|delete)\s+/i.test(body);

  if (body && (body.startsWith('{') || body.startsWith('['))) {
    try {
      const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
      if (typeof parsed?.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim();
      }
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      // Ignore JSON parsing errors and fall back to plain text handling.
    }
  }

  if (looksLikeHtml && hasCannotPost) {
    return 'Backend API route was not found. Ensure the API server is running on port 8787 (use `npm run dev` to start both app and server).';
  }

  if (looksLikeHtml) {
    return 'Received HTML instead of API JSON. Ensure the API server is running and `/api/app` requests are proxied correctly.';
  }

  return body || `Request failed: ${status}`;
};

const isSessionAuthError = (status: number, text: string) => {
  if (status !== 401) {
    return false;
  }

  const normalized = (text || '').toLowerCase();
  if (!normalized.trim()) {
    return true;
  }

  // Treat 401 as session/auth expiration only when the server response indicates auth context.
  return /(session|token|sign\s*in|signin|authentication required|unauthorized|not authenticated|expired)/i.test(normalized);
};

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);

  const res = await fetch(buildApiUrl(path), {
    ...init,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();

    if (isSessionAuthError(res.status, text)) {
      // Only force a reload if there was a stale session (user stored locally but cookie gone).
      // If already unauthenticated, just throw so the caller handles it gracefully.
      const hadSession = !!localStorage.getItem('synapse_auth_user');
      localStorage.removeItem('synapse_auth_user');
      localStorage.removeItem('synapse_auth_token');
      if (hadSession) {
        window.location.reload();
      }
      throw new Error('Session expired. Please sign in again.');
    }

    throw new Error(parseError(res.status, text));
  }

  return (await res.json()) as T;
};

export const apiGet = async <T>(path: string): Promise<T> => {
  return requestJson<T>(path);
};

export const apiPatch = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  return requestJson<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

export const apiPost = async <T>(
  path: string,
  body: Record<string, unknown>,
  init?: RequestInit,
): Promise<T> => {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');

  return requestJson<T>(path, {
    ...init,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
};

export const apiPut = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  return requestJson<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
};

export const apiDelete = async <T>(path: string): Promise<T> => {
  return requestJson<T>(path, {
    method: 'DELETE',
  });
};
