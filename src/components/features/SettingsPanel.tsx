import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { KeyRound, Moon, Save, Sun, Palette, CheckCircle2, HardDrive, Cloud, Clock3, GraduationCap, Bot, GripVertical, Plus, Trash2, ChevronDown, Loader2, Languages, Bell, BellOff, Zap } from 'lucide-react';
import type { IconType } from 'react-icons';
import * as SiIcons from 'react-icons/si';
import { getStorage, updateStorage, type AiProvider, type QuestionDifficulty } from '../../utils/storage';
import { apiDelete, apiGet, apiPost } from '../../utils/api/client';
import { addUserModel, deleteUserModel, getApiCredentialStatus, getUserModels, saveApiCredential, saveModelPrioritySettings, testApiConnectivity, type ModelProvider, type PrioritizedModelCandidate } from '../../utils/gemini';
import { isPuterAvailable, puterChat } from '../../utils/puter';

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
};

const SW_READY_TIMEOUT_MS = 8000;

const doSubscribe = async (vapidPublicKey: string): Promise<PushSubscription> => {
    const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
            'Service worker did not activate in time. ' +
            'In development mode, push notifications require a production build (npm run build && npm start).' +
            ' In production, try reloading the page.'
        )), SW_READY_TIMEOUT_MS)
    );
    const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
    const existing = await reg.pushManager.getSubscription();
    if (existing) return existing;
    return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as ArrayBuffer,
    });
};

interface SettingsPanelProps {
    theme: 'light' | 'dark';
    themeMode: 'light' | 'dark' | 'auto';
    onSetThemeMode: (mode: 'light' | 'dark' | 'auto') => void;
    initialSection?: 'ai-models' | 'storage' | null;
}

const reconcilePriorityOrder = (priorityIds: string[], availableModels: PrioritizedModelCandidate[]): string[] => {
    const availableIds = new Set(availableModels.map((candidate) => candidate.id));
    const cleaned = Array.isArray(priorityIds)
        ? priorityIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
        : [];

    const dedupe = new Set<string>();
    const next: string[] = [];

    for (const id of cleaned) {
        if (!availableIds.has(id) || dedupe.has(id)) {
            continue;
        }
        dedupe.add(id);
        next.push(id);
    }

    for (const candidate of availableModels) {
        if (!dedupe.has(candidate.id)) {
            dedupe.add(candidate.id);
            next.push(candidate.id);
        }
    }

    return next;
};

interface SortableModelRowProps {
    model: PrioritizedModelCandidate;
    index: number;
    providerLabel: string;
    providerBadge: React.ReactNode;
    isPriorityEnabled: boolean;
    onDelete: (modelId: string) => void;
}

