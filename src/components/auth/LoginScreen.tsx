import React, { useMemo, useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { KeyRound, ShieldCheck, Sparkles, BookOpen, Network, Github, Eye, EyeOff } from 'lucide-react';
import type { AuthUser } from '../../utils/auth';
import {
    authenticateWithPasskey,
    getRegisteredPasskeyUsers,
    isPasskeySupported,
    registerWithEmailPassword,
    registerPasskeyUser,
    signInWithEmailPassword,
} from '../../utils/auth';

interface LoginScreenProps {
    hasGoogleClientId: boolean;
    onLogin: (user: AuthUser, options?: { keepToken?: boolean }) => void;
}

const FEATURES = [
    { icon: <BookOpen className="w-3 h-3" />, label: 'Upload summary OF topics' },
    { icon: <Network className="w-3 h-3" />, label: 'Create links between topics' },
    { icon: <Sparkles className="w-3 h-3" />, label: 'Revise smartly using ai & Spaced Repetition' },
];  

type FormMode = 'signin' | 'signup';

function hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r},${g},${b}`;
}

const GoogleSignInRow: React.FC<{
    onSuccess: (user: AuthUser, options?: { keepToken?: boolean }) => void;
    onError: () => void;
}> = ({ onSuccess, onError }) => {
    const [hovered, setHovered] = useState(false);
    const login = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            try {
                const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
                });
                const info = await res.json() as { sub: string; name: string; email: string; picture?: string };
                onSuccess({ id: info.sub, name: info.name, email: info.email, avatarUrl: info.picture }, { keepToken: false });
            } catch {
                onError();
            }
        },
        onError,
    });

    const rgb = hexToRgb('#4285F4');
    return (
        <button
            type="button"
            onClick={() => login()}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="w-full flex items-center gap-3 px-4 h-11"
            style={{
                background: hovered ? `rgba(${rgb}, 0.07)` : 'var(--bg-surface-raised)',
                border: `1px solid ${hovered ? `rgba(${rgb}, 0.40)` : 'var(--border-default)'}`,
                borderRadius: '14px',
                boxShadow: hovered ? `0 4px 20px rgba(${rgb}, 0.12)` : 'none',
                transition: 'background 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease',
            }}
        >
            <span
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                    background: hovered ? `rgba(${rgb}, 0.18)` : 'rgba(66,133,244,0.09)',
                    transition: 'background 0.22s ease',
                }}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
            </span>
            <span className="text-sm font-medium flex-1 text-left" style={{ color: 'var(--text-primary)' }}>
                Continue with Google
            </span>
        </button>
    );
};

export const LoginScreen: React.FC<LoginScreenProps> = ({ hasGoogleClientId, onLogin }) => {
    const [authError, setAuthError] = useState<string | null>(null);
    const [formMode, setFormMode] = useState<FormMode>('signin');
    const [isLoading, setIsLoading] = useState(false);
    const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
    const [showPasskeyRegister, setShowPasskeyRegister] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [passkeyName, setPasskeyName] = useState('');
    const [passkeyHovered, setPasskeyHovered] = useState(false);

    const passkeyAvailable = useMemo(() => isPasskeySupported(), []);
    const registeredPasskeyUsers = useMemo(() => getRegisteredPasskeyUsers(), []);

    const switchMode = (mode: FormMode) => {
        setFormMode(mode);
        setAuthError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthError(null);
        setIsLoading(true);
        try {
            const user =
                formMode === 'signup'
                    ? await registerWithEmailPassword(name, email, password)
                    : await signInWithEmailPassword(email, password);
            onLogin(user, { keepToken: true });
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Authentication failed.');
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasskeyLogin = async () => {
        setAuthError(null);
        setIsPasskeyLoading(true);
        try {
            const user = await authenticateWithPasskey();
            onLogin(user, { keepToken: false });
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Passkey login failed.');
        } finally {
            setIsPasskeyLoading(false);
        }
    };

    const handleRegisterPasskey = async () => {
        setAuthError(null);
        setIsPasskeyLoading(true);
        try {
            const trimmedName = passkeyName.trim();
            if (!trimmedName) throw new Error('Enter your name to create a passkey.');
            const user = await registerPasskeyUser(trimmedName);
            onLogin(user, { keepToken: false });
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Passkey registration failed.');
        } finally {
            setIsPasskeyLoading(false);
        }
    };

    const handlePasskeyClick = () => {
        if (formMode === 'signup') {
            setShowPasskeyRegister((prev) => !prev);
            setAuthError(null);
        } else if (registeredPasskeyUsers.length > 0) {
            handlePasskeyLogin();
        } else {
            setShowPasskeyRegister((prev) => !prev);
            setAuthError(null);
        }
    };

    return (
        <div className="h-[100dvh] w-full flex flex-col lg:flex-row overflow-hidden">

            {/* ─── LEFT PANEL: Form ─── */}
            <div
                className="relative flex flex-col w-full lg:w-1/2 flex-1 lg:flex-none overflow-y-auto scrollbar-on-intent"
                style={{ background: 'var(--bg-surface)' }}
            >
                <div className="relative z-10 flex flex-col flex-1 px-8 sm:px-10 py-6 w-full max-w-[500px] mx-auto">

                    {/* Headline */}
                    <div className="mb-4">
                        <h1
                            className="text-[1.85rem] font-bold leading-tight mb-1"
                            style={{ fontFamily: 'Syne, sans-serif', color: 'var(--text-primary)', letterSpacing: '-0.03em' }}
                        >
                            {formMode === 'signin' ? 'Welcome back!' : 'Create account'}
                        </h1>
                        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {formMode === 'signin'
                                ? 'Sign in to continue your learning journey.'
                                : 'Start building your knowledge base today.'}
                        </p>
                    </div>

                    {/* Mode Toggle Tabs */}
                    <div
                        className="flex p-1 rounded-2xl mb-4"
                        style={{ background: 'var(--bg-surface-raised)', border: '1px solid var(--border-default)' }}
                    >
                        {(['signin', 'signup'] as FormMode[]).map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => switchMode(mode)}
                                className="flex-1 py-1.5 text-sm font-semibold rounded-xl transition-all duration-200"
                                style={{
                                    background: formMode === mode ? 'var(--accent-primary)' : 'transparent',
                                    color: formMode === mode ? '#ffffff' : 'var(--text-muted)',
                                    boxShadow: formMode === mode ? '0 2px 10px var(--accent-glow)' : 'none',
                                }}
                            >
                                {mode === 'signin' ? 'Sign In' : 'Sign Up'}
                            </button>
                        ))}
                    </div>

                    {/* Email / Password Form */}
                    <form onSubmit={handleSubmit}>
                        {/* Name field — animates in/out for sign-up */}
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateRows: formMode === 'signup' ? '1fr' : '0fr',
                                transition: 'grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                            }}
                        >
                            <div style={{ overflow: 'hidden', minHeight: 0, opacity: formMode === 'signup' ? 1 : 0, transition: 'opacity 0.25s ease' }}>
                                <div className="space-y-1 pb-3">
                                    <label htmlFor="auth-name" className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                                        Name
                                    </label>
                                    <input
                                        id="auth-name"
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Your full name"
                                        className="input-field"
                                        autoComplete="name"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-1 mb-3">
                            <label htmlFor="auth-email" className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                                Email
                            </label>
                            <input
                                id="auth-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter your email address"
                                className="input-field"
                                autoComplete="email"
                            />
                        </div>

                        <div className="space-y-1 mb-3">
                            <label htmlFor="auth-password" className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                                Password
                            </label>
                            <div className="relative">
                                <input
                                    id="auth-password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={formMode === 'signup' ? 'At least 8 characters' : 'Enter your password'}
                                    className="input-field pr-10"
                                    autoComplete={formMode === 'signup' ? 'new-password' : 'current-password'}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((p) => !p)}
                                    tabIndex={-1}
                                    className="absolute right-3 top-1/2 -translate-y-1/2"
                                    style={{ color: 'var(--text-muted)' }}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    {showPassword
                                        ? <EyeOff className="w-4 h-4" />
                                        : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

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

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="btn-primary w-full py-2.5 text-sm font-semibold"
                        >
                            {isLoading
                                ? (formMode === 'signup' ? 'Creating account…' : 'Signing in…')
                                : (formMode === 'signup' ? 'Create Account' : 'Log In')}
                        </button>
                    </form>

                    {/* Divider */}
                    <div className="flex items-center gap-3 my-3">
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-default)' }} />
                        <span className="text-[11px] font-medium uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                            or continue with
                        </span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--border-default)' }} />
                    </div>

                    {/* Social & Passkey options */}
                    <div className="space-y-2.5">
                        {/* Google */}
                        {hasGoogleClientId ? (
                            <GoogleSignInRow
                                onSuccess={onLogin}
                                onError={() => setAuthError('Google sign-in failed.')}
                            />
                        ) : (
                            <div
                                className="rounded-2xl px-4 py-2.5 text-xs"
                                style={{
                                    background: 'rgba(245,158,11,0.08)',
                                    border: '1px solid rgba(245,158,11,0.25)',
                                    color: '#d97706',
                                }}
                            >
                                Set{' '}
                                <code className="font-mono px-1 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.12)' }}>
                                    VITE_GOOGLE_CLIENT_ID
                                </code>{' '}
                                to enable Google login.
                            </div>
                        )}

                        {/* Passkey */}
                        {passkeyAvailable && (
                            <div>
                                <button
                                    type="button"
                                    onClick={handlePasskeyClick}
                                    disabled={isPasskeyLoading}
                                    onMouseEnter={() => setPasskeyHovered(true)}
                                    onMouseLeave={() => setPasskeyHovered(false)}
                                    className="w-full flex items-center gap-3 px-4 h-11"
                                    style={{
                                        background: passkeyHovered ? 'rgba(99,102,241,0.07)' : 'var(--bg-surface-raised)',
                                        border: `1px solid ${passkeyHovered ? 'rgba(99,102,241,0.42)' : 'var(--border-default)'}`,
                                        borderRadius: '14px',
                                        boxShadow: passkeyHovered ? '0 4px 20px rgba(99,102,241,0.12)' : 'none',
                                        transition: 'background 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease',
                                    }}
                                >
                                    <span
                                        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                                        style={{
                                            background: passkeyHovered ? 'rgba(99,102,241,0.20)' : 'rgba(99,102,241,0.10)',
                                            transition: 'background 0.22s ease',
                                        }}
                                    >
                                        <KeyRound className="w-3.5 h-3.5" style={{ color: '#6366f1' }} />
                                    </span>
                                    <span className="text-sm font-medium flex-1 text-left" style={{ color: 'var(--text-primary)' }}>
                                        {isPasskeyLoading
                                            ? 'Authenticating…'
                                            : formMode === 'signup'
                                                ? 'Create passkey'
                                                : registeredPasskeyUsers.length === 1
                                                    ? `Continue as ${registeredPasskeyUsers[0].name}`
                                                    : registeredPasskeyUsers.length > 1
                                                        ? `${registeredPasskeyUsers.length} passkeys saved`
                                                        : 'Sign in with passkey'}
                                    </span>
                                    {formMode === 'signin' && registeredPasskeyUsers.length === 1 && (
                                        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>passkey</span>
                                    )}
                                </button>

                                {/* Inline passkey register */}
                                {showPasskeyRegister && (
                                    <div
                                        className="mt-2 px-4 pb-4 pt-3 space-y-2.5 rounded-xl"
                                        style={{ background: 'var(--bg-surface-raised)', border: '1px solid var(--border-subtle)' }}
                                    >
                                        <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Create new passkey</p>
                                        <div className="space-y-1">
                                            <label htmlFor="passkey-name" className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                                Your name
                                            </label>
                                            <input
                                                id="passkey-name"
                                                value={passkeyName}
                                                onChange={(e) => setPasskeyName(e.target.value)}
                                                placeholder="e.g. Mehdi"
                                                className="input-field"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleRegisterPasskey}
                                            disabled={isPasskeyLoading}
                                            className="btn-primary text-xs py-2 px-4 w-full"
                                        >
                                            {isPasskeyLoading ? 'Processing…' : 'Create passkey'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Footer */}
                    <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <p className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                            Identity validated by your chosen provider.
                        </p>
                        <p className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                            By continuing, you agree to our{' '}
                            <a href="/terms-of-service.html" target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--text-secondary)' }}>
                                Terms of Service
                            </a>
                            {' '}and{' '}
                            <a href="/open-source-license.txt" target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--text-secondary)' }}>
                                Open-Source License
                            </a>
                            .
                        </p>
                        <p className="text-[11px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                            Built by{' '}
                            <a href="https://mehdinickzamir.com" target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--text-secondary)' }}>
                                Mehdi Nickzamir
                            </a>
                            {' '}·{' '}
                            <a
                                href="https://github.com/themoonoutofhaze/AntiForget"
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 underline"
                                style={{ color: 'var(--text-secondary)' }}
                            >
                                <Github className="h-3.5 w-3.5" aria-hidden="true" />
                                GitHub
                            </a>
                        </p>
                    </div>
                </div>
            </div>

            {/* ─── RIGHT PANEL: Decorative ─── */}
            <div
                className="flex flex-col w-full lg:w-1/2 flex-shrink-0 relative overflow-hidden order-first lg:order-none"
                style={{
                    background: 'linear-gradient(145deg, #1d4ed8 0%, #0f9e8c 45%, #16a34a 100%)',
                }}
            >
                {/* Subtle dot-grid overlay */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)',
                        backgroundSize: '28px 28px',
                    }}
                />

                {/* Glow orbs */}
                <div className="absolute pointer-events-none" style={{ top: '10%', right: '15%', width: '260px', height: '260px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, transparent 70%)' }} />
                <div className="absolute pointer-events-none" style={{ bottom: '12%', left: '10%', width: '200px', height: '200px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(20,184,166,0.40) 0%, transparent 70%)' }} />
                <div className="absolute pointer-events-none" style={{ top: '55%', right: '5%', width: '140px', height: '140px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,197,94,0.35) 0%, transparent 70%)' }} />

                {/* Decorative rings */}
                <div className="absolute pointer-events-none" style={{ top: '-60px', right: '-60px', width: '320px', height: '320px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.07)' }} />
                <div className="absolute pointer-events-none" style={{ top: '-20px', right: '-20px', width: '220px', height: '220px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.06)' }} />
                <div className="absolute pointer-events-none" style={{ bottom: '-80px', left: '-80px', width: '380px', height: '380px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.05)' }} />

                {/* Content */}
                <div className="relative z-10 flex flex-col justify-center flex-1 px-6 py-4 lg:px-14 lg:py-16">

                    {/* Logo + Name */}
                    <div className="flex items-center gap-4 mb-0 lg:mb-8">
                        <div
                            className="w-16 h-16 rounded-3xl flex items-center justify-center flex-shrink-0"
                            style={{
                                background: 'rgba(255,255,255,0.12)',
                                border: '1px solid rgba(255,255,255,0.20)',
                                backdropFilter: 'blur(12px)',
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    display: 'block',
                                    width: '36px',
                                    height: '36px',
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
                            <p className="text-[18px] font-bold tracking-tight" style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff', lineHeight: 1.2 }}>
                                AntiForget
                            </p>
                            <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Intelligent Learning System</p>
                        </div>
                    </div>

                    {/* Tagline */}
                    <h2
                        className="hidden lg:block"
                        style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff', letterSpacing: '-0.03em', fontSize: '2.2rem', fontWeight: 700, lineHeight: 1.2, marginBottom: '1rem' }}
                    >
                        Train memory{' '}
                        <span
                            className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full"
                            style={{
                                background: '#ff4d00',
                                color: '#ffffff',
                                border: '1px solid #ffa200',
                                verticalAlign: 'middle',
                                letterSpacing: '0.06em',
                                lineHeight: '1',
                            }}
                        >
                            FOR FREE
                        </span>
                        <br />
                        with calm clarity.
                    </h2>
                    <p className="hidden lg:block text-[15px] leading-relaxed mb-10" style={{ color: 'rgba(255,255,255,0.65)' }}>
                        One workspace to distill notes, map ideas,<br />and run AI-guided drill sessions.
                    </p>

                    {/* Feature cards */}
                    <div className="hidden lg:block space-y-3">
                        {FEATURES.map((f, i) => {
                            const cardColors = ['rgba(255,255,255,0.15)', 'rgba(20,184,166,0.22)', 'rgba(34,197,94,0.20)'];
                            const borderColors = ['rgba(255,255,255,0.30)', 'rgba(20,184,166,0.40)', 'rgba(34,197,94,0.38)'];
                            const iconColors = ['#bfdbfe', '#5eead4', '#86efac'];
                            return (
                                <div
                                    key={f.label}
                                    className="flex items-center gap-4 px-5 py-3.5 rounded-2xl"
                                    style={{
                                        background: cardColors[i],
                                        border: `1px solid ${borderColors[i]}`,
                                        backdropFilter: 'blur(12px)',
                                    }}
                                >
                                    <span
                                        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                                        style={{ background: 'rgba(255,255,255,0.12)', color: iconColors[i] }}
                                    >
                                        {f.icon}
                                    </span>
                                    <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.90)' }}>{f.label}</span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Bottom attribution */}
                    <div className="hidden lg:flex mt-12 items-center gap-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-xs">Open-source · Privacy-first · Free forever</span>
                    </div>
                </div>
            </div>

        </div>
    );
};
