import React, { useState, useEffect, useRef } from 'react';
import { Send, Target, KeyRound, CheckCircle2, ChevronRight, BookOpen, Star, Smile, AlertCircle, Loader2, MessageCircle } from 'lucide-react';
import { Timer } from '../ui/Timer';
import { RichTextMessage } from '../ui/RichTextMessage';
import { addRevisionSeconds, getTodaysReviews, processReview } from '../../utils/fsrs';
import { getStorage, updateStorage, type AiProvider } from '../../utils/storage';
import { calculateAverageScore, extractQuestionScores, generateTutorResponse, getApiCredentialStatus, getProviderLabel, getUserModels, saveApiCredential, type TutorTopicContext, type AiAttempt, type ModelProvider } from '../../utils/gemini';

/* ──────────────────────────────────────────────────────────────
   Types
────────────────────────────────────────────────────────────── */
interface QuizQuestion {
    index: number;           // 1-based
    label: string;           // e.g. "CONCEPTUAL"
    text: string;
}

interface QuizResult {
    index: number;
    score: number;
    correctAnswer: string;
    userAnswer: string;
}

interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
const Q_LABEL_MAP: Record<number, string> = {
    1: 'CONCEPTUAL',
    2: 'PRACTICAL',
    3: 'CONNECTION',
};

/** Parse the questions out of the AI's opening message. */
const parseQuestions = (text: string): QuizQuestion[] => {
    const results: QuizQuestion[] = [];
    const cleanText = text.replace(/\*/g, '');
    const regex = /Q([1-3])\s*(?:\([^)]*\))?\s*:\s*([\s\S]*?)(?=Q[1-3]\s*(?:\([^)]*\))?\s*:|$)/gi;
    for (const match of cleanText.matchAll(regex)) {
        const idx = Number(match[1]);
        const raw = (match[2] || '').trim();

        if (idx >= 1 && idx <= 3 && raw) {
            results.push({ index: idx, label: Q_LABEL_MAP[idx] || `Q${idx}`, text: raw });
        }
    }
    return results;
};

/** Parse per-question scores + correct answers from the grading response. */
const parseResults = (text: string, userAnswers: string[], questions: QuizQuestion[]): QuizResult[] => {
    const results: QuizResult[] = [];
    const cleanText = text.replace(/\*/g, '');
    questions.forEach((q, i) => {
        const idx = q.index;
        const scoreMatch = cleanText.match(new RegExp(`Q${idx}\\s*Score\\s*:\\s*([0-4](?:\\.\\d+)?)`, 'i'));
        const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;

        let correctAnswer = '';
        const allPatterns = [
            // Pattern with Q prefix and "Correct Answer"
            new RegExp(`Q${idx}\\s*Correct\\s*Answer\\s*:\\s*([\\s\\S]*?)(?=Q[1-3]\\s*(?:Score|Correct\\s*Answer|Answer)\\s*:|$)`, 'i'),
            // Pattern with Q prefix and just "Answer"
            new RegExp(`Q${idx}\\s*Answer\\s*:\\s*([\\s\\S]*?)(?=Q[1-3]\\s*(?:Score|Correct\\s*Answer|Answer)\\s*:|$)`, 'i'),
            // Pattern without Q prefix - "Correct Answer" right after score
            new RegExp(`Q${idx}[^\\n]*\\n\\s*Correct\\s*Answer\\s*:\\s*([\\s\\S]*?)(?=Q[1-3]\\s*(?:Score|Correct\\s*Answer|Answer)\\s*:|$)`, 'i'),
            // Standalone "Correct Answer" anywhere in text for this question
            new RegExp(`Q${idx}[^\\n]*?(?:Score[^\\n]*\\n)?[^\\n]*Correct\\s*Answer\\s*:\\s*([\\s\\S]*?)(?=Q[1-3]\\s*(?:Score|Correct\\s*Answer|Answer)\\s*:|$)`, 'i'),
            // Fallback: look for "Correct Answer" on its own line after Q{idx} mention
            new RegExp(`(?:Q${idx}[^\\n]*\\n)\\s*Correct\\s*Answer\\s*:\\s*([\\s\\S]*?)(?=Q[1-3]|$)`, 'i'),
        ];

        for (const pattern of allPatterns) {
            const matchedAnswer = cleanText.match(pattern)?.[1]?.trim();
            if (matchedAnswer && matchedAnswer.length > 0) {
                correctAnswer = matchedAnswer;
                break;
            }
        }

        results.push({ index: idx, score, correctAnswer, userAnswer: userAnswers[i] || '' });
    });
    return results;
};

const scoreColor = (score: number): string => {
    if (score >= 3.5) return '#10b981';
    if (score >= 2) return '#f59e0b';
    return '#f43f5e';
};

const scoreEmoji = (score: number): string => {
    if (score >= 3.5) return '🌟';
    if (score >= 2.5) return '👍';
    if (score >= 1.5) return '📖';
    return '💪';
};

const scoreLabel = (score: number): string => {
    if (score >= 3.5) return 'Excellent';
    if (score >= 2.5) return 'Good';
    if (score >= 1.5) return 'Keep going';
    return 'Needs work';
};