const SortableModelRow: React.FC<SortableModelRowProps> = ({ model, index, providerLabel, providerBadge, isPriorityEnabled, onDelete }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: model.id,
        disabled: !isPriorityEnabled,
    });

    return (
        <div
            ref={setNodeRef}
            className={`priority-draggable-row${isDragging ? ' is-dragging' : ''}`}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                cursor: isPriorityEnabled ? 'default' : 'not-allowed',
                opacity: isPriorityEnabled ? 1 : 0.7,
            }}
        >
            <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    #{index + 1} {model.model}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="inline-flex items-center gap-1.5">
                        {providerBadge}
                        {providerLabel}
                    </span>
                    {model.reasoning ? ' • reasoning' : ''}
                </p>
            </div>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    className="priority-drag-handle"
                    aria-label={`Drag ${model.model} to reorder`}
                    disabled={!isPriorityEnabled}
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="w-4 h-4" />
                    Drag
                </button>
                <button
                    type="button"
                    className="btn-secondary p-2"
                    onClick={() => onDelete(model.id)}
                    aria-label={`Remove ${model.model}`}
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ theme, themeMode, onSetThemeMode, initialSection = null }) => {
    const modelProviderOptions: ModelProvider[] = ['openai', 'groq', 'mistral', 'nvidia', 'openrouter', 'gemini', 'claude', 'puter'];

    const [openSection, setOpenSection] = useState<'appearance' | 'user-information' | 'ai-models' | 'storage' | null>(null);
    const [openaiKeyInput, setOpenaiKeyInput] = useState('');
    const [activeKeyProvider, setActiveKeyProvider] = useState<AiProvider>('groq');
    const [groqKeyInput, setGroqKeyInput] = useState('');
    const [mistralKeyInput, setMistralKeyInput] = useState('');
    const [nvidiaKeyInput, setNvidiaKeyInput] = useState('');
    const [openrouterKeyInput, setOpenrouterKeyInput] = useState('');
    const [geminiKeyInput, setGeminiKeyInput] = useState('');
    const [claudeKeyInput, setClaudeKeyInput] = useState('');
    const [dailyRevisionMinutesLimit, setDailyRevisionMinutesLimit] = useState(60);
    const [maxTopicsPerDay, setMaxTopicsPerDay] = useState(5);
    const [revisionSecondsToday, setRevisionSecondsToday] = useState(0);
    const [studentEducationLevel, setStudentEducationLevel] = useState('high school');
    const [studentMajor, setStudentMajor] = useState('');
    const [aiLanguage, setAiLanguage] = useState('English');
    const [questionDifficulty, setQuestionDifficulty] = useState<QuestionDifficulty>('doesnt_matter');
    const [revisionReminderEnabled, setRevisionReminderEnabled] = useState(false);
    const [revisionReminderTime, setRevisionReminderTime] = useState('09:00');
    const [lightningReviewEnabled, setLightningReviewEnabled] = useState(true);
    const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');
    const [notifSubState, setNotifSubState] = useState<'idle' | 'subscribing' | 'subscribed' | 'error'>('idle');
    const [notifSubMessage, setNotifSubMessage] = useState('');
    const [notifTestState, setNotifTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [providerModels, setProviderModels] = useState<Record<AiProvider, string>>({
        openai: 'gpt-oss-120b',
        groq: 'openai/gpt-oss-120b',
        mistral: 'mistral-small-latest',
        nvidia: 'nemotron-3-super-120b-a12b',
        openrouter: 'xiaomi/mimo-v2-flash',
        gemini: 'gemini-2.5-flash',
        claude: 'claude-3-5-haiku-latest',
        puter: 'gpt-oss-120b',
    });
    const [apiTestState, setApiTestState] = useState<Record<AiProvider, 'idle' | 'testing' | 'success' | 'error'>>({
        openai: 'idle',
        groq: 'idle',
        mistral: 'idle',
        nvidia: 'idle',
        openrouter: 'idle',
        gemini: 'idle',
        claude: 'idle',
        puter: 'idle',
    });
    const [apiTestMessage, setApiTestMessage] = useState<Record<AiProvider, string>>({
        openai: '',
        groq: '',
        mistral: '',
        nvidia: '',
        openrouter: '',
        gemini: '',
        claude: '',
        puter: '',
    });
    const [driveConnected, setDriveConnected] = useState(false);
    const [driveReady, setDriveReady] = useState(false);
    const [isLoadingDriveStatus, setIsLoadingDriveStatus] = useState(true);
    const [isDisconnectingDrive, setIsDisconnectingDrive] = useState(false);
    const [savedKeyProviders, setSavedKeyProviders] = useState<Record<AiProvider, boolean>>({
        openai: false,
        groq: false,
        mistral: false,
        nvidia: false,
        openrouter: false,
        gemini: false,
        claude: false,
        puter: false,
    });
    const [newModelProvider, setNewModelProvider] = useState<ModelProvider>('groq');
    const [newModelName, setNewModelName] = useState('');
    const [newModelReasoning, setNewModelReasoning] = useState(false);
    const [modelSaveState, setModelSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
    const [modelSaveMessage, setModelSaveMessage] = useState('');
    const [priorityModels, setPriorityModels] = useState<PrioritizedModelCandidate[]>([]);
    const [manualPriorityIds, setManualPriorityIds] = useState<string[]>([]);
    const [priorityState, setPriorityState] = useState<'idle' | 'loading' | 'error'>('idle');
    const [priorityMessage, setPriorityMessage] = useState('');
    const [puterState, setPuterState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [puterMessage, setPuterMessage] = useState('');
    const [showFloatingSave, setShowFloatingSave] = useState(false);
    const topSaveSentinelRef = useRef<HTMLDivElement | null>(null);
    const latestPriorityIdsRef = useRef<string[]>([]);

    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: { distance: 5 },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 160,
                tolerance: 8,
            },
        })
    );

    const providerLabelMap: Record<ModelProvider, string> = {
        openai: 'OpenAI',
        groq: 'Groq',
        mistral: 'Mistral',
        nvidia: 'NVIDIA',
        openrouter: 'OpenRouter',
        gemini: 'Gemini',
        claude: 'Claude',
        puter: 'Puter',
    };

    const providerIconNameMap: Record<ModelProvider, string> = {
        openai: 'SiOpenai',
        groq: 'SiGroq',
        mistral: 'SiMistralai',
        nvidia: 'SiNvidia',
        openrouter: 'SiOpenrouter',
        gemini: 'SiGooglegemini',
        claude: 'SiAnthropic',
        puter: 'SiPuter',
    };

    const providerAccentMap: Record<ModelProvider, string> = {
        openai: '#10a37f',
        groq: '#f55036',
        mistral: '#ff7000',
        nvidia: '#76b900',
        openrouter: '#3b82f6',
        gemini: '#4285f4',
        claude: '#d97706',
        puter: '#ec4899',
    };

    const renderProviderBadge = (provider: ModelProvider, sizeClass = 'w-3.5 h-3.5') => {
        const iconName = providerIconNameMap[provider];
        const IconComponent = (SiIcons as Record<string, IconType | undefined>)[iconName];

        if (IconComponent) {
            return <IconComponent className={sizeClass} style={{ color: providerAccentMap[provider] }} aria-hidden="true" />;
        }

        return (
            <span
                className={`${sizeClass} rounded-sm inline-flex items-center justify-center text-[9px] font-bold leading-none`}
                style={{ background: 'var(--bg-elevated)', color: providerAccentMap[provider], border: '1px solid var(--border-subtle)' }}
                aria-hidden="true"
            >
                {provider.slice(0, 1).toUpperCase()}
            </span>
        );
    };

    const keyInputMap: Record<AiProvider, string> = {
        openai: openaiKeyInput,
        groq: groqKeyInput,
        mistral: mistralKeyInput,
        nvidia: nvidiaKeyInput,
        openrouter: openrouterKeyInput,
        gemini: geminiKeyInput,
        claude: claudeKeyInput,
        puter: '',
    };

    const setKeyInputMap: Record<AiProvider, (value: string) => void> = {
        openai: setOpenaiKeyInput,
        groq: setGroqKeyInput,
        mistral: setMistralKeyInput,
        nvidia: setNvidiaKeyInput,
        openrouter: setOpenrouterKeyInput,
        gemini: setGeminiKeyInput,
        claude: setClaudeKeyInput,
        puter: () => {},
    };

    const todayMinutesSpent = useMemo(() => Math.floor(revisionSecondsToday / 60), [revisionSecondsToday]);
    const spendPct = useMemo(() => {
        if (dailyRevisionMinutesLimit <= 0) return 0;
        return Math.min(100, Math.round((todayMinutesSpent / dailyRevisionMinutesLimit) * 100));
    }, [todayMinutesSpent, dailyRevisionMinutesLimit]);
    const subsectionPanelStyle = useMemo(
        () => ({
            background: theme === 'light' ? '#fcfeff' : 'var(--bg-muted)',
            border: theme === 'light' ? '1px solid #e6efff' : '1px solid var(--border-subtle)',
        }),
        [theme]
    );

    const clampDailyLimit = (value: number) => {
        if (Number.isNaN(value)) return 60;
        return Math.max(10, Math.min(300, value));
    };

    useEffect(() => {
        const load = async () => {
            const storage = await getStorage();
            setActiveKeyProvider(storage.aiProvider);
            setDailyRevisionMinutesLimit(Math.max(10, storage.dailyRevisionMinutesLimit || 60));
            setMaxTopicsPerDay(Math.max(1, storage.maxTopicsPerDay || 5));
            setRevisionSecondsToday(Math.max(0, storage.revisionSecondsToday || 0));
            setStudentEducationLevel((storage.studentEducationLevel || 'high school').trim() || 'high school');
            setStudentMajor(storage.studentMajor || '');
            setAiLanguage((storage.aiLanguage || 'English').trim() || 'English');
            setQuestionDifficulty(storage.questionDifficulty || 'doesnt_matter');
            setRevisionReminderEnabled(Boolean(storage.revisionReminderEnabled));
            setRevisionReminderTime(storage.revisionReminderTime || '09:00');
            setLightningReviewEnabled(storage.lightningReviewEnabled ?? true);
            if (typeof Notification !== 'undefined') {
                setNotifPermission(Notification.permission);
                if (Notification.permission === 'granted' && 'serviceWorker' in navigator && 'PushManager' in window) {
                    try {
                        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
                        if (reg) {
                            const existingSub = await reg.pushManager.getSubscription();
                            if (existingSub) setNotifSubState('subscribed');
                        }
                    } catch { /* ignore */ }
                }
            }
            setProviderModels({
                openai: storage.aiModelOverrides.openai || 'gpt-oss-120b',
                groq: storage.aiModelOverrides.groq || 'openai/gpt-oss-120b',
                mistral: storage.aiModelOverrides.mistral || 'mistral-small-latest',
                nvidia: storage.aiModelOverrides.nvidia || 'nemotron-3-super-120b-a12b',
                openrouter: storage.aiModelOverrides.openrouter || 'xiaomi/mimo-v2-flash',
                gemini: storage.aiModelOverrides.gemini || 'gemini-2.5-flash',
                claude: storage.aiModelOverrides.claude || 'claude-3-5-haiku-latest',
                puter: 'gpt-oss-120b',
            });

            try {
                const keyStatus = await getApiCredentialStatus();
                setSavedKeyProviders(keyStatus.providers);
            } catch {
                setSavedKeyProviders({
                    openai: false,
                    groq: false,
                    mistral: false,
                    nvidia: false,
                    openrouter: false,
                    gemini: false,
                    claude: false,
                    puter: false,
                });
            }

            try {
                setPriorityState('loading');
                const modelData = await getUserModels();
                setPriorityModels(modelData.models);
                setManualPriorityIds((prev) => reconcilePriorityOrder(prev, modelData.models));
                setPriorityState('idle');
                setPriorityMessage('');
            } catch (error) {
                setPriorityState('error');
                setPriorityMessage(error instanceof Error ? error.message : 'Failed to load your custom models.');
            }

            try {
                const fileSettings = await apiGet<{
                    provider: 'google-drive';
                    driveConnected: boolean;
                    driveReady: boolean;
                }>('/settings/storage-provider');
                setDriveConnected(fileSettings.driveConnected);
                setDriveReady(fileSettings.driveReady);
            } catch {
                setDriveConnected(false);
                setDriveReady(false);
            } finally {
                setIsLoadingDriveStatus(false);
            }
        };
        load();
    }, []);

    useEffect(() => {
        if (!initialSection) {
            return;
        }
        setOpenSection(initialSection);
        
        // Ensure the section renders first, then smoothly scroll it into view.
        setTimeout(() => {
            const sectionId = `settings-section-${initialSection}`;
            const element = document.getElementById(sectionId);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150);
    }, [initialSection]);

    useEffect(() => {
        setManualPriorityIds((prev) => reconcilePriorityOrder(prev, priorityModels));
    }, [priorityModels]);

    useEffect(() => {
        latestPriorityIdsRef.current = manualPriorityIds;
    }, [manualPriorityIds]);

    useEffect(() => {
        const node = topSaveSentinelRef.current;
        if (!node || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
            return;
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                setShowFloatingSave(!entry.isIntersecting);
            },
            {
                threshold: 0.95,
            }
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const handleSave = async () => {
        setSaveState('saving');
        try {
            // Persist revision settings first so language/time/profile are saved
            // even if a later model/key/priority call encounters an issue.
            await updateStorage({
                dailyRevisionMinutesLimit: clampDailyLimit(dailyRevisionMinutesLimit),
                maxTopicsPerDay: Math.max(1, Math.min(20, maxTopicsPerDay)),
                studentEducationLevel: studentEducationLevel.trim() || 'high school',
                studentMajor: studentMajor.trim(),
                aiLanguage: aiLanguage.trim() || 'English',
                questionDifficulty,
                revisionReminderEnabled,
                revisionReminderTime,
                lightningReviewEnabled,
            });

            const saveOps: Promise<unknown>[] = [];
            
            // If the user is saving keys for the first time or updating them,
            // we should also ensure the default model for that provider is added
            // if they don't have any models for it yet.
            const providersToCheck = new Set<AiProvider>();

            const priorityToSave = reconcilePriorityOrder(latestPriorityIdsRef.current, priorityModels);

            const nextGroqKey = groqKeyInput.trim();
            const nextMistralKey = mistralKeyInput.trim();
            const nextNvidiaKey = nvidiaKeyInput.trim();
            const nextOpenrouterKey = openrouterKeyInput.trim();
            const nextGeminiKey = geminiKeyInput.trim();
            const nextClaudeKey = claudeKeyInput.trim();
            const nextOpenaiKey = openaiKeyInput.trim();

            if (nextOpenaiKey) {
                saveOps.push(saveApiCredential('openai', nextOpenaiKey));
                providersToCheck.add('openai');
            }
            if (nextGroqKey) {
                saveOps.push(saveApiCredential('groq', nextGroqKey));
                providersToCheck.add('groq');
            }
            if (nextMistralKey) {
                saveOps.push(saveApiCredential('mistral', nextMistralKey));
                providersToCheck.add('mistral');
            }
            if (nextNvidiaKey) {
                saveOps.push(saveApiCredential('nvidia', nextNvidiaKey));
                providersToCheck.add('nvidia');
            }
            if (nextOpenrouterKey) {
                saveOps.push(saveApiCredential('openrouter', nextOpenrouterKey));
                providersToCheck.add('openrouter');
            }
            if (nextGeminiKey) {
                saveOps.push(saveApiCredential('gemini', nextGeminiKey));
                providersToCheck.add('gemini');
            }
            if (nextClaudeKey) {
                saveOps.push(saveApiCredential('claude', nextClaudeKey));
                providersToCheck.add('claude');
            }

            await Promise.all(saveOps);

            // Add default models for newly literal providers if they don't have them
            for (const provider of providersToCheck) {
                const hasModel = priorityModels.some(m => m.provider === provider);
                if (!hasModel) {
                    const defaultModel = providerModels[provider];
                    try {
                        await addUserModel({
                            provider,
                            model: defaultModel,
                            reasoning: false
                        });
                    } catch (e) {
                        console.error(`Failed to add default model for ${provider}`, e);
                    }
                }
            }
            
            // Refresh models after potential additions
            const refreshModelData = await getUserModels();
            setPriorityModels(refreshModelData.models);

            const savedPriority = await saveModelPrioritySettings(priorityToSave);
            const reconciledSavedPriority = reconcilePriorityOrder(savedPriority.modelPriority, refreshModelData.models);
            setManualPriorityIds(reconciledSavedPriority);

            await updateStorage({
                aiModelPriority: reconciledSavedPriority,
            });

            try {
                const keyStatus = await getApiCredentialStatus();
                setSavedKeyProviders(keyStatus.providers);
            } catch {
                // Keep local state when credential status endpoint is unavailable.
            }

            setOpenaiKeyInput('');
            setGroqKeyInput('');
            setMistralKeyInput('');
            setNvidiaKeyInput('');
            setOpenrouterKeyInput('');
            setGeminiKeyInput('');
            setClaudeKeyInput('');

            setSaveState('saved');
            setTimeout(() => setSaveState('idle'), 1800);
        } catch (error) {
            setSaveState('idle');
            alert(error instanceof Error ? error.message : 'Failed to save settings.');
        }
    };

    const handleAddCustomModel = async () => {
        const model = newModelName.trim();
        if (!model) {
            setModelSaveState('error');
            setModelSaveMessage('Model name is required.');
            return;
        }

        if (newModelProvider !== 'puter' && !savedKeyProviders[newModelProvider]) {
            setModelSaveState('error');
            setModelSaveMessage(`Add a ${providerLabelMap[newModelProvider]} key first, then add models for it.`);
            return;
        }

        setModelSaveState('saving');
        setModelSaveMessage('');

        try {
            const response = await addUserModel({
                provider: newModelProvider,
                model,
                reasoning: newModelReasoning,
            });

            setPriorityModels(response.models);
            setManualPriorityIds((prev) => reconcilePriorityOrder(prev, response.models));
            setNewModelName('');
            setNewModelReasoning(false);
            setModelSaveState('idle');
            setModelSaveMessage('');
        } catch (error) {
            setModelSaveState('error');
            setModelSaveMessage(error instanceof Error ? error.message : 'Failed to add model.');
        }
    };

    const handleDeleteCustomModel = async (modelId: string) => {
        try {
            const response = await deleteUserModel(modelId);
            setPriorityModels(response.models);
            setManualPriorityIds((prev) => prev.filter((id) => id !== modelId));
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Failed to remove model.');
        }
    };

    const handlePriorityDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }

        setManualPriorityIds((prev) => {
            const oldIndex = prev.indexOf(String(active.id));
            const newIndex = prev.indexOf(String(over.id));
            if (oldIndex === -1 || newIndex === -1) {
                return prev;
            }
            return arrayMove(prev, oldIndex, newIndex);
        });
    };

    const handleRemoveSavedKey = async (provider: AiProvider) => {
        await saveApiCredential(provider, null);
        try {
            const keyStatus = await getApiCredentialStatus();
            setSavedKeyProviders(keyStatus.providers);
        } catch {
            setSavedKeyProviders((prev) => ({ ...prev, [provider]: false }));
        }
        setKeyInputMap[provider]('');
    };

    const handleConnectGoogleDrive = async () => {
        const response = await apiGet<{ authUrl: string }>('/drive/auth-url');
        window.location.href = response.authUrl;
    };

    const handleDisconnectGoogleDrive = async () => {
        setIsDisconnectingDrive(true);
        try {
            await apiDelete<{ ok: boolean; disconnected: boolean }>('/settings/storage-provider/google-drive');
            setDriveConnected(false);
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Failed to disconnect Google Drive.');
        } finally {
            setIsDisconnectingDrive(false);
        }
    };

    const handleTestProvider = async (provider: AiProvider) => {
        setApiTestState((prev) => ({ ...prev, [provider]: 'testing' }));
        setApiTestMessage((prev) => ({ ...prev, [provider]: '' }));

        try {
            const providerInputMap: Record<AiProvider, string> = {
                openai: openaiKeyInput,
                groq: groqKeyInput,
                mistral: mistralKeyInput,
                nvidia: nvidiaKeyInput,
                openrouter: openrouterKeyInput,
                gemini: geminiKeyInput,
                claude: claudeKeyInput,
                puter: '',
            };

            const testResult = await testApiConnectivity(
                provider,
                providerModels[provider],
                providerInputMap[provider].trim() || undefined
            );

            if (!testResult.ok) {
                setApiTestState((prev) => ({ ...prev, [provider]: 'error' }));
                setApiTestMessage((prev) => ({ ...prev, [provider]: testResult.error || 'Connection test failed.' }));
                return;
            }

            setApiTestState((prev) => ({ ...prev, [provider]: 'success' }));
            setApiTestMessage((prev) => ({
                ...prev,
                [provider]: `Connected in ${testResult.latencyMs ?? 0}ms using model ${testResult.model || providerModels[provider]}.`,
            }));
        } catch (error) {
            setApiTestState((prev) => ({ ...prev, [provider]: 'error' }));
            setApiTestMessage((prev) => ({
                ...prev,
                [provider]: error instanceof Error ? error.message : 'Connection test failed.',
            }));
        }
    };

    const handleTestPuter = async () => {
        setPuterState('testing');
        setPuterMessage('');

        try {
            if (!isPuterAvailable()) {
                throw new Error('Puter.js is not available in this browser session. Reload the app and try again.');
            }

            // Before testing Puter, ensure its default model is at least registered
            // if it doesn't exist yet, so it can be used for normal operation.
            const hasPuterModel = priorityModels.some(m => m.provider === 'puter');
            if (!hasPuterModel) {
                try {
                    const response = await addUserModel({
                        provider: 'puter',
                        model: providerModels.puter,
                        reasoning: false
                    });
                    setPriorityModels(response.models);
                } catch (e) {
                    console.error('Failed to add default Puter model during test.', e);
                }
            }

            const response = await puterChat('Reply in 12 words: confirm Puter is connected.', {
                model: 'gpt-oss-120b',
            });

            const text = response.trim();
            setPuterState('success');
            setPuterMessage(text || 'Puter is connected and returned an empty response.');
        } catch (error) {
            setPuterState('error');
            setPuterMessage(error instanceof Error ? error.message : 'Puter test failed.');
        }
    };

    const renderSaveSettingsButton = (withId: boolean) => (
        <button
            id={withId ? 'save-provider-key-btn' : undefined}
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="btn-primary h-11 px-4 inline-flex items-center justify-center gap-2"
            aria-label={saveState === 'saved' ? 'Settings saved' : saveState === 'saving' ? 'Saving settings' : 'Save settings'}
            title={saveState === 'saved' ? 'Saved!' : saveState === 'saving' ? 'Saving...' : 'Save Settings'}
            style={{
                background: saveState === 'saved' ? '#10b981' : undefined,
                color: '#ffffff',
            }}
        >
            {saveState === 'saved' ? (
                <CheckCircle2 className="w-4 h-4" color="#ffffff" />
            ) : (
                <Save className={`w-4 h-4${saveState === 'saving' ? ' animate-pulse' : ''}`} color="#ffffff" />
            )}
            <span className="text-sm font-semibold tracking-wide text-white">
                {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving' : 'Save'}
            </span>
        </button>
    );

    return (
        <div className="container mx-auto px-3 py-4 sm:px-4 sm:py-8">
            <div className="animate-slide-up max-w-5xl mx-auto space-y-5">
                <div ref={topSaveSentinelRef} aria-hidden="true" style={{ height: 1 }} />
                <div>
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <span className="section-eyebrow">Configuration</span>
                            <h2 className="section-title text-2xl sm:text-3xl mt-1">Settings</h2>
                        </div>
                        <div
                            className="hidden sm:flex justify-end transition-opacity duration-300"
                            style={{
                                opacity: showFloatingSave ? 0 : 1,
                                pointerEvents: showFloatingSave ? 'none' : 'auto',
                            }}
                        >
                            {renderSaveSettingsButton(true)}
                        </div>
                    </div>
                    <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                        Set your daily revision time budget, AI keys, and storage preferences.
                    </p>
                    <div
                        className="sm:hidden flex justify-end mt-3 transition-opacity duration-300"
                        style={{
                            opacity: showFloatingSave ? 0 : 1,
                            pointerEvents: showFloatingSave ? 'none' : 'auto',
                        }}
                    >
                        {renderSaveSettingsButton(true)}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="glass-card p-4">
                        <button
                            type="button"
                            onClick={() => setOpenSection((prev) => (prev === 'appearance' ? null : 'appearance'))}
                            className="w-full flex items-center justify-between gap-3 text-left"
                            aria-expanded={openSection === 'appearance'}
                        >
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                    style={{ background: 'rgba(6,182,212,0.10)', border: '1px solid var(--border-subtle)' }}
                                >
                                    <Palette className="w-4 h-4" style={{ color: 'var(--accent-secondary)' }} />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Appearance</p>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Theme preferences</p>
                                </div>
                            </div>
                            <ChevronDown
                                className="w-4 h-4 transition-transform"
                                style={{ color: 'var(--text-secondary)', transform: openSection === 'appearance' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                            />
                        </button>

                        {openSection === 'appearance' && (
                            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
                                    {[
                                        { label: 'Light', mode: 'light' as const, previewDark: false },
                                        { label: 'Dark', mode: 'dark' as const, previewDark: true },
                                        { label: 'Auto', mode: 'auto' as const, previewDark: theme === 'dark' },
                                    ].map((t) => (
                                        <button
                                            key={t.label}
                                            id={t.mode === 'dark' ? 'toggle-appearance-btn' : undefined}
                                            onClick={() => onSetThemeMode(t.mode)}
                                            className="rounded-xl p-3 text-left transition-all"
                                            style={{
                                                background: t.mode === 'auto'
                                                    ? 'linear-gradient(135deg, #f8fafc 0%, #0f172a 100%)'
                                                    : t.previewDark
                                                        ? '#0f172a'
                                                        : '#f8fafc',
                                                border: `2px solid ${
                                                    t.mode === themeMode
                                                        ? 'var(--accent-primary)'
                                                        : 'var(--border-subtle)'
                                                }`,
                                            }}
                                        >
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs font-semibold" style={{ color: t.mode === 'auto' || t.previewDark ? '#f1f5f9' : '#0f172a' }}>
                                                    {t.label}
                                                </p>
                                                {t.mode === 'auto' ? (
                                                    <Clock3 className="w-4 h-4" style={{ color: '#e2e8f0' }} />
                                                ) : t.previewDark ? (
                                                    <Moon className="w-4 h-4" style={{ color: '#e2e8f0' }} />
                                                ) : (
                                                    <Sun className="w-4 h-4" style={{ color: '#0f172a' }} />
                                                )}
                                            </div>
                                            {t.mode === 'auto' && (
                                                <p className="mt-2 text-[11px]" style={{ color: '#cbd5e1' }}>
                                                    Light: 07:00-18:59
                                                </p>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="glass-card p-4">
                    <button
                        type="button"
                        onClick={() => setOpenSection((prev) => (prev === 'user-information' ? null : 'user-information'))}
                        className="w-full flex items-center justify-between gap-3 text-left"
                        aria-expanded={openSection === 'user-information'}
                    >
                        <div className="flex items-center gap-2">
                            <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ background: 'rgba(14,165,233,0.10)', border: '1px solid var(--border-subtle)' }}
                            >
                                <GraduationCap className="w-4 h-4" style={{ color: '#0ea5e9' }} />
                            </div>
                            <div>
                                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Revision Settings</p>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Language, time limit, revision profile</p>
                            </div>
                        </div>
                        <ChevronDown
                            className="w-4 h-4 transition-transform"
                            style={{ color: 'var(--text-secondary)', transform: openSection === 'user-information' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        />
                    </button>

                    {openSection === 'user-information' && (
                        <div className="mt-4 pt-4 space-y-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <div className="rounded-xl p-4 space-y-4" style={subsectionPanelStyle}>
                                <div className="flex items-center gap-2">
                                    <Languages className="w-4 h-4" style={{ color: '#0ea5e9' }} />
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Language</p>
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="ai-language" className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                        AI Language
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <Languages
                                            className="w-4 h-4 shrink-0"
                                            style={{ color: 'var(--text-muted)' }}
                                        />
                                        <select
                                            id="ai-language"
                                            value={aiLanguage}
                                            onChange={(e) => setAiLanguage(e.target.value)}
                                            className="input-field"
                                            style={{ flex: 1 }}
                                        >
                                            {['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Arabic', 'Turkish', 'Persian', 'Hindi', 'Japanese', 'Korean', 'Chinese (Simplified)'].map((lang) => (
                                                <option key={lang} value={lang}>{lang}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                        Questions, grading answers, and tutor chat will be generated in this language.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-xl p-4 space-y-4" style={subsectionPanelStyle}>
                                <div className="flex items-center gap-2">
                                    <Clock3 className="w-4 h-4" style={{ color: 'var(--accent-secondary)' }} />
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Daily Revision Budget</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-3 items-end">
                                    <div>
                                        <label htmlFor="daily-revision-limit" className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                            Daily time limit (minutes)
                                        </label>
                                        <input
                                            id="daily-revision-limit"
                                            type="range"
                                            min={10}
                                            max={300}
                                            step={5}
                                            value={dailyRevisionMinutesLimit}
                                            onChange={(e) => setDailyRevisionMinutesLimit(clampDailyLimit(Number(e.target.value)))}
                                            className="w-full mt-2"
                                        />
                                    </div>
                                    <input
                                        type="number"
                                        min={10}
                                        max={300}
                                        value={dailyRevisionMinutesLimit}
                                        onChange={(e) => setDailyRevisionMinutesLimit(clampDailyLimit(Number(e.target.value)))}
                                        className="input-field"
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-3 items-end">
                                    <div>
                                        <label htmlFor="max-topics-day" className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                            Max topics per day
                                        </label>
                                        <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                                            Limits how many topics you review daily. Helps prevent burnout.
                                        </p>
                                    </div>
                                    <input
                                        id="max-topics-day"
                                        type="number"
                                        min={1}
                                        max={20}
                                        value={maxTopicsPerDay}
                                        onChange={(e) => setMaxTopicsPerDay(Math.max(1, Math.min(20, Number(e.target.value))))}
                                        className="input-field"
                                    />
                                </div>

                                <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                                    <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
                                        <span>Today</span>
                                        <span>{todayMinutesSpent}/{dailyRevisionMinutesLimit} min</span>
                                    </div>
                                    <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'rgba(16,185,129,0.12)', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${spendPct}%`, background: 'var(--accent-primary)', borderRadius: 999, transition: 'width 250ms ease' }} />
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-xl p-4 space-y-4" style={subsectionPanelStyle}>
                                <div className="flex items-center gap-2">
                                    <Zap className="w-4 h-4" style={{ color: '#fbbf24' }} />
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Lightning Review</p>
                                </div>
                                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                    Quick review mode with 1 question per topic. Great for busy days or rapid refreshers.
                                </p>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Enable Lightning button</span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={lightningReviewEnabled}
                                        onClick={() => setLightningReviewEnabled((prev) => !prev)}
                                        className="relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors"
                                        style={{ background: lightningReviewEnabled ? '#fbbf24' : 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                                    >
                                        <span
                                            className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                                            style={{ transform: lightningReviewEnabled ? 'translateX(22px)' : 'translateX(2px)', margin: '3px 0 0 0' }}
                                        />
                                    </button>
                                </div>
                            </div>

                            <div className="rounded-xl p-4 space-y-4" style={subsectionPanelStyle}>
                                <div className="flex items-center gap-2">
                                    <GraduationCap className="w-4 h-4" style={{ color: '#0ea5e9' }} />
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Learner Profile</p>
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="student-education-level" className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                        Education Level
                                    </label>
                                    <input
                                        id="student-education-level"
                                        type="text"
                                        value={studentEducationLevel}
                                        onChange={(e) => setStudentEducationLevel(e.target.value)}
                                        placeholder="high school, master's in physics, PhD in CS..."
                                        className="input-field"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label htmlFor="student-major" className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                        Major / Specialization
                                    </label>
                                    <input
                                        id="student-major"
                                        type="text"
                                        value={studentMajor}
                                        onChange={(e) => setStudentMajor(e.target.value)}
                                        placeholder="Computer Science, Physics, Medicine..."
                                        className="input-field"
                                    />
                                </div>

                            </div>

                            <div className="rounded-xl p-4 space-y-4" style={subsectionPanelStyle}>
                                <div className="flex items-center gap-2">
                                    <Zap className="w-4 h-4" style={{ color: '#f59e0b' }} />
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Question Difficulty</p>
                                </div>
                                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                    Controls how challenging the AI's questions are for each revision session.
                                </p>
                                <div className="grid grid-cols-1 gap-2">
                                    {([
                                        { value: 'doesnt_matter', label: "Doesn't Matter", desc: 'No difficulty instruction is added to the prompt.' },
                                        { value: 'easy', label: 'Easy', desc: 'Introductory questions testing basic recall and understanding.' },
                                        { value: 'medium', label: 'Medium', desc: 'Questions requiring reasoning and application of concepts.' },
                                        { value: 'hard', label: 'Hard', desc: 'Advanced questions requiring deep understanding and synthesis.' },
                                        { value: 'auto', label: 'Auto', desc: 'Starts easy for new topics, ramps up as you review more and perform better.' },
                                    ] as { value: QuestionDifficulty; label: string; desc: string }[]).map(({ value, label, desc }) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setQuestionDifficulty(value)}
                                            className="w-full text-left rounded-lg px-4 py-3.5 transition-all"
                                            style={{
                                                background: questionDifficulty === value ? 'rgba(245,158,11,0.10)' : 'var(--bg-elevated)',
                                                border: `1px solid ${questionDifficulty === value ? '#f59e0b' : 'var(--border-subtle)'}`,
                                            }}
                                        >
                                            <p className="text-sm font-semibold" style={{ color: questionDifficulty === value ? '#f59e0b' : 'var(--text-primary)' }}>{label}</p>
                                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-xl p-4 space-y-4" style={subsectionPanelStyle}>
                                <div className="flex items-center gap-2">
                                    <Bell className="w-4 h-4" style={{ color: '#8b5cf6' }} />
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Revision Reminder</p>
                                </div>
                                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                    Get a daily push notification to remind you to revise. Works on Mac, Windows, Android, and iOS (when installed as a PWA).
                                </p>

                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Enable daily reminder</span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={revisionReminderEnabled}
                                        onClick={() => setRevisionReminderEnabled((prev) => !prev)}
                                        className="relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors"
                                        style={{ background: revisionReminderEnabled ? '#8b5cf6' : 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                                    >
                                        <span
                                            className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                                            style={{ transform: revisionReminderEnabled ? 'translateX(22px)' : 'translateX(2px)', margin: '3px 0 0 0' }}
                                        />
                                    </button>
                                </div>

                                {revisionReminderEnabled && (
                                    <div className="space-y-2">
                                        <label htmlFor="reminder-time" className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                            Reminder time
                                        </label>
                                        <input
                                            id="reminder-time"
                                            type="time"
                                            value={revisionReminderTime}
                                            onChange={(e) => setRevisionReminderTime(e.target.value)}
                                            className="input-field"
                                            style={{ maxWidth: 140 }}
                                        />
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                            Notification permission:&nbsp;
                                            <span style={{ color: notifPermission === 'granted' ? 'var(--accent-primary)' : notifPermission === 'denied' ? '#ef4444' : 'var(--text-secondary)', fontWeight: 600 }}>
                                                {notifPermission === 'granted' ? 'Granted' : notifPermission === 'denied' ? 'Denied' : 'Not granted'}
                                            </span>
                                        </span>
                                    </div>
                                    {notifPermission !== 'granted' && (
                                        <button
                                            type="button"
                                            className="btn-secondary text-sm"
                                            disabled={notifSubState === 'subscribing'}
                                            onClick={async () => {
                                                setNotifSubState('subscribing');
                                                setNotifSubMessage('');
                                                try {
                                                    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
                                                        setNotifSubState('error');
                                                        setNotifSubMessage('Push notifications are not supported in this browser.');
                                                        return;
                                                    }
                                                    const permission = await Notification.requestPermission();
                                                    setNotifPermission(permission);
                                                    if (permission !== 'granted') {
                                                        setNotifSubState('error');
                                                        setNotifSubMessage('Permission denied. Please enable notifications in your browser settings.');
                                                        return;
                                                    }
                                                    const vapidData = await apiGet<{ publicKey: string }>('/push/vapid-key');
                                                    const sub = await doSubscribe(vapidData.publicKey);
                                                    const subJson = sub.toJSON() as unknown as Record<string, unknown>;
                                                    await Promise.all([
                                                        apiPost('/push/subscribe', { ...subJson, utcOffsetMinutes: -new Date().getTimezoneOffset() }),
                                                        updateStorage({ revisionReminderEnabled: true, revisionReminderTime }),
                                                    ]);
                                                    setRevisionReminderEnabled(true);
                                                    setNotifSubState('subscribed');
                                                    setNotifSubMessage('Subscribed! Notifications will fire at your chosen time.');
                                                } catch (err: any) {
                                                    setNotifSubState('error');
                                                    setNotifSubMessage(err?.message || 'Failed to subscribe to notifications.');
                                                }
                                            }}
                                        >
                                            {notifSubState === 'subscribing' ? 'Requesting…' : 'Request Permission & Subscribe'}
                                        </button>
                                    )}
                                    {notifPermission === 'granted' && notifSubState !== 'subscribed' && (
                                        <button
                                            type="button"
                                            className="btn-secondary text-sm"
                                            disabled={notifSubState === 'subscribing'}
                                            onClick={async () => {
                                                setNotifSubState('subscribing');
                                                setNotifSubMessage('');
                                                try {
                                                    const vapidData = await apiGet<{ publicKey: string }>('/push/vapid-key');
                                                    const sub = await doSubscribe(vapidData.publicKey);
                                                    const subJson = sub.toJSON() as unknown as Record<string, unknown>;
                                                    await Promise.all([
                                                        apiPost('/push/subscribe', { ...subJson, utcOffsetMinutes: -new Date().getTimezoneOffset() }),
                                                        updateStorage({ revisionReminderEnabled: true, revisionReminderTime }),
                                                    ]);
                                                    setRevisionReminderEnabled(true);
                                                    setNotifSubState('subscribed');
                                                    setNotifSubMessage('Subscribed! Notifications will fire at your chosen time.');
                                                } catch (err: any) {
                                                    setNotifSubState('error');
                                                    setNotifSubMessage(err?.message || 'Failed to subscribe.');
                                                }
                                            }}
                                        >
                                            {notifSubState === 'subscribing' ? 'Subscribing…' : 'Enable Push Notifications'}
                                        </button>
                                    )}
                                    {notifSubState === 'subscribed' && (
                                        <div className="flex items-center gap-1.5">
                                            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                                            <span className="text-[11px]" style={{ color: 'var(--accent-primary)' }}>Push notifications enabled</span>
                                        </div>
                                    )}
                                    {notifSubMessage && notifSubState !== 'subscribed' && (
                                        <p className="text-[11px]" style={{ color: notifSubState === 'error' ? '#ef4444' : 'var(--text-muted)' }}>{notifSubMessage}</p>
                                    )}
                                    {notifPermission === 'denied' && (
                                        <p className="text-[11px]" style={{ color: '#ef4444' }}>
                                            Notifications are blocked. Please allow them in your browser/OS settings, then reload the page.
                                        </p>
                                    )}
                                </div>

                                {notifPermission === 'granted' && notifSubState === 'subscribed' && (
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            className="btn-secondary text-xs flex items-center gap-1.5"
                                            disabled={notifTestState === 'sending'}
                                            onClick={async () => {
                                                setNotifTestState('sending');
                                                try {
                                                    await apiPost('/push/test', {});
                                                    setNotifTestState('sent');
                                                    setTimeout(() => setNotifTestState('idle'), 4000);
                                                } catch (err: any) {
                                                    setNotifTestState('error');
                                                    setTimeout(() => setNotifTestState('idle'), 4000);
                                                }
                                            }}
                                        >
                                            <Bell className="w-3.5 h-3.5" />
                                            {notifTestState === 'sending' ? 'Sending…' : notifTestState === 'sent' ? 'Sent!' : notifTestState === 'error' ? 'Failed' : 'Send Test Notification'}
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-secondary text-xs flex items-center gap-1.5"
                                            onClick={async () => {
                                                try {
                                                    const reg = await navigator.serviceWorker.ready;
                                                    const sub = await reg.pushManager.getSubscription();
                                                    if (sub) {
                                                        await apiPost('/push/unsubscribe', { endpoint: sub.endpoint });
                                                        await sub.unsubscribe();
                                                    }
                                                    setNotifSubState('idle');
                                                    setNotifSubMessage('');
                                                } catch { /* ignore */ }
                                            }}
                                        >
                                            <BellOff className="w-3.5 h-3.5" />
                                            Unsubscribe
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="glass-card p-4" id="settings-section-ai-models">
                    <button
                        type="button"
                        onClick={() => setOpenSection((prev) => (prev === 'ai-models' ? null : 'ai-models'))}
                        className="w-full flex items-center justify-between gap-3 text-left"
                        aria-expanded={openSection === 'ai-models'}
                    >
                        <div className="flex items-center gap-2">
                            <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid var(--border-subtle)' }}
                            >
                                <Bot className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                            </div>
                            <div>
                                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>AI Models</p>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Keys, model list, and priority order</p>
                            </div>
                        </div>
                        <ChevronDown
                            className="w-4 h-4 transition-transform"
                            style={{ color: 'var(--text-secondary)', transform: openSection === 'ai-models' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        />
                    </button>

                    {openSection === 'ai-models' && (
                        <div className="mt-4 pt-4 space-y-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <div className="rounded-xl p-4 space-y-4" style={subsectionPanelStyle}>
                                <div className="flex items-center gap-2">
                                    <KeyRound className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>AI Keys</p>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {(['openai', 'groq', 'mistral', 'nvidia', 'openrouter', 'gemini', 'claude', 'puter'] as AiProvider[]).map((provider) => (
                                        <button
                                            key={provider}
                                            type="button"
                                            onClick={() => setActiveKeyProvider(provider)}
                                            className="px-3 py-2.5 rounded-full text-sm font-semibold transition-all"
                                            style={{
                                                background: activeKeyProvider === provider ? 'rgba(16,185,129,0.12)' : 'var(--bg-elevated)',
                                                border: `1px solid ${activeKeyProvider === provider ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                                                color: activeKeyProvider === provider ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                            }}
                                        >
                                            <span className="inline-flex items-center gap-1.5">
                                                {renderProviderBadge(provider)}
                                                {providerLabelMap[provider]}
                                            </span>
                                        </button>
                                    ))}
                                </div>

                                {activeKeyProvider === 'puter' ? (
                                    <div className="space-y-3">
                                        <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                                SDK status: {isPuterAvailable() ? 'Loaded' : 'Not loaded'}
                                            </p>
                                            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                                                Puter provides free AI access without requiring an API key.
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                className="btn-secondary text-sm"
                                                onClick={handleTestPuter}
                                                disabled={puterState === 'testing'}
                                            >
                                                {puterState === 'testing' ? 'Testing Puter…' : 'Test Puter AI'}
                                            </button>
                                        </div>
                                        {puterMessage && (
                                            <p
                                                className="text-[11px]"
                                                style={{ color: puterState === 'success' ? 'var(--accent-primary)' : '#ef4444' }}
                                            >
                                                {puterMessage}
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <label htmlFor="active-provider-key-input" className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                            {providerLabelMap[activeKeyProvider]} API Key
                                        </label>
                                        <textarea
                                            id="active-provider-key-input"
                                            value={keyInputMap[activeKeyProvider]}
                                            onChange={(e) => setKeyInputMap[activeKeyProvider](e.target.value)}
                                            placeholder={savedKeyProviders[activeKeyProvider]
                                                ? 'A key is already stored securely. Paste a new key only if you want to replace it.'
                                                : `Paste your ${providerLabelMap[activeKeyProvider]} API key here...`}
                                            className="textarea-field min-h-[90px] font-mono"
                                            style={{ letterSpacing: '0.02em' }}
                                        />
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                className="btn-secondary text-sm"
                                                onClick={() => handleTestProvider(activeKeyProvider)}
                                                disabled={apiTestState[activeKeyProvider] === 'testing'}
                                            >
                                                {apiTestState[activeKeyProvider] === 'testing'
                                                    ? 'Testing…'
                                                    : `Test ${providerLabelMap[activeKeyProvider]} API`}
                                            </button>
                                            {savedKeyProviders[activeKeyProvider] && (
                                                <button
                                                    type="button"
                                                    className="btn-secondary text-sm"
                                                    onClick={() => handleRemoveSavedKey(activeKeyProvider)}
                                                >
                                                    Remove Saved Key
                                                </button>
                                            )}
                                        </div>
                                        {savedKeyProviders[activeKeyProvider] && (
                                            <p className="text-[11px]" style={{ color: 'var(--accent-primary)' }}>
                                                Stored securely on server.
                                            </p>
                                        )}
                                        {apiTestMessage[activeKeyProvider] && (
                                            <p
                                                className="text-[11px]"
                                                style={{ color: apiTestState[activeKeyProvider] === 'success' ? 'var(--accent-primary)' : '#ef4444' }}
                                        >
                                                {apiTestMessage[activeKeyProvider]}
                                            </p>
                                        )}
                                    </div>
                                )}

                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                    Keys are encrypted at rest and used only by the server during AI requests.
                                </p>
                            </div>

                            <div className="rounded-xl p-4 space-y-4" style={subsectionPanelStyle}>
                                <div className="flex items-center gap-2">
                                    <Bot className="w-4 h-4" style={{ color: '#f59e0b' }} />
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>My Models</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-end">
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Provider</label>
                                        <select
                                            value={newModelProvider}
                                            onChange={(e) => setNewModelProvider(e.target.value as ModelProvider)}
                                            className="input-field"
                                        >
                                            {modelProviderOptions.map((provider) => (
                                                <option key={provider} value={provider}>
                                                    {providerLabelMap[provider]}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Model Name</label>
                                        <input
                                            type="text"
                                            value={newModelName}
                                            onChange={(e) => setNewModelName(e.target.value)}
                                            placeholder="e.g. gpt-5.4-nano or openai/gpt-oss-120b"
                                            className="input-field"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        className="btn-secondary gap-2 h-10"
                                        onClick={handleAddCustomModel}
                                        disabled={modelSaveState === 'saving'}
                                    >
                                        <Plus className="w-4 h-4" />
                                        {modelSaveState === 'saving' ? 'Adding…' : 'Add'}
                                    </button>
                                </div>

                                <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={newModelReasoning}
                                        onChange={(e) => setNewModelReasoning(e.target.checked)}
                                    />
                                    Reasoning model
                                </label>

                                {modelSaveMessage && (
                                    <p className="text-[11px]" style={{ color: modelSaveState === 'error' ? '#ef4444' : 'var(--text-secondary)' }}>
                                        {modelSaveMessage}
                                    </p>
                                )}

                                {priorityState === 'loading' && (
                                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Loading your models…</p>
                                )}

                                {priorityState === 'error' && (
                                    <p className="text-xs" style={{ color: '#ef4444' }}>{priorityMessage || 'Failed to load models.'}</p>
                                )}

                                {priorityState !== 'loading' && manualPriorityIds.length === 0 && (
                                    <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                                        No models added yet. Add your first model above.
                                    </div>
                                )}

                                {manualPriorityIds.length > 0 && (
                                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePriorityDragEnd}>
                                        <SortableContext items={manualPriorityIds} strategy={verticalListSortingStrategy}>
                                            <div className="space-y-2">
                                                {manualPriorityIds.map((id, index) => {
                                                    const candidate = priorityModels.find((item) => item.id === id);
                                                    if (!candidate) {
                                                        return null;
                                                    }

                                                    return (
                                                        <SortableModelRow
                                                            key={candidate.id}
                                                            model={candidate}
                                                            index={index}
                                                            providerLabel={providerLabelMap[candidate.provider]}
                                                            providerBadge={renderProviderBadge(candidate.provider, 'w-3 h-3')}
                                                            isPriorityEnabled={candidate.provider === 'puter' ? isPuterAvailable() : savedKeyProviders[candidate.provider]}
                                                            onDelete={handleDeleteCustomModel}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </SortableContext>
                                    </DndContext>
                                )}

                                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                    Drag to reorder priority. On mobile, long-press the drag handle first. Save Settings to persist changes.
                                </p>
                            </div>

                        </div>
                    )}
                </div>

                <div className="glass-card p-4" id="settings-section-storage">
                    <button
                        type="button"
                        onClick={() => setOpenSection((prev) => (prev === 'storage' ? null : 'storage'))}
                        className="w-full flex items-center justify-between gap-3 text-left"
                        aria-expanded={openSection === 'storage'}
                    >
                        <div className="flex items-center gap-2">
                            <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid var(--border-subtle)' }}
                            >
                                <HardDrive className="w-4 h-4" style={{ color: '#3b82f6' }} />
                            </div>
                            <div>
                                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Storage</p>
                                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>File storage provider and folder settings</p>
                            </div>
                        </div>
                        <ChevronDown
                            className="w-4 h-4 transition-transform"
                            style={{ color: 'var(--text-secondary)', transform: openSection === 'storage' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        />
                    </button>

                    {openSection === 'storage' && (
                        <div className="mt-4 pt-4 space-y-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <div className="space-y-2">
                                <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                    Storage Provider
                                </label>
                                <div className="input-field" style={{ display: 'flex', alignItems: 'center' }}>
                                    Google Drive
                                </div>
                            </div>

                            <div
                                className="rounded-xl p-3 flex flex-col gap-4"
                                style={subsectionPanelStyle}
                            >
                                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                    {isLoadingDriveStatus
                                        ? 'Checking Google Drive connection...'
                                        : !driveReady
                                        ? 'Google Drive OAuth is not configured on the server yet.'
                                        : driveConnected
                                            ? 'Google Drive is connected for this account.'
                                            : 'Connect your Google Drive account to upload files there.'}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className="btn-secondary gap-2"
                                        onClick={handleConnectGoogleDrive}
                                        disabled={isLoadingDriveStatus || !driveReady}
                                    >
                                        {isLoadingDriveStatus ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Checking...
                                            </>
                                        ) : (
                                            <>
                                                <Cloud className="w-4 h-4" />
                                                {driveConnected ? 'Reconnect Drive' : 'Connect Drive'}
                                            </>
                                        )}
                                    </button>
                                    {driveConnected && (
                                        <button
                                            type="button"
                                            className="btn-secondary gap-2"
                                            onClick={handleDisconnectGoogleDrive}
                                            disabled={isDisconnectingDrive}
                                            style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                                        >
                                            {isDisconnectingDrive ? 'Disconnecting...' : 'Disconnect Drive'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[90] transition-all duration-300"
                    style={{
                        opacity: showFloatingSave ? 1 : 0,
                        transform: showFloatingSave ? 'translateY(0)' : 'translateY(6px)',
                        pointerEvents: showFloatingSave ? 'auto' : 'none',
                    }}
                >
                    <div
                        className="rounded-2xl p-2 shadow-lg"
                        style={{
                            background: 'color-mix(in srgb, var(--bg-surface-raised) 88%, transparent)',
                            border: '1px solid var(--border-subtle)',
                            backdropFilter: 'blur(8px)',
                        }}
                    >
                        {renderSaveSettingsButton(false)}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
