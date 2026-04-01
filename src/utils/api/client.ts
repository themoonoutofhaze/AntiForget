import { getCurrentUserId } from '../userContext';

const API_BASE = '/api/app';

export const buildApiUrl = (path: string) => `${API_BASE}${path}`;

const parseError = (status: number, text: string) => {
  const body = (text || '').trim();
  const looksLikeHtml = body.startsWith('<!DOCTYPE html>') || body.startsWith('<html');
  const hasCannotPost = /cannot\s+(post|get|put|patch|delete)\s+/i.test(body);

  if (looksLikeHtml && hasCannotPost) {
    return 'Backend API route was not found. Ensure the API server is running on port 8787 (use `npm run dev` to start both app and server).';
  }

  if (looksLikeHtml) {
    return 'Received HTML instead of API JSON. Ensure the API server is running and `/api/app` requests are proxied correctly.';
  }

  return body || `Request failed: ${status}`;
};

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(buildApiUrl(path), init);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseError(res.status, text));
  }

  return (await res.json()) as T;
};

export const apiGet = async <T>(path: string): Promise<T> => {
  const userId = encodeURIComponent(getCurrentUserId());
  const joiner = path.includes('?') ? '&' : '?';
  return requestJson<T>(`${path}${joiner}userId=${userId}`);
};

export const apiPatch = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  return requestJson<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-id': getCurrentUserId() },
    body: JSON.stringify({ ...body, userId: getCurrentUserId() }),
  });
};

export const apiPost = async <T>(
  path: string,
  body: Record<string, unknown>,
  init?: RequestInit,
): Promise<T> => {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('x-user-id', getCurrentUserId());

  return requestJson<T>(path, {
    ...init,
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, userId: getCurrentUserId() }),
  });
};

export const apiPut = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  return requestJson<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-user-id': getCurrentUserId() },
    body: JSON.stringify({ ...body, userId: getCurrentUserId() }),
  });
};

export const apiDelete = async <T>(path: string): Promise<T> => {
  return requestJson<T>(path, {
    method: 'DELETE',
    headers: { 'x-user-id': getCurrentUserId() },
  });
};