const convertAverageToMastery = (score: number): number => {
    if (score < 0.75) return 1;
    if (score < 1.75) return 2;
    if (score < 2.6) return 3;
    if (score < 3.5) return 4;
    return 5;
};

/* ──────────────────────────────────────────────────────────────
   Component
────────────────────────────────────────────────────────────── */
export const SocraticArena: React.FC = () => {
    const [provider, setProvider] = useState<AiProvider>('openai');
    const [apiKey, setApiKey] = useState('');
    const [hasAiAccess, setHasAiAccess] = useState(false);
    const [apiKeyError, setApiKeyError] = useState<string | null>(null);
    const [dueNodes, setDueNodes] = useState<string[]>([]);
    const [isInitializing, setIsInitializing] = useState(true);
    const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);

    /* Quiz state */
    const [phase, setPhase] = useState<'lobby' | 'loading' | 'answering' | 'submitting' | 'results'>('lobby');
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [answers, setAnswers] = useState<string[]>(['', '', '', '']);
    const [rawAiQuestionMessage, setRawAiQuestionMessage] = useState('');
    const [results, setResults] = useState<QuizResult[]>([]);
    const [averageScore, setAverageScore] = useState<number | null>(null);
    const [topicReviewed, setTopicReviewed] = useState(false);
    const [currentTopicName, setCurrentTopicName] = useState('');
    const [activeModelInfo, setActiveModelInfo] = useState<{ provider: ModelProvider; model: string } | null>(null);
    const [questionGenerationMs, setQuestionGenerationMs] = useState<number | null>(null);
    const [errorWithAttempts, setErrorWithAttempts] = useState<{ message: string; attempts: AiAttempt[] } | null>(null);
    const [chatOpen, setChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isChatSending, setIsChatSending] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);

    const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
    const [timeBudgetReached, setTimeBudgetReached] = useState(false);
    const [sessionMinutesLimit, setSessionMinutesLimit] = useState(60);
    const [isTimerActive, setIsTimerActive] = useState(false);
    const [isUnrecorded, setIsUnrecorded] = useState(false);

    const activeRequestRef = useRef<AbortController | null>(null);
    const providerLabel = getProviderLabel(provider);

    /* ── Load config ── */
    useEffect(() => {
        const loadConfig = async () => {
            try {
                setIsInitializing(true);
                const storage = await getStorage();
                const [credentialStatus, userModels] = await Promise.all([
                    getApiCredentialStatus(),
                    getUserModels().catch(() => ({ activeProviders: [], models: [] })),
                ]);

                const hydratedKeys: Record<AiProvider, string> = {
                    openai: credentialStatus.providers.openai ? 'configured-on-server' : '',
                    groq: credentialStatus.providers.groq ? 'configured-on-server' : '',
                    mistral: credentialStatus.providers.mistral ? 'configured-on-server' : '',
                    nvidia: credentialStatus.providers.nvidia ? 'configured-on-server' : '',
                    openrouter: credentialStatus.providers.openrouter ? 'configured-on-server' : '',
                    gemini: credentialStatus.providers.gemini ? 'configured-on-server' : '',
                    claude: credentialStatus.providers.claude ? 'configured-on-server' : '',
                    puter: '',
                };

                const preferredProvider = (['openai', 'claude', 'gemini', 'openrouter', 'nvidia', 'groq', 'mistral'] as AiProvider[])
                    .find((candidate) => Boolean(hydratedKeys[candidate])) || 'openai';

                setProvider(preferredProvider);
                setApiKey('');
                const hasConfiguredApiKey = Object.values(credentialStatus.providers).some(Boolean);
                const hasPuterModel = userModels.models.some((model) => model.provider === 'puter');
                setHasAiAccess(hasConfiguredApiKey || hasPuterModel);

                const reviews = await getTodaysReviews();
                setDueNodes(reviews);

                const now = Date.now();
                const dueCount = Object.values(storage.fsrsData).filter((data) => data.due <= now).length;
                const dailyLimitMinutes = Math.max(10, storage.dailyRevisionMinutesLimit || 60);
                setSessionMinutesLimit(dailyLimitMinutes);
                setTimeBudgetReached(dueCount > 0 && storage.revisionSecondsToday >= dailyLimitMinutes * 60);
            } catch (error) {
                console.error('Failed to load Socratic lobby state:', error);
            } finally {
                setIsInitializing(false);
            }
        };
        loadConfig();
    }, []);

    useEffect(() => {
        return () => { activeRequestRef.current?.abort(); };
    }, []);

    const getElapsedSeconds = () => {
        if (!sessionStartedAt) return 0;
        return Math.max(0, Math.round((Date.now() - sessionStartedAt) / 1000));
    };

    const buildRevisionChatContext = () => {
        const quizLines = results.map((r) => {
            const q = questions.find((item) => item.index === r.index);
            return [
                `Q${r.index} (${q?.label || 'QUESTION'}): ${q?.text || ''}`,
                `Student answer: ${r.userAnswer || 'No answer provided.'}`,
                `Model answer: ${r.correctAnswer || 'No model answer provided.'}`,
                `Score: ${r.score}/4`,
            ].join('\n');
        });

        return [
            `Current topic: ${currentTopicName || 'Unknown topic'}`,
            averageScore !== null ? `Average quiz score: ${averageScore.toFixed(2)}/4` : '',
            quizLines.length > 0 ? `Quiz recap:\n${quizLines.join('\n\n')}` : '',
        ].filter(Boolean).join('\n\n');
    };

    const sendChatMessage = async () => {
        const trimmed = chatInput.trim();
        if (!trimmed || isChatSending) return;

        setChatInput('');
        setChatError(null);
        setIsChatSending(true);

        const nextUserMessage: ChatMessage = { role: 'user', text: trimmed };
        const historyMessages = [...chatMessages, nextUserMessage];
        setChatMessages(historyMessages);

        const history = historyMessages.slice(0, -1).map((m) => ({
            role: m.role,
            parts: [{ text: m.text }],
        }));

        const prompt = chatMessages.length === 0
            ? `${buildRevisionChatContext()}\n\nStudent follow-up question: ${trimmed}`
            : trimmed;

        const controller = new AbortController();
        activeRequestRef.current?.abort();
        activeRequestRef.current = controller;

        try {
            const topicContext = currentNodeId ? await buildTopicContext(currentNodeId) : null;
            const resp = await generateTutorResponse(history, prompt, topicContext, {
                signal: controller.signal,
                mode: 'chat',
            });
            if (resp.provider && resp.model) {
                setActiveModelInfo({ provider: resp.provider, model: resp.model });
            }
            setChatMessages((prev) => [...prev, { role: 'model', text: resp.text }]);
        } catch (e: any) {
            if (e instanceof Error && e.name === 'AbortError') return;
            console.error(e);
            setChatError(e.message || 'Failed to send message. Please try again.');
        } finally {
            if (activeRequestRef.current === controller) activeRequestRef.current = null;
            setIsChatSending(false);
        }
    };

    const buildTopicContext = async (topicId: string): Promise<TutorTopicContext> => {
        const storage = await getStorage();
        const node = storage.nodes.find((n) => n.id === topicId);
        const linkedTopicIdSet = new Set<string>();
        for (const edge of storage.edges) {
            if (edge.source === topicId && edge.target !== topicId) linkedTopicIdSet.add(edge.target);
            if (edge.target === topicId && edge.source !== topicId) linkedTopicIdSet.add(edge.source);
        }
        const linkedTopicNames = [...linkedTopicIdSet]
            .map((id) => storage.nodes.find((n) => n.id === id)?.title || '')
            .filter(Boolean);

        return {
            topicId,
            topicName: node?.title || 'Unknown topic',
            linkedTopicNames,
            summaryContent: node?.summary || 'No summary available.',
            hasAttachedFile: Boolean(node?.hasPdfBlob),
            studentLevel: (storage.studentEducationLevel || 'high school').trim() || 'high school',
            studentMajor: (storage.studentMajor || '').trim(),
            aiLanguage: (storage.aiLanguage || 'English').trim() || 'English',
            missedQuestionHistory: storage.missedQuestionHistoryByTopic[topicId] || [],
        };
    };

    /* ── Save API key ── */
    const saveApiKey = async () => {
        const trimmedKey = apiKey.trim();
        if (!trimmedKey) {
            setApiKeyError(`Please enter a valid ${providerLabel} API key.`);
            return;
        }
        await saveApiCredential(provider, trimmedKey);
        const refreshed = await getApiCredentialStatus();
        const refreshedKeys: Record<AiProvider, string> = {
            openai: refreshed.providers.openai ? 'configured-on-server' : '',
            groq: refreshed.providers.groq ? 'configured-on-server' : '',
            mistral: refreshed.providers.mistral ? 'configured-on-server' : '',
            nvidia: refreshed.providers.nvidia ? 'configured-on-server' : '',
            openrouter: refreshed.providers.openrouter ? 'configured-on-server' : '',
            gemini: refreshed.providers.gemini ? 'configured-on-server' : '',
            claude: refreshed.providers.claude ? 'configured-on-server' : '',
            puter: '',
        };
        const preferredProvider = (['openai', 'claude', 'gemini', 'openrouter', 'nvidia', 'groq', 'mistral'] as AiProvider[])
            .find((candidate) => Boolean(refreshedKeys[candidate])) || provider;
        setProvider(preferredProvider);
        setApiKey('');
        setApiKeyError(null);
        setHasAiAccess(Object.values(refreshed.providers).some(Boolean));
    };

    /* ── Start quiz ── */
    const startQuiz = async (unrecorded = false, dueNodeOverride?: string[]) => {
        let nextId: string | null = null;
        if (unrecorded) {
            const storage = await getStorage();
            if (storage.nodes.length === 0) return; // no topics to practice
            nextId = storage.nodes[Math.floor(Math.random() * storage.nodes.length)].id;
        } else {
            const dueQueue = dueNodeOverride || dueNodes;
            if (dueQueue.length === 0) return;
            nextId = dueQueue[0];
        }
        if (!nextId) return;

        setCurrentNodeId(nextId);
        setIsUnrecorded(unrecorded);
        setSessionStartedAt(Date.now());
        setPhase('loading');
        setAnswers(['', '', '']);
        setResults([]);
        setAverageScore(null);
        setTopicReviewed(false);
        setActiveModelInfo(null);
        setQuestionGenerationMs(null);
        setErrorWithAttempts(null);
        setChatOpen(false);
        setChatMessages([]);
        setChatInput('');
        setIsChatSending(false);
        setChatError(null);
        activeRequestRef.current?.abort();

        const topicContext = await buildTopicContext(nextId);
        setCurrentTopicName(topicContext.topicName || 'Unknown topic');
        const controller = new AbortController();
        activeRequestRef.current = controller;

        try {
            const resp = await generateTutorResponse(
                [],
                'Start the first round now. Follow all protocol constraints.',
                topicContext,
                { signal: controller.signal }
            );
            if (resp.provider && resp.model) {
                setActiveModelInfo({ provider: resp.provider, model: resp.model });
            }
            setQuestionGenerationMs(typeof resp.generationMs === 'number' ? resp.generationMs : null);
            await new Promise((resolve) => window.setTimeout(resolve, 450));
            const parsed = parseQuestions(resp.text);
            setRawAiQuestionMessage(resp.text);
            setQuestions(parsed);
            setAnswers(new Array(parsed.length).fill(''));
            setIsTimerActive(true);
            setPhase('answering');
        } catch (e: any) {
            if (e instanceof Error && e.name === 'AbortError') return;
            console.error(e);
            setErrorWithAttempts({ message: e.message, attempts: e.attempts || [] });
            setPhase('lobby');
        } finally {
            if (activeRequestRef.current === controller) activeRequestRef.current = null;
        }
    };

    /* ── Submit answers ── */
    const submitAnswers = async () => {
        if (phase === 'submitting') return;
        setPhase('submitting');
        setIsTimerActive(false);
        activeRequestRef.current?.abort();
        setChatOpen(false);
        setChatMessages([]);
        setChatInput('');
        setIsChatSending(false);
        setChatError(null);

        // Build a single combined answer message for the AI
        const combinedAnswer = questions
            .map((q, i) => `Q${q.index}: ${answers[i] || 'I don\'t know'}`)
            .join('\n\n');

        const history = [{ role: 'model' as const, parts: [{ text: rawAiQuestionMessage }] }];
        const controller = new AbortController();
        activeRequestRef.current = controller;

        try {
            const resp = await generateTutorResponse(history, combinedAnswer, null, { signal: controller.signal });
            if (resp.provider && resp.model) {
                setActiveModelInfo({ provider: resp.provider, model: resp.model });
            }

            const parsed = parseResults(resp.text, answers, questions);
            setResults(parsed);

            const scores = extractQuestionScores(resp.text, questions.map(q => q.index));
            if (scores) {
                const avg = calculateAverageScore(scores);
                setAverageScore(avg);

                if (!topicReviewed && currentNodeId && !isUnrecorded) {
                    const mastery = convertAverageToMastery(avg);
                    const elapsed = getElapsedSeconds();
                    setSessionStartedAt(null);
                    await addRevisionSeconds(elapsed);
                    await processReview(currentNodeId, mastery);
                    const refreshed = await getTodaysReviews();
                    setDueNodes(refreshed);
                    setTopicReviewed(true);

                    // Track weak questions
                    const weakQuestions = parsed
                        .filter((r) => r.score <= 1)
                        .map((r) => questions.find((q) => q.index === r.index)?.text || '');
                    if (weakQuestions.length > 0) {
                        const storage = await getStorage();
                        const existing = storage.missedQuestionHistoryByTopic[currentNodeId] || [];
                        const merged = Array.from(new Set([...weakQuestions.filter(Boolean), ...existing])).slice(0, 16);
                        await updateStorage({
                            missedQuestionHistoryByTopic: {
                                ...storage.missedQuestionHistoryByTopic,
                                [currentNodeId]: merged,
                            },
                        });
                    }
                }
            }
            setPhase('results');
        } catch (e: any) {
            if (e instanceof Error && e.name === 'AbortError') return;
            console.error(e);
            setErrorWithAttempts({ message: e.message, attempts: e.attempts || [] });
            setPhase('answering');
        } finally {
            if (activeRequestRef.current === controller) activeRequestRef.current = null;
        }
    };

    const handleTimeUp = async () => {
        setIsTimerActive(false);
        if (phase === 'answering') {
            await submitAnswers();
        }
    };

    const skipCurrentTopic = async () => {
        if (phase !== 'answering') return;

        activeRequestRef.current?.abort();
        setIsTimerActive(false);
        setChatOpen(false);
        setChatMessages([]);
        setChatInput('');
        setIsChatSending(false);
        setChatError(null);

        const elapsed = getElapsedSeconds();
        setSessionStartedAt(null);
        if (elapsed > 0 && !isUnrecorded) {
            await addRevisionSeconds(elapsed);
        }

        if (isUnrecorded) {
            await startQuiz(true);
            return;
        }

        const nextDueNodes = dueNodes.filter((id) => id !== currentNodeId);
        setDueNodes(nextDueNodes);

        if (nextDueNodes.length === 0) {
            await resetToLobby();
            return;
        }

        await startQuiz(false, nextDueNodes);
    };

    const resetToLobby = async () => {
        activeRequestRef.current?.abort();
        const elapsed = getElapsedSeconds();
        setSessionStartedAt(null);
        if (elapsed > 0 && !isUnrecorded) await addRevisionSeconds(elapsed);
        const refreshed = await getTodaysReviews();
        setDueNodes(refreshed);
        setPhase('lobby');
        setIsTimerActive(false);
        setQuestions([]);
        setAnswers(['', '', '']);
        setResults([]);
        setAverageScore(null);
        setCurrentNodeId(null);
        setCurrentTopicName('');
        setTopicReviewed(false);
        setActiveModelInfo(null);
        setQuestionGenerationMs(null);
        setErrorWithAttempts(null);
        setIsUnrecorded(false);
        setChatOpen(false);
        setChatMessages([]);
        setChatInput('');
        setIsChatSending(false);
        setChatError(null);
    };

    /* ══════════════════════════════════════════════════════════
       RENDER — Initial hydration
    ══════════════════════════════════════════════════════════ */
    if (isInitializing) {
        return (
            <div className="animate-slide-up w-full space-y-6">
                <div className="glass-card max-w-md mx-auto p-8 text-center space-y-4">
                    <div className="loading-dots flex items-center justify-center gap-2">
                        <span /><span /><span />
                    </div>
                    <h2 className="section-title text-xl">Loading Socratic review...</h2>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Syncing API credentials and revision topics.
                    </p>
                </div>
            </div>
        );
    }

    /* ══════════════════════════════════════════════════════════
       RENDER — API key gate
    ══════════════════════════════════════════════════════════ */
    if (!hasAiAccess) {
        return (
            <div className="animate-slide-up w-full space-y-6">
                <div className="glass-card max-w-md mx-auto p-8 text-center space-y-5">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
                        style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.14), rgba(6,182,212,0.08))', border: '1px solid var(--border-default)' }}>
                        <KeyRound className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
                    </div>
                    <div>
                        <h2 className="section-title text-xl">{providerLabel} API Key Required</h2>
                        <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                            Add at least one provider key to enable AI-powered quiz sessions. Models are selected automatically.
                        </p>
                    </div>
                    <div className="space-y-3">
                        <select id="coach-provider-select-gate" value={provider}
                            onChange={(e) => { setProvider(e.target.value as AiProvider); setApiKey(''); setApiKeyError(null); }}
                            className="input-field">
                            <option value="groq">Groq</option>
                            <option value="mistral">Mistral</option>
                            <option value="nvidia">NVIDIA</option>
                            <option value="openrouter">OpenRouter</option>
                        </select>
                        <input id="api-key-input" type="password" value={apiKey}
                            onChange={(e) => { setApiKey(e.target.value); if (apiKeyError) setApiKeyError(null); }}
                            onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
                            placeholder={`Enter your ${providerLabel} API key`}
                            className="input-field" />
                        {apiKeyError && <p className="text-xs text-left" style={{ color: '#ef4444' }}>{apiKeyError}</p>}
                        <button id="save-api-key-btn" onClick={saveApiKey} className="btn-primary w-full">
                            Save &amp; Continue
                        </button>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        API keys are encrypted in your app database and only used by the server proxy.
                    </p>
                </div>
            </div>
        );
    }

    /* ══════════════════════════════════════════════════════════
       RENDER — Lobby
    ══════════════════════════════════════════════════════════ */
    if (phase === 'lobby') {
        return (
            <div className="animate-slide-up w-full space-y-6 socratic-liveness-hint">
                {/* Friendly banner */}
              

                <div className="glass-card w-full overflow-hidden">
                    <div className="relative px-6 py-6 md:px-8 md:py-7" style={{ background: 'linear-gradient(120deg, rgba(16,185,129,0.14) 0%, rgba(6,182,212,0.06) 45%, rgba(15,23,42,0) 100%)' }}>
                        <div className="absolute -top-16 -right-14 w-44 h-44 rounded-full blur-2xl opacity-40"
                            style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.38) 0%, rgba(16,185,129,0) 70%)' }} />
                        <div className="absolute -bottom-20 left-24 w-52 h-52 rounded-full blur-3xl opacity-30"
                            style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.28) 0%, rgba(6,182,212,0) 72%)' }} />

                        <div className="relative z-10">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold tracking-wider uppercase"
                                style={{ border: '1px solid rgba(16,185,129,0.28)', background: 'rgba(16,185,129,0.10)', color: 'var(--text-secondary)' }}>
                                <BookOpen className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                                Knowledge Check
                            </div>

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-[1.2fr_auto] gap-5 items-end">
                                <div>
                                    <h2 className="section-title text-3xl leading-tight">Socratic Review</h2>
                                    <p className="text-sm mt-2 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
                                        You'll get a few short questions about a topic. Answer each one in your own words - there's no time pressure, just honest reflection.
                                    </p>
                                </div>

                                <div className="glass-card px-4 py-3 min-w-52" style={{ background: 'color-mix(in srgb, var(--bg-surface-raised) 90%, transparent)' }}>
                                    <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'var(--text-muted)' }}>Ready today</p>
                                    <p className="text-3xl font-display font-bold leading-none mt-1" style={{ fontFamily: 'Syne, sans-serif', color: 'var(--text-primary)' }}>
                                        {dueNodes.length}
                                    </p>
                                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        {dueNodes.length === 1 ? 'topic' : 'topics'} up for a quick check-in
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-6 md:px-8 md:py-8 space-y-5">
                        {errorWithAttempts && (
                            <div className="max-w-md w-full p-4 glass-card bg-red-400/5 border-red-500/20 text-left space-y-3">
                                <div className="flex items-center gap-2 font-bold font-display text-red-100">
                                    <AlertCircle className="w-4 h-4 text-red-400" />
                                    Request Failed
                                </div>
                                <p className="text-sm opacity-80 text-red-100 leading-relaxed">{errorWithAttempts.message}</p>

                                {errorWithAttempts.attempts.length > 0 && (
                                    <div className="mt-3 font-mono text-[10px] bg-red-950/20 p-2 rounded-lg border border-red-500/10 max-h-40 overflow-y-auto">
                                        <p className="uppercase opacity-40 mb-2 border-b border-white/5 pb-1">Fallback sequence record</p>
                                        <div className="space-y-1.5">
                                            {errorWithAttempts.attempts.map((a, i) => (
                                                <div key={i} className="flex gap-2">
                                                    <span className="text-red-400/80 shrink-0">[{a.status}]</span>
                                                    <div className="opacity-60 min-w-0">
                                                        <span className="font-bold opacity-100">{a.model}</span>
                                                        {a.error && <span className="ml-2 italic opacity-40">- {a.error}</span>}
                                                        {!!a.providerRawError && a.status >= 400 && (
                                                            <pre className="text-[10px] mt-1 p-2 rounded bg-black/30 border border-red-500/15 text-red-200/80 whitespace-pre-wrap break-words">
                                                                {a.providerRawError}
                                                            </pre>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <button onClick={() => { setErrorWithAttempts(null); resetToLobby(); }} className="w-full btn-secondary text-xs uppercase tracking-widest mt-2 py-2 hover:bg-white/5">
                                    Back to Lobby
                                </button>
                            </div>
                        )}

                        {dueNodes.length > 0 ? (
                            <>
                            

                                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                                    <button id="start-session-btn" onClick={() => startQuiz(false)}
                                        className="btn-primary gap-2 flex-1"
                                        style={{ minWidth: 220 }}>
                                        <Target className="w-4 h-4" />
                                        Start Review ({sessionMinutesLimit} min limit)
                                    </button>
                                    <button id="start-unrecorded-btn" onClick={() => startQuiz(true)}
                                        className="btn-secondary gap-2 flex-1"
                                        style={{ minWidth: 220, background: 'transparent', borderColor: 'var(--border-default)' }}>
                                        <Smile className="w-4 h-4" />
                                        Practice Mode (Unrecorded)
                                    </button>
                                </div>
                            </>
                        ) : (
                        <div className="space-y-3">
                            <div className="badge badge-green mx-auto">All caught up! 🎉</div>
                            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                {timeBudgetReached
                                    ? 'You reached your daily revision time limit. Increase it in Settings if you want longer sessions today.'
                                    : 'No topics due right now. Come back later — great job staying on top of things!'}
                            </p>
                            
                            <div className="pt-4 mt-4" style={{ borderTop: '1px solid var(--border-default)' }}>
                                <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                                    Want to practice anyway without affecting your stats?
                                </p>
                                <button id="start-unrecorded-btn" onClick={() => startQuiz(true)}
                                    className="btn-secondary gap-2 mx-auto"
                                    style={{ minWidth: 200, width: '100%', maxWidth: 320 }}>
                                    <Smile className="w-4 h-4" />
                                    Practice Random Topic
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                </div>
            </div>
        );
    }

    /* ══════════════════════════════════════════════════════════
       RENDER — Loading questions
    ══════════════════════════════════════════════════════════ */
    if (phase === 'loading') {
        return (
            <div className="animate-slide-up w-full space-y-6">
                <div className="glass-card w-full overflow-hidden flex flex-col items-center justify-center min-h-[400px]">
                    <div className="relative p-10 text-center space-y-6 w-full max-w-2xl relative overflow-hidden">
                        <div className="flex flex-col items-center gap-4 relative z-10">
                            <div className="relative">
                                <Loader2 className="w-12 h-12 animate-spin" style={{ color: 'var(--accent-primary)' }} />
                                <div className="absolute inset-0 flex items-center justify-center animate-pulse">
                                    <div className="w-3 h-3 rounded-full bg-emerald-400" />
                                </div>
                            </div>
                            <div>
                                <p className="text-xl font-bold font-display tracking-tight" style={{ color: 'var(--text-primary)' }}>
                                    Synthesizing Questions…
                                </p>
                                <p className="text-sm mt-1 opacity-60" style={{ color: 'var(--text-muted)' }}>
                                    Scanning model priority queue for optimal reasoning capacity
                                </p>
                            </div>
                        </div>

                        <div className="pt-2 px-10">
                            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500/40 transition-all duration-1000 w-1/3 animate-ping" />
                            </div>
                        </div>

                        <p className="text-[10px] uppercase tracking-widest opacity-20 font-bold" style={{ color: 'var(--text-muted)' }}>
                            AntiForget Autoscale Fallback Protocol v2.4
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    /* ══════════════════════════════════════════════════════════
       RENDER — Answering phase
    ══════════════════════════════════════════════════════════ */
    if (phase === 'answering' || phase === 'submitting') {
        const isSubmitting = phase === 'submitting';
        const allFilled = answers.every((a) => a.trim().length > 0);

        return (
            <div className="animate-slide-up w-full space-y-6 pb-8">
                <div className="glass-card w-full overflow-hidden px-4 py-6 md:px-10 md:py-10 space-y-6 md:space-y-8">
                    {/* Header */}
                    <div className="max-w-4xl mx-auto w-full">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0 flex-1">
                                <span className="section-eyebrow">Knowledge Check</span>
                                <h2 className="section-title text-xl md:text-2xl mt-0.5 leading-tight">
                                    <span className="font-normal" style={{ color: 'var(--accent-primary)' }}>Revising</span>{' '}{currentTopicName || 'Unknown Topic'} {isUnrecorded && <span className="text-sm font-normal ml-2 opacity-60">(Practice Mode)</span>}
                                </h2>
                                <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                    {questionGenerationMs !== null && (
                                        <span>
                                            <span style={{ color: 'var(--accent-primary)' }}>✓</span>{' '}
                                            Generated in <span style={{ color: 'var(--accent-primary)' }}>{(questionGenerationMs / 1000).toFixed(2)}s</span>
                                            {activeModelInfo?.model ? (
                                                <span> · <span style={{ color: 'var(--text-primary)' }}>{activeModelInfo.model}</span></span>
                                            ) : null}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {isTimerActive && (
                                    <Timer initialSeconds={sessionMinutesLimit * 60} isActive={isTimerActive} onComplete={handleTimeUp} />
                                )}
                                <button id="close-quiz-btn" onClick={resetToLobby}
                                    className="font-semibold rounded-xl border"
                                    style={{ borderColor: 'rgba(220,38,38,0.34)', color: '#dc2626', background: 'rgba(220,38,38,0.12)', padding: '10px 18px' }}>
                                    Exit
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Friendly nudge */}
                    <div className="quiz-nudge-bar max-w-4xl mx-auto">
                        <Smile className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent-primary)' }} />
                        <span>Take your time — write what you genuinely understand. Short is fine.</span>
                    </div>

                    {/* Question cards */}
                    <div className="space-y-4 max-w-4xl mx-auto w-full">
                        {questions.map((q, i) => (
                            <div key={q.index} className="quiz-question-card glass-card p-5 space-y-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                                <div className="flex items-start gap-3">
                                    <div className="quiz-q-number">{q.index}</div>
                                    <div className="flex-1">
                                        <span className="quiz-q-label">{q.label}</span>
                                        <p className="quiz-q-text mt-1">{q.text}</p>
                                    </div>
                                </div>
                                <textarea
                                    id={`answer-q${q.index}`}
                                    className="textarea-field quiz-answer-textarea"
                                    placeholder={i === 0
                                        ? "Share your understanding — even a rough draft is great 👌"
                                        : "Your answer here…"}
                                    value={answers[i]}
                                    disabled={isSubmitting}
                                    onChange={(e) => {
                                        const next = [...answers];
                                        next[i] = e.target.value;
                                        setAnswers(next);
                                    }}
                                    rows={4}
                                />
                            </div>
                        ))}
                    </div>

                    {/* Submit */}
                    <div className="flex flex-col items-center gap-3 max-w-4xl mx-auto w-full">
                        {!allFilled && !isSubmitting && (
                            <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                                Fill in all answers — write "I don't know" if you're stuck 🙂
                            </p>
                        )}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 w-full">
                            <button
                                id="skip-topic-btn"
                                onClick={skipCurrentTopic}
                                disabled={isSubmitting}
                                className="btn-secondary">
                                Skip Topic
                            </button>
                            <button
                                id="submit-answers-btn"
                                onClick={submitAnswers}
                                disabled={isSubmitting || (!allFilled && answers.every((a) => a.trim() === ''))}
                                className="btn-primary gap-2">
                                {isSubmitting ? (
                                    <>
                                        <div className="quiz-btn-spinner" />
                                        Grading…
                                    </>
                                ) : (
                                    <>
                                        <Send className="w-4 h-4" />
                                        Submit Answers
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    /* ══════════════════════════════════════════════════════════
       RENDER — Results
    ══════════════════════════════════════════════════════════ */
    if (phase === 'results') {
        const overallEmoji = averageScore !== null
            ? (averageScore >= 3 ? '🌟' : averageScore >= 2 ? '👍' : '💪')
            : '📋';

        const overallMessage = averageScore !== null
            ? (averageScore >= 3
                ? "Great job! Your understanding is solid."
                : averageScore >= 2
                    ? "Good effort! Review the feedback below and you'll nail it next time."
                    : "Keep going — every attempt builds your knowledge. Check the correct answers below.")
            : 'Review complete.';

        return (
            <div className="animate-slide-up w-full space-y-6 pb-8 page-nudge-scroll">
                {/* Result banner */}
                <div className="quiz-result-banner glass-card max-w-4xl mx-auto p-6 text-center space-y-2">
                    <div className="text-4xl">{overallEmoji}</div>
                    <h2 className="section-title text-xl">{overallMessage}</h2>
                    {averageScore !== null && (
                        <div className="flex items-center justify-center gap-3 mt-2">
                            <span className="badge badge-green-accent">
                                <Star className="w-3 h-3" />
                                Average {averageScore.toFixed(2)} / 4
                            </span>
                            {activeModelInfo && (
                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                    via {getProviderLabel(activeModelInfo.provider)}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Per-question results */}
                <div className="space-y-4 max-w-4xl mx-auto">
                    {results.map((r) => {
                        const q = questions.find((q) => q.index === r.index);
                        return (
                            <div key={r.index} className="quiz-result-card glass-card p-5 space-y-4">
                                {/* Question header */}
                                <div className="flex items-start gap-3">
                                    <div className="quiz-q-number">{r.index}</div>
                                    <div className="flex-1 min-w-0">
                                        <span className="quiz-q-label">{q?.label || `Q${r.index}`}</span>
                                        <p className="quiz-q-text mt-1">{q?.text}</p>
                                    </div>
                                    {/* Score badge */}
                                    <div className="quiz-score-badge flex-shrink-0" style={{ '--score-color': scoreColor(r.score) } as React.CSSProperties}>
                                        <span className="quiz-score-emoji">{scoreEmoji(r.score)}</span>
                                        <span className="quiz-score-num">{r.score}/4</span>
                                        <span className="quiz-score-label">{scoreLabel(r.score)}</span>
                                    </div>
                                </div>

                                {/* User answer */}
                                {r.userAnswer && (
                                    <div className="quiz-answer-review">
                                        <p className="quiz-answer-review-label">Your answer</p>
                                        <p className="quiz-answer-review-text">{r.userAnswer}</p>
                                    </div>
                                )}

                                {/* Correct answer */}
                                <div className="quiz-correct-answer">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#10b981' }} />
                                        <span className="quiz-answer-review-label" style={{ color: '#10b981' }}>Correct answer</span>
                                    </div>
                                    <div className="quiz-correct-text">
                                        {r.correctAnswer ? (
                                            <RichTextMessage text={r.correctAnswer} />
                                        ) : (
                                            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No correct answer was returned for this question.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="glass-card max-w-4xl mx-auto p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <h3 className="section-title text-lg">Need help with these answers?</h3>
                            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                Use the button below to ask AI follow-up questions about this revision topic.
                            </p>
                        </div>
                        <button
                            id="toggle-results-chat-btn"
                            onClick={() => setChatOpen((prev) => !prev)}
                            className="btn-secondary gap-2"
                        >
                            <MessageCircle className="w-4 h-4" />
                            {chatOpen ? 'Hide AI Chat' : 'I Want to Ask AI Questions'}
                        </button>
                    </div>

                    {chatOpen && (
                        <div className="space-y-3">
                            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                                {chatMessages.length === 0 && (
                                    <div className="text-sm rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)' }}>
                                        Ask anything about your mistakes, model answers, or request extra practice questions.
                                    </div>
                                )}
                                {chatMessages.map((message, idx) => (
                                    <div
                                        key={`${message.role}-${idx}`}
                                        className="rounded-xl p-3"
                                        style={{
                                            background: message.role === 'user' ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.03)',
                                            border: '1px solid var(--border-default)',
                                        }}
                                    >
                                        <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                                            {message.role === 'user' ? 'You' : 'AI Tutor'}
                                        </p>
                                        {message.role === 'model' ? (
                                            <RichTextMessage text={message.text} />
                                        ) : (
                                            <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{message.text}</p>
                                        )}
                                    </div>
                                ))}
                                {isChatSending && (
                                    <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)' }}>
                                        Thinking…
                                    </div>
                                )}
                            </div>

                            {chatError && (
                                <p className="text-xs" style={{ color: '#ef4444' }}>{chatError}</p>
                            )}

                            <div className="flex flex-col sm:flex-row gap-2">
                                <input
                                    id="results-chat-input"
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            sendChatMessage();
                                        }
                                    }}
                                    disabled={isChatSending}
                                    className="input-field flex-1"
                                    placeholder="Ask AI to explain, compare, or give one more practice question..."
                                />
                                <button
                                    id="send-results-chat-btn"
                                    onClick={sendChatMessage}
                                    disabled={!chatInput.trim() || isChatSending}
                                    className="btn-primary gap-2"
                                >
                                    <Send className="w-4 h-4" />
                                    Send
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-4xl mx-auto w-full">
                    {dueNodes.length > 0 && !isUnrecorded && (
                        <button id="next-review-btn" onClick={() => startQuiz(false)} className="btn-primary gap-2 flex-1 sm:flex-none">
                            <ChevronRight className="w-4 h-4" />
                            Next Topic ({dueNodes.length} left)
                        </button>
                    )}
                    {isUnrecorded && (
                        <button id="next-unrecorded-btn" onClick={() => startQuiz(true)} className="btn-primary gap-2 flex-1 sm:flex-none">
                            <ChevronRight className="w-4 h-4" />
                            Practice Another
                        </button>
                    )}
                    <button id="back-to-lobby-btn" onClick={resetToLobby} className="btn-secondary gap-2 flex-1 sm:flex-none">
                        Back to Overview
                    </button>
                </div>
            </div>
        );
    }

    return null;
};
