import React, { useMemo, useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { KeyRound, ShieldCheck, Sparkles, BookOpen, Network } from 'lucide-react';
import type { AuthUser } from '../../utils/auth';
import {
    authenticateWithPasskey,
    isPasskeySupported,
    parseGoogleCredential,
    registerPasskeyUser,
} from '../../utils/auth';

interface LoginScreenProps {
    hasGoogleClientId: boolean;
    onLogin: (user: AuthUser) => void;
}

const FEATURES = [
    {
        icon: <BookOpen className="w-4 h-4" />,
        title: '10-min distillation sprints',
        desc: 'Active synthesis over passive reading.',
    },
    {
        icon: <Network className="w-4 h-4" />,
        title: 'Knowledge graph mapping',
        desc: 'See conceptual links emerge visually.',
    },
    {
        icon: <Sparkles className="w-4 h-4" />,
        title: 'AI Socratic review loops',
        desc: 'Spaced repetition with real dialogue.',
    },
];

export const LoginScreen: React.FC<LoginScreenProps> = ({ hasGoogleClientId, onLogin }) => {
    const [authError, setAuthError] = useState<string | null>(null);
    const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
    const [passkeyName, setPasskeyName] = useState('');
    const [passkeyEmail, setPasskeyEmail] = useState('');

    const passkeyAvailable = useMemo(() => isPasskeySupported(), []);

    const handleRegisterPasskey = async () => {
        setAuthError(null);
        setIsPasskeyLoading(true);
        try {
            const name = passkeyName.trim();
            const email = passkeyEmail.trim();
            if (!name || !email) throw new Error('Enter your name and email to create a passkey.');
            const user = await registerPasskeyUser(name, email);
            onLogin(user);
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Passkey registration failed.');
        } finally {
            setIsPasskeyLoading(false);
        }
    };

    const handlePasskeyLogin = async () => {
        setAuthError(null);
        setIsPasskeyLoading(true);
        try {
            const user = await authenticateWithPasskey();
            onLogin(user);
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Passkey login failed.');
        } finally {
            setIsPasskeyLoading(false);
        }
    };

    return (
        <div
            className="min-h-[100dvh] w-full flex items-start justify-center p-4 sm:p-6 md:py-8 relative overflow-x-hidden overflow-y-auto scrollbar-on-intent"
            style={{ background: 'var(--bg-app)' }}
        >
            {/* Animated background orbs */}
            <div className="app-background" />
            <div className="light-grid-overlay" style={{ opacity: 0.6 }} />

            {/* Constellation canvas */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background:
                        'radial-gradient(ellipse at 20% 30%, rgba(5,150,105,0.10) 0%, transparent 55%), radial-gradient(ellipse at 80% 70%, rgba(6,182,212,0.08) 0%, transparent 55%)',
                }}
            />

            <div className="relative z-10 w-full max-w-5xl mx-auto">
                <div
                    className="grid md:grid-cols-2 gap-0 overflow-y-auto max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] scrollbar-on-intent"
                    style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-default)',
                        borderRadius: '24px',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        boxShadow: '0 32px 80px rgba(0,0,0,0.12), 0 8px 32px rgba(0,0,0,0.08)',
                    }}
                >
                    {/* ── Left panel ──────────────────────────────── */}
                    <div
                        className="p-10 md:p-12 flex flex-col relative overflow-hidden"
                        style={{
                            background: 'linear-gradient(145deg, rgba(5,150,105,0.08) 0%, rgba(6,182,212,0.04) 100%)',
                            borderRight: '1px solid var(--border-subtle)',
                        }}
                    >
                        {/* Decorative blobs */}
                        <div
                            className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full pointer-events-none"
                            style={{ background: 'radial-gradient(ellipse, rgba(16,185,129,0.12) 0%, transparent 70%)' }}
                        />

                        {/* Logo */}
                        <div className="flex items-center gap-3 mb-10">
                            <div
                                className="w-10 h-10 rounded-xl flex items-center justify-center"
                                style={{
                                    background: 'linear-gradient(135deg, #2563eb 0%, #14b8a6 52%, #22c55e 100%)',
                                    boxShadow: '0 6px 20px var(--accent-glow)',
                                }}
                            >
                                <span
                                    aria-hidden="true"
                                    className="w-7 h-7"
                                    style={{
                                        background: '#ffffff',
                                        maskImage: 'url(/icon.svg)',
                                        maskRepeat: 'no-repeat',
                                        maskPosition: 'center',
                                        maskSize: 'contain',
                                        WebkitMaskImage: 'url(/icon.svg)',
                                        WebkitMaskRepeat: 'no-repeat',
                                        WebkitMaskPosition: 'center',
                                        WebkitMaskSize: 'contain',
                                    }}
                                />
                            </div>
                            <div>
                                <p
                                    className="text-sm font-bold tracking-tight"
                                    style={{ fontFamily: 'Syne, sans-serif', color: 'var(--text-primary)' }}
                                >
                                    AntiForget
                                </p>
                                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                    Intelligent Learning
                                </p>
                            </div>
                        </div>

                        {/* Hero headline */}
                        <h1
                            className="text-3xl md:text-4xl font-display font-bold leading-tight mb-4"
                            style={{ fontFamily: 'Syne, sans-serif', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}
                        >
                            Train memory with{' '}
                            <span className="gradient-text-warm">
                                calm, structured clarity.
                            </span>
                        </h1>

                        <p className="text-sm leading-relaxed mb-8" style={{ color: 'var(--text-secondary)' }}>
                            One focused workspace to distill notes, connect ideas, and run Socratic drill sessions.
                        </p>

                        {/* Feature list */}
                        <div className="space-y-3 mt-auto">
                            {FEATURES.map((f) => (
                                <div
                                    key={f.title}
                                    className="flex items-start gap-3 p-3 rounded-xl"
                                    style={{
                                        background: 'var(--bg-surface-raised)',
                                        border: '1px solid var(--border-subtle)',
                                    }}
                                >
                                    <span
                                        className="p-1.5 rounded-lg flex-shrink-0"
                                        style={{
                                            background: 'rgba(16,185,129,0.10)',
                                            color: 'var(--accent-primary)',
                                        }}
                                    >
                                        {f.icon}
                                    </span>
                                    <div>
                                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                            {f.title}
                                        </p>
                                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                            {f.desc}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── Right panel ─────────────────────────────── */}
                    <div className="p-10 md:p-12 flex flex-col justify-center">
                        <h2
                            className="text-2xl font-display font-bold mb-2"
                            style={{ fontFamily: 'Syne, sans-serif', color: 'var(--text-primary)' }}
                        >
                            Sign in to continue
                        </h2>
                        <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
                            Access your learning cockpit with Google or a device passkey.
                        </p>

                        <div className="space-y-5">
                            {/* Google login */}
                            {hasGoogleClientId ? (
                                <div>
                                    <GoogleLogin
                                        theme="outline"
                                        size="large"
                                        text="continue_with"
                                        shape="pill"
                                        width="100%"
                                        onSuccess={(credentialResponse) => {
                                            if (!credentialResponse.credential) return;
                                            const user = parseGoogleCredential(credentialResponse.credential);
                                            onLogin(user);
                                        }}
                                        onError={() => console.error('Google login failed.')}
                                    />
                                </div>
                            ) : (
                                <div
                                    className="rounded-xl p-4 text-sm"
                                    style={{
                                        background: 'rgba(245,158,11,0.08)',
                                        border: '1px solid rgba(245,158,11,0.25)',
                                        color: '#d97706',
                                    }}
                                >
                                    Set <code className="font-mono text-xs px-1 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.12)' }}>VITE_GOOGLE_CLIENT_ID</code> in your environment to enable Google login.
                                </div>
                            )}

                            {/* Divider */}
                            <div className="flex items-center gap-3">
                                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                                <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>or</span>
                                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
                            </div>

                            {/* Passkey section */}
                            <div
                                className="rounded-xl p-4 space-y-3"
                                style={{
                                    background: 'var(--bg-muted)',
                                    border: '1px solid var(--border-default)',
                                }}
                            >
                                <div className="flex items-center gap-2">
                                    <KeyRound
                                        className="w-4 h-4 flex-shrink-0"
                                        style={{ color: 'var(--accent-primary)' }}
                                    />
                                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        Passkey Sign‑In
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        id="passkey-name"
                                        value={passkeyName}
                                        onChange={(e) => setPasskeyName(e.target.value)}
                                        placeholder="Full name"
                                        className="input-field"
                                    />
                                    <input
                                        id="passkey-email"
                                        value={passkeyEmail}
                                        onChange={(e) => setPasskeyEmail(e.target.value)}
                                        placeholder="Email"
                                        className="input-field"
                                    />
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        id="create-passkey-btn"
                                        onClick={handleRegisterPasskey}
                                        disabled={!passkeyAvailable || isPasskeyLoading}
                                        className="btn-primary text-xs py-2 px-4"
                                    >
                                        {isPasskeyLoading ? 'Processing…' : 'Create passkey'}
                                    </button>
                                    <button
                                        id="use-passkey-btn"
                                        onClick={handlePasskeyLogin}
                                        disabled={!passkeyAvailable || isPasskeyLoading}
                                        className="btn-secondary text-xs py-2 px-4"
                                    >
                                        Use existing passkey
                                    </button>
                                </div>

                                {!passkeyAvailable && (
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                        Passkeys are not supported on this browser or device.
                                    </p>
                                )}
                            </div>

                            {/* Error */}
                            {authError && (
                                <div
                                    className="rounded-xl px-4 py-3 text-sm"
                                    style={{
                                        background: 'rgba(244,63,94,0.08)',
                                        border: '1px solid rgba(244,63,94,0.25)',
                                        color: '#f43f5e',
                                    }}
                                >
                                    {authError}
                                </div>
                            )}
                        </div>

                        {/* Trust note */}
                        <p
                            className="mt-8 flex items-center gap-2 text-xs"
                            style={{ color: 'var(--text-muted)' }}
                        >
                            <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                            Identity validated by your chosen sign‑in provider. No passwords stored.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
