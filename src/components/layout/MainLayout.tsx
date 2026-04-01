import React from 'react';
import { Header } from './Header';
import { ConstellationBackground } from '../ui/ConstellationBackground';
import type { AuthUser } from '../../utils/auth';

interface MainLayoutProps {
    children: React.ReactNode;
    completedRevisions: number;
    dailyReviewGoal: number;
    user: AuthUser;
    onLogout: () => void;
    theme: 'light' | 'dark';
    onToggleTheme: () => void;
    sidebar: React.ReactNode;
    isSidebarOpen: boolean;
    onToggleSidebar: () => void;
    onCloseSidebar: () => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    completedRevisions,
    dailyReviewGoal,
    user,
    onLogout,
    theme,
    onToggleTheme,
    sidebar,
    isSidebarOpen,
    onToggleSidebar,
    onCloseSidebar,
}) => {
    return (
        <div className="flex min-h-screen w-full relative">
            {/* Animated background */}
            <div className="app-background" />
            {theme === 'light' && <div className="light-grid-overlay" />}
            <ConstellationBackground />

            {/* Sidebar */}
            <div className={`sidebar-shell ${isSidebarOpen ? 'open' : ''}`}>
                {sidebar}
            </div>

            {isSidebarOpen && (
                <button
                    type="button"
                    className="mobile-sidebar-overlay"
                    onClick={onCloseSidebar}
                    aria-label="Close navigation"
                />
            )}

            {/* Main content */}
            <div className="content-area">
                <Header
                    completedRevisions={completedRevisions}
                    totalRevisions={dailyReviewGoal}
                    user={user}
                    onLogout={onLogout}
                    theme={theme}
                    onToggleTheme={onToggleTheme}
                    isSidebarOpen={isSidebarOpen}
                    onToggleSidebar={onToggleSidebar}
                />
                <main className="page-content">
                    {children}
                </main>
            </div>
        </div>
    );
};
