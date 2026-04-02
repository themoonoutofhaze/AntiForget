import React, { useEffect, useCallback, useState } from 'react';
import {
    ReactFlow,
    Controls,
    Background,
    applyNodeChanges,
    applyEdgeChanges,
    addEdge,
    Handle,
    Position,
} from '@xyflow/react';
import type {
    Node as FlowNode,
    Edge as FlowEdge,
    NodeChange,
    EdgeChange,
    Connection,
    NodeProps,
    NodeTypes,
    OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getStorage, updateStorage } from '../../utils/storage';
import type { GraphEdge } from '../../utils/storage';
import { FileText, Network } from 'lucide-react';

type CustomNodeData = { label: string; hasPdfBlob: boolean; tags: string[] };

const CustomNode = ({ data }: NodeProps<FlowNode<CustomNodeData>>) => (
    <div
        style={{
            padding: '10px 14px',
            borderRadius: '12px',
            background: 'var(--bg-surface-raised)',
            border: '1px solid var(--border-default)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            minWidth: 150,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            cursor: 'grab',
        }}
    >
        <Handle
            type="target"
            position={Position.Top}
            style={{
                width: 10,
                height: 10,
                background: 'var(--accent-primary)',
                border: '2px solid var(--bg-surface-raised)',
            }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {data.hasPdfBlob && (
                <FileText style={{ width: 14, height: 14, color: 'var(--accent-secondary)', flexShrink: 0 }} />
            )}
            <span
                style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    lineHeight: 1.3,
                }}
            >
                {data.label}
            </span>
        </div>
        {data.tags.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {data.tags.slice(0, 3).map((tag) => (
                    <span
                        key={tag}
                        style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 999,
                            background: 'var(--bg-subtle)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-secondary)',
                        }}
                    >
                        #{tag}
                    </span>
                ))}
            </div>
        )}
        <Handle
            type="source"
            position={Position.Bottom}
            style={{
                width: 10,
                height: 10,
                background: 'var(--accent-secondary)',
                border: '2px solid var(--bg-surface-raised)',
            }}
        />
    </div>
);

const nodeTypes: NodeTypes = { custom: CustomNode };

export const KnowledgeGraph: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
    const [nodes, setNodes] = useState<FlowNode[]>([]);
    const [edges, setEdges] = useState<FlowEdge[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadGraph = async () => {
            const storage = await getStorage();
            const flowNodes: FlowNode[] = storage.nodes.map((n) => ({
                id: n.id,
                position: n.position || { x: Math.random() * 500, y: Math.random() * 350 },
                data: { label: n.title, hasPdfBlob: n.hasPdfBlob, tags: n.tags || [] },
                type: 'custom',
            }));
            const flowEdges: FlowEdge[] = storage.edges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                style: { stroke: 'var(--accent-primary)', strokeWidth: 1.5, opacity: 0.4 },
                animated: false,
            }));
            setNodes(flowNodes);
            setEdges(flowEdges);
            setLoading(false);
        };
        loadGraph();
    }, []);

    const onNodesChange = useCallback(
        (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
        []
    );
    const onEdgesChange = useCallback(
        (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        []
    );

    const onConnect = useCallback(async (connection: Connection) => {
        const edgeOptions: FlowEdge = {
            id: `${connection.source}-${connection.target}`,
            source: connection.source as string,
            target: connection.target as string,
            style: { stroke: 'var(--accent-primary)', strokeWidth: 1.5, opacity: 0.4 },
        };
        setEdges((eds) => addEdge(edgeOptions, eds));
        const currentStorage = await getStorage();
        const newEdge: GraphEdge = {
            id: edgeOptions.id,
            source: connection.source as string,
            target: connection.target as string,
        };
        await updateStorage({ edges: [...currentStorage.edges, newEdge] });
    }, []);

    const onNodeDragStop = useCallback<OnNodeDrag>(async (_event, draggedNode) => {
        const storage = await getStorage();
        const updated = storage.nodes.map((n) =>
            n.id === draggedNode.id ? { ...n, position: draggedNode.position } : n
        );
        await updateStorage({ nodes: updated });
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="loading-dots flex items-center gap-2">
                    <span /><span /><span />
                    <span className="text-sm ml-2" style={{ color: 'var(--text-muted)' }}>Loading graph…</span>
                </div>
            </div>
        );
    }

    return (
        <div className={`animate-slide-up glass-card p-6 sm:p-8 relative overflow-hidden flex flex-col space-y-4 sm:space-y-6 ${embedded ? 'topics-graph-shell h-[640px] xl:h-[calc(100vh-92px)]' : 'h-[calc(100dvh-150px)] sm:h-[calc(100dvh-170px)] max-w-6xl mx-auto min-h-[560px]'}`}>
            {/* Decorative background elements */}
            {!embedded && (
                <>
                    <div className="absolute top-0 right-0 w-64 h-64 bg-accent-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl pointer-events-none" />
                </>
            )}

            {/* Header */}
            <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <span className="section-eyebrow">Visualization</span>
                    <h2 className="section-title text-3xl mt-1">Topic Map</h2>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        See connections across your summarized topics. Drag nodes and draw edges to link ideas.
                    </p>
                </div>
                <div
                    className="flex w-full sm:w-auto items-center justify-between sm:justify-start gap-3 px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider"
                    style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-muted)',
                    }}
                >
                    <span className="flex items-center gap-1.5">
                        <Network className="w-3.5 h-3.5" style={{ color: 'var(--accent-primary)' }} />
                        <span>{nodes.length} topics</span>
                    </span>
                    <span className="opacity-30">·</span>
                    <span>{edges.length} links</span>
                </div>
            </div>

            {/* Graph canvas */}
            <div
                className={`relative z-10 w-full overflow-hidden rounded-2xl ${embedded ? 'h-[480px] xl:h-full' : 'flex-1'}`}
                style={{
                    background: 'rgba(235, 241, 250, 0.4)',
                    border: '1px solid var(--border-subtle)',
                    backdropFilter: 'blur(4px)',
                }}
            >
                {nodes.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                        <div
                            className="w-16 h-16 rounded-2xl flex items-center justify-center"
                            style={{
                                background: 'var(--bg-muted)',
                                border: '1px solid var(--border-subtle)',
                            }}
                        >
                            <Network className="w-8 h-8" style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                        </div>
                        <div className="text-center">
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                                No topics yet
                            </p>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                                Distil a source to populate your knowledge graph.
                            </p>
                        </div>
                    </div>
                ) : (
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeDragStop={onNodeDragStop}
                        nodeTypes={nodeTypes}
                        fitView
                        fitViewOptions={{ padding: 0.25 }}
                    >
                        <Background
                            color="var(--border-subtle)"
                            gap={24}
                            size={1}
                            style={{ opacity: 0.5 }}
                        />
                        <Controls />
                    </ReactFlow>
                )}
            </div>

            <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                Drag from a node handle to another to create a connection.
            </p>
        </div>
    );
};
