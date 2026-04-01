import React, { useEffect, useRef } from 'react';

export const ConstellationBackground: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const isDark = () => document.documentElement.classList.contains('dark');

        const stars: { x: number; y: number; vx: number; vy: number; radius: number; opacity: number }[] = [];
        const numStars = 60;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        window.addEventListener('resize', resize);
        resize();

        for (let i = 0; i < numStars; i++) {
            stars.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.25,
                vy: (Math.random() - 0.5) * 0.25,
                radius: Math.random() * 1.8 + 0.4,
                opacity: Math.random() * 0.5 + 0.2,
            });
        }

        let frame: number;

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const dark = isDark();
            const starColor = dark ? [16, 185, 129] : [5, 150, 105];
            const lineColor = dark ? [6, 182, 212] : [16, 185, 129];

            for (let i = 0; i < numStars; i++) {
                const star = stars[i];
                star.x += star.vx;
                star.y += star.vy;

                if (star.x < 0 || star.x > canvas.width) star.vx *= -1;
                if (star.y < 0 || star.y > canvas.height) star.vy *= -1;

                const baseAlpha = dark ? 0.35 : 0.18;
                ctx.beginPath();
                ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${starColor[0]},${starColor[1]},${starColor[2]},${baseAlpha * star.opacity * 2})`;
                ctx.fill();

                for (let j = i + 1; j < numStars; j++) {
                    const star2 = stars[j];
                    const dist = Math.hypot(star.x - star2.x, star.y - star2.y);
                    if (dist < 140) {
                        const alpha = (1 - dist / 140) * (dark ? 0.12 : 0.06);
                        ctx.beginPath();
                        ctx.moveTo(star.x, star.y);
                        ctx.lineTo(star2.x, star2.y);
                        ctx.strokeStyle = `rgba(${lineColor[0]},${lineColor[1]},${lineColor[2]},${alpha})`;
                        ctx.lineWidth = 0.8;
                        ctx.stroke();
                    }
                }
            }
            frame = requestAnimationFrame(animate);
        };
        animate();

        return () => {
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(frame);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 pointer-events-none z-0"
        />
    );
};
