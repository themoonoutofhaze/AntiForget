import React from 'react';
import {
    LayoutDashboard,
    Layers,
    MessageSquare,
    Settings2,
    Info,
    Heart,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';

type View = 'home' | 'distill' | 'arena' | 'settings' | 'info';

interface NavItem {
    id: View;
    label: string;
    icon: React.ReactNode;
    description: string;
}

const NAV_ITEMS: NavItem[] = [
    {
        id: 'home',
        label: 'Dashboard',
        icon: <LayoutDashboard className="w-4 h-4 flex-shrink-0" />,
        description: 'Overview & stats',
    },
    {
        id: 'distill',
        label: 'Topics',
        icon: <Layers className="w-4 h-4 flex-shrink-0" />,
        description: 'Create, edit, and link topics',
    },
    {
        id: 'arena',
        label: 'Socratic Review',
        icon: <MessageSquare className="w-4 h-4 flex-shrink-0" />,
        description: 'Socratic sessions',
    },
    {
        id: 'settings',
        label: 'App Settings',
        icon: <Settings2 className="w-4 h-4 flex-shrink-0" />,
        description: 'Preferences',
    },
    {
        id: 'info',
        label: 'Help & Info',
        icon: <Info className="w-4 h-4 flex-shrink-0" />,
        description: 'How the system works',
    },
];

interface SidebarProps {
    currentView: View;
    onNavigate: (view: View) => void;
    isFolded?: boolean;
    onToggleFold?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
    currentView, 
    onNavigate, 
    isFolded = false, 
    onToggleFold 
}) => {
    return (
        <aside className={`sidebar ${isFolded ? 'folded' : ''}`}>
            {/* Fold Toggle */}
            <button 
                onClick={onToggleFold}
                className="absolute -right-3 top-20 w-6 h-6 rounded-full border flex items-center justify-center bg-surface-raised z-50 hover:scale-110 transition-transform hidden md:flex"
                style={{ 
                    backgroundColor: 'var(--bg-surface-raised)', 
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-secondary)'
                }}
            >
                {isFolded ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>

            {/* Logo */}
            <div className={`sidebar-logo ${isFolded ? 'px-3' : ''}`}>
                <div className="flex items-center gap-3">
                    <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
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
                    {!isFolded && (
                        <div>
                            <p className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)', fontFamily: 'Syne, sans-serif' }}>
                                AntiForget
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                Intelligent Learning
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Navigation */}
            <nav className={`sidebar-nav ${isFolded ? 'items-center' : ''}`}>
                {!isFolded && <p className="section-eyebrow px-3 py-2">Navigation</p>}

                {NAV_ITEMS.map((item) => (
                    <button
                        key={item.id}
                        id={`nav-${item.id}`}
                        onClick={() => onNavigate(item.id)}
                        className={`nav-item w-full text-left ${currentView === item.id ? 'active' : ''} ${isFolded ? 'justify-center px-0' : ''}`}
                        title={isFolded ? item.label : undefined}
                    >
                        {item.icon}
                        {!isFolded && <span>{item.label}</span>}
                    </button>
                ))}
            </nav>

            {/* Bottom branding */}
            <div
                className={isFolded ? 'px-2 py-3' : 'px-4 py-4'}
                style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
                <div className="p-0">
                    {isFolded ? (
                        <a
                            href="https://github.com/sponsors/themoonoutofhaze?frequency=one-time"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group w-full px-0 py-1 rounded-full flex items-center justify-center gap-1.5 text-[10px] font-semibold border bg-[var(--bg-muted)] transition-all duration-300 hover:scale-110 hover:shadow-lg hover:bg-[rgba(239,68,68,0.14)]"
                            style={{
                                color: 'rgba(220, 38, 38, 0.72)',
                                borderColor: 'var(--border-default)',
                            }}
                            title="Support me"
                        >
                            <span className="inline-flex items-center justify-center rounded-full p-[2px] transition-transform duration-300 group-hover:scale-110" style={{ background: 'rgba(239, 68, 68, 0.14)' }}>
                                <Heart className="w-3 h-3 fill-current transition-all duration-300 group-hover:animate-pulse" style={{ color: 'rgba(220, 38, 38, 0.94)' }} />
                            </span>
                        </a>
                    ) : (
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.12em] mb-0" style={{ color: 'var(--text-muted)' }}>
                                    Built with Love
                                </p>
                                <a
                                    href="https://mehdinickzamir.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[11px] font-semibold inline-block transition-colors hover:underline"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    by Mehdi Nickzamir
                                </a>
                            </div>
                            <a
                                href="https://ko-fi.com/mehdinickzamir"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group shrink-0 px-2 py-1 rounded-full inline-flex items-center justify-center gap-1 text-[10px] font-semibold border bg-[var(--bg-muted)] transition-all duration-300 hover:scale-105 hover:shadow-md hover:bg-[rgba(239,68,68,0.14)]"
                                style={{
                                    color: 'rgba(220, 38, 38, 0.72)',
                                    borderColor: 'var(--border-default)',
                                }}
                            >
                                <span className="inline-flex items-center justify-center rounded-full p-[2px] transition-transform duration-300 group-hover:scale-110" style={{ background: 'rgba(239, 68, 68, 0.14)' }}>
                                    <Heart className="w-3 h-3 fill-current transition-all duration-300 group-hover:animate-pulse" style={{ color: 'rgba(220, 38, 38, 0.94)' }} />
                                </span>
                                <span>Support</span>
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
};
