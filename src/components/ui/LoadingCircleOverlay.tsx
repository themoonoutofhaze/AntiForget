import React from 'react';

interface LoadingCircleOverlayProps {
    visible: boolean;
    label?: string;
}

export const LoadingCircleOverlay: React.FC<LoadingCircleOverlayProps> = ({
    visible,
    label = 'Loading...',
}) => {
    if (!visible) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center"
            style={{ background: 'rgba(15, 23, 42, 0.28)', backdropFilter: 'blur(2px)' }}
            aria-live="polite"
            aria-busy="true"
        >
            <div
                className="rounded-2xl px-6 py-5 flex flex-col items-center gap-3"
                style={{
                    background: 'var(--bg-surface-raised)',
                    border: '1px solid var(--border-default)',
                    boxShadow: '0 16px 40px rgba(2, 6, 23, 0.22)',
                }}
            >
                <span
                    className="w-10 h-10 rounded-full animate-spin"
                    style={{
                        borderWidth: '3px',
                        borderStyle: 'solid',
                        borderColor: 'rgba(100, 116, 139, 0.28)',
                        borderTopColor: 'var(--accent-primary)',
                    }}
                />
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)', margin: 0 }}>
                    {label}
                </p>
            </div>
        </div>
    );
};
