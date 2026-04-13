import { getStorage, type AiProvider } from './storage';
import { apiDelete, apiGet, apiPost, apiPut } from './api/client';
import { hasActivePuterSession, isPuterAvailable, puterChat } from './puter';

export type ModelProvider = AiProvider | 'puter';

const PROVIDER_LABELS: Record<ModelProvider, string> = {
    openai: 'OpenAI API',
    groq: 'Groq',
    mistral: 'Mistral',
    nvidia: 'NVIDIA',
    openrouter: 'OpenRouter',
    gemini: 'Gemini API',
    claude: 'Claude API',
    puter: 'Puter.js',
};

const PROVIDER_DEFAULTS: Record<AiProvider, { remoteUrl: string; devProxyUrl: string; model: string }> = {
    openai: {
        remoteUrl: 'https://api.openai.com/v1/chat/completions',
        devProxyUrl: '/api/openai/chat/completions',
        model: 'gpt-oss-120b',
    },
    groq: {
        remoteUrl: 'https://api.groq.com/openai/v1/chat/completions',
        devProxyUrl: '/api/groq/chat/completions',
        model: 'openai/gpt-oss-120b',
    },
    mistral: {
        remoteUrl: 'https://api.mistral.ai/v1/chat/completions',
        devProxyUrl: '/api/mistral/chat/completions',
        model: 'mistral-small-latest',
    },
    nvidia: {
        remoteUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
        devProxyUrl: '/api/nvidia/chat/completions',
        model: 'nemotron-3-super-120b-a12b',
    },
    openrouter: {
        remoteUrl: 'https://openrouter.ai/api/v1/chat/completions',
        devProxyUrl: '/api/openrouter/chat/completions',
        model: 'google/gemini-2.0-flash-exp:free',
    },
    gemini: {
        remoteUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        devProxyUrl: '/api/gemini/chat/completions',
        model: 'gemini-2.5-flash',
    },
    claude: {
        remoteUrl: 'https://api.anthropic.com/v1/messages',
        devProxyUrl: '/api/claude/messages',
        model: 'claude-3-5-haiku-latest',
    },
    puter: {
        remoteUrl: '',
        devProxyUrl: '',
        model: 'gpt-oss-120b',
    },
};

const getDefaultProviderFromEnv = (): AiProvider => {
    return 'groq';
};

const getProviderModel = (provider: AiProvider): string => {
    return PROVIDER_DEFAULTS[provider].model;
};

export const getProviderLabel = (provider: ModelProvider): string => PROVIDER_LABELS[provider];
export const getDefaultModelForProvider = (provider: AiProvider): string => PROVIDER_DEFAULTS[provider].model;
export const getEnvModelForProvider = (provider: AiProvider): string => getProviderModel(provider);

export const getEnvProvider = (): AiProvider => getDefaultProviderFromEnv();


export interface TutorTopicContext {
    topicId: string;
    topicName: string;
    linkedTopicNames: string[];
    summaryContent: string;
    hasAttachedFile?: boolean;
    studentLevel: string;
    studentMajor: string;
    aiLanguage?: string;
    missedQuestionHistory: string[];
    questionDifficulty?: 'easy' | 'medium' | 'hard' | 'doesnt_matter' | 'auto';
    topicReps?: number;
    topicFsrsDifficulty?: number;
    questionCount?: number;
    isLightning?: boolean;
}

export interface AiAttempt {
    id: string;
    provider: AiProvider;
    model: string;
    endpoint?: string;
    status: number;
    error?: string;
    providerRawError?: string;
    durationMs?: number;
}

export interface PrioritizedModelCandidate {
    id: string;
    provider: ModelProvider;
    model: string;
    reasoning: boolean;
}

export interface UserModelPayload extends Record<string, unknown> {
    provider: ModelProvider;
    model: string;
    reasoning: boolean;
}

export type TutorRequestMode = 'questions' | 'grading' | 'chat';

