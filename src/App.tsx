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
import { LoginScreen } from './components/auth/LoginScreen';
import {
    clearStoredUser,
    getStoredUser,
    storeUser,
    type AuthUser,
} from './utils/auth';

// ─── Types ──────────────────────────────────────────────────────────────────

const VIEWS = ['home', 'distill', 'arena', 'settings', 'info'] as const;
type View = (typeof VIEWS)[number];
type Theme = 'light' | 'dark';
type ThemeMode = Theme | 'auto';
const THEME_KEY = 'synapse_theme';
const THEME_MODE_KEY = 'synapse_theme_mode';
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

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



function DashboardHome({
    user,
    completedRevisions,
    dailyGoal,
    onNavigate,
}: {
    user: AuthUser;
    completedRevisions: number;
    dailyGoal: number;
    onNavigate: (v: View) => void;
}) {
    const goalPct = Math.round(Math.min((completedRevisions / dailyGoal) * 100, 100));
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = user.name.split(' ')[0];

    return (
        <div className="animate-slide-up" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

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
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
        const savedMode = localStorage.getItem(THEME_MODE_KEY);
        if (savedMode === 'light' || savedMode === 'dark' || savedMode === 'auto') {
            return savedMode;
        }

        const savedTheme = localStorage.getItem(THEME_KEY);
        return savedTheme === 'dark' ? 'dark' : 'light';
    });
    const [timeTick, setTimeTick] = useState(() => Date.now());

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
        if (!user) return;
        getStorage().then((s) => {
            setCompletedRevisions(s.completedRevisionsToday);
            setDailyGoal(Math.max(1, Math.floor((s.dailyRevisionMinutesLimit || 60) / 20)));
        });
    }, [currentView, user]);

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
            {currentView === 'arena'    && <SocraticArena />}
            {currentView === 'settings' && (
                <div className="settings-section-container p-6">
                    <SettingsPanel
                        theme={theme}
                        themeMode={themeMode}
                        onSetThemeMode={setThemeMode}
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
