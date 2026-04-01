import React from 'react';
import { LogOut, Menu, Moon, Sun, Target, X } from 'lucide-react';
import type { AuthUser } from '../../utils/auth';

interface HeaderProps {
    completedRevisions: number;
    totalRevisions?: number;
    user: AuthUser;
    onLogout: () => void;
    theme: 'light' | 'dark';
    onToggleTheme: () => void;
    isSidebarOpen: boolean;
    onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({
    completedRevisions,
    totalRevisions = 3,
    user,
    onLogout,
    theme,
    onToggleTheme,
    isSidebarOpen,
    onToggleSidebar,
}) => {
    const progress = Math.min((completedRevisions / totalRevisions) * 100, 100);
    const circumference = 2 * Math.PI * 16; // r=16

    return (
        <header
            className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 sm:px-5 md:px-6 lg:px-8 lg:py-4"
            style={{
                background: 'var(--bg-sidebar)',
                borderBottom: '1px solid var(--border-subtle)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
            }}
        >
            {/* Left — greeting */}
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={onToggleSidebar}
                    className="btn-ghost lg:hidden"
                    aria-label={isSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
                    title={isSidebarOpen ? 'Close menu' : 'Open menu'}
                >
                    {isSidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </button>
                <div className="flex flex-col">
                    <p className="hidden sm:block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    Good learning session,
                    </p>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {user.name.split(' ')[0]}
                    </p>
                </div>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-2 sm:gap-3">
                {/* Daily progress ring */}
                <div className="hidden md:flex items-center gap-2.5 px-3 py-2 rounded-xl"
                    style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)' }}
                >
                    <div className="relative w-8 h-8 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                            <circle
                                cx="18" cy="18" r="16"
                                fill="none"
                                stroke="var(--border-default)"
                                strokeWidth="3"
                            />
                            <circle
                                cx="18" cy="18" r="16"
                                fill="none"
                                stroke="var(--accent-primary)"
                                strokeWidth="3"
                                strokeDasharray={`${circumference}`}
                                strokeDashoffset={circumference - (circumference * progress) / 100}
                                strokeLinecap="round"
                                style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)' }}
                            />
                        </svg>
                        <Target className="absolute w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                            Daily Goal
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {completedRevisions}/{totalRevisions} reviews
                        </span>
                    </div>
                </div>

                {/* Theme toggle */}
                <button
                    id="toggle-theme-btn"
                    onClick={onToggleTheme}
                    className="btn-ghost"
                    title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                    {theme === 'dark'
                        ? <Sun className="w-4 h-4" />
                        : <Moon className="w-4 h-4" />
                    }
                </button>

                {/* User avatar + logout */}
                <div className="flex items-center gap-2 pl-2 sm:gap-2.5 sm:pl-3"
                    style={{ borderLeft: '1px solid var(--border-subtle)' }}
                >
                    <div className="avatar-ring">
                        {user.avatarUrl ? (
                            <img
                                src={user.avatarUrl}
                                alt={user.name}
                                className="h-8 w-8 rounded-full block"
                            />
                        ) : (
                            <div
                                className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold"
                                style={{
                                    background: 'var(--accent-primary)',
                                    color: '#fff',
                                    border: '2px solid var(--bg-app)',
                                }}
                            >
                                {user.name.slice(0, 1).toUpperCase()}
                            </div>
                        )}
                    </div>

                    <button
                        id="logout-btn"
                        onClick={onLogout}
                        className="btn-ghost"
                        title="Sign out"
                    >
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </header>
    );
};