const generationSystemPrompt = [
    'You are a Socratic Tutor for revision topics. First assistant turn for a topic:',
    '- Generate open-ended questions in one message.',
    '- Number and label them: Q1 (CONCEPTUAL), Q2 (APPLIED), Q3 (CONNECTION).',
    '- Ensure each question asks exactly one specific thing.',
    '- Output format must be exactly: Q[n] ([LABEL]): <question>',
    '- Do not include any intro or outro text. Output only questions.',
].join('\n');

const gradingSystemPrompt = [
    'You are a Socratic Tutor evaluating user answers to revision questions.',
    '- Grade each answered question from 0 to 4.',
    '- Provide score and short correct answer only for asked questions.',
    '- Use exact format: Qn Score: x and Qn Correct Answer: y',
].join('\n');

const chatSystemPrompt = [
    'You are a Socratic Tutor helping a student after they completed a revision quiz.',
    '- Answer the student\'s follow-up questions clearly and directly.',
    '- Use short explanations, examples, and analogies when helpful.',
    '- If the student asks for practice, provide one focused question at a time unless they ask for more.',
    '- Stay grounded in the provided topic and quiz context when available.',
].join('\n');

const resolveEffectiveDifficulty = (
    difficulty: string | undefined,
    reps: number,
    fsrsDifficulty: number,
): 'easy' | 'medium' | 'hard' | null => {
    if (!difficulty || difficulty === 'doesnt_matter') return null;
    if (difficulty === 'easy') return 'easy';
    if (difficulty === 'medium') return 'medium';
    if (difficulty === 'hard') return 'hard';
    if (difficulty === 'auto') {
        if (reps < 3) return 'easy';
        if (reps < 7) return fsrsDifficulty > 6 ? 'easy' : 'medium';
        return fsrsDifficulty > 6 ? 'medium' : 'hard';
    }
    return null;
};

