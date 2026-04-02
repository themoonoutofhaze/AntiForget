import { useState, useEffect } from 'react';
import './App.css';
import { MainLayout } from './components/layout/MainLayout';
import { Sidebar } from './components/layout/Sidebar';
import { DistillationTray } from './components/features/DistillationTray';
import { KnowledgeGraph } from './components/features/KnowledgeGraph';
import { SocraticArena } from './components/features/SocraticArena';
import { SettingsPanel } from './components/features/SettingsPanel';
import { RevisionPoolStatus } from './components/features/RevisionPoolStatus';
import { InfoGuide } from './components/features/InfoGuide.tsx';
import { getStorage } from './utils/storage';
import { getApiCredentialStatus, getUserModels, addUserModel } from './utils/gemini';
import { apiGet } from './utils/api/client';
import { isPuterAvailable, puterChat } from './utils/puter';
import { LoginScreen } from './components/auth/LoginScreen';
import { CheckCircle2, ArrowRight, Bot, Cloud, KeyRound, X } from 'lucide-react';
import {
    clearStoredUser,
    getStoredUser,
    storeUser,
    type AuthUser,
} from './utils/auth';

// ─── Types ──────────────────────────────────────────────────────────────────

const VIEWS = ['home', 'distill', 'arena', 'settings', 'info'] as const;
type View = (typeof VIEWS)[number];
type SettingsSection = 'ai-models' | 'storage';
type Theme = 'light' | 'dark';
type ThemeMode = Theme | 'auto';
const THEME_KEY = 'synapse_theme';
const THEME_MODE_KEY = 'synapse_theme_mode';
const SETUP_CHECKLIST_DISMISSED_KEY = 'synapse_setup_checklist_dismissed';
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const DEFAULT_PUTER_MODEL = 'openai/gpt-oss-120b';

const getThemeFromTime = (date: Date): Theme => {
    const hour = date.getHours();
    return hour >= 19 || hour < 7 ? 'dark' : 'light';
};

// ─── Dashboard Home ──────────────────────────────────────────────────────────

// Mini ring for daily progress
function DailyProgressRing({ completed, goal }: { completed: number; goal: number }) {
    const pct = Math.min(completed / goal, 1);
    const r = 28;
    const circ = 2 * Math.PI * r;
    const offset = circ - pct * circ;
    return (
        <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
            <svg width={72} height={72} viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={36} cy={36} r={r} fill="none" stroke="rgba(16,185,129,0.12)" strokeWidth={5} />
                <circle
                    cx={36} cy={36} r={r}
                    fill="none"
                    stroke="var(--accent-primary)"
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeDasharray={circ}
                    strokeDashoffset={offset}
                    style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)', filter: 'drop-shadow(0 0 6px rgba(16,185,129,0.5))' }}
                />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontFamily: "'Syne',sans-serif", fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{completed}</span>
                <span style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>/ {goal}</span>
            </div>
        </div>
    );
}

type SetupChecklistState = {
    isLoading: boolean;
    hasAnyApiKey: boolean;
    hasPuterModel: boolean;
    driveConnected: boolean;
    driveReady: boolean;
};

