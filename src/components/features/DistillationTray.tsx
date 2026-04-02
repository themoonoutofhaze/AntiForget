import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, CheckCircle, Trash2, Pencil, ArrowLeft } from 'lucide-react';
import { savePdfBlob, deletePdfBlob } from '../../utils/idb';
import { createNode, getStorage, updateStorage } from '../../utils/storage';
import type { GraphNode } from '../../utils/storage';

type DistillationTrayProps = {
    onTopicModeActiveChange?: (isActive: boolean) => void;
};

export const DistillationTray: React.FC<DistillationTrayProps> = ({ onTopicModeActiveChange }) => {
    const [mode, setMode] = useState<'new' | 'edit' | null>(null);
    const [existingTopics, setExistingTopics] = useState<GraphNode[]>([]);
    const [selectedTopicId, setSelectedTopicId] = useState('');
    const [sourceFile, setSourceFile] = useState<File | null>(null);
    const [title, setTitle] = useState('');
    const [tagsInput, setTagsInput] = useState('');
    const [summaryText, setSummaryText] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null);
    const [linkedTopicIds, setLinkedTopicIds] = useState<string[]>([]);
    const [linkSearchQuery, setLinkSearchQuery] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const loadTopics = async () => {
            const storage = await getStorage();
            setExistingTopics(storage.nodes);
        };
        loadTopics();
    }, []);

    useEffect(() => {
        onTopicModeActiveChange?.(mode !== null);
    }, [mode, onTopicModeActiveChange]);

    const parseTags = (raw: string): string[] =>
        raw
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);

    const handleSelectTopicToEdit = (topicId: string) => {
        setSelectedTopicId(topicId);
        const topic = existingTopics.find((node) => node.id === topicId);
        if (!topic) return;
        setTitle(topic.title);
        setSummaryText(topic.summary);
        setTagsInput((topic.tags || []).join(', '));

        getStorage().then((storage) => {
            const outgoingLinks = storage.edges
                .filter((edge) => edge.source === topicId)
                .map((edge) => edge.target);
            setLinkedTopicIds(outgoingLinks);
        });
    };

    const toggleLinkedTopic = (topicId: string) => {
        setLinkedTopicIds((prev) =>
            prev.includes(topicId)
                ? prev.filter((id) => id !== topicId)
                : [...prev, topicId]
        );
    };

    const handleDeleteTopic = async (topic: GraphNode) => {
        const confirmed = window.confirm(
            `Delete "${topic.title}"? This will remove its summary, tags, graph links, and review history.`
        );
        if (!confirmed) return;

        setDeletingTopicId(topic.id);
        try {
            const storage = await getStorage();
            const updatedNodes = storage.nodes.filter((node) => node.id !== topic.id);
            const updatedEdges = storage.edges.filter(
                (edge) => edge.source !== topic.id && edge.target !== topic.id
            );
            const { [topic.id]: _removedRecord, ...remainingFsrsData } = storage.fsrsData;

            await updateStorage({
                nodes: updatedNodes,
                edges: updatedEdges,
                fsrsData: remainingFsrsData,
            });

            if (topic.hasPdfBlob) {
                await deletePdfBlob(topic.id);
            }

            const refreshed = await getStorage();
            setExistingTopics(refreshed.nodes);
            if (selectedTopicId === topic.id) {
                setSelectedTopicId('');
                setTitle('');
                setSummaryText('');
                setTagsInput('');
                setSourceFile(null);
            }
        } catch (err) {
            console.error('Failed to delete topic:', err);
            alert('Failed to delete topic. Check console for details.');
        } finally {
            setDeletingTopicId(null);
        }
    };

    const filteredTopics = existingTopics
        .filter((topic) => topic.title.toLowerCase().includes(searchQuery.toLowerCase().trim()))
        .sort((a, b) => a.title.localeCompare(b.title));

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            setSourceFile(file);
            if (!title.trim()) setTitle(file.name.replace(/\.(pdf|doc|docx)$/i, ''));
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) {
            setSourceFile(file);
            if (!title.trim()) setTitle(file.name.replace(/\.(pdf|doc|docx)$/i, ''));
        }
    };

    const handleSave = async () => {
        if (!mode) return;
        const hasSummary = summaryText.trim().length > 0;
        const hasAttachedFile = sourceFile !== null;
        if (!title.trim() || (!hasSummary && !hasAttachedFile)) return;
        setIsSaving(true);
        try {
            const tags = parseTags(tagsInput);

            if (mode === 'edit' && selectedTopicId) {
                const storage = await getStorage();
                const updatedNodes = storage.nodes.map((node) =>
                    node.id === selectedTopicId
                        ? {
                            ...node,
                            title,
                            summary: summaryText,
                            tags,
                            hasPdfBlob: sourceFile ? true : node.hasPdfBlob,
                        }
                        : node
                );
                const otherEdges = storage.edges.filter((edge) => edge.source !== selectedTopicId);
                const linkedEdges = linkedTopicIds.map((targetId) => ({
                    id: `${selectedTopicId}-${targetId}`,
                    source: selectedTopicId,
                    target: targetId,
                }));

                await updateStorage({ nodes: updatedNodes, edges: [...otherEdges, ...linkedEdges] });
                if (sourceFile) {
                    await savePdfBlob(selectedTopicId, sourceFile.name, sourceFile);
                }
                alert('Topic updated successfully!');
            } else {
                const storage = await getStorage();
                const newNode = await createNode(title, summaryText, tags, sourceFile !== null);
                if (sourceFile) await savePdfBlob(newNode.id, sourceFile.name, sourceFile);
                if (linkedTopicIds.length > 0) {
                    const linkedEdges = linkedTopicIds.map((targetId) => ({
                        id: `${newNode.id}-${targetId}`,
                        source: newNode.id,
                        target: targetId,
                    }));
                    await updateStorage({ edges: [...storage.edges, ...linkedEdges] });
                }
                alert('New topic saved to Knowledge Graph!');
            }

            const refreshed = await getStorage();
            setExistingTopics(refreshed.nodes);
            setSourceFile(null);
            setSelectedTopicId('');
            setMode(null);
            setSummaryText('');
            setTitle('');
            setTagsInput('');
            setLinkedTopicIds([]);
        } catch (err) {
            console.error('Failed to save distillation:', err);
            alert('Failed to save. Check console for details.');
        } finally {
            setIsSaving(false);
        }
    };

    const hasSummary = summaryText.trim().length > 0;
    const canSave =
        !!mode &&
        title.trim().length > 0 &&
        (hasSummary || sourceFile !== null) &&
        !isSaving &&
        (mode === 'edit' ? selectedTopicId.length > 0 : true);

    const linkableTopics = existingTopics.filter((topic) =>
        mode === 'edit' ? topic.id !== selectedTopicId : true
    );

    const normalizedLinkSearch = linkSearchQuery.toLowerCase().trim();
    const lastThreeLinkableTopics = linkableTopics.slice(-3).reverse();
    const visibleLinkTopics = normalizedLinkSearch
        ? linkableTopics.filter((topic) => topic.title.toLowerCase().includes(normalizedLinkSearch))
        : lastThreeLinkableTopics;

    const resetForm = () => {
        setSelectedTopicId('');
        setSourceFile(null);
        setTitle('');
        setTagsInput('');
        setSummaryText('');
        setSearchQuery('');
        setLinkSearchQuery('');
        setLinkedTopicIds([]);
    };

    const topicsHeading =
        mode === 'new'
            ? 'Create Topic'
            : mode === 'edit'
                ? 'Edit Topic'
                : 'Create, Edit, and Link Topics';

    const topicsSubtitle =
        mode === null
            ? 'Choose a mode first to keep the workspace focused and easier to scan.'
            : mode === 'new'
                ? 'Draft a new topic with summary, tags, and optional source file.'
                : 'Select a topic to update details and manage links.';

    return (
        <div className="animate-slide-up w-full space-y-5">

            {/* ── No mode: header + mode picker ── */}
            {!mode && (
                <div className="glass-card relative overflow-hidden flex flex-col items-stretch">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-accent-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl pointer-events-none" />

                    <div className="relative z-10 p-6 sm:p-8 pb-0">
                        <span className="section-eyebrow">Topics</span>
                        <h2 className="section-title text-3xl mt-1">{topicsHeading}</h2>
                        <p className="text-sm mt-2 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
                            {topicsSubtitle}
                        </p>
                    </div>

                    <div className="p-6  relative z-10">
                        <div className="grid gap-3 grid-cols-2">
                            <button
                                id="topic-create-btn"
                                type="button"
                                onClick={() => { resetForm(); setMode('new'); }}
                                className="p-4 text-left rounded-xl border transition-all duration-200 shadow-sm bg-emerald-500/[0.06] border-emerald-500/20 hover:bg-emerald-500/[0.12] hover:border-emerald-500/40 hover:shadow-md"
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <UploadCloud className="w-4 h-4 shrink-0 text-emerald-500" aria-hidden="true" />
                                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Create new topic</span>
                                </div>
                                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    Upload a file or paste a summary, then save a new topic to your library.
                                </p>
                            </button>
                            <button
                                id="topic-edit-btn"
                                type="button"
                                onClick={() => { resetForm(); setMode('edit'); }}
                                className="p-4 text-left rounded-xl border transition-all duration-200 shadow-sm bg-blue-500/[0.06] border-blue-500/20 hover:bg-blue-500/[0.12] hover:border-blue-500/40 hover:shadow-md"
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <Pencil className="w-4 h-4 shrink-0 text-blue-500" aria-hidden="true" />
                                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Edit existing topic</span>
                                </div>
                                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                                    Find a topic, then update title, tags, and summary.
                                </p>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ════════════════════════════════════════
                EDIT MODE — single container
            ════════════════════════════════════════ */}
            {mode === 'edit' && (
                <div className="glass-card relative overflow-hidden flex flex-col items-stretch">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-accent-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl pointer-events-none" />

                    {/* Header */}
                    <div className="relative z-10 p-6 sm:p-8 pb-4 flex items-start justify-between gap-3">
                        <div>
                            <span className="section-eyebrow">Topics</span>
                            <h2 className="section-title text-3xl mt-1">{topicsHeading}</h2>
                            <p className="text-sm mt-2 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
                                {topicsSubtitle}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="btn-secondary p-2 shrink-0 mt-1"
                            onClick={() => { resetForm(); setMode(null); }}
                            aria-label="Back to mode selection"
                            title="Back"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }} />

                    {/* Select a topic */}
                    <div className="relative z-10 p-6 sm:p-8 space-y-4">
                        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            Edit Existing Topic
                        </p>
                        <input
                            id="edit-topic-search"
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-field"
                            placeholder="Search topics by title…"
                        />
                        <div
                            className="rounded-lg"
                            style={{
                                minHeight: 72,
                                maxHeight: 240,
                                overflowY: 'auto',
                                border: '1px solid var(--border-subtle)',
                                padding: 6,
                            }}
                        >
                            {filteredTopics.length === 0 ? (
                                <p className="text-xs px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                                    {existingTopics.length === 0
                                        ? 'No topics yet. Create your first topic using the Create New Topic mode.'
                                        : 'No matching topics found.'}
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {filteredTopics.map((topic) => {
                                        const isSelected = selectedTopicId === topic.id;
                                        return (
                                            <div
                                                key={topic.id}
                                                className="flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
                                                style={{
                                                    background: isSelected ? 'var(--bg-subtle)' : 'transparent',
                                                    border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                                                }}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectTopicToEdit(topic.id)}
                                                    className={isSelected ? 'btn-primary text-xs px-3 py-1.5 shrink-0' : 'btn-secondary text-xs px-3 py-1.5 shrink-0'}
                                                >
                                                    <Pencil className="w-3.5 h-3.5" />
                                                    {isSelected ? 'Editing' : 'Edit'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteTopic(topic)}
                                                    disabled={deletingTopicId === topic.id}
                                                    className="btn-secondary text-xs px-3 py-1.5 shrink-0"
                                                    style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.35)' }}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    {deletingTopicId === topic.id ? 'Deleting…' : 'Delete'}
                                                </button>
                                                <span
                                                    className="text-sm font-medium truncate min-w-0"
                                                    style={{ color: 'var(--text-primary)' }}
                                                    title={topic.title}
                                                >
                                                    {topic.title}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Topic details (only after a topic is selected) */}
                    {selectedTopicId && (
                        <>
                            <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }} />
                            <div className="relative z-10 p-6 sm:p-8 space-y-4">
                                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                                    Topic Details
                                </p>

                                <div className="space-y-1.5">
                                    <label htmlFor="topic-name-input" className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                        Title
                                    </label>
                                    <input
                                        id="topic-name-input"
                                        type="text"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder="e.g. Attention Mechanisms in Transformers"
                                        className="input-field"
                                    />
                                </div>

                                <div className="border-t w-full" style={{ borderColor: 'var(--border-subtle)' }} />

                                <div className="space-y-1.5">
                                    <label htmlFor="topic-tags-input" className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                        Tags
                                    </label>
                                    <input
                                        id="topic-tags-input"
                                        type="text"
                                        value={tagsInput}
                                        onChange={(e) => setTagsInput(e.target.value)}
                                        placeholder="e.g. ai, transformers, revision"
                                        className="input-field"
                                    />
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                        Separate tags with commas.
                                    </p>
                                </div>

                                <div className="border-t w-full" style={{ borderColor: 'var(--border-subtle)' }} />

                                <div className="space-y-1.5">
                                    <label htmlFor="summary-textarea" className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                        Summary
                                    </label>
                                    <textarea
                                        id="summary-textarea"
                                        value={summaryText}
                                        onChange={(e) => setSummaryText(e.target.value)}
                                        placeholder="Update your topic summary here."
                                        className="textarea-field min-h-[180px]"
                                        style={{ resize: 'vertical' }}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }} />

                    {/* Link topics */}
                    <div className="relative z-10 p-6 sm:p-8 space-y-4">
                        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            Link to Other Topics
                        </p>
                        <input
                            id="link-topic-search"
                            type="text"
                            value={linkSearchQuery}
                            onChange={(e) => setLinkSearchQuery(e.target.value)}
                            className="input-field"
                            placeholder="Search topic to link…"
                        />
                        <div
                            className="rounded-lg"
                            style={{
                                minHeight: 72,
                                maxHeight: 200,
                                overflowY: 'auto',
                                border: '1px solid var(--border-subtle)',
                                padding: 6,
                            }}
                        >
                            {linkableTopics.length === 0 ? (
                                <p className="text-xs px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                                    No other topics available to link yet.
                                </p>
                            ) : visibleLinkTopics.length === 0 ? (
                                <p className="text-xs px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                                    No matching topics found.
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {visibleLinkTopics.map((topic) => {
                                        const isLinked = linkedTopicIds.includes(topic.id);
                                        return (
                                            <button
                                                key={topic.id}
                                                type="button"
                                                onClick={() => toggleLinkedTopic(topic.id)}
                                                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
                                                style={{
                                                    background: isLinked ? 'var(--bg-subtle)' : 'transparent',
                                                    border: `1px solid ${isLinked ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                                                }}
                                            >
                                                <span
                                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                                    style={{ background: isLinked ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                                                />
                                                <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                                    {topic.title}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Showing last 3 topics by default. Search to find older ones. Linked topics appear as outgoing connections in the graph.
                        </p>
                    </div>

                    <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }} />

                    {/* Save */}
                    <div className="relative z-10 p-6 sm:p-8 flex justify-end">
                        <button
                            id="save-to-graph-btn"
                            onClick={handleSave}
                            disabled={!canSave}
                            className="btn-primary gap-2"
                            style={{ minWidth: 160 }}
                        >
                            <CheckCircle className="w-4 h-4" />
                            {isSaving ? 'Saving…' : 'Save Topic Changes'}
                        </button>
                    </div>
                </div>
            )}

            {/* ════════════════════════════════════════
                NEW MODE — single container
            ════════════════════════════════════════ */}
            {mode === 'new' && (
                <div className="glass-card relative overflow-hidden flex flex-col items-stretch">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-accent-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl pointer-events-none" />

                    {/* Header */}
                    <div className="relative z-10 p-6 sm:p-8 pb-4 flex items-start justify-between gap-3">
                        <div>
                            <span className="section-eyebrow">Topics</span>
                            <h2 className="section-title text-3xl mt-1">{topicsHeading}</h2>
                            <p className="text-sm mt-2 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
                                {topicsSubtitle}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="btn-secondary p-2 shrink-0 mt-1"
                            onClick={() => { resetForm(); setMode(null); }}
                            aria-label="Back to mode selection"
                            title="Back"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }} />

                    {/* Topic details + file upload */}
                    <div className="relative z-10 p-6 sm:p-8 space-y-4">
                        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            New Topic
                        </p>

                        <div className="space-y-1.5">
                            <label htmlFor="topic-name-input" className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                Title
                            </label>
                            <input
                                id="topic-name-input"
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Attention Mechanisms in Transformers"
                                className="input-field"
                            />
                        </div>

                        <div className="border-t w-full" style={{ borderColor: 'var(--border-subtle)' }} />

                        <div className="space-y-1.5">
                            <label htmlFor="topic-tags-input" className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                Tags
                            </label>
                            <input
                                id="topic-tags-input"
                                type="text"
                                value={tagsInput}
                                onChange={(e) => setTagsInput(e.target.value)}
                                placeholder="e.g. ai, transformers, revision"
                                className="input-field"
                            />
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Separate tags with commas.
                            </p>
                        </div>

                        <div className="border-t w-full" style={{ borderColor: 'var(--border-subtle)' }} />

                        <div className="space-y-1.5">
                            <label htmlFor="summary-textarea" className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                Summary
                            </label>
                            <textarea
                                id="summary-textarea"
                                value={summaryText}
                                onChange={(e) => setSummaryText(e.target.value)}
                                placeholder="Paste or write your summary here. You can leave this empty if a file is attached."
                                className="textarea-field min-h-[180px]"
                                style={{ resize: 'vertical' }}
                            />
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                Optional when a source file is attached.
                            </p>
                        </div>

                        <div className="border-t w-full" style={{ borderColor: 'var(--border-subtle)' }} />

                        {/* Compact file upload row */}
                        <div className="space-y-2">
                            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                Source File <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                            </p>
                            <div
                                id="file-drop-zone"
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                                className="flex items-center gap-3 rounded-lg px-4 py-3 cursor-pointer transition-colors"
                                style={{
                                    border: `1px dashed ${isDragging ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
                                    background: isDragging ? 'var(--bg-subtle)' : 'transparent',
                                }}
                            >
                                <UploadCloud
                                    className="w-5 h-5 shrink-0"
                                    style={{ color: isDragging ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                                />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium truncate" style={{ color: sourceFile ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                        {sourceFile ? sourceFile.name : (isDragging ? 'Drop to upload' : 'Click or drag to upload')}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                        PDF, DOC, DOCX
                                    </p>
                                </div>
                                {sourceFile && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setSourceFile(null); }}
                                        className="ml-auto shrink-0 text-xs btn-secondary px-2 py-1"
                                        style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.35)' }}
                                    >
                                        Remove
                                    </button>
                                )}
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                    className="hidden"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }} />

                    {/* Link topics */}
                    <div className="relative z-10 p-6 sm:p-8 space-y-4">
                        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                            Link to Other Topics
                        </p>
                        <input
                            id="link-topic-search"
                            type="text"
                            value={linkSearchQuery}
                            onChange={(e) => setLinkSearchQuery(e.target.value)}
                            className="input-field"
                            placeholder="Search topic to link…"
                        />
                        <div
                            className="rounded-lg"
                            style={{
                                minHeight: 72,
                                maxHeight: 200,
                                overflowY: 'auto',
                                border: '1px solid var(--border-subtle)',
                                padding: 6,
                            }}
                        >
                            {linkableTopics.length === 0 ? (
                                <p className="text-xs px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                                    No other topics available to link yet.
                                </p>
                            ) : visibleLinkTopics.length === 0 ? (
                                <p className="text-xs px-2 py-2" style={{ color: 'var(--text-muted)' }}>
                                    No matching topics found.
                                </p>
                            ) : (
                                <div className="space-y-1.5">
                                    {visibleLinkTopics.map((topic) => {
                                        const isLinked = linkedTopicIds.includes(topic.id);
                                        return (
                                            <button
                                                key={topic.id}
                                                type="button"
                                                onClick={() => toggleLinkedTopic(topic.id)}
                                                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
                                                style={{
                                                    background: isLinked ? 'var(--bg-subtle)' : 'transparent',
                                                    border: `1px solid ${isLinked ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                                                }}
                                            >
                                                <span
                                                    className="w-1.5 h-1.5 rounded-full shrink-0"
                                                    style={{ background: isLinked ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                                                />
                                                <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                                    {topic.title}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Showing last 3 topics by default. Search to find older ones. Linked topics appear as outgoing connections in the graph.
                        </p>
                    </div>

                    <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }} />

                    {/* Save */}
                    <div className="relative z-10 p-6 sm:p-8 flex justify-end">
                        <button
                            id="save-to-graph-btn"
                            onClick={handleSave}
                            disabled={!canSave}
                            className="btn-primary gap-2"
                            style={{ minWidth: 160 }}
                        >
                            <CheckCircle className="w-4 h-4" />
                            {isSaving ? 'Saving…' : 'Save New Topic'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