const buildTutorPrompt = (
    history: { role: 'user' | 'model', parts: { text: string }[] }[],
    newPrompt: string,
    topicContext: TutorTopicContext | null,
    mode: TutorRequestMode,
    aiLanguage: string,
) => {
    const isFirstTurn = !history || history.length === 0;
    let finalPrompt = newPrompt;
    const shouldInjectTopicContext = mode === 'questions' && isFirstTurn;

    if (shouldInjectTopicContext) {
        const topicName = typeof topicContext?.topicName === 'string' && topicContext.topicName.trim()
            ? topicContext.topicName.trim()
            : 'Unknown topic';
        const linkedTopics = Array.isArray(topicContext?.linkedTopicNames)
            ? topicContext.linkedTopicNames.filter((name) => typeof name === 'string' && name.trim())
            : [];
        const summaryContent = typeof topicContext?.summaryContent === 'string' && topicContext.summaryContent.trim()
            ? topicContext.summaryContent.trim()
            : 'No summary available.';
        const studentLevel = typeof topicContext?.studentLevel === 'string' && topicContext.studentLevel.trim()
            ? topicContext.studentLevel.trim()
            : 'high school';
        const studentMajor = typeof topicContext?.studentMajor === 'string' && topicContext.studentMajor.trim()
            ? topicContext.studentMajor.trim()
            : 'not specified';
        const weakHistory = Array.isArray(topicContext?.missedQuestionHistory)
            ? topicContext.missedQuestionHistory.filter((item) => typeof item === 'string' && item.trim()).slice(0, 5)
            : [];

        const questionCount = topicContext?.questionCount ?? 3;
        const isLightning = topicContext?.isLightning ?? false;

        const questionInstructions: string[] = [];
        if (questionCount >= 1) {
            questionInstructions.push('1. CONCEPTUAL - Test understanding of core concepts.');
        }
        if (questionCount >= 2) {
            questionInstructions.push('2. APPLIED - Apply knowledge to a practical scenario.');
        }
        if (questionCount >= 3) {
            const connectionInstruction = linkedTopics.length > 0
                ? `3. CONNECTION - Must explore the relationship between "${topicName}" and "${linkedTopics[0]}"${linkedTopics.length > 1 ? ` (or other linked topics: ${linkedTopics.slice(1).join(', ')})` : ''}.`
                : '3. CONNECTION - Explore how this topic relates to other relevant topics of your choosing.';
            questionInstructions.push(connectionInstruction);
        }

        const questionCountInstruction = isLightning
            ? 'Generate exactly 1 question (CONCEPTUAL only) for a quick check.'
            : `Generate exactly ${questionCount} question${questionCount > 1 ? 's' : ''} of these types, in this order:`;

        finalPrompt = [
            `Topic: ${topicName}`,
            `Linked topics: ${linkedTopics.length > 0 ? linkedTopics.join(', ') : 'None'}`,
            `Topic summary: ${summaryContent}`,
            `Student level: ${studentLevel}`,
            `Student major: ${studentMajor}`,
            '',
            weakHistory.length > 0
                ? `Previously wrong questions to revisit:\n${weakHistory.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
                : 'Previously wrong questions to revisit: none',
            '',
            questionCountInstruction,
            ...questionInstructions.slice(0, questionCount),
            '',
            `User: ${newPrompt}`,
        ].join('\n');
    }

    const languageInstruction = `- Generate all output in ${aiLanguage}.`;

    let difficultyInstruction: string | null = null;
    if (mode === 'questions' && topicContext) {
        const effectiveDifficulty = resolveEffectiveDifficulty(
            topicContext.questionDifficulty,
            topicContext.topicReps ?? 0,
            topicContext.topicFsrsDifficulty ?? 5,
        );
        if (effectiveDifficulty === 'easy') difficultyInstruction = '- Ask easy, introductory-level questions that test basic recall and understanding.';
        else if (effectiveDifficulty === 'medium') difficultyInstruction = '- Ask medium-level questions that require some reasoning and application of concepts.';
        else if (effectiveDifficulty === 'hard') difficultyInstruction = '- Ask challenging, advanced questions that require deep understanding, synthesis, and critical thinking.';
    }

    const systemPrompt = [
        mode === 'questions'
            ? generationSystemPrompt
            : mode === 'grading'
                ? gradingSystemPrompt
                : chatSystemPrompt,
        languageInstruction,
        difficultyInstruction,
    ].filter(Boolean).join('\n');
    const serializedHistory = (history || [])
        .slice(-6)
        .map((entry) => {
            const role = entry.role === 'model' ? 'ASSISTANT' : 'USER';
            const content = (entry.parts || []).map((part) => part.text).join('\n');
            return `[${role}]\n${content}`;
        })
        .join('\n\n');

    return [
        `[SYSTEM]\n${systemPrompt}`,
        serializedHistory,
        `[USER]\n${finalPrompt}`,
    ].filter(Boolean).join('\n\n');
};

const getPuterPrimaryModel = async (): Promise<PrioritizedModelCandidate | null> => {
    const data = await getUserModels();
    const first = Array.isArray(data.models) ? data.models[0] : null;
    if (!first || first.provider !== 'puter') {
        return null;
    }
    return first;
};

export const generateTutorResponse = async (
    history: { role: 'user' | 'model', parts: { text: string }[] }[],
    newPrompt: string,
    topicContext: TutorTopicContext | null,
    options?: { signal?: AbortSignal; mode?: TutorRequestMode }
) => {
    const resolvedMode: TutorRequestMode = options?.mode || ((!history || history.length === 0) ? 'questions' : 'grading');
    let aiLanguage = (topicContext?.aiLanguage || '').trim();
    if (!aiLanguage) {
        try {
            const storage = await getStorage();
            aiLanguage = (storage.aiLanguage || '').trim();
        } catch {
            aiLanguage = '';
        }
    }
    if (!aiLanguage) {
        aiLanguage = 'English';
    }

    try {
        const puterPrimary = await getPuterPrimaryModel();
        const shouldBypassPuter = resolvedMode === 'questions' && Boolean(topicContext?.hasAttachedFile);
        const canUsePuter = puterPrimary
            && isPuterAvailable()
            && !shouldBypassPuter
            && await hasActivePuterSession();

        if (canUsePuter) {
            const startedAt = Date.now();
            const prompt = buildTutorPrompt(history, newPrompt, topicContext, resolvedMode, aiLanguage);
            const text = await puterChat(prompt, { model: puterPrimary.model });
            return {
                text: text || 'No response generated.',
                provider: 'puter' as ModelProvider,
                model: puterPrimary.model,
                generationMs: Date.now() - startedAt,
                attempts: [],
            };
        }
    } catch {
        // If Puter probing fails, continue with the server-side fallback chain.
    }

    const data = await apiPost<{ 
        text?: string; 
        error?: string; 
        provider?: ModelProvider; 
        model?: string;
        generationMs?: number;
        attempts?: AiAttempt[];
    }>('/ai/tutor', {
        history,
        newPrompt,
        topicContext,
        mode: resolvedMode,
        aiLanguage,
    }, {
        signal: options?.signal,
    });

    if (data.error) {
        const err: any = new Error(data.error);
        err.attempts = data.attempts;
        throw err;
    }

    return {
        text: data.text || 'No response generated.',
        provider: data.provider,
        model: data.model,
        generationMs: data.generationMs,
        attempts: data.attempts,
    };
};

export const getApiCredentialStatus = async () => {
    return await apiGet<{ providers: Record<AiProvider, boolean> }>('/ai/credentials/status');
};

export const saveApiCredential = async (provider: AiProvider, apiKey: string | null) => {
    return await apiPost<{ ok: boolean }>('/ai/credentials', { provider, apiKey });
};

export const testApiConnectivity = async (
    provider: AiProvider,
    modelOverride?: string,
    apiKey?: string
) => {
    return await apiPost<{
        ok: boolean;
        latencyMs?: number;
        model?: string;
        replyPreview?: string;
        error?: string;
    }>('/ai/test', {
        provider,
        modelOverride,
        apiKey,
    });
};

export const getModelPrioritySettings = async () => {
    return await apiGet<{
        activeProviders: AiProvider[];
        availableModels: PrioritizedModelCandidate[];
        currentPriority: string[];
    }>('/ai/model-priority');
};

export const saveModelPrioritySettings = async (modelPriority: string[]) => {
    return await apiPut<{ ok: boolean; modelPriority: string[] }>('/ai/model-priority', {
        modelPriority,
    });
};

export const getUserModels = async () => {
    return await apiGet<{
        activeProviders: AiProvider[];
        models: PrioritizedModelCandidate[];
    }>('/ai/models');
};

export const addUserModel = async (payload: UserModelPayload) => {
    return await apiPost<{
        ok: boolean;
        model: PrioritizedModelCandidate | null;
        models: PrioritizedModelCandidate[];
    }>('/ai/models', payload);
};

export const deleteUserModel = async (modelId: string) => {
    return await apiDelete<{
        ok: boolean;
        models: PrioritizedModelCandidate[];
    }>(`/ai/models/${encodeURIComponent(modelId)}`);
};

export const extractQuestionScores = (text: string, expectedIndices: number[]): number[] | null => {
    const regex = /Q([1-3])\s*Score\s*:\s*([0-4](?:\.\d+)?)/gi;
    const foundScores: Record<number, number> = {};

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        const qIndex = Number(match[1]);
        const parsed = Number.parseFloat(match[2]);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 4) {
            foundScores[qIndex] = parsed;
        }
    }

    const scores: number[] = [];
    for (const expected of expectedIndices) {
        if (foundScores[expected] === undefined) {
            return null;
        }
        scores.push(foundScores[expected]);
    }

    return scores;
};

export const calculateAverageScore = (scores: number[]): number => {
    if (!scores.length) {
        return 0;
    }
    const total = scores.reduce((sum, value) => sum + value, 0);
    return Math.round((total / scores.length) * 100) / 100;
};
