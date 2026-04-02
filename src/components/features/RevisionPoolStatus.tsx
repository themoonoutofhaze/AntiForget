import React, { useEffect, useMemo, useState } from 'react';
import { format, formatDistanceToNowStrict, isToday, differenceInHours, differenceInDays } from 'date-fns';
import { getStorage, type GraphNode, type FSRSRecord } from '../../utils/storage';

type RevisionStatus = 'overdue' | 'today' | 'upcoming';
type LearningStage = 'new' | 'halfway' | 'learned';

interface RevisionRow {
    nodeId: string;
    title: string;
    tags: string[];
    due: number;
    dueLabel: string;
    dueRelative: string;
    status: RevisionStatus;
    fluency: number;
    expertise: number;
    learningScore: number;
    stability: number;
    difficulty: number;
    reps: number;
    lapses: number;
    stage: LearningStage;
    hoursUntilDue: number;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const computeStatus = (due: number, now: number): RevisionStatus => {
    if (due <= now) return 'overdue';
    return isToday(due) ? 'today' : 'upcoming';
};

const computeStage = (record: FSRSRecord, learningScore: number): LearningStage => {
    if (record.reps <= 1 || learningScore < 38) return 'new';
    if (learningScore < 74) return 'halfway';
    return 'learned';
};

const computeMetrics = (record: FSRSRecord): Pick<RevisionRow, 'fluency' | 'expertise' | 'learningScore'> => {
    const stability = record.stability || 0;
    const difficulty = record.difficulty || 5;
    const reps = record.reps || 0;
    const lapses = record.lapses || 0;

    const fluency = clamp(Math.round((stability / 21) * 100), 0, 100);
    const expertise = clamp(Math.round(reps * 12 + (10 - difficulty) * 5 - lapses * 8), 0, 100);
    const learningScore = clamp(Math.round(fluency * 0.45 + expertise * 0.55), 0, 100);

    return { fluency, expertise, learningScore };
};

const buildRows = (nodes: GraphNode[], fsrsData: Record<string, FSRSRecord>): RevisionRow[] => {
    const now = Date.now();

    return nodes
        .map((node) => {
            const record = fsrsData[node.id];
            if (!record) return null;

            const metrics = computeMetrics(record);
            const stage = computeStage(record, metrics.learningScore);
            const hoursUntilDue = differenceInHours(record.due, now);

            return {
                nodeId: node.id,
                title: node.title,
                tags: node.tags || [],
                due: record.due,
                dueLabel: format(record.due, 'MMM d, yyyy HH:mm'),
                dueRelative: formatDistanceToNowStrict(record.due, { addSuffix: true }),
                status: computeStatus(record.due, now),
                fluency: metrics.fluency,
                expertise: metrics.expertise,
                learningScore: metrics.learningScore,
                stability: record.stability,
                difficulty: record.difficulty,
                reps: record.reps,
                lapses: record.lapses,
                stage,
                hoursUntilDue,
            };
        })
        .filter((row): row is RevisionRow => Boolean(row))
        .sort((a, b) => a.due - b.due);
};

// ─── Mini Circular Progress ───────────────────────────────────────────────────
const CircularProgress: React.FC<{ value: number; size?: number; color: string; track?: string }> = ({
    value,
    size = 36,
    color,
    track = 'rgba(255,255,255,0.06)',
}) => {
    const r = (size - 4) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ - (value / 100) * circ;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={3} />
            <circle
                cx={size / 2} cy={size / 2} r={r}
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={circ}
                strokeDashoffset={offset}
                style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
            />
        </svg>
    );
};

// ─── Thin Bar ────────────────────────────────────────────────────────────────
const MiniBar: React.FC<{ value: number; color: string; label: string }> = ({ value, color, label }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color }}>{value}</span>
        </div>
        <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
            <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)' }} />
        </div>
    </div>
);

// ─── Urgency badge ────────────────────────────────────────────────────────────
const UrgencyBadge: React.FC<{ status: RevisionStatus }> = ({ status }) => {
    const cfg = {
        overdue: { label: 'Overdue', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.28)', dot: '#ef4444' },
        today:   { label: 'Due Today', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.28)', dot: '#f59e0b' },
        upcoming:{ label: 'Upcoming', color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.28)', dot: '#10b981' },
    }[status];

    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em',
            color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
            borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap',
        }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.dot, flexShrink: 0, boxShadow: status === 'overdue' ? `0 0 6px ${cfg.dot}` : 'none' }} />
            {cfg.label}
        </span>
    );
};

const StagePill: React.FC<{ stage: LearningStage }> = ({ stage }) => {
    const cfg = {
        new:      { label: 'New', color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.28)' },
        halfway:  { label: 'Growing', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)', border: 'rgba(6,182,212,0.28)' },
        learned:  { label: 'Mastered', color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.28)' },
    }[stage];
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em', color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 999, padding: '2px 8px' }}>
            {cfg.label}
        </span>
    );
};