function SetupChecklistCard({
    setup,
    onOpenSettingsSection,
    onRunPuterQuickSetup,
    isPuterSetupRunning,
    isDismissed,
    onDismiss,
}: {
    setup: SetupChecklistState;
    onOpenSettingsSection: (section: SettingsSection) => void;
    onRunPuterQuickSetup: () => Promise<void>;
    isPuterSetupRunning: boolean;
    isDismissed: boolean;
    onDismiss: () => void;
}) {
    const aiReady = setup.hasAnyApiKey || setup.hasPuterModel;
    const driveStepDone = setup.driveConnected || !setup.driveReady;

    if (isDismissed || (!setup.isLoading && aiReady && driveStepDone)) {
        return null;
    }

    return (
        <section
            className="dash-hero relative overflow-hidden dark:!border-orange-500/50"
            style={{
                border: '1px solid rgba(249, 115, 22, 0.3)',
                background: 'linear-gradient(135deg, rgba(255, 237, 213, 0.95) 0%, rgba(209, 250, 229, 0.95) 100%)',
                boxShadow: '0 8px 32px rgba(249, 115, 22, 0.12), -8px 8px 32px rgba(16, 185, 129, 0.12)',
            }}
        >
            {/* Dark mode overlay adjustment */}
            <div className="absolute inset-0 z-0 hidden dark:block" style={{ background: 'linear-gradient(135deg, rgba(168, 62, 11, 0.85) 0%, rgba(4, 95, 71, 0.85) 100%)' }} />

            <button
                type="button"
                aria-label="Close setup checklist"
                onClick={onDismiss}
                className="absolute top-3 right-3 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-orange-500/30 bg-white/75 text-orange-700 transition-colors hover:bg-white dark:border-orange-300/30 dark:bg-white/10 dark:text-orange-100 dark:hover:bg-white dark:hover:text-orange-950"
            >
                <X className="h-4 w-4" />
            </button>

            <div className="relative z-10">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <span 
                            className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full text-orange-700 bg-orange-200 border border-orange-300 mb-2 inline-flex items-center gap-1.5 dark:bg-orange-900/50 dark:text-orange-200 dark:border-orange-700" 
                            style={{ display: 'inline-flex' }}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                            Action Required
                        </span>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }} className="dark:text-orange-50">
                            Complete your setup
                        </h3>
                        <p style={{ margin: '6px 0 0', fontSize: '0.86rem', color: 'var(--text-secondary)' }} className="dark:text-orange-200/80">
                            You're almost there! Finish these 2 steps to unlock AntiForget's AI features.
                        </p>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 18 }}>
                    <article 
                        className="rounded-2xl p-4 transition-transform hover:-translate-y-0.5 bg-orange-50/90 dark:bg-black/40 border border-orange-400/40 dark:border-orange-500/50 backdrop-blur-sm"
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <p className="text-xs font-black tracking-[0.08em] text-orange-900/60 dark:text-orange-200/60" style={{ margin: 0 }}>STEP 1</p>
                            {aiReady ? <CheckCircle2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400" /> : <Bot className="w-5 h-5 text-orange-500 dark:text-orange-400" />}
                        </div>
                        <p className="text-sm font-bold text-orange-900 dark:text-white" style={{ margin: '8px 0 4px' }}>Enable AI</p>
                        <p className="text-xs leading-relaxed text-orange-800/80 dark:text-orange-100/80" style={{ margin: 0 }}>Connect an API key or use Puter's 1-click setup.</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                            <button 
                                type="button" 
                                className="text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors bg-white/60 dark:bg-white/10 border border-orange-400/40 text-orange-900 dark:text-orange-50 hover:bg-white hover:border-orange-400/80 dark:hover:bg-white dark:hover:text-orange-950 dark:hover:border-white" 
                                onClick={() => onOpenSettingsSection('ai-models')}
                            >
                                <KeyRound className="w-3.5 h-3.5" />
                                API Settings
                                <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                                type="button"
                                className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ background: '#f97316', boxShadow: '0 2px 10px rgba(249, 115, 22, 0.3)' }}
                                onClick={() => {
                                    void onRunPuterQuickSetup();
                                }}
                                disabled={isPuterSetupRunning || !isPuterAvailable()}
                            >
                                {isPuterSetupRunning ? 'Connecting…' : 'Use Puter (Easy Setup)'}
                            </button>
                        </div>
                    </article>

                    <article 
                        className="rounded-2xl p-4 transition-transform hover:-translate-y-0.5 bg-teal-50/90 dark:bg-black/40 border border-teal-400/40 dark:border-teal-500/50 backdrop-blur-sm"
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <p className="text-xs font-black tracking-[0.08em] text-teal-900/60 dark:text-teal-200/60" style={{ margin: 0 }}>STEP 2</p>
                            {driveStepDone ? <CheckCircle2 className="w-5 h-5 text-emerald-500 dark:text-emerald-400" /> : <Cloud className="w-5 h-5 text-teal-600 dark:text-teal-400" />}
                        </div>
                        <p className="text-sm font-bold text-teal-900 dark:text-white" style={{ margin: '8px 0 4px' }}>Connect Google Drive</p>
                        <p className="text-xs leading-relaxed text-teal-800/80 dark:text-teal-100/80" style={{ margin: 0 }}>
                            {setup.driveReady ? 'Required to upload and distill PDFs.' : 'Drive integration is currently offline.'}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                            <button 
                                type="button" 
                                className="text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors bg-white/60 dark:bg-white/10 border border-teal-400/40 text-teal-900 dark:text-teal-50 hover:bg-white hover:border-teal-400/80 dark:hover:bg-white dark:hover:text-teal-950 dark:hover:border-white" 
                                onClick={() => onOpenSettingsSection('storage')}
                            >
                                Open Storage
                                <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </article>
                </div>
            </div>
        </section>
    );
}

