import type { AiProvider } from './storage';
import { apiDelete, apiGet, apiPost, apiPut } from './api/client';
import { isPuterAvailable, puterChat } from './puter';

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
        model: 'gpt-5.4-nano',
    },
    groq: {
        remoteUrl: 'https://api.groq.com/openai/v1/chat/completions',
        devProxyUrl: '/api/groq/chat/completions',
        model: 'llama3-8b-8192',
    },
    mistral: {
        remoteUrl: 'https://api.mistral.ai/v1/chat/completions',
        devProxyUrl: '/api/mistral/chat/completions',
        model: 'mistral-small-latest',
    },
    nvidia: {
        remoteUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
        devProxyUrl: '/api/nvidia/chat/completions',
        model: 'meta/llama-3.1-405b-instruct',
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
        model: 'claude-3-7-sonnet-latest',
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

export const getEnvApiKeyForProvider = (provider: AiProvider): string => {
    const envKeys: Record<AiProvider, string | undefined> = {
        openai: import.meta.env.VITE_OPENAI_API_KEY,
        groq: import.meta.env.VITE_GROQ_API_KEY,
        mistral: import.meta.env.VITE_MISTRAL_API_KEY,
        nvidia: import.meta.env.VITE_NVIDIA_API_KEY,
        openrouter: import.meta.env.VITE_OPENROUTER_API_KEY,
        gemini: import.meta.env.VITE_GEMINI_API_KEY,
        claude: import.meta.env.VITE_CLAUDE_API_KEY,
    };
    return envKeys[provider]?.trim() || '';
};

export interface TutorTopicContext {
    topicId: string;
    topicName: string;
    linkedTopicNames: string[];
    summaryContent: string;
    studentLevel: string;
    studentMajor: string;
    studentFocusTopic: string;
    missedQuestionHistory: string[];
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

const generationSystemPrompt = [
    'You are a Socratic Tutor for revision topics. First assistant turn for a topic:',
    '- Generate exactly 3 open-ended questions in one message.',
    '- Number and label them in this exact order: Q1 (CONCEPTUAL), Q2 (APPLIED), Q3 (CONNECTION).',
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

const buildTutorPrompt = (
    history: { role: 'user' | 'model', parts: { text: string }[] }[],
    newPrompt: string,
    topicContext: TutorTopicContext | null,
) => {
    const isFirstTurn = !history || history.length === 0;
    let finalPrompt = newPrompt;

    if (isFirstTurn) {
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
        const studentFocus = typeof topicContext?.studentFocusTopic === 'string' && topicContext.studentFocusTopic.trim()
            ? topicContext.studentFocusTopic.trim()
            : 'not specified';
        const weakHistory = Array.isArray(topicContext?.missedQuestionHistory)
            ? topicContext.missedQuestionHistory.filter((item) => typeof item === 'string' && item.trim()).slice(0, 5)
            : [];

        finalPrompt = [
            `Topic: ${topicName}`,
            `Linked topics: ${linkedTopics.length > 0 ? linkedTopics.join(', ') : 'None'}`,
            `Topic summary: ${summaryContent}`,
            `Student level: ${studentLevel}`,
            `Student major: ${studentMajor}`,
            `Student focus topic: ${studentFocus}`,
            '',
            weakHistory.length > 0
                ? `Previously wrong questions to revisit:\n${weakHistory.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
                : 'Previously wrong questions to revisit: none',
            '',
            'Generate exactly 3 questions of these types, in this order:',
            '1. CONCEPTUAL',
            '2. APPLIED',
            '3. CONNECTION',
            '',
            `User: ${newPrompt}`,
        ].join('\n');
    }

    const systemPrompt = isFirstTurn ? generationSystemPrompt : gradingSystemPrompt;
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
    options?: { signal?: AbortSignal }
) => {
    try {
        const puterPrimary = await getPuterPrimaryModel();
        if (puterPrimary && isPuterAvailable()) {
            const startedAt = Date.now();
            const prompt = buildTutorPrompt(history, newPrompt, topicContext);
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

    for (const match of text.matchAll(regex)) {
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