// ─── Next Due Countdown ───────────────────────────────────────────────────────
const NextDueCountdown: React.FC<{ row: RevisionRow | undefined }> = ({ row }) => {
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 60000);
        return () => clearInterval(id);
    }, []);

    if (!row) {
        return (
            <div className="pool-next-card" style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No items scheduled</p>
            </div>
        );
    }

    const now = Date.now();
    const isLate = row.due <= now;
    const hours = Math.abs(differenceInHours(row.due, now));
    const days = Math.abs(differenceInDays(row.due, now));
    const displayTime = days >= 1 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h` : '< 1h';
    const color = isLate ? '#ef4444' : row.status === 'today' ? '#f59e0b' : '#10b981';

    return (
        <div className="pool-next-card">
            <p style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                {isLate ? '⚡ Overdue by' : '⏱ Next Due in'}
            </p>
            <p style={{ fontSize: 'clamp(1.6rem,3vw,2.2rem)', fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1 }}>
                {displayTime}
            </p>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: 6, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.title}
            </p>
            <StagePill stage={row.stage} />
        </div>
    );
};

// ─── Mastery Pipeline Bar ─────────────────────────────────────────────────────
const MasteryPipeline: React.FC<{ newCount: number; halfwayCount: number; learnedCount: number; total: number }> = ({
    newCount, halfwayCount, learnedCount, total,
}) => {
    if (total === 0) return (
        <div style={{ height: 12, borderRadius: 99, background: 'var(--bg-muted)' }} />
    );
    const newPct = (newCount / total) * 100;
    const halfPct = (halfwayCount / total) * 100;
    const learnedPct = (learnedCount / total) * 100;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', gap: 2 }}>
                {newCount > 0 && <div style={{ flex: newPct, background: 'linear-gradient(90deg,#f97316,#fb923c)', borderRadius: 99, transition: 'flex 0.8s ease' }} />}
                {halfwayCount > 0 && <div style={{ flex: halfPct, background: 'linear-gradient(90deg,#06b6d4,#22d3ee)', borderRadius: 99, transition: 'flex 0.8s ease' }} />}
                {learnedCount > 0 && <div style={{ flex: learnedPct, background: 'linear-gradient(90deg,#10b981,#34d399)', borderRadius: 99, transition: 'flex 0.8s ease' }} />}
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
                {[
                    { label: 'New', count: newCount, color: '#f97316' },
                    { label: 'Growing', count: halfwayCount, color: '#06b6d4' },
                    { label: 'Mastered', count: learnedCount, color: '#10b981' },
                ].map(({ label, count, color }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                            <span style={{ color, fontWeight: 800 }}>{count}</span> {label}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ─── Topic Row Card ───────────────────────────────────────────────────────────
const TopicRowCard: React.FC<{ row: RevisionRow; rank: number }> = ({ row, rank }) => {
    const [expanded, setExpanded] = useState(false);
    const scoreColor = row.learningScore >= 74 ? '#10b981' : row.learningScore >= 38 ? '#06b6d4' : '#f97316';

    return (
        <div
            className="pool-topic-row"
            style={{ animationDelay: `${rank * 0.04}s` }}
            onClick={() => setExpanded(e => !e)}
            role="button"
            aria-expanded={expanded}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'nowrap', overflow: 'hidden' }}>
                {/* Rank */}
                <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: row.status === 'overdue' ? 'rgba(239,68,68,0.14)' : row.status === 'today' ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.7rem', fontWeight: 800,
                    color: row.status === 'overdue' ? '#ef4444' : row.status === 'today' ? '#f59e0b' : '#10b981',
                }}>
                    {rank}
                </div>

                {/* Title + due */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.title}
                    </p>
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '2px 0 0', fontWeight: 500 }}>
                        {row.dueRelative}
                    </p>
                </div>

                {/* Score ring */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                    <CircularProgress value={row.learningScore} size={34} color={scoreColor} />
                    <span style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.55rem', fontWeight: 800, color: scoreColor,
                    }}>
                        {row.learningScore}
                    </span>
                </div>

                {/* Status badge */}
                <UrgencyBadge status={row.status} />

                {/* Expand chevron */}
                <svg width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0, color: 'var(--text-muted)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} aria-hidden="true">
                    <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                    <MiniBar value={row.fluency} color="#06b6d4" label="Fluency" />
                    <MiniBar value={row.expertise} color="#10b981" label="Expertise" />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', gridColumn: '1/-1', marginTop: 4 }}>
                        <StagePill stage={row.stage} />
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)', borderRadius: 99, padding: '2px 8px', fontWeight: 600 }}>
                            {row.reps} reps
                        </span>
                        {row.lapses > 0 && (
                            <span style={{ fontSize: '0.62rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 99, padding: '2px 8px', fontWeight: 600 }}>
                                {row.lapses} lapses
                            </span>
                        )}
                        {row.tags.map(tag => (
                            <span key={tag} style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)', borderRadius: 99, padding: '2px 8px', fontWeight: 500 }}>
                                #{tag}
                            </span>
                        ))}
                    </div>
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', gridColumn: '1/-1', marginTop: 2 }}>
                        Due: {row.dueLabel}
                    </p>
                </div>
            )}
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export const RevisionPoolStatus: React.FC = () => {
    const PAGE_SIZE = 3;
    const [rows, setRows] = useState<RevisionRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    const loadData = async () => {
        try {
            setIsLoading(true);
            const storage = await getStorage();
            setRows(buildRows(storage.nodes, storage.fsrsData));
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [rows.length]);

    const summary = useMemo(() => {
        const overdue = rows.filter(r => r.status === 'overdue').length;
        const today = rows.filter(r => r.status === 'today').length;
        const upcoming = rows.filter(r => r.status === 'upcoming').length;
        const newCount = rows.filter(r => r.stage === 'new').length;
        const halfwayCount = rows.filter(r => r.stage === 'halfway').length;
        const learnedCount = rows.filter(r => r.stage === 'learned').length;
        const avgLearning = rows.length ? Math.round(rows.reduce((s, r) => s + r.learningScore, 0) / rows.length) : 0;
        const nextDue = rows.find(r => r.status === 'overdue') ?? rows.find(r => r.status === 'today') ?? rows[0];
        const criticalCount = overdue + today;
        return { overdue, today, upcoming, avgLearning, newCount, halfwayCount, learnedCount, nextDue, criticalCount };
    }, [rows]);

    const visibleRows = rows.slice(0, visibleCount);
    const hasMoreRows = visibleCount < rows.length;
    const remainingRows = rows.length - visibleCount;

    return (
        <div className="pool-root w-full mx-auto">
            {/* Section header */}


            {isLoading ? (
                <div className="pool-empty">
                    <div className="loading-dots flex items-center gap-2" style={{ marginBottom: 10 }}>
                        <span /><span /><span />
                    </div>
                    <p style={{ fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Loading revision pool...</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Fetching topics and schedule from your dataset.</p>
                </div>
            ) : rows.length === 0 ? (
                <div className="pool-empty">
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>📚</div>
                    <p style={{ fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 4px' }}>Pool is empty</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Complete a review round or distill a topic to populate the revision pool.</p>
                </div>
            ) : (
                <>
                    {/* Top strip: Next Due + Key stats */}
                    <div className="pool-top-strip">
                        <NextDueCountdown row={summary.nextDue} />

                        <div className="pool-stat-grid">
                            <div className="pool-stat-cell" style={{ '--stat-color': '#ef4444' } as React.CSSProperties}>
                                <p className="pool-stat-value" style={{ color: '#ef4444' }}>{summary.overdue}</p>
                                <p className="pool-stat-label">Overdue</p>
                            </div>
                            <div className="pool-stat-cell" style={{ '--stat-color': '#f59e0b' } as React.CSSProperties}>
                                <p className="pool-stat-value" style={{ color: '#f59e0b' }}>{summary.today}</p>
                                <p className="pool-stat-label">Due Today</p>
                            </div>
                            <div className="pool-stat-cell" style={{ '--stat-color': '#10b981' } as React.CSSProperties}>
                                <p className="pool-stat-value" style={{ color: '#10b981' }}>{summary.upcoming}</p>
                                <p className="pool-stat-label">Upcoming</p>
                            </div>
                            <div className="pool-stat-cell" style={{ '--stat-color': 'var(--accent-secondary)' } as React.CSSProperties}>
                                <p className="pool-stat-value" style={{ color: 'var(--accent-secondary)' }}>{summary.avgLearning}</p>
                                <p className="pool-stat-label">Avg Score</p>
                            </div>
                        </div>
                    </div>

                    {/* Mastery pipeline */}
                    <div className="glass-card" style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
                                Mastery Pipeline
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <CircularProgress value={summary.avgLearning} size={28} color={summary.avgLearning >= 74 ? '#10b981' : summary.avgLearning >= 38 ? '#06b6d4' : '#f97316'} />
                                <div>
                                    <p style={{ fontSize: '0.62rem', color: 'var(--text-muted)', margin: 0, fontWeight: 600 }}>Avg Score</p>
                                    <p style={{ fontSize: '0.85rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{summary.avgLearning}%</p>
                                </div>
                            </div>
                        </div>
                        <MasteryPipeline
                            newCount={summary.newCount}
                            halfwayCount={summary.halfwayCount}
                            learnedCount={summary.learnedCount}
                            total={rows.length}
                        />
                    </div>

                    {/* Priority queue */}
                    <div className="glass-card" style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <p style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: 0 }}>
                                Priority Queue
                            </p>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                                Sorted by urgency
                            </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {visibleRows.map((row, i) => (
                                <TopicRowCard key={row.nodeId} row={row} rank={i + 1} />
                            ))}
                        </div>

                        {hasMoreRows && (
                            <button
                                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                                style={{
                                    width: '100%', marginTop: 10, padding: '8px 0',
                                    background: 'var(--bg-muted)', border: '1px solid var(--border-subtle)',
                                    borderRadius: 10, fontSize: '0.75rem', fontWeight: 600,
                                    color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s ease',
                                }}
                            >
                                {`Show ${Math.min(PAGE_SIZE, remainingRows)} more topics ↓`}
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
