import { jwtDecode } from 'jwt-decode';

const AUTH_KEY = 'synapse_auth_user';
const PASSKEY_ACCOUNT_KEY = 'synapse_passkey_account';

export interface AuthUser {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
}

interface GoogleCredentialPayload {
    sub: string;
    name: string;
    email: string;
    picture?: string;
}

interface PasskeyAccount {
    credentialIdBase64Url: string;
    user: AuthUser;
}

const toBase64Url = (bytes: Uint8Array): string => {
    const binary = String.fromCharCode(...bytes);
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value: string): ArrayBuffer => {
    const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const randomChallenge = () => crypto.getRandomValues(new Uint8Array(32));

const getStoredPasskeyAccount = (): PasskeyAccount | null => {
    const raw = localStorage.getItem(PASSKEY_ACCOUNT_KEY);
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw) as PasskeyAccount;
    } catch {
        return null;
    }
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

export const storeUser = (user: AuthUser) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
};

export const clearStoredUser = () => {
    localStorage.removeItem(AUTH_KEY);
};

export const parseGoogleCredential = (credential: string): AuthUser => {
    const payload = jwtDecode<GoogleCredentialPayload>(credential);

    return {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        avatarUrl: payload.picture,
    };
};

export const isPasskeySupported = () => {
    return typeof window !== 'undefined' && 'PublicKeyCredential' in window;
};

export const registerPasskeyUser = async (name: string, email: string): Promise<AuthUser> => {
    if (!isPasskeySupported()) {
        throw new Error('Passkeys are not supported on this browser.');
    }

    const userId = crypto.randomUUID();
    const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: randomChallenge(),
        rp: {
            name: 'AntiForget',
            id: window.location.hostname,
        },
        user: {
            id: new TextEncoder().encode(userId),
            name: email,
            displayName: name,
        },
        pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
        ],
        timeout: 60_000,
        attestation: 'none',
        authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'preferred',
        },
    };

    const credential = await navigator.credentials.create({ publicKey });
    if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('Passkey registration was cancelled.');
    }

    const authUser: AuthUser = {
        id: userId,
        name,
        email,
    };

    const account: PasskeyAccount = {
        credentialIdBase64Url: toBase64Url(new Uint8Array(credential.rawId)),
        user: authUser,
    };

    localStorage.setItem(PASSKEY_ACCOUNT_KEY, JSON.stringify(account));
    return authUser;
};

export const authenticateWithPasskey = async (): Promise<AuthUser> => {
    if (!isPasskeySupported()) {
        throw new Error('Passkeys are not supported on this browser.');
    }

    const account = getStoredPasskeyAccount();
    if (!account) {
        throw new Error('No passkey account found. Register one first.');
    }

    const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: randomChallenge(),
        timeout: 60_000,
        userVerification: 'preferred',
        allowCredentials: [
            {
                type: 'public-key',
                id: fromBase64Url(account.credentialIdBase64Url),
            },
        ],
    };

    const credential = await navigator.credentials.get({ publicKey });
    if (!(credential instanceof PublicKeyCredential)) {
        throw new Error('Passkey sign-in was cancelled.');
    }

    return account.user;
};
