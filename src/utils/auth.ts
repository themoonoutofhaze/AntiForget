import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

const AUTH_KEY = 'synapse_auth_user';
const PASSKEY_ACCOUNT_KEY = 'synapse_passkey_account';
const AUTH_TOKEN_KEY = 'synapse_auth_token';
const LEGACY_TOKEN_CLEARED_KEY = 'synapse_legacy_token_cleared';

export interface AuthUser {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
}

interface PasskeyAccount {
    credentialIdBase64Url: string;
    user: AuthUser;
}

interface EmailAuthResponse {
    user: AuthUser;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const getStoredPasskeyAccounts = (): PasskeyAccount[] => {
    const raw = localStorage.getItem(PASSKEY_ACCOUNT_KEY);
    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw) as PasskeyAccount[] | PasskeyAccount;
        if (Array.isArray(parsed)) {
            return parsed;
        }
        return parsed ? [parsed] : [];
    } catch {
        return [];
    }
};

const parseEmailAuthError = async (res: Response): Promise<string> => {
    const fallback = `Request failed: ${res.status}`;
    try {
        const parsed = (await res.json()) as { error?: string };
        if (parsed?.error && typeof parsed.error === 'string') {
            return parsed.error;
        }
        return fallback;
    } catch {
        return fallback;
    }
};

const postEmailAuth = async (
    path: '/api/app/auth/signup' | '/api/app/auth/signin',
    payload: Record<string, string>,
): Promise<EmailAuthResponse> => {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        throw new Error(await parseEmailAuthError(res));
    }

    return (await res.json()) as EmailAuthResponse;
};

export const getStoredUser = (): AuthUser | null => {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw) as AuthUser;
    } catch {
        return null;
    }
};

export const storeUser = (user: AuthUser, _token?: string) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
    // Token is now stored in an httpOnly cookie set by the server.
    // Clear any legacy localStorage token on first store.
    if (!localStorage.getItem(LEGACY_TOKEN_CLEARED_KEY)) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.setItem(LEGACY_TOKEN_CLEARED_KEY, '1');
    }
};

export const getAuthToken = (): string | null => {
    // Auth token is now in an httpOnly cookie — not readable from JS.
    // Return null so callers don't set a redundant Authorization header.
    return null;
};

export const storeAuthToken = (_token: string) => {
    // No-op: token is managed as an httpOnly cookie by the server.
};

export const clearStoredUser = async () => {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    try {
        await fetch('/api/app/auth/signout', { method: 'POST' });
    } catch {
        // Best-effort cookie clear.
    }
};

export const verifyGoogleCredentialWithServer = async (credential: string): Promise<{ user: AuthUser }> => {
    const res = await fetch('/api/app/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
    });
    if (!res.ok) {
        const parsed = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(parsed?.error || 'Google Sign-In verification failed.');
    }
    return res.json() as Promise<{ user: AuthUser }>;
};

export const verifyGoogleAccessTokenWithServer = async (accessToken: string): Promise<{ user: AuthUser }> => {
    const res = await fetch('/api/app/auth/google/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
    });
    if (!res.ok) {
        const parsed = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(parsed?.error || 'Google Sign-In verification failed.');
    }
    return res.json() as Promise<{ user: AuthUser }>;
};

export const refreshAuthToken = async (): Promise<{ user: AuthUser } | null> => {
    try {
        const res = await fetch('/api/app/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return null;
        const data = await res.json() as { user: AuthUser };
        return data;
    } catch {
        return null;
    }
};

export const isPasskeySupported = () => {
    return typeof window !== 'undefined' && 'PublicKeyCredential' in window;
};

export const getRegisteredPasskeyUsers = (): AuthUser[] => {
    return getStoredPasskeyAccounts().map((account) => account.user);
};

export const registerPasskeyUser = async (name: string): Promise<AuthUser> => {
    if (!isPasskeySupported()) {
        throw new Error('Passkeys are not supported on this browser.');
    }

    const challengeRes = await fetch('/api/app/auth/passkey/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'registration', userName: name }),
    });
    if (!challengeRes.ok) {
        throw new Error('Failed to get passkey challenge from server.');
    }
    const { challengeId, options } = await challengeRes.json() as { challengeId: string; options: object; userId: string };

    const registrationResponse = await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'] });

    const registerRes = await fetch('/api/app/auth/passkey/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, response: registrationResponse, name }),
    });
    if (!registerRes.ok) {
        const parsed = await registerRes.json().catch(() => ({})) as { error?: string };
        throw new Error(parsed?.error || 'Passkey registration failed.');
    }
    const { user } = await registerRes.json() as { user: AuthUser };

    const account: PasskeyAccount = {
        credentialIdBase64Url: registrationResponse.id,
        user,
    };
    const existingAccounts = getStoredPasskeyAccounts();
    const nextAccounts = [
        ...existingAccounts.filter((a) => a.credentialIdBase64Url !== account.credentialIdBase64Url),
        account,
    ];
    localStorage.setItem(PASSKEY_ACCOUNT_KEY, JSON.stringify(nextAccounts));

    return user;
};

export const authenticateWithPasskey = async (): Promise<AuthUser> => {
    if (!isPasskeySupported()) {
        throw new Error('Passkeys are not supported on this browser.');
    }

    const challengeRes = await fetch('/api/app/auth/passkey/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'authentication' }),
    });
    if (!challengeRes.ok) {
        throw new Error('Failed to get passkey challenge from server.');
    }
    const { challengeId, options } = await challengeRes.json() as { challengeId: string; options: object };

    const authenticationResponse = await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'] });

    const verifyRes = await fetch('/api/app/auth/passkey/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, response: authenticationResponse }),
    });
    if (!verifyRes.ok) {
        const parsed = await verifyRes.json().catch(() => ({})) as { error?: string };
        throw new Error(parsed?.error || 'Passkey authentication failed.');
    }
    const { user } = await verifyRes.json() as { user: AuthUser };

    return user;
};

export const registerWithEmailPassword = async (name: string, email: string, password: string): Promise<AuthUser> => {
    const normalizedName = name.trim();
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedName) {
        throw new Error('Name is required.');
    }
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new Error('Enter a valid email address.');
    }
    if (password.length < 8) {
        throw new Error('Password must be at least 8 characters.');
    }

    const response = await postEmailAuth('/api/app/auth/signup', {
        name: normalizedName,
        email: normalizedEmail,
        password,
    });

    return response.user;
};

export const signInWithEmailPassword = async (email: string, password: string): Promise<AuthUser> => {
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
        throw new Error('Enter a valid email address.');
    }
    if (!password) {
        throw new Error('Password is required.');
    }

    const response = await postEmailAuth('/api/app/auth/signin', {
        email: normalizedEmail,
        password,
    });

    return response.user;
};
