'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { automationApi, tenantApi } from '@/lib/api';
import Cookies from 'js-cookie';
import {
    Save, Play, ArrowLeft, Zap, GitBranch, Shield, Mail, Clock,
    AlertCircle, RefreshCw, MessageSquare, UserPlus, Tag, ArrowUp,
    Globe, Bell, Square, FileText, Shuffle, ChevronDown, ChevronRight,
    X, Check, Trash2, Settings, Eye, Pause, AlertTriangle, ArrowRightCircle,
    Variable, Search, ShieldAlert, ShieldX, Network, MapPin, Crosshair,
    Braces, Calculator, Type, Filter, Repeat, FilePlus, FileEdit,
    FileCheck, FileSearch, SearchCode, Regex, ShieldCheck, UserCheck,
    Hourglass, Layers, GitMerge, Headphones, LayoutList, Ticket,
    StickyNote, ListFilter, ClipboardList, ClipboardEdit,
    MessageCirclePlus, ListTodo, Copy, MoreVertical, Activity,
    Workflow, Hash, PanelRightClose, PanelRightOpen, ChevronLeft,
    ToggleLeft, ToggleRight, Users, Info,
} from 'lucide-react';

// Dynamic import ReactFlow to avoid SSR issues
const ReactFlow = dynamic(() => import('reactflow').then(mod => mod.default), { ssr: false });
const Background = dynamic(() => import('reactflow').then(mod => mod.Background), { ssr: false });
const Controls = dynamic(() => import('reactflow').then(mod => mod.Controls), { ssr: false });
const MiniMap = dynamic(() => import('reactflow').then(mod => mod.MiniMap), { ssr: false });
const Panel = dynamic(() => import('reactflow').then(mod => mod.Panel), { ssr: false });

import { addEdge, applyNodeChanges, applyEdgeChanges, MarkerType, Handle, Position } from 'reactflow';
import type { Node, Edge, Connection, NodeChange, EdgeChange } from 'reactflow';

// ── Icon map ──
const ICON_MAP: Record<string, React.ReactNode> = {
    Zap: <Zap size={14} />, AlertCircle: <AlertCircle size={14} />, RefreshCw: <RefreshCw size={14} />,
    ArrowRightCircle: <ArrowRightCircle size={14} />, Clock: <Clock size={14} />, AlertTriangle: <AlertTriangle size={14} />,
    Play: <Play size={14} />, GitBranch: <GitBranch size={14} />, Shuffle: <Shuffle size={14} />,
    Variable: <Variable size={14} />, FileText: <FileText size={14} />, Square: <Square size={14} />,
    Shield: <Shield size={14} />, MessageSquare: <MessageSquare size={14} />, UserPlus: <UserPlus size={14} />,
    Tag: <Tag size={14} />, ArrowUp: <ArrowUp size={14} />, Bell: <Bell size={14} />, Globe: <Globe size={14} />,
    Mail: <Mail size={14} />,
    Search: <Search size={14} />, ShieldAlert: <ShieldAlert size={14} />, ShieldX: <ShieldX size={14} />,
    SearchCode: <SearchCode size={14} />, Network: <Network size={14} />, MapPin: <MapPin size={14} />,
    Crosshair: <Crosshair size={14} />, Regex: <Regex size={14} />, Braces: <Braces size={14} />,
    Calculator: <Calculator size={14} />, Type: <Type size={14} />, Filter: <Filter size={14} />,
    Repeat: <Repeat size={14} />,
    FilePlus: <FilePlus size={14} />, FileEdit: <FileEdit size={14} />, FileCheck: <FileCheck size={14} />,
    FileSearch: <FileSearch size={14} />,
    ShieldCheck: <ShieldCheck size={14} />, UserCheck: <UserCheck size={14} />,
    Hourglass: <Hourglass size={14} />, Layers: <Layers size={14} />, GitMerge: <GitMerge size={14} />,
    Headphones: <Headphones size={14} />, LayoutList: <LayoutList size={14} />,
    TicketPlus: <Ticket size={14} />, TicketCheck: <Ticket size={14} />, TicketSearch: <Ticket size={14} />,
    StickyNote: <StickyNote size={14} />, ListFilter: <ListFilter size={14} />,
    ClipboardPlus: <ClipboardList size={14} />, ClipboardEdit: <ClipboardEdit size={14} />,
    ClipboardList: <ClipboardList size={14} />, MessageCirclePlus: <MessageCirclePlus size={14} />,
    ListTodo: <ListTodo size={14} />,
};

// Larger icons for palette
const ICON_MAP_LG: Record<string, React.ReactNode> = {
    Zap: <Zap size={18} />, AlertCircle: <AlertCircle size={18} />, RefreshCw: <RefreshCw size={18} />,
    ArrowRightCircle: <ArrowRightCircle size={18} />, Clock: <Clock size={18} />, AlertTriangle: <AlertTriangle size={18} />,
    Play: <Play size={18} />, GitBranch: <GitBranch size={18} />, Shuffle: <Shuffle size={18} />,
    Variable: <Variable size={18} />, FileText: <FileText size={18} />, Square: <Square size={18} />,
    Shield: <Shield size={18} />, MessageSquare: <MessageSquare size={18} />, UserPlus: <UserPlus size={18} />,
    Tag: <Tag size={18} />, ArrowUp: <ArrowUp size={18} />, Bell: <Bell size={18} />, Globe: <Globe size={18} />,
    Mail: <Mail size={18} />,
    Search: <Search size={18} />, ShieldAlert: <ShieldAlert size={18} />, ShieldX: <ShieldX size={18} />,
    SearchCode: <SearchCode size={18} />, Network: <Network size={18} />, MapPin: <MapPin size={18} />,
    Crosshair: <Crosshair size={18} />, Regex: <Regex size={18} />, Braces: <Braces size={18} />,
    Calculator: <Calculator size={18} />, Type: <Type size={18} />, Filter: <Filter size={18} />,
    Repeat: <Repeat size={18} />,
    FilePlus: <FilePlus size={18} />, FileEdit: <FileEdit size={18} />, FileCheck: <FileCheck size={18} />,
    FileSearch: <FileSearch size={18} />,
    ShieldCheck: <ShieldCheck size={18} />, UserCheck: <UserCheck size={18} />,
    Hourglass: <Hourglass size={18} />, Layers: <Layers size={18} />, GitMerge: <GitMerge size={18} />,
    Headphones: <Headphones size={18} />, LayoutList: <LayoutList size={18} />,
    TicketPlus: <Ticket size={18} />, TicketCheck: <Ticket size={18} />, TicketSearch: <Ticket size={18} />,
    StickyNote: <StickyNote size={18} />, ListFilter: <ListFilter size={18} />,
    ClipboardPlus: <ClipboardList size={18} />, ClipboardEdit: <ClipboardEdit size={18} />,
    ClipboardList: <ClipboardList size={18} />, MessageCirclePlus: <MessageCirclePlus size={18} />,
    ListTodo: <ListTodo size={18} />,
};

// ── Category colors ──
const CATEGORY_COLORS: Record<string, string> = {
    trigger: '#f0883e',
    logic: '#a371f7',
    soc_action: '#3fb950',
    communication: '#79c0ff',
    enrichment: '#f778ba',
    data_transform: '#d2a8ff',
    incident_ops: '#f0883e',
    freshdesk: '#22c55e',
    onedesk: '#3b82f6',
};

