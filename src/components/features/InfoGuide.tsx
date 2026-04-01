import React, { useState } from 'react';
import { ChevronDown, ExternalLink, KeyRound, Sparkles } from 'lucide-react';

const overviewStepCardStyle: React.CSSProperties = {
    background: 'var(--bg-surface-raised)',
    border: '1px solid var(--border-default)',
    borderRadius: 14,
    padding: 14,
};

const providerCardStyle: React.CSSProperties = {
    background: 'var(--bg-surface-raised)',
    border: '1px solid var(--border-default)',
    borderRadius: 14,
    padding: 14,
};

const providers = [
    {
        name: 'Groq',
        preferred: true,
        summary: 'Fast and reliable for this app. Lowest friction path for setup and testing.',
        keyUrl: 'https://console.groq.com/keys',
        modelsUrl: 'https://console.groq.com/docs/models',
    },
    {
        name: 'OpenAI',
        preferred: false,
        summary: 'Official OpenAI API provider for GPT-family models.',
        keyUrl: 'https://platform.openai.com/api-keys',
        modelsUrl: 'https://platform.openai.com/docs/models',
    },
    {
        name: 'Mistral',
        preferred: false,
        summary: 'Strong open-weight and hosted model options from Mistral.',
        keyUrl: 'https://console.mistral.ai/api-keys',
        modelsUrl: 'https://docs.mistral.ai/getting-started/models/models_overview/',
    },
    {
        name: 'NVIDIA',
        preferred: false,
        summary: 'NVIDIA-hosted inference endpoints via NVIDIA Build.',
        keyUrl: 'https://build.nvidia.com/',
        modelsUrl: 'https://build.nvidia.com/explore/discover',
    },
    {
        name: 'OpenRouter',
        preferred: false,
        summary: 'One API for many model vendors and routing choices.',
        keyUrl: 'https://openrouter.ai/keys',
        modelsUrl: 'https://openrouter.ai/models',
    },
    {
        name: 'Gemini (Google AI)',
        preferred: false,
        summary: 'Google Gemini endpoints with broad model family support.',
        keyUrl: 'https://aistudio.google.com/app/apikey',
        modelsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    },
    {
        name: 'Claude (Anthropic)',
        preferred: false,
        summary: 'Anthropic Claude models for high-quality reasoning and writing.',
        keyUrl: 'https://console.anthropic.com/settings/keys',
        modelsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
    },
    {
        name: 'Puter.js',
        preferred: false,
        summary: 'Client-side Puter integration. No API key required in this app flow.',
        keyUrl: 'https://developer.puter.com/',
        modelsUrl: 'https://developer.puter.com/tutorials/free-unlimited-openrouter-api/',
    },
];

const appOverviewSteps = [
    {
        title: 'Distill your topics',
        description: 'Add your own summary or upload source material, then link related topics to build context.',
    },
    {
        title: 'Practice with Socratic questions',
        description: 'The coach asks conceptual, applied, and connection questions so you explain ideas, not just definitions.',
    },
    {
        title: 'Get scored and scheduled',
        description: 'Answers are graded, mastery is updated, and FSRS schedules your next best review automatically.',
    },
];

export const InfoGuide: React.FC = () => {
    const [openSection, setOpenSection] = useState<'overview' | 'keys' | null>(null);

    const toggleSection = (section: 'overview' | 'keys') => {
        setOpenSection((current) => (current === section ? null : section));
    };

    const sectionBaseClass = 'rounded-2xl border overflow-hidden';

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="animate-slide-up max-w-5xl mx-auto space-y-5 pb-2">
                <div>
                    <span className="section-eyebrow">Guide</span>
                    <h2 className="section-title text-3xl mt-1">How AntiForget Works</h2>
                    <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                        A clean walkthrough of setup, providers, and the learning loop.
                    </p>
                </div>

                <section className={sectionBaseClass} style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
                <button
                    type="button"
                    onClick={() => toggleSection('overview')}
                    className="w-full px-4 py-4 flex items-center gap-3 text-left"
                    aria-expanded={openSection === 'overview'}
                >
                    <span
                        className="w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center"
                        style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
                    >
                        1
                    </span>
                    <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                    <h3 className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>App overview</h3>
                    <ChevronDown
                        className={`w-4 h-4 transition-transform ${openSection === 'overview' ? 'rotate-180' : ''}`}
                        style={{ color: 'var(--text-secondary)' }}
                    />
                </button>
                <div
                    className={`grid transition-all duration-300 ${openSection === 'overview' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                >
                    <div className="overflow-hidden">
                        <div className="px-4 pb-4 border-t space-y-3" style={{ borderColor: 'var(--border-default)' }}>
                            {appOverviewSteps.map((step, index) => (
                                <div key={step.title} className="flex items-start gap-3 pt-3">
                                    <div
                                        className="w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center mt-0.5"
                                        style={{
                                            color: 'var(--text-on-accent)',
                                            background: 'var(--accent-primary)',
                                        }}
                                    >
                                        {index + 1}
                                    </div>
                                    <div style={overviewStepCardStyle} className="flex-1">
                                        <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{step.title}</p>
                                        <p className="text-xs mt-1 leading-5" style={{ color: 'var(--text-secondary)' }}>
                                            {step.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className={sectionBaseClass} style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
                <button
                    type="button"
                    onClick={() => toggleSection('keys')}
                    className="w-full px-4 py-4 flex items-center gap-3 text-left"
                    aria-expanded={openSection === 'keys'}
                >
                    <span
                        className="w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center"
                        style={{ background: '#f59e0b', color: '#111827' }}
                    >
                        2
                    </span>
                    <KeyRound className="w-4 h-4" style={{ color: '#f59e0b' }} />
                    <h3 className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>How to get API keys</h3>
                    <ChevronDown
                        className={`w-4 h-4 transition-transform ${openSection === 'keys' ? 'rotate-180' : ''}`}
                        style={{ color: 'var(--text-secondary)' }}
                    />
                </button>
                <div
                    className={`grid transition-all duration-300 ${openSection === 'keys' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                >
                    <div className="overflow-hidden">
                        <div className="px-4 pb-4 border-t space-y-4" style={{ borderColor: 'var(--border-default)' }}>
                            <ol className="list-decimal pl-4 text-xs leading-6 pt-3" style={{ color: 'var(--text-secondary)' }}>
                                <li>Start with Groq for the easiest setup and fast responses.</li>
                                <li>Open your provider dashboard and create a new API key.</li>
                                <li>Paste the key in Settings and select your model.</li>
                            </ol>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {providers.map((provider) => (
                                    <div key={provider.name} style={providerCardStyle} className="space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                                {provider.name}
                                            </p>
                                            {provider.preferred && (
                                                <span
                                                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                                    style={{
                                                        color: '#065f46',
                                                        background: 'rgba(16, 185, 129, 0.14)',
                                                        border: '1px solid rgba(16, 185, 129, 0.25)',
                                                    }}
                                                >
                                                    Preferred
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                                            {provider.summary}
                                        </p>
                                        <div className="flex flex-wrap gap-3 pt-1">
                                            <a
                                                href={provider.keyUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
                                                style={{ color: 'var(--accent-primary)' }}
                                            >
                                                Get key
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                            <a
                                                href={provider.modelsUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
                                                style={{ color: 'var(--accent-secondary)' }}
                                            >
                                                Browse models
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    </div>
    );
};
