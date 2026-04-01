import React, { useEffect, useState } from 'react';
import { Timer as TimerIcon } from 'lucide-react';

interface TimerProps {
    initialSeconds: number;
    onComplete: () => void;
    isActive: boolean;
}

export const Timer: React.FC<TimerProps> = ({ initialSeconds, onComplete, isActive }) => {
    const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

    useEffect(() => {
        if (!isActive || secondsLeft <= 0) return;
        const interval = setInterval(() => {
            setSecondsLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    onComplete();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [isActive, secondsLeft, onComplete]);

    const minutes = Math.floor(secondsLeft / 60);
    const seconds = secondsLeft % 60;
    const progress = ((initialSeconds - secondsLeft) / initialSeconds) * 100;
    const circumference = 2 * Math.PI * 20;

    const isWarning = secondsLeft <= 60 && secondsLeft > 0;
    const isDanger  = secondsLeft === 0;

    const color = isDanger
        ? '#f43f5e'
        : isWarning
        ? '#f59e0b'
        : 'var(--accent-primary)';

    return (
        <div
            className="flex items-center gap-3 px-4 py-2 rounded-xl"
            style={{
                background: 'var(--bg-muted)',
                border: `1px solid ${isDanger ? 'rgba(244,63,94,0.3)' : isWarning ? 'rgba(245,158,11,0.3)' : 'var(--border-default)'}`,
            }}
        >
            {/* Progress ring */}
            <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
                <svg className="-rotate-90 w-full h-full" viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r="20" fill="none" stroke="var(--border-default)" strokeWidth="3" />
                    <circle
                        cx="22" cy="22" r="20"
                        fill="none"
                        stroke={color}
                        strokeWidth="3"
                        strokeDasharray={`${circumference}`}
                        strokeDashoffset={circumference - (circumference * progress) / 100}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.3s ease' }}
                    />
                </svg>
                <TimerIcon
                    className="absolute w-3.5 h-3.5"
                    style={{ color }}
                />
            </div>

            {/* Time display */}
            <div className="flex flex-col">
                <span
                    className="font-mono text-lg font-semibold leading-none"
                    style={{
                        color,
                        fontFamily: '"JetBrains Mono", monospace',
                        ...(isDanger ? { animation: 'pulse 1s ease-in-out infinite' } : {}),
                    }}
                >
                    {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {isDanger ? 'Time\'s up!' : isWarning ? 'Wrapping up…' : 'remaining'}
                </span>
            </div>
        </div>
    );
};
