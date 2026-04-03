import React, { useMemo, useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { KeyRound, ShieldCheck, Sparkles, BookOpen, Network, Github, Eye, EyeOff } from 'lucide-react';
import type { AuthUser } from '../../utils/auth';
import { LoadingCircleOverlay } from '../ui/LoadingCircleOverlay';
import {
    authenticateWithPasskey,
    getRegisteredPasskeyUsers,
    isPasskeySupported,
    registerWithEmailPassword,
    registerPasskeyUser,
    signInWithEmailPassword,
    verifyGoogleAccessTokenWithServer,
} from '../../utils/auth';

interface LoginScreenProps {
    hasGoogleClientId: boolean;
    onLogin: (user: AuthUser, options?: { keepToken?: boolean }) => void;
}

const FEATURES = [
    { icon: <BookOpen className="w-3 h-3" />, label: 'Upload summary of topics' },
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
    onLoadingChange: (isLoading: boolean) => void;
}> = ({ onSuccess, onError, onLoadingChange }) => {
    const [hovered, setHovered] = useState(false);
    const login = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            onLoadingChange(true);
            try {
                const { user } = await verifyGoogleAccessTokenWithServer(tokenResponse.access_token);
                onSuccess(user);
            } catch {
                onError();
            } finally {
                onLoadingChange(false);
            }
        },
        onError: () => {
            onLoadingChange(false);
            onError();
        },
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
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [showMobileForm, setShowMobileForm] = useState(false);

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
        <div className="h-[100dvh] w-full flex flex-col md:flex-row overflow-hidden relative">

            {/* ─── RIGHT PANEL: Decorative (Background on Mobile) ─── */}
            <div
                className="flex flex-col w-full md:w-1/2 flex-shrink-0 absolute inset-0 md:relative z-0 overflow-hidden order-first md:order-none"
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
                <div 
                    className={`relative z-10 flex flex-col items-center md:items-start min-h-0 px-6 md:px-14 md:py-16 transition-all duration-[1000ms] ease-[cubic-bezier(0.32,0.72,0,1)] w-full md:w-auto md:flex-1 md:justify-center ${
                        showMobileForm ? 'justify-start h-auto' : 'justify-start pt-[26vh] flex-1 md:pt-16'
                    }`}
                >
                    {/* --- DESKTOP LOGO --- */}
                    <div className="hidden md:flex md:flex-row md:items-center md:gap-4 md:mb-8">
                        <div
                            className="w-16 h-16 rounded-3xl flex items-center justify-center flex-shrink-0"
                            style={{
                                background: 'rgba(255,255,255,0.15)',
                                border: '1px solid rgba(255,255,255,0.25)',
                                backdropFilter: 'blur(12px)',
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    display: 'block',
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
                                className="w-[36px] h-[36px]"
                            />
                        </div>
                        <div className="flex flex-col whitespace-nowrap items-start w-auto">
                            <p className="font-bold tracking-tight text-[18px]" style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff', lineHeight: 1.2 }}>
                                AntiForget
                            </p>
                            <p className="font-medium text-[12px] opacity-100 mt-0" style={{ color: 'rgba(255,255,255,0.7)' }}>
                                Smart Revision System
                            </p>
                        </div>
                    </div>

                    {/* --- MOBILE LOGOS --- */}
                    <div 
                        className={`block md:hidden relative w-full transition-all duration-[1000ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
                            showMobileForm ? 'h-[60px] mt-[4vh] mb-0' : 'h-[160px] mt-0 mb-8'
                        }`}
                    >
                        {/* Mobile Top Logo (Visible when form is open) */}
                        <div 
                            className={`absolute inset-0 flex items-center justify-center gap-3 transition-all ${
                                showMobileForm 
                                    ? 'duration-[700ms] delay-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] opacity-100 scale-100 pointer-events-auto' 
                                    : 'duration-[400ms] ease-out opacity-0 scale-95 pointer-events-none'
                            }`}
                        >
                            <div
                                className="w-12 h-12 rounded-[19px] flex items-center justify-center flex-shrink-0 shadow-2xl"
                                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', backdropFilter: 'blur(12px)' }}
                            >
                                <span className="w-[24px] h-[24px] block" style={{ background: '#ffffff', maskImage: 'url(/icon.svg)', maskRepeat: 'no-repeat', maskPosition: 'center', maskSize: 'contain', WebkitMaskImage: 'url(/icon.svg)', WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', WebkitMaskSize: 'contain' }} />
                            </div>
                            <div className="flex flex-col whitespace-nowrap items-start">
                                <p className="font-bold tracking-tight text-[20px]" style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff', lineHeight: 1.2 }}>
                                    AntiForget
                                </p>
                                <p className="font-medium text-[11px] opacity-90 mt-0" style={{ color: 'rgba(255,255,255,0.7)' }}>
                                    Smart Revision System
                                </p>
                            </div>
                        </div>

                        {/* Mobile Center Logo (Visible when form is closed) */}
                        <div 
                            className={`absolute inset-x-0 top-0 flex flex-col items-center gap-4 transition-all ${
                                showMobileForm 
                                    ? 'duration-[400ms] ease-out opacity-0 scale-[0.98] pointer-events-none' 
                                    : 'duration-[700ms] delay-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] opacity-100 scale-100 pointer-events-auto'
                            }`}
                        >
                            <div
                                className="w-20 h-20 rounded-[2rem] flex items-center justify-center flex-shrink-0 shadow-2xl"
                                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', backdropFilter: 'blur(12px)' }}
                            >
                                <span className="w-[42px] h-[42px] block" style={{ background: '#ffffff', maskImage: 'url(/icon.svg)', maskRepeat: 'no-repeat', maskPosition: 'center', maskSize: 'contain', WebkitMaskImage: 'url(/icon.svg)', WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center', WebkitMaskSize: 'contain' }} />
                            </div>
                            <div className="flex flex-col whitespace-nowrap items-center">
                                <p className="font-bold tracking-tight text-[28px]" style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff', lineHeight: 1.2 }}>
                                    AntiForget
                                </p>
                                <p className="font-medium text-[14px] opacity-100 mt-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
                                    Smart Revision System
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Mobile Landing Big Text */}
                    <div 
                        className={`md:hidden flex flex-col items-center flex-shrink-0 justify-center w-full transition-all text-center overflow-hidden ${
                            showMobileForm 
                                ? 'duration-[400ms] ease-out max-h-0 opacity-0 scale-95 pointer-events-none mb-0' 
                                : 'duration-[700ms] delay-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] max-h-[300px] opacity-100 scale-100 mb-[40px]'
                        }`}
                    >
                        <h2
                            style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff', letterSpacing: '-0.01em', fontSize: '20px', fontWeight: 700, lineHeight: 1.3, marginBottom: '0.5rem' }}
                        >
                            Learn once, remember forever.
                        </h2>
                        <p className="text-[14px] sm:text-[15px] leading-relaxed max-w-[300px] sm:max-w-none" style={{ color: 'rgba(255,255,255,0.75)' }}>
                            Active recall through AI. Next revision auto-scheduled by performance.
                        </p>
                    </div>

                    {/* Desktop Tagline (Hidden on Mobile completely now to match design) */}
                    <div className="hidden md:block w-full">
                        <h2
                            style={{ fontFamily: 'Syne, sans-serif', color: '#ffffff', letterSpacing: '-0.03em', fontSize: '2.2rem', fontWeight: 700, lineHeight: 1.2, marginBottom: '1rem' }}
                        >
                            Learn once,<br />
                            remember forever.
                        </h2>
                        <p className="text-[15px] leading-relaxed mb-10" style={{ color: 'rgba(255,255,255,0.65)' }}>
                            AntiForget uses AI-generated quizzes to trigger active recall.<br />Your next revision is automatically scheduled based on how well you perform.
                        </p>

                        {/* Feature cards */}
                        <div className="space-y-3">
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
                        <div className="mt-12 flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                            <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="text-xs">Open-source · Privacy-first · Free forever</span>
                        </div>
                    </div>
                </div>

                {/* Mobile Bottom Buttons (Landing State) */}
                <div 
                    className={`absolute bottom-0 left-0 right-0 p-8 flex flex-col items-center gap-5 md:hidden transition-all duration-[1000ms] ease-[cubic-bezier(0.32,0.72,0,1)] z-10 ${
                        showMobileForm ? 'translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
                    }`}
                >
                    <button 
                        onClick={() => { setFormMode('signup'); setShowMobileForm(true); }}
                        className="w-full bg-white text-emerald-600 font-bold py-4 rounded-xl shadow-xl text-[16px] hover:-translate-y-0.5 transition-transform"
                    >
                        Get Started
                    </button>
                    <button 
                        onClick={() => { setFormMode('signin'); setShowMobileForm(true); }}
                        className="text-white text-[13px] font-medium opacity-80 hover:opacity-100"
                    >
                        I already have an account
                    </button>
                </div>
            </div>

            {/* ─── LEFT PANEL: Form (Slides up on Mobile) ─── */}
            <div
                className={`absolute inset-x-0 bottom-0 z-20 h-auto max-h-[85dvh] md:max-h-none md:h-full md:relative flex flex-col w-full md:w-1/2 flex-1 md:flex-none overflow-y-auto scrollbar-on-intent transition-transform duration-[1000ms] ease-[cubic-bezier(0.32,0.72,0,1)] bg-[var(--bg-surface)] md:bg-[var(--bg-surface-raised)] rounded-t-[32px] md:rounded-none shadow-[0_-10px_40px_rgba(0,0,0,0.2)] md:shadow-none ${
                    showMobileForm ? 'translate-y-0' : 'translate-y-full md:translate-y-0'
                }`}
            >
                {/* Mobile Drag Handle / Close indicator */}
                <div 
                    className="md:hidden w-full flex justify-center py-4 cursor-pointer flex-shrink-0"
                    onClick={() => setShowMobileForm(false)}
                >
                    <div className="w-12 h-1.5 rounded-full" style={{ background: 'var(--border-strong)' }} />
                </div>

                <div className="relative z-10 flex flex-col flex-1 px-8 sm:px-10 pt-4 pb-12 md:py-12 w-full max-w-[500px] mx-auto md:justify-center transition-all duration-300">

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
                                onLoadingChange={setIsGoogleLoading}
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
                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateRows: showPasskeyRegister ? '1fr' : '0fr',
                                        transition: 'grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                                    }}
                                >
                                    <div style={{ overflow: 'hidden', minHeight: 0, opacity: showPasskeyRegister ? 1 : 0, transition: 'opacity 0.25s ease' }}>
                                        <div
                                            className="mt-3 px-4 pb-4 pt-3 space-y-2.5 rounded-xl block"
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
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Spacer */}
                    <div className="flex-1 md:hidden" />

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

            <LoadingCircleOverlay
                visible={isGoogleLoading}
                label="Signing you in..."
            />

        </div>
    );
};