// ── Custom Node Component ──
function CustomNode({ data }: { data: any }) {
    const catColor = CATEGORY_COLORS[data.category] || '#8b949e';
    const isSelected = data._selected;

    const handleStyle: React.CSSProperties = {
        width: 10, height: 10,
        background: catColor,
        border: `2px solid var(--bg-secondary, #161b22)`,
        borderRadius: '50%',
    };

    return (
        <div
            style={{
                background: 'var(--bg-secondary, #161b22)',
                border: `2px solid ${isSelected ? catColor : 'var(--border-color, #30363d)'}`,
                borderRadius: '12px',
                minWidth: 200,
                boxShadow: isSelected ? `0 0 12px ${catColor}40` : '0 2px 8px rgba(0,0,0,0.2)',
                overflow: 'visible',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                position: 'relative',
            }}
        >
            {/* Target handle (top) */}
            <Handle
                type="target"
                position={Position.Top}
                style={handleStyle}
            />

            {/* Header bar */}
            <div style={{
                background: `${catColor}20`,
                borderBottom: `1px solid ${catColor}30`,
                padding: '8px 12px',
                display: 'flex', alignItems: 'center', gap: '6px',
                borderRadius: '10px 10px 0 0',
            }}>
                <span style={{ color: catColor }}>
                    {ICON_MAP[data.icon] || <Zap size={14} />}
                </span>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary, #e6edf3)' }}>
                    {data.label || data.nodeType}
                </span>
            </div>
            {/* Body */}
            <div style={{ padding: '8px 12px' }}>
                <span style={{
                    fontSize: '0.68rem', color: 'var(--text-tertiary, #8b949e)',
                    display: 'block', lineHeight: 1.3,
                }}>
                    {data.description || data.nodeType}
                </span>
                {data.configSummary && (
                    <div style={{
                        marginTop: '6px', padding: '4px 8px', borderRadius: '6px',
                        background: 'var(--bg-tertiary, #0d1117)',
                        fontSize: '0.67rem', color: 'var(--text-secondary, #c9d1d9)',
                        fontFamily: 'monospace', maxHeight: 40, overflow: 'hidden',
                    }}>
                        {data.configSummary}
                    </div>
                )}
            </div>

            {/* Source handle (bottom) */}
            <Handle
                type="source"
                position={Position.Bottom}
                style={handleStyle}
            />
        </div>
    );
}

const nodeTypes = { custom: CustomNode };

export default function BuilderPage() {
    return (
        <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>Loading Builder...</div>}>
            <BuilderInner />
        </Suspense>
    );
}

function BuilderInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const workflowId = searchParams.get('id');
    const executionId = searchParams.get('execution');

    // Load ReactFlow CSS dynamically
    useEffect(() => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/reactflow@11.11.3/dist/style.css';
        document.head.appendChild(link);
        return () => { document.head.removeChild(link); };
    }, []);

    // ── State ──
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [workflowName, setWorkflowName] = useState('Untitled Workflow');
    const [workflowDesc, setWorkflowDesc] = useState('');
    const [workflowStatus, setWorkflowStatus] = useState('draft');
    const [catalog, setCatalog] = useState<any[]>([]);
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const [nodeConfig, setNodeConfig] = useState<any>({});
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState('');
    const [executionData, setExecutionData] = useState<any>(null);
    const [executionResult, setExecutionResult] = useState<any>(null);

    // Tines-style UI state
    const [leftPanelOpen, setLeftPanelOpen] = useState(true);
    const [rightPanelOpen, setRightPanelOpen] = useState(true);
    const [rightPanelTab, setRightPanelTab] = useState<'build' | 'test' | 'logs'>('build');
    const [paletteSearch, setPaletteSearch] = useState('');
    const [paletteHover, setPaletteHover] = useState<string | null>(null);
    const [showEventsPanel, setShowEventsPanel] = useState(false);

    // Multi-tenant targeting (super_admin)
    const userRole = Cookies.get('user_role') || '';
    const isSuperAdmin = userRole === 'super_admin';
    const [tenantsList, setTenantsList] = useState<any[]>([]);
    const [targetTenantIds, setTargetTenantIds] = useState<string[]>([]);

    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

    // ── Flat list of all nodes from catalog ──
    const allNodes = useMemo(() => {
        const result: any[] = [];
        for (const cat of catalog) {
            for (const n of cat.nodes || []) {
                result.push({ ...n, category: cat.id, categoryLabel: cat.label, categoryColor: cat.color });
            }
        }
        return result;
    }, [catalog]);

    // Filtered nodes for search
    const filteredNodes = useMemo(() => {
        if (!paletteSearch) return allNodes;
        const q = paletteSearch.toLowerCase();
        return allNodes.filter(n =>
            n.label?.toLowerCase().includes(q) ||
            n.type?.toLowerCase().includes(q) ||
            n.category?.toLowerCase().includes(q) ||
            n.description?.toLowerCase().includes(q)
        );
    }, [allNodes, paletteSearch]);

    // ── Load catalog ──
    useEffect(() => {
        automationApi.getNodeCatalog().then(res => setCatalog(res.categories || [])).catch(() => {});
    }, []);

    // ── Load tenants list (super_admin only) ──
    useEffect(() => {
        if (isSuperAdmin) {
            tenantApi.list().then(res => setTenantsList(res.tenants || [])).catch(() => {});
        }
    }, [isSuperAdmin]);

    // ── Load workflow if editing ──
    useEffect(() => {
        if (!workflowId) return;
        automationApi.getWorkflow(workflowId).then(wf => {
            setWorkflowName(wf.name || 'Untitled');
            setWorkflowDesc(wf.description || '');
            setWorkflowStatus(wf.status || 'draft');
            if (wf.target_tenant_ids) {
                setTargetTenantIds(Array.isArray(wf.target_tenant_ids) ? wf.target_tenant_ids : []);
            }

            const rfNodes: Node[] = (wf.nodes || []).map((n: any) => ({
                id: n.id,
                type: 'custom',
                position: { x: n.position_x || 0, y: n.position_y || 0 },
                data: {
                    label: n.label || n.node_type,
                    nodeType: n.node_type,
                    category: n.category || '',
                    config: n.config || {},
                    icon: _findNodeIcon(n.node_type, n.category),
                    description: _findNodeDesc(n.node_type),
                    configSummary: _getConfigSummary(n.config),
                    error_handling: n.error_handling || 'stop',
                },
            }));

            const rfEdges: Edge[] = (wf.edges || []).map((e: any) => ({
                id: e.id,
                source: e.source_node_id,
                target: e.target_node_id,
                label: e.label || (e.condition?.branch || ''),
                data: { condition: e.condition },
                animated: true,
                style: { stroke: '#a371f7', strokeWidth: 2 },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#a371f7' },
            }));

            setNodes(rfNodes);
            setEdges(rfEdges);
        }).catch(e => console.error(e));
    }, [workflowId]);

    // ── Load execution data ──
    useEffect(() => {
        if (!executionId) return;
        setRightPanelTab('logs');
        automationApi.getExecution(executionId).then(setExecutionData).catch(() => {});
    }, [executionId]);

    // Helper finders
    const _findNodeIcon = (nodeType: string, category: string): string => {
        for (const cat of catalog) {
            for (const n of cat.nodes || []) {
                if (n.type === nodeType) return n.icon || 'Zap';
            }
        }
        return 'Zap';
    };

    const _findNodeDesc = (nodeType: string): string => {
        for (const cat of catalog) {
            for (const n of cat.nodes || []) {
                if (n.type === nodeType) return n.description || '';
            }
        }
        return '';
    };

    const _getConfigSummary = (config: any): string => {
        if (!config || Object.keys(config).length === 0) return '';
        const parts: string[] = [];
        if (config.filters) {
            const filters = Object.entries(config.filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
            if (filters.length) parts.push(filters.join(', '));
        }
        if (config.status) parts.push(`status: ${config.status}`);
        if (config.comment) parts.push(`"${config.comment.slice(0, 40)}..."`);
        if (config.field) parts.push(`${config.field} ${config.operator || '=='} ${config.value || ''}`);
        if (config.variable_name) parts.push(`${config.variable_name} = ${config.value || ''}`);
        if (config.message) parts.push(`"${config.message.slice(0, 40)}..."`);
        return parts.join(' | ') || '';
    };

    // ── Handlers ──
    const onNodesChange = useCallback((changes: NodeChange[]) => setNodes(nds => applyNodeChanges(changes, nds)), []);
    const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges(eds => applyEdgeChanges(changes, eds)), []);
    const onConnect = useCallback((connection: Connection) => {
        setEdges(eds => addEdge({
            ...connection,
            animated: true,
            style: { stroke: '#a371f7', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#a371f7' },
        }, eds));
    }, []);

    const onNodeClick = useCallback((_: any, node: Node) => {
        setSelectedNode(node);
        setNodeConfig(node.data?.config || {});
        setRightPanelTab('build');
        setRightPanelOpen(true);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
        setShowEventsPanel(false);
    }, []);

    // ── Drag from palette ──
    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        const nodeDataStr = event.dataTransfer.getData('application/reactflow');
        if (!nodeDataStr || !reactFlowInstance) return;

        const nodeInfo = JSON.parse(nodeDataStr);
        const position = reactFlowInstance.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
        });

        const newNode: Node = {
            id: `${nodeInfo.type}_${Date.now()}`,
            type: 'custom',
            position,
            data: {
                label: nodeInfo.label,
                nodeType: nodeInfo.type,
                category: nodeInfo.category,
                config: {},
                icon: nodeInfo.icon || 'Zap',
                description: nodeInfo.description || '',
                configSummary: '',
                error_handling: 'stop',
            },
        };

        setNodes(nds => [...nds, newNode]);
    }, [reactFlowInstance]);

    // ── Save ──
    const handleSave = async () => {
        setSaving(true);
        setSaveMsg('');

        const payload = {
            name: workflowName,
            description: workflowDesc,
            nodes: nodes.map(n => ({
                id: n.id,
                node_type: n.data.nodeType,
                category: n.data.category || '',
                label: n.data.label || '',
                config: n.data.config || {},
                position_x: n.position.x,
                position_y: n.position.y,
                error_handling: n.data.error_handling || 'stop',
                retry_count: 0,
                timeout_sec: 30,
            })),
            edges: edges.map(e => ({
                id: e.id,
                source_node_id: e.source,
                target_node_id: e.target,
                condition: e.data?.condition || null,
                label: typeof e.label === 'string' ? e.label : '',
            })),
            canvas_data: reactFlowInstance ? reactFlowInstance.toObject() : {},
            target_tenant_ids: targetTenantIds.length > 0 ? targetTenantIds : null,
        };

        try {
            if (workflowId) {
                await automationApi.updateWorkflow(workflowId, payload);
            } else {
                const res = await automationApi.createWorkflow(payload);
                if (res?.id) {
                    router.replace(`/automations/builder?id=${res.id}`);
                }
            }
            setSaveMsg('Saved!');
            setTimeout(() => setSaveMsg(''), 2000);
        } catch (e: any) {
            setSaveMsg(`Error: ${e.message}`);
        }
        setSaving(false);
    };

    // ── Execute ──
    const handleRun = async () => {
        if (!workflowId) {
            setSaveMsg('Save first before running');
            return;
        }
        try {
            const result = await automationApi.executeWorkflow(workflowId, { input_data: {} });
            setExecutionResult(result);
            setRightPanelTab('logs');
            if (result.execution_id) {
                const exData = await automationApi.getExecution(result.execution_id);
                setExecutionData(exData);
            }
        } catch (e: any) {
            setSaveMsg(`Run failed: ${e.message}`);
        }
    };

    // ── Publish / Pause ──
    const handleToggleStatus = async () => {
        if (!workflowId) return;
        try {
            if (workflowStatus === 'active') {
                await automationApi.pauseWorkflow(workflowId);
                setWorkflowStatus('paused');
            } else {
                await automationApi.publishWorkflow(workflowId);
                setWorkflowStatus('active');
            }
        } catch (e: any) { setSaveMsg(`Error: ${e.message}`); }
    };

    // ── Update node config ──
    const updateNodeConfig = (key: string, value: any) => {
        const updated = { ...nodeConfig, [key]: value };
        setNodeConfig(updated);

        if (selectedNode) {
            setNodes(nds => nds.map(n => {
                if (n.id === selectedNode.id) {
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            config: updated,
                            configSummary: _getConfigSummary(updated),
                        },
                    };
                }
                return n;
            }));
        }
    };

    // ── Delete selected node ──
    const deleteSelectedNode = () => {
        if (!selectedNode) return;
        setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
        setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
        setSelectedNode(null);
    };

    // ── Duplicate selected node ──
    const duplicateSelectedNode = () => {
        if (!selectedNode) return;
        const newNode: Node = {
            id: `${selectedNode.data.nodeType}_${Date.now()}`,
            type: 'custom',
            position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 60 },
            data: { ...selectedNode.data, label: `${selectedNode.data.label} (copy)` },
        };
        setNodes(nds => [...nds, newNode]);
    };

    // ── Get connected nodes for "Referenced by" section ──
    const getReferencedNodes = () => {
        if (!selectedNode) return { incoming: [] as Node[], outgoing: [] as Node[] };
        const incoming = edges.filter(e => e.target === selectedNode.id).map(e => nodes.find(n => n.id === e.source)).filter(Boolean) as Node[];
        const outgoing = edges.filter(e => e.source === selectedNode.id).map(e => nodes.find(n => n.id === e.target)).filter(Boolean) as Node[];
        return { incoming, outgoing };
    };

    // ── Render config fields for selected node (Build tab) ──
    const renderConfigFields = () => {
        if (!selectedNode) return null;
        const nodeType = selectedNode.data.nodeType;

        let schema: any = {};
        for (const cat of catalog) {
            for (const n of cat.nodes || []) {
                if (n.type === nodeType) {
                    schema = n.config_schema || {};
                    break;
                }
            }
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Node label */}
                <div>
                    <label style={labelStyle}>Name</label>
                    <input
                        value={selectedNode.data.label || ''}
                        onChange={e => {
                            const newLabel = e.target.value;
                            setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, label: newLabel } } : n));
                        }}
                        style={inputStyle}
                    />
                </div>

                {/* Description */}
                <div>
                    <label style={labelStyle}>Description</label>
                    <textarea
                        value={selectedNode.data.description || ''}
                        onChange={e => {
                            const newDesc = e.target.value;
                            setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, description: newDesc } } : n));
                        }}
                        rows={2}
                        style={{ ...inputStyle, resize: 'vertical', minHeight: 44 }}
                        placeholder="Describe what this node does..."
                    />
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />

                {/* Config fields from schema */}
                {Object.entries(schema).map(([key, fieldDef]: [string, any]) => {
                    if (fieldDef.type === 'object' && fieldDef.properties) {
                        return (
                            <div key={key}>
                                <label style={{ ...labelStyle, fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{key}</label>
                                {Object.entries(fieldDef.properties).map(([subKey, subDef]: [string, any]) => (
                                    <div key={subKey} style={{ marginBottom: '0.5rem' }}>
                                        <label style={labelStyle}>{subDef.label || subKey}</label>
                                        <input
                                            value={(nodeConfig[key] || {})[subKey] || ''}
                                            onChange={e => {
                                                const obj = { ...(nodeConfig[key] || {}), [subKey]: e.target.value };
                                                updateNodeConfig(key, obj);
                                            }}
                                            placeholder={subDef.placeholder || ''}
                                            style={inputStyle}
                                        />
                                    </div>
                                ))}
                            </div>
                        );
                    }

                    if (fieldDef.type === 'select') {
                        return (
                            <div key={key}>
                                <label style={labelStyle}>{fieldDef.label || key}</label>
                                <select
                                    value={nodeConfig[key] || ''}
                                    onChange={e => updateNodeConfig(key, e.target.value)}
                                    style={inputStyle}
                                >
                                    <option value="">— Select —</option>
                                    {(fieldDef.options || []).map((opt: string) => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            </div>
                        );
                    }

                    if (fieldDef.type === 'textarea') {
                        return (
                            <div key={key}>
                                <label style={labelStyle}>{fieldDef.label || key}</label>
                                <textarea
                                    value={nodeConfig[key] || ''}
                                    onChange={e => updateNodeConfig(key, e.target.value)}
                                    rows={3}
                                    style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
                                />
                            </div>
                        );
                    }

                    if (fieldDef.type === 'number') {
                        return (
                            <div key={key}>
                                <label style={labelStyle}>{fieldDef.label || key}</label>
                                <input
                                    type="number"
                                    value={nodeConfig[key] || fieldDef.default || ''}
                                    onChange={e => updateNodeConfig(key, parseInt(e.target.value) || 0)}
                                    min={0}
                                    max={fieldDef.max}
                                    style={inputStyle}
                                />
                            </div>
                        );
                    }

                    if (fieldDef.type === 'array') {
                        return (
                            <div key={key}>
                                <label style={labelStyle}>{fieldDef.label || key}</label>
                                <input
                                    value={(nodeConfig[key] || []).join(', ')}
                                    onChange={e => updateNodeConfig(key, e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                                    placeholder="Comma-separated values"
                                    style={inputStyle}
                                />
                            </div>
                        );
                    }

                    return (
                        <div key={key}>
                            <label style={labelStyle}>{fieldDef.label || key}</label>
                            <input
                                value={nodeConfig[key] || ''}
                                onChange={e => updateNodeConfig(key, e.target.value)}
                                placeholder={fieldDef.placeholder || ''}
                                style={inputStyle}
                            />
                        </div>
                    );
                })}

                {/* Error handling */}
                <div>
                    <label style={labelStyle}>On Error</label>
                    <select
                        value={selectedNode.data.error_handling || 'stop'}
                        onChange={e => {
                            setNodes(nds => nds.map(n => n.id === selectedNode.id ? { ...n, data: { ...n.data, error_handling: e.target.value } } : n));
                        }}
                        style={inputStyle}
                    >
                        <option value="stop">Stop workflow</option>
                        <option value="continue">Continue (skip)</option>
                    </select>
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />

                {/* Referenced by section */}
                {(() => {
                    const { incoming, outgoing } = getReferencedNodes();
                    if (incoming.length === 0 && outgoing.length === 0) return null;
                    return (
                        <div>
                            <label style={{ ...labelStyle, fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Referenced by</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {incoming.map(n => (
                                    <div key={n.id} onClick={() => { setSelectedNode(n); setNodeConfig(n.data?.config || {}); }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            padding: '6px 8px', borderRadius: '6px', cursor: 'pointer',
                                            background: 'var(--bg-tertiary)', fontSize: '0.75rem',
                                            color: 'var(--text-secondary)',
                                        }}>
                                        <span style={{ color: CATEGORY_COLORS[n.data?.category] || '#8b949e', display: 'flex' }}>
                                            {ICON_MAP[n.data?.icon] || <Zap size={14} />}
                                        </span>
                                        <span>{n.data?.label}</span>
                                        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>← input</span>
                                    </div>
                                ))}
                                {outgoing.map(n => (
                                    <div key={n.id} onClick={() => { setSelectedNode(n); setNodeConfig(n.data?.config || {}); }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            padding: '6px 8px', borderRadius: '6px', cursor: 'pointer',
                                            background: 'var(--bg-tertiary)', fontSize: '0.75rem',
                                            color: 'var(--text-secondary)',
                                        }}>
                                        <span style={{ color: CATEGORY_COLORS[n.data?.category] || '#8b949e', display: 'flex' }}>
                                            {ICON_MAP[n.data?.icon] || <Zap size={14} />}
                                        </span>
                                        <span>{n.data?.label}</span>
                                        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>output →</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })()}
            </div>
        );
    };

    // ── Render Test tab ──
    const renderTestPanel = () => {
        if (!selectedNode) return null;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.25rem 0' }}>
                <div style={{
                    padding: '1.5rem', textAlign: 'center', borderRadius: '8px',
                    border: '1px dashed var(--border-color)', background: 'var(--bg-tertiary)',
                }}>
                    <Play size={28} style={{ color: 'var(--text-tertiary)', marginBottom: '0.5rem' }} />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem' }}>
                        Test this node with sample input data
                    </p>
                    <button
                        onClick={handleRun}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '6px',
                            padding: '0.45rem 1rem', borderRadius: '8px',
                            background: 'rgba(163,113,247,0.15)', border: '1px solid rgba(163,113,247,0.3)',
                            color: '#a371f7', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                        }}
                    >
                        <Play size={14} /> Run Test
                    </button>
                </div>
                {executionResult && (
                    <div style={{
                        padding: '0.75rem', borderRadius: '8px',
                        background: executionResult.status === 'success' ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)',
                        border: `1px solid ${executionResult.status === 'success' ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}`,
                    }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: executionResult.status === 'success' ? '#3fb950' : '#f85149', marginBottom: '4px' }}>
                            {executionResult.status?.toUpperCase() || 'COMPLETED'}
                        </div>
                        {executionResult.execution_id && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                                ID: {executionResult.execution_id}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    // ── Render Logs tab ──
    const renderLogsPanel = () => {
        if (!executionData) {
            return (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    <Activity size={28} style={{ marginBottom: '0.5rem', opacity: 0.3 }} />
                    <p style={{ fontSize: '0.8rem', margin: 0 }}>No execution logs yet</p>
                    <p style={{ fontSize: '0.72rem', margin: '4px 0 0', color: 'var(--text-tertiary)' }}>Run the workflow to see logs here</p>
                </div>
            );
        }

        const sc = (s: string) => {
            if (s === 'success') return '#3fb950';
            if (s === 'failed') return '#f85149';
            if (s === 'running') return '#2f81f7';
            return '#8b949e';
        };

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{
                    padding: '0.75rem', borderRadius: '8px',
                    background: `${sc(executionData.status)}15`,
                    border: `1px solid ${sc(executionData.status)}30`,
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: sc(executionData.status) }}>
                            {executionData.status?.toUpperCase()}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                            {executionData.duration_ms ? `${(executionData.duration_ms / 1000).toFixed(1)}s` : '—'}
                        </div>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        Nodes: {executionData.nodes_executed || 0} / {executionData.nodes_total || 0}
                    </div>
                    {executionData.error_message && (
                        <div style={{ fontSize: '0.72rem', color: '#f85149', marginTop: '4px' }}>
                            {executionData.error_message}
                        </div>
                    )}
                </div>

                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Node Execution Log
                </div>
                {(executionData.node_logs || []).map((log: any, i: number) => (
                    <div
                        key={log.id || i}
                        style={{
                            padding: '0.6rem', borderRadius: '8px',
                            background: 'var(--bg-tertiary)',
                            border: `1px solid ${sc(log.status)}30`,
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-primary)' }}>{log.node_type}</span>
                            <span style={{ fontSize: '0.68rem', color: sc(log.status), fontWeight: 600 }}>{log.status}</span>
                        </div>
                        {log.duration_ms !== undefined && (
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{log.duration_ms}ms</div>
                        )}
                        {log.output_data && (
                            <pre style={{
                                fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '4px',
                                background: 'var(--bg-primary)', padding: '4px 8px', borderRadius: '4px',
                                maxHeight: 80, overflow: 'auto', whiteSpace: 'pre-wrap',
                            }}>
                                {JSON.stringify(log.output_data, null, 2)}
                            </pre>
                        )}
                        {log.error_message && (
                            <div style={{ fontSize: '0.68rem', color: '#f85149', marginTop: '4px' }}>{log.error_message}</div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    // ── Right panel: Workflow properties (no node selected) ──
    const renderWorkflowProperties = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Status toggle */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.75rem', borderRadius: '10px', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
            }}>
                <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>Status</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                        {workflowStatus === 'active' ? 'Workflow is live' : workflowStatus === 'paused' ? 'Workflow is paused' : 'Draft — not active'}
                    </div>
                </div>
                <button
                    onClick={handleToggleStatus}
                    disabled={!workflowId}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '4px',
                        padding: '0.3rem 0.65rem', borderRadius: '20px',
                        border: 'none', cursor: workflowId ? 'pointer' : 'default',
                        background: workflowStatus === 'active' ? 'rgba(63,185,80,0.2)' : 'rgba(139,148,158,0.15)',
                        color: workflowStatus === 'active' ? '#3fb950' : '#8b949e',
                        fontSize: '0.75rem', fontWeight: 600,
                        opacity: workflowId ? 1 : 0.5,
                    }}
                >
                    {workflowStatus === 'active' ? <><ToggleRight size={16} /> Enabled</> : <><ToggleLeft size={16} /> Disabled</>}
                </button>
            </div>

            {/* Name */}
            <div>
                <label style={labelStyle}>Name</label>
                <input
                    value={workflowName}
                    onChange={e => setWorkflowName(e.target.value)}
                    style={inputStyle}
                    placeholder="Workflow Name"
                />
            </div>

            {/* Description */}
            <div>
                <label style={labelStyle}>Description</label>
                <textarea
                    value={workflowDesc}
                    onChange={e => setWorkflowDesc(e.target.value)}
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
                    placeholder="What does this workflow do?"
                />
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--border-color)' }} />

            {/* Stats */}
            <div>
                <label style={{ ...labelStyle, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-tertiary)' }}>Resources</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-tertiary)',
                    }}>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Hash size={13} style={{ color: 'var(--text-tertiary)' }} /> Nodes
                        </span>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>{nodes.length}</span>
                    </div>
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-tertiary)',
                    }}>
                        <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <GitBranch size={13} style={{ color: 'var(--text-tertiary)' }} /> Connections
                        </span>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>{edges.length}</span>
                    </div>
                </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--border-color)' }} />

            {/* ── Target Tenants (super_admin only) ── */}
            {isSuperAdmin && (
                <div>
                    <label style={{ ...labelStyle, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-tertiary)' }}>
                        Apply To Tenants
                    </label>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', margin: '0 0 8px' }}>
                        Select which tenants this automation should run for
                    </p>

                    {/* All Tenants toggle */}
                    <label style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                        background: targetTenantIds.includes('all') ? 'rgba(163,113,247,0.1)' : 'var(--bg-tertiary)',
                        border: `1px solid ${targetTenantIds.includes('all') ? 'rgba(163,113,247,0.3)' : 'var(--border-color)'}`,
                        marginBottom: '6px',
                        transition: 'all 0.15s',
                    }}>
                        <input
                            type="checkbox"
                            checked={targetTenantIds.includes('all')}
                            onChange={e => {
                                if (e.target.checked) {
                                    setTargetTenantIds(['all']);
                                } else {
                                    setTargetTenantIds([]);
                                }
                            }}
                            style={{ accentColor: '#a371f7' }}
                        />
                        <Globe size={14} style={{ color: targetTenantIds.includes('all') ? '#a371f7' : 'var(--text-tertiary)' }} />
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: targetTenantIds.includes('all') ? '#a371f7' : 'var(--text-secondary)' }}>
                            All Tenants
                        </span>
                    </label>

                    {/* Individual tenant checkboxes */}
                    {!targetTenantIds.includes('all') && (
                        <div style={{
                            maxHeight: 200, overflow: 'auto', borderRadius: '8px',
                            border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)',
                        }}>
                            {tenantsList.length === 0 ? (
                                <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.73rem', color: 'var(--text-tertiary)' }}>
                                    No tenants available
                                </div>
                            ) : (
                                <>
                                    {/* Select all / Clear */}
                                    <div style={{
                                        display: 'flex', justifyContent: 'space-between', padding: '6px 10px',
                                        borderBottom: '1px solid var(--border-color)',
                                    }}>
                                        <button
                                            onClick={() => setTargetTenantIds(tenantsList.map((t: any) => String(t.id)))}
                                            style={{
                                                border: 'none', background: 'transparent', cursor: 'pointer',
                                                fontSize: '0.68rem', color: '#a371f7', fontWeight: 600, padding: 0,
                                            }}
                                        >
                                            Select All
                                        </button>
                                        <button
                                            onClick={() => setTargetTenantIds([])}
                                            style={{
                                                border: 'none', background: 'transparent', cursor: 'pointer',
                                                fontSize: '0.68rem', color: 'var(--text-tertiary)', fontWeight: 600, padding: 0,
                                            }}
                                        >
                                            Clear
                                        </button>
                                    </div>
                                    {tenantsList.map((t: any) => {
                                        const tid = String(t.id);
                                        const isChecked = targetTenantIds.includes(tid);
                                        return (
                                            <label
                                                key={tid}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    padding: '6px 10px', cursor: 'pointer',
                                                    background: isChecked ? 'rgba(163,113,247,0.06)' : 'transparent',
                                                    borderBottom: '1px solid var(--border-color)',
                                                    transition: 'background 0.1s',
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={e => {
                                                        if (e.target.checked) {
                                                            setTargetTenantIds(prev => [...prev, tid]);
                                                        } else {
                                                            setTargetTenantIds(prev => prev.filter(id => id !== tid));
                                                        }
                                                    }}
                                                    style={{ accentColor: '#a371f7', flexShrink: 0 }}
                                                />
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{
                                                        fontSize: '0.76rem', fontWeight: isChecked ? 600 : 500,
                                                        color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    }}>
                                                        {t.name}
                                                    </div>
                                                    {t.slug && (
                                                        <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)' }}>
                                                            {t.slug}
                                                        </div>
                                                    )}
                                                </div>
                                            </label>
                                        );
                                    })}
                                </>
                            )}
                        </div>
                    )}

                    {/* Summary */}
                    {targetTenantIds.length > 0 && (
                        <div style={{
                            marginTop: '6px', padding: '6px 10px', borderRadius: '6px',
                            background: 'rgba(163,113,247,0.08)', fontSize: '0.7rem', color: '#a371f7',
                        }}>
                            {targetTenantIds.includes('all')
                                ? 'This automation will apply to all tenants'
                                : `Selected ${targetTenantIds.length} tenant${targetTenantIds.length > 1 ? 's' : ''}`
                            }
                        </div>
                    )}
                </div>
            )}

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--border-color)' }} />

            {/* Credentials placeholder */}
            <div>
                <label style={{ ...labelStyle, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-tertiary)' }}>Credentials</label>
                <div style={{
                    padding: '1rem', borderRadius: '8px', textAlign: 'center',
                    border: '1px dashed var(--border-color)', background: 'var(--bg-tertiary)',
                }}>
                    <Shield size={20} style={{ color: 'var(--text-tertiary)', marginBottom: '4px' }} />
                    <p style={{ fontSize: '0.73rem', color: 'var(--text-tertiary)', margin: 0 }}>
                        No credentials configured
                    </p>
                </div>
            </div>
        </div>
    );

    return (
        <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-primary)', overflow: 'hidden' }}>
            {/* ══════════════════════════════════════════════════════════════
                LEFT PANEL — Collapsible Node Palette
               ══════════════════════════════════════════════════════════════ */}
            <div style={{
                width: leftPanelOpen ? 260 : 54,
                minWidth: leftPanelOpen ? 260 : 54,
                borderRight: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
                display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
                transition: 'width 0.2s ease, min-width 0.2s ease',
            }}>
                {/* Palette header */}
                <div style={{
                    padding: leftPanelOpen ? '8px 10px' : '8px 6px',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    minHeight: 48,
                    justifyContent: leftPanelOpen ? 'flex-start' : 'center',
                }}>
                    <button
                        onClick={() => router.push('/automations')}
                        style={{
                            display: 'flex', padding: '5px', borderRadius: '6px',
                            border: 'none', background: 'transparent', cursor: 'pointer',
                            color: 'var(--text-secondary)', flexShrink: 0,
                        }}
                        title="Back to automations"
                    >
                        <ArrowLeft size={16} />
                    </button>

                    {leftPanelOpen && (
                        <>
                            <div style={{
                                flex: 1, display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '5px 8px', borderRadius: '6px',
                                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                            }}>
                                <Search size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                                <input
                                    value={paletteSearch}
                                    onChange={e => setPaletteSearch(e.target.value)}
                                    placeholder="Search nodes..."
                                    style={{
                                        border: 'none', background: 'transparent', outline: 'none',
                                        fontSize: '0.76rem', color: 'var(--text-primary)', width: '100%',
                                    }}
                                />
                                {paletteSearch && (
                                    <button onClick={() => setPaletteSearch('')} style={{ display: 'flex', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0 }}>
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={() => setLeftPanelOpen(false)}
                                style={{
                                    display: 'flex', padding: '5px', borderRadius: '6px',
                                    border: 'none', background: 'transparent', cursor: 'pointer',
                                    color: 'var(--text-tertiary)', flexShrink: 0,
                                }}
                                title="Collapse panel"
                            >
                                <ChevronLeft size={14} />
                            </button>
                        </>
                    )}
                </div>

                {/* Collapsed state — vertical icon strip */}
                {!leftPanelOpen && (
                    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', gap: '2px' }}>
                        {/* Expand button */}
                        <button
                            onClick={() => setLeftPanelOpen(true)}
                            style={{
                                display: 'flex', padding: '6px', borderRadius: '8px',
                                border: 'none', background: 'transparent', cursor: 'pointer',
                                color: 'var(--text-tertiary)', marginBottom: '4px',
                            }}
                            title="Expand panel"
                        >
                            <ChevronRight size={14} />
                        </button>
                        {/* Show one icon per category */}
                        {catalog.map((cat: any) => (
                            <div key={cat.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', marginBottom: '4px' }}>
                                <div style={{
                                    width: 6, height: 6, borderRadius: '50%',
                                    background: cat.color || '#8b949e', margin: '4px 0 2px',
                                }} />
                                {(cat.nodes || []).map((n: any) => (
                                    <div
                                        key={n.type}
                                        draggable
                                        onDragStart={e => {
                                            e.dataTransfer.setData('application/reactflow', JSON.stringify({ ...n, category: cat.id }));
                                            e.dataTransfer.effectAllowed = 'move';
                                        }}
                                        title={n.label}
                                        onMouseEnter={() => setPaletteHover(`${cat.id}-${n.type}`)}
                                        onMouseLeave={() => setPaletteHover(null)}
                                        style={{
                                            width: 36, height: 36, borderRadius: '8px',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'grab',
                                            color: cat.color || '#8b949e',
                                            background: paletteHover === `${cat.id}-${n.type}` ? `${cat.color || '#8b949e'}18` : 'transparent',
                                            border: `1px solid ${paletteHover === `${cat.id}-${n.type}` ? `${cat.color || '#8b949e'}30` : 'transparent'}`,
                                            transition: 'all 0.1s',
                                        }}
                                    >
                                        {ICON_MAP[n.icon] || <Zap size={14} />}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}

                {/* Expanded state — list with icons + full labels */}
                {leftPanelOpen && (
                    <div style={{ flex: 1, overflow: 'auto', padding: '6px' }}>
                        {paletteSearch ? (
                            /* Search results */
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                {filteredNodes.length === 0 && (
                                    <div style={{ padding: '1.5rem 0.5rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.76rem' }}>
                                        No matching nodes
                                    </div>
                                )}
                                {filteredNodes.map(n => (
                                    <div
                                        key={`${n.category}-${n.type}`}
                                        draggable
                                        onDragStart={e => {
                                            e.dataTransfer.setData('application/reactflow', JSON.stringify({ ...n, category: n.category }));
                                            e.dataTransfer.effectAllowed = 'move';
                                        }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '8px',
                                            padding: '5px 8px', borderRadius: '8px', cursor: 'grab',
                                            color: 'var(--text-secondary)',
                                            border: '1px solid transparent',
                                            transition: 'all 0.1s',
                                        }}
                                        onMouseOver={e => { e.currentTarget.style.background = 'var(--bg-tertiary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                                        onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                                    >
                                        <div style={{
                                            width: 30, height: 30, borderRadius: '8px',
                                            background: `${n.categoryColor || CATEGORY_COLORS[n.category] || '#8b949e'}15`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: n.categoryColor || CATEGORY_COLORS[n.category] || '#8b949e',
                                            flexShrink: 0,
                                        }}>
                                            {ICON_MAP[n.icon] || <Zap size={14} />}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.76rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.label}</div>
                                            <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', lineHeight: 1.2 }}>{n.categoryLabel}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            /* Default — list view grouped by category */
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {catalog.map((cat: any) => (
                                    <div key={cat.id}>
                                        {/* Category label */}
                                        <div style={{
                                            fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
                                            letterSpacing: '0.8px', color: cat.color || 'var(--text-tertiary)',
                                            padding: '6px 8px 3px',
                                        }}>
                                            {cat.label}
                                        </div>
                                        {/* Nodes as rows with icon + label */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                            {(cat.nodes || []).map((n: any) => {
                                                const isHovered = paletteHover === `${cat.id}-${n.type}`;
                                                return (
                                                    <div
                                                        key={n.type}
                                                        draggable
                                                        onDragStart={e => {
                                                            e.dataTransfer.setData('application/reactflow', JSON.stringify({ ...n, category: cat.id }));
                                                            e.dataTransfer.effectAllowed = 'move';
                                                        }}
                                                        onMouseEnter={() => setPaletteHover(`${cat.id}-${n.type}`)}
                                                        onMouseLeave={() => setPaletteHover(null)}
                                                        title={n.description || n.label}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: '8px',
                                                            padding: '5px 8px', borderRadius: '8px',
                                                            cursor: 'grab',
                                                            background: isHovered ? `${cat.color || '#8b949e'}10` : 'transparent',
                                                            border: `1px solid ${isHovered ? `${cat.color || '#8b949e'}25` : 'transparent'}`,
                                                            transition: 'all 0.1s',
                                                        }}
                                                    >
                                                        <div style={{
                                                            width: 30, height: 30, borderRadius: '8px',
                                                            background: `${cat.color || '#8b949e'}15`,
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            color: cat.color || '#8b949e',
                                                            flexShrink: 0,
                                                            transition: 'all 0.12s',
                                                            transform: isHovered ? 'scale(1.06)' : 'scale(1)',
                                                        }}>
                                                            {ICON_MAP[n.icon] || <Zap size={14} />}
                                                        </div>
                                                        <span style={{
                                                            fontSize: '0.76rem', fontWeight: 500,
                                                            color: isHovered ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                            whiteSpace: 'nowrap', overflow: 'hidden',
                                                            textOverflow: 'ellipsis', transition: 'color 0.1s',
                                                        }}>
                                                            {n.label}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ══════════════════════════════════════════════════════════════
                CENTER — Canvas + Top Bar
               ══════════════════════════════════════════════════════════════ */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                {/* Top bar */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)', height: 48, minHeight: 48,
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        flex: 1, minWidth: 0,
                    }}>
                        <Workflow size={16} style={{ color: '#a371f7', flexShrink: 0 }} />
                        <input
                            value={workflowName}
                            onChange={e => setWorkflowName(e.target.value)}
                            style={{
                                border: 'none', background: 'transparent', fontSize: '0.88rem',
                                fontWeight: 700, color: 'var(--text-primary)', outline: 'none',
                                flex: 1, minWidth: 0,
                            }}
                            placeholder="Workflow Name"
                        />
                    </div>

                    {/* Status badge */}
                    {(() => {
                        const sc = workflowStatus === 'active' ? { bg: 'rgba(63,185,80,0.15)', c: '#3fb950', t: 'Active' }
                            : workflowStatus === 'paused' ? { bg: 'rgba(210,153,34,0.15)', c: '#d29922', t: 'Paused' }
                            : { bg: 'rgba(139,148,158,0.15)', c: '#8b949e', t: 'Draft' };
                        return (
                            <span style={{
                                fontSize: '0.68rem', padding: '3px 10px', borderRadius: '12px',
                                background: sc.bg, color: sc.c, fontWeight: 600,
                                whiteSpace: 'nowrap',
                            }}>
                                {sc.t}
                            </span>
                        );
                    })()}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button
                            onClick={handleRun}
                            title="Test Run"
                            style={{
                                display: 'flex', alignItems: 'center', gap: '4px',
                                padding: '5px 10px', borderRadius: '8px',
                                background: 'rgba(163,113,247,0.1)', border: '1px solid rgba(163,113,247,0.25)',
                                color: '#a371f7', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600,
                            }}
                        >
                            <Zap size={13} /> Test
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '4px',
                                padding: '5px 12px', borderRadius: '8px',
                                background: 'linear-gradient(135deg, #a371f7, #8957e5)',
                                border: 'none', color: '#fff', cursor: 'pointer',
                                fontSize: '0.76rem', fontWeight: 700,
                            }}
                        >
                            <Save size={13} /> {saving ? '...' : 'Save'}
                        </button>
                        <button
                            onClick={() => setRightPanelOpen(!rightPanelOpen)}
                            title={rightPanelOpen ? 'Close panel' : 'Open panel'}
                            style={{
                                display: 'flex', padding: '5px', borderRadius: '6px',
                                border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)',
                                cursor: 'pointer', color: 'var(--text-secondary)',
                            }}
                        >
                            {rightPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
                        </button>
                    </div>

                    {saveMsg && (
                        <span style={{
                            fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
                            color: saveMsg.startsWith('Error') || saveMsg.startsWith('Run') || saveMsg.startsWith('Save first') ? '#f85149' : '#3fb950',
                        }}>
                            {saveMsg}
                        </span>
                    )}
                </div>

                {/* Canvas */}
                <div ref={reactFlowWrapper} style={{ flex: 1, position: 'relative' }}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={onNodeClick}
                        onPaneClick={onPaneClick}
                        onInit={setReactFlowInstance}
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        nodeTypes={nodeTypes}
                        fitView
                        defaultEdgeOptions={{
                            animated: true,
                            style: { stroke: '#a371f7', strokeWidth: 2 },
                            markerEnd: { type: MarkerType.ArrowClosed, color: '#a371f7' },
                        }}
                        style={{ background: 'var(--bg-primary)' }}
                    >
                        <Background color="var(--border-color)" gap={20} size={1} />
                        <Controls
                            style={{
                                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                                borderRadius: '8px', overflow: 'hidden',
                            }}
                        />
                        <MiniMap
                            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                            nodeColor={(n) => CATEGORY_COLORS[n.data?.category] || '#8b949e'}
                        />
                        {nodes.length === 0 && (
                            <Panel position="top-center">
                                <div style={{
                                    padding: '2rem 3rem', textAlign: 'center',
                                    background: 'var(--bg-secondary)', borderRadius: '12px',
                                    border: '1px dashed var(--border-color)', marginTop: '15vh',
                                }}>
                                    <GitBranch size={40} color="#a371f7" style={{ marginBottom: '0.75rem' }} />
                                    <h3 style={{ color: 'var(--text-primary)', margin: '0 0 0.3rem', fontSize: '1rem' }}>
                                        Build Your Workflow
                                    </h3>
                                    <p style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem', margin: 0 }}>
                                        Drag nodes from the left panel onto the canvas
                                    </p>
                                </div>
                            </Panel>
                        )}
                    </ReactFlow>

                    {/* ── Floating Node Action Toolbar (Tines-style) ── */}
                    {selectedNode && (
                        <div
                            style={{
                                position: 'absolute',
                                left: '50%', bottom: showEventsPanel ? 220 : 24,
                                transform: 'translateX(-50%)',
                                display: 'flex', alignItems: 'center', gap: '2px',
                                padding: '4px 6px',
                                borderRadius: '12px',
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                                zIndex: 10,
                            }}
                        >
                            <ActionBtn icon={<Play size={14} />} label="Run" onClick={handleRun} />
                            <ActionBtn icon={<Zap size={14} />} label="Test" onClick={handleRun} />
                            <ActionBtn
                                icon={<Activity size={14} />}
                                label="Events"
                                active={showEventsPanel}
                                onClick={() => setShowEventsPanel(!showEventsPanel)}
                            />
                            <div style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 2px' }} />
                            <ActionBtn icon={<Copy size={14} />} label="Copy" onClick={duplicateSelectedNode} />
                            <ActionBtn icon={<Trash2 size={14} />} label="Delete" onClick={deleteSelectedNode} danger />
                        </div>
                    )}

                    {/* ── Bottom Events Panel ── */}
                    {showEventsPanel && selectedNode && (
                        <div style={{
                            position: 'absolute',
                            left: 0, right: 0, bottom: 0, height: 200,
                            background: 'var(--bg-secondary)',
                            borderTop: '1px solid var(--border-color)',
                            display: 'flex', flexDirection: 'column',
                            zIndex: 9,
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '8px 12px', borderBottom: '1px solid var(--border-color)',
                            }}>
                                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    Events — {selectedNode.data.label}
                                </span>
                                <button
                                    onClick={() => setShowEventsPanel(false)}
                                    style={{ display: 'flex', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px' }}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
                                {executionData?.node_logs?.filter((l: any) => l.node_type === selectedNode.data.nodeType).length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {executionData.node_logs
                                            .filter((l: any) => l.node_type === selectedNode.data.nodeType)
                                            .map((log: any, i: number) => (
                                                <div key={i} style={{
                                                    display: 'flex', alignItems: 'center', gap: '12px',
                                                    padding: '8px 10px', borderRadius: '6px',
                                                    background: 'var(--bg-tertiary)', fontSize: '0.75rem',
                                                }}>
                                                    <span style={{
                                                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                                        background: log.status === 'success' ? '#3fb950' : log.status === 'failed' ? '#f85149' : '#2f81f7',
                                                    }} />
                                                    <span style={{ color: 'var(--text-tertiary)', fontFamily: 'monospace', fontSize: '0.68rem' }}>
                                                        {log.id?.slice(0, 8) || `evt_${i}`}
                                                    </span>
                                                    <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{log.status}</span>
                                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.68rem' }}>
                                                        {log.duration_ms ? `${log.duration_ms}ms` : '—'}
                                                    </span>
                                                </div>
                                            ))
                                        }
                                    </div>
                                ) : (
                                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                                        <Activity size={20} style={{ marginBottom: '6px', opacity: 0.3 }} />
                                        <p style={{ margin: 0 }}>No events yet. Run the workflow to see events.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                RIGHT PANEL — Properties (Tines-style)
               ══════════════════════════════════════════════════════════════ */}
            {rightPanelOpen && (
                <div style={{
                    width: 340, minWidth: 340,
                    borderLeft: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                }}>
                    {selectedNode ? (
                        /* ── Node selected: Tabbed config panel ── */
                        <>
                            {/* Node header */}
                            <div style={{
                                padding: '12px 16px',
                                borderBottom: '1px solid var(--border-color)',
                                display: 'flex', alignItems: 'center', gap: '8px',
                            }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: '8px',
                                    background: `${CATEGORY_COLORS[selectedNode.data.category] || '#8b949e'}20`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: CATEGORY_COLORS[selectedNode.data.category] || '#8b949e',
                                }}>
                                    {ICON_MAP_LG[selectedNode.data.icon] || <Zap size={18} />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        {selectedNode.data.label}
                                    </div>
                                    <div style={{ fontSize: '0.68rem', color: CATEGORY_COLORS[selectedNode.data.category] || '#8b949e' }}>
                                        {selectedNode.data.nodeType}
                                    </div>
                                </div>
                                <button
                                    onClick={() => setSelectedNode(null)}
                                    style={{
                                        display: 'flex', border: 'none', background: 'transparent',
                                        cursor: 'pointer', color: 'var(--text-tertiary)', padding: '4px',
                                        borderRadius: '4px',
                                    }}
                                >
                                    <X size={14} />
                                </button>
                            </div>

                            {/* Tabs: Build | Test | Logs */}
                            <div style={{
                                display: 'flex', borderBottom: '1px solid var(--border-color)',
                                padding: '0 12px',
                            }}>
                                {(['build', 'test', 'logs'] as const).map(t => (
                                    <button
                                        key={t}
                                        onClick={() => setRightPanelTab(t)}
                                        style={{
                                            padding: '8px 14px', border: 'none', cursor: 'pointer',
                                            fontSize: '0.76rem', fontWeight: rightPanelTab === t ? 700 : 500,
                                            background: 'transparent',
                                            color: rightPanelTab === t ? '#a371f7' : 'var(--text-tertiary)',
                                            borderBottom: `2px solid ${rightPanelTab === t ? '#a371f7' : 'transparent'}`,
                                            marginBottom: '-1px',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        {t === 'build' ? 'Build' : t === 'test' ? 'Test' : 'Logs'}
                                    </button>
                                ))}
                            </div>

                            {/* Tab content */}
                            <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
                                {rightPanelTab === 'build' && renderConfigFields()}
                                {rightPanelTab === 'test' && renderTestPanel()}
                                {rightPanelTab === 'logs' && renderLogsPanel()}
                            </div>
                        </>
                    ) : (
                        /* ── No node selected: Workflow properties ── */
                        <>
                            <div style={{
                                padding: '12px 16px',
                                borderBottom: '1px solid var(--border-color)',
                                display: 'flex', alignItems: 'center', gap: '8px',
                            }}>
                                <Workflow size={16} style={{ color: '#a371f7' }} />
                                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    Workflow Properties
                                </span>
                            </div>
                            <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
                                {renderWorkflowProperties()}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Floating action bar button ──
function ActionBtn({ icon, label, onClick, danger, active }: {
    icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; active?: boolean;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            title={label}
            style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1px',
                padding: '6px 10px', borderRadius: '8px', border: 'none',
                cursor: 'pointer',
                background: active ? 'rgba(163,113,247,0.15)' : hovered
                    ? (danger ? 'rgba(248,81,73,0.12)' : 'rgba(139,148,158,0.1)')
                    : 'transparent',
                color: active ? '#a371f7' : danger
                    ? (hovered ? '#f85149' : 'var(--text-tertiary)')
                    : (hovered ? 'var(--text-primary)' : 'var(--text-tertiary)'),
                transition: 'all 0.12s',
            }}
        >
            {icon}
            <span style={{ fontSize: '0.58rem', fontWeight: 600 }}>{label}</span>
        </button>
    );
}

// ── Shared styles ──
const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.73rem', fontWeight: 600,
    color: 'var(--text-secondary)', marginBottom: '4px',
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.4rem 0.6rem', borderRadius: '6px',
    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none',
    boxSizing: 'border-box' as const,
};
