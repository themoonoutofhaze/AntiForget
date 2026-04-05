import { v4 as uuidv4 } from 'uuid';
import { apiGet, apiPatch } from './api/client';

export interface GraphNode {
    id: string;
    title: string;
    summary: string;
    tags: string[];
    hasPdfBlob: boolean;
    position: { x: number; y: number };
}

export interface GraphEdge {
    id: string;
    source: string;
    target: string;
}

export interface FSRSRecord {
    nodeId: string;
    due: number;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    reps: number;
    lapses: number;
    state: 'New' | 'Learning' | 'Review' | 'Relearning';
}

export type AiProvider = 'openai' | 'groq' | 'mistral' | 'nvidia' | 'openrouter' | 'gemini' | 'claude' | 'puter';
export type QuestionDifficulty = 'easy' | 'medium' | 'hard' | 'doesnt_matter' | 'auto';

export interface SynapseStorage {
    nodes: GraphNode[];
    edges: GraphEdge[];
    fsrsData: Record<string, FSRSRecord>;
    completedRevisionsToday: number;
    revisionSecondsToday: number;
    dailyRevisionMinutesLimit: number;
    lastRevisionDate: string; // YYYY-MM-DD
    studentEducationLevel: string;
    studentMajor: string;
    studentFocusTopic: string;
    aiLanguage: string;
    missedQuestionHistoryByTopic: Record<string, string[]>;
    aiProvider: AiProvider;
    aiModelOverrides: Partial<Record<AiProvider, string>>;
    aiModelPriority: string[];
    openaiApiKey: string | null;
    groqApiKey: string | null;
    mistralApiKey: string | null;
    nvidiaApiKey: string | null;
    openrouterApiKey: string | null;
    geminiApiKey: string | null;
    claudeApiKey: string | null;
    questionDifficulty: QuestionDifficulty;
    revisionReminderEnabled: boolean;
    revisionReminderTime: string;
}

const DEFAULT_STATE: SynapseStorage = {
    nodes: [],
    edges: [],
    fsrsData: {},
    completedRevisionsToday: 0,
    revisionSecondsToday: 0,
    dailyRevisionMinutesLimit: 60,
    lastRevisionDate: new Date().toISOString().split('T')[0],
    studentEducationLevel: 'high school',
    studentMajor: '',
    studentFocusTopic: '',
    aiLanguage: 'English',
    missedQuestionHistoryByTopic: {},
    aiProvider: 'groq',
    aiModelOverrides: {},
    aiModelPriority: [],
    openaiApiKey: null,
    groqApiKey: null,
    mistralApiKey: null,
    nvidiaApiKey: null,
    openrouterApiKey: null,
    geminiApiKey: null,
    claudeApiKey: null,
    questionDifficulty: 'doesnt_matter',
    revisionReminderEnabled: false,
    revisionReminderTime: '09:00',
};

export const getStorage = async (): Promise<SynapseStorage> => {
    try {
        const serverData = await apiGet<Partial<SynapseStorage> & { ai_language?: string }>('/storage');
        const parsedProvider = serverData.aiProvider;
        const aiProvider: AiProvider =
            parsedProvider === 'openai' || parsedProvider === 'groq' || parsedProvider === 'mistral' || parsedProvider === 'nvidia' || parsedProvider === 'openrouter' || parsedProvider === 'gemini' || parsedProvider === 'claude'
                ? parsedProvider
                : 'groq';

        const normalizedNodes = (serverData.nodes ?? []).map((node) => ({
            ...node,
            tags: Array.isArray(node.tags) ? node.tags.filter((tag) => typeof tag === 'string') : [],
        })) as GraphNode[];

        const normalizedMissedHistory = Object.fromEntries(
            Object.entries(serverData.missedQuestionHistoryByTopic ?? {}).map(([topicId, questions]) => [
                topicId,
                Array.isArray(questions) ? questions.filter((q) => typeof q === 'string' && q.trim()) : [],
            ])
        ) as Record<string, string[]>;

        return {
            ...DEFAULT_STATE,
            ...serverData,
            aiLanguage: (serverData.aiLanguage || serverData.ai_language || 'English').trim() || 'English',
            nodes: normalizedNodes,
            missedQuestionHistoryByTopic: normalizedMissedHistory,
            aiProvider,
            aiModelOverrides: serverData.aiModelOverrides ?? {},
            aiModelPriority: Array.isArray(serverData.aiModelPriority)
                ? serverData.aiModelPriority.filter((id): id is string => typeof id === 'string')
                : [],
            openaiApiKey: null,
            groqApiKey: null,
            mistralApiKey: null,
            nvidiaApiKey: null,
            openrouterApiKey: null,
            geminiApiKey: null,
            claudeApiKey: null,
        };
    } catch (error) {
        console.error('Failed to load storage from API, using defaults:', error);
        return DEFAULT_STATE;
    }
};

export const updateStorage = async (data: Partial<SynapseStorage>) => {
    await apiPatch<{ ok: boolean }>('/storage', data as Record<string, unknown>);
};

export const createNode = async (
    title: string,
    summary: string,
    tags: string[],
    hasPdfBlob: boolean,
    position = { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 }
) => {
    const storage = await getStorage();
    const newNode: GraphNode = {
        id: uuidv4(),
        title,
        summary,
        tags,
        hasPdfBlob,
        position
    };

    const newFSRSRecord: FSRSRecord = {
        nodeId: newNode.id,
        due: Date.now(),
        stability: 0,
        difficulty: 0,
        elapsed_days: 0,
        scheduled_days: 0,
        reps: 0,
        lapses: 0,
        state: 'New',
    };

    await updateStorage({
        nodes: [...storage.nodes, newNode],
        fsrsData: { ...storage.fsrsData, [newNode.id]: newFSRSRecord }
    });

    return newNode;
};