function SocraticSetupRequired({
    onOpenSettingsSection,
}: {
    onOpenSettingsSection: (section: SettingsSection) => void;
}) {
    return (
        <div className="animate-slide-up max-w-2xl mx-auto">
            <div
                className="glass-card p-6 sm:p-8"
                style={{
                    border: '1px solid var(--border-subtle)',
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--bg-surface) 84%, #dbeafe 16%) 0%, var(--bg-surface) 100%)',
                }}
            >
                <div className="flex items-start gap-4">
                    <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: 'rgba(37,99,235,0.14)', border: '1px solid var(--border-subtle)' }}
                    >
                        <Bot className="w-6 h-6" style={{ color: '#2563eb' }} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)', margin: 0 }}>
                            Model not found
                        </h3>
                        <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                            Set up a model and API first to use Socratic Review.
                        </p>
                        <button
                            type="button"
                            className="btn-primary text-sm gap-2 mt-4"
                            onClick={() => onOpenSettingsSection('ai-models')}
                        >
                            <KeyRound className="w-4 h-4" />
                            Open AI Settings
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}



function DashboardHome({
    user,
    completedRevisions,
    dailyGoal,
    onNavigate,
    setup,
    onOpenSettingsSection,
    onRunPuterQuickSetup,
    isPuterSetupRunning,
    isSetupChecklistDismissed,
    onDismissSetupChecklist,
}: {
    user: AuthUser;
    completedRevisions: number;
    dailyGoal: number;
    onNavigate: (v: View) => void;
    setup: SetupChecklistState;
    onOpenSettingsSection: (section: SettingsSection) => void;
    onRunPuterQuickSetup: () => Promise<void>;
    isPuterSetupRunning: boolean;
    isSetupChecklistDismissed: boolean;
    onDismissSetupChecklist: () => void;
}) {
    const goalPct = Math.round(Math.min((completedRevisions / dailyGoal) * 100, 100));
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = user.name.split(' ')[0];

    return (
        <div className="animate-slide-up" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <SetupChecklistCard
                setup={setup}
                onOpenSettingsSection={onOpenSettingsSection}
                onRunPuterQuickSetup={onRunPuterQuickSetup}
                isPuterSetupRunning={isPuterSetupRunning}
                isDismissed={isSetupChecklistDismissed}
                onDismiss={onDismissSetupChecklist}
            />

            {/* ── Hero ── */}
            <div className="dash-hero">
                <div className="dash-hero-glow dash-hero-glow-a" />
                <div className="dash-hero-glow dash-hero-glow-b" />

                <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
                    <div style={{ flex: '1 1 300px' }}>
                        <span className="badge badge-green-accent" style={{ marginBottom: 12, display: 'inline-flex' }}>
                            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </span>
                        <h1 style={{ fontFamily: "inherit", fontSize: '1.75rem', fontWeight: 800, margin: '0 0 10px', letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1.2, width: 'fit-content' }}>
                            {greeting}, {firstName}.
                        </h1>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6, maxWidth: 520 }}>
                            {goalPct >= 100
                                ? `🎯 Daily goal crushed. You're building a real retention advantage.`
                                : `You've done ${completedRevisions} of ${dailyGoal} today. Keep the cycle going — every rep compounds.`}
                        </p>
                        <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
                            <button id="hero-distill-btn" onClick={() => onNavigate('distill')} className="btn-primary">
                                Open Topics
                            </button>
                            <button id="hero-review-btn" onClick={() => onNavigate('arena')} className="btn-secondary">
                                Review Session
                            </button>
                        </div>
                    </div>

                    {/* Daily progress ring */}
                    <div className="dash-daily-ring-card">
                        <DailyProgressRing completed={completedRevisions} goal={dailyGoal} />
                        <div>
                            <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>Daily Goal</p>
                            <p style={{ margin: '2px 0 0', fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                {goalPct}% complete
                            </p>
                            <div style={{ marginTop: 8, height: 4, width: 100, borderRadius: 99, background: 'rgba(16,185,129,0.12)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${goalPct}%`, background: 'var(--accent-primary)', borderRadius: 99, transition: 'width 1s ease' }} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Revision Pool ── */}
            <RevisionPoolStatus />
        </div>
    );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
    const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
    const [completedRevisions, setCompletedRevisions] = useState(0);
    const [dailyGoal, setDailyGoal] = useState(3);
    const [currentView, setCurrentView] = useState<View>('home');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isSidebarFolded, setIsSidebarFolded] = useState(false);
    const [isTopicModeActive, setIsTopicModeActive] = useState(false);
    const [settingsSectionFocus, setSettingsSectionFocus] = useState<SettingsSection | null>(null);
    const [isPuterSetupRunning, setIsPuterSetupRunning] = useState(false);
    const [setupChecklist, setSetupChecklist] = useState<SetupChecklistState>({
        isLoading: true,
        hasAnyApiKey: false,
        hasPuterModel: false,
        driveConnected: false,
        driveReady: false,
    });
    const [isSetupChecklistDismissed, setIsSetupChecklistDismissed] = useState(() => {
        return localStorage.getItem(SETUP_CHECKLIST_DISMISSED_KEY) === 'true';
    });
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
        const savedMode = localStorage.getItem(THEME_MODE_KEY);
        if (savedMode === 'light' || savedMode === 'dark' || savedMode === 'auto') {
            return savedMode;
        }

        const savedTheme = localStorage.getItem(THEME_KEY);
        return savedTheme === 'dark' ? 'dark' : 'light';
    });
    const [timeTick, setTimeTick] = useState(() => Date.now());
    const isArenaSetupReady = setupChecklist.hasAnyApiKey || setupChecklist.hasPuterModel;

    const theme: Theme = themeMode === 'auto' ? getThemeFromTime(new Date(timeTick)) : themeMode;

    useEffect(() => {
        if (themeMode !== 'auto') {
            return;
        }

        const intervalId = window.setInterval(() => {
            setTimeTick(Date.now());
        }, 60_000);

        return () => window.clearInterval(intervalId);
    }, [themeMode]);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem(THEME_MODE_KEY, themeMode);

        if (themeMode !== 'auto') {
            localStorage.setItem(THEME_KEY, themeMode);
        }
    }, [theme, themeMode]);

    useEffect(() => {
        localStorage.setItem(SETUP_CHECKLIST_DISMISSED_KEY, isSetupChecklistDismissed ? 'true' : 'false');
    }, [isSetupChecklistDismissed]);

    useEffect(() => {
        if (!user) return;
        getStorage().then((s) => {
            setCompletedRevisions(s.completedRevisionsToday);
            setDailyGoal(Math.max(1, Math.floor((s.dailyRevisionMinutesLimit || 60) / 20)));
        });
    }, [currentView, user]);

    const refreshSetupChecklist = async () => {
        if (!user) {
            return;
        }

        setSetupChecklist((prev) => ({ ...prev, isLoading: true }));

        const [keyStatus, driveStatus, userModels] = await Promise.all([
            getApiCredentialStatus().catch(() => ({
                providers: {
                    openai: false,
                    groq: false,
                    mistral: false,
                    nvidia: false,
                    openrouter: false,
                    gemini: false,
                    claude: false,
                    puter: false,
                },
            })),
            apiGet<{ provider: 'google-drive'; driveConnected: boolean; driveReady: boolean }>('/settings/storage-provider').catch(() => ({
                provider: 'google-drive' as const,
                driveConnected: false,
                driveReady: false,
            })),
            getUserModels().catch(() => ({ activeProviders: [], models: [] })),
        ]);

        const hasAnyApiKey = Object.entries(keyStatus.providers)
            .filter(([provider]) => provider !== 'puter')
            .some(([, value]) => Boolean(value));

        const hasPuterModel = userModels.models.some((model) => model.provider === 'puter');

        setSetupChecklist({
            isLoading: false,
            hasAnyApiKey,
            hasPuterModel,
            driveConnected: driveStatus.driveConnected && driveStatus.driveReady,
            driveReady: driveStatus.driveReady,
        });
    };

    useEffect(() => {
        void refreshSetupChecklist();
    }, [user, currentView]);

    const handleLogin = (nextUser: AuthUser, _options?: { keepToken?: boolean }) => {
        storeUser(nextUser);
        setUser(nextUser);
    };

    const handleLogout = () => {
        void clearStoredUser();
        setUser(null);
    };

    const handleToggleTheme = () => {
        setThemeMode((prev) => {
            if (prev === 'auto') {
                return theme === 'dark' ? 'light' : 'dark';
            }
            return prev === 'dark' ? 'light' : 'dark';
        });
    };

    const handleNavigate = (nextView: View) => {
        setCurrentView(nextView);
        setIsSidebarOpen(false);
        if (nextView !== 'settings') {
            setSettingsSectionFocus(null);
        }
    };

    const handleOpenSettingsSection = (section: SettingsSection) => {
        setSettingsSectionFocus(section);
        setCurrentView('settings');
        setIsSidebarOpen(false);
    };

    const handleDismissSetupChecklist = () => {
        setIsSetupChecklistDismissed(true);
    };

    const handlePuterQuickSetup = async () => {
        setIsPuterSetupRunning(true);
        try {
            if (!isPuterAvailable()) {
                handleOpenSettingsSection('ai-models');
                return;
            }

            await puterChat('Reply with exactly this: Puter ready.', {
                model: 'gpt-5.4-nano',
            });

            const existing = await getUserModels();
            const alreadyAdded = existing.models.some(
                (model) => model.provider === 'puter' && model.model.toLowerCase() === DEFAULT_PUTER_MODEL
            );

            if (!alreadyAdded) {
                await addUserModel({
                    provider: 'puter',
                    model: DEFAULT_PUTER_MODEL,
                    reasoning: false,
                });
            }

            await refreshSetupChecklist();
            handleOpenSettingsSection('ai-models');
        } catch {
            handleOpenSettingsSection('ai-models');
        } finally {
            setIsPuterSetupRunning(false);
        }
    };

    if (!user) {
        return (
            <LoginScreen
                hasGoogleClientId={Boolean(googleClientId)}
                onLogin={handleLogin}
            />
        );
    }

    return (
        <MainLayout
            completedRevisions={completedRevisions}
            dailyReviewGoal={dailyGoal}
            user={user}
            onLogout={handleLogout}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
            onCloseSidebar={() => setIsSidebarOpen(false)}
            sidebar={
                <Sidebar
                    currentView={currentView}
                    onNavigate={handleNavigate}
                    isFolded={isSidebarFolded}
                    onToggleFold={() => setIsSidebarFolded(!isSidebarFolded)}
                />
            }
        >
            {currentView === 'home' && (
                <DashboardHome
                    user={user}
                    completedRevisions={completedRevisions}
                    dailyGoal={dailyGoal}
                    onNavigate={handleNavigate}
                    setup={setupChecklist}
                    onOpenSettingsSection={handleOpenSettingsSection}
                    onRunPuterQuickSetup={handlePuterQuickSetup}
                    isPuterSetupRunning={isPuterSetupRunning}
                    isSetupChecklistDismissed={isSetupChecklistDismissed}
                    onDismissSetupChecklist={handleDismissSetupChecklist}
                />
            )}
            {currentView === 'distill' && (
                <div className={isTopicModeActive ? 'topics-layout topics-layout--single' : 'topics-layout'}>
                    <section className="topics-layout-form">
                        <DistillationTray onTopicModeActiveChange={setIsTopicModeActive} />
                    </section>
                    {!isTopicModeActive && (
                        <section className="topics-layout-graph">
                            <KnowledgeGraph embedded />
                        </section>
                    )}
                </div>
            )}
            {currentView === 'arena' && (
                setupChecklist.isLoading ? (
                    <div className="animate-slide-up max-w-xl mx-auto text-center py-10">
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            Checking AI setup...
                        </p>
                    </div>
                ) : isArenaSetupReady ? (
                    <SocraticArena />
                ) : (
                    <SocraticSetupRequired onOpenSettingsSection={handleOpenSettingsSection} />
                )
            )}
            {currentView === 'settings' && (
                <div className="settings-section-container p-6">
                    <SettingsPanel
                        theme={theme}
                        themeMode={themeMode}
                        onSetThemeMode={setThemeMode}
                        initialSection={settingsSectionFocus}
                    />
                </div>
            )}
            {currentView === 'info' && (
                <div className="help-info-section-container p-6">
                    <InfoGuide />
                </div>
            )}
        </MainLayout>
    );
}

export default App;
