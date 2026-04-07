'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { automationApi } from '@/lib/api';
import Cookies from 'js-cookie';
import {
    Workflow, Plus, Play, Pause, Copy, Trash2, MoreVertical,
    Zap, CheckCircle, XCircle, Clock, AlertCircle, Search,
    LayoutTemplate, ArrowRight, RefreshCw, GitBranch, Filter,
    Key, Eye, EyeOff, Shield
} from 'lucide-react';

type ViewTab = 'workflows' | 'templates' | 'executions' | 'credentials';

export default function AutomationsPage() {
    const router = useRouter();
    const [tab, setTab] = useState<ViewTab>('workflows');
    const [workflows, setWorkflows] = useState<any[]>([]);
    const [templates, setTemplates] = useState<any[]>([]);
    const [executions, setExecutions] = useState<any[]>([]);
    const [credentials, setCredentials] = useState<any[]>([]);
    const [showCredModal, setShowCredModal] = useState(false);
    const [credForm, setCredForm] = useState({ name: '', integration: '', api_key: '' });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [actionMenuId, setActionMenuId] = useState<string | null>(null);

    const tenantId = Cookies.get('tenant_id') || '';

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            if (tab === 'workflows') {
                const params: any = {};
                if (tenantId) params.tenant_id = tenantId;
                if (statusFilter) params.status = statusFilter;
                const res = await automationApi.listWorkflows(params);
                setWorkflows(res.workflows || []);
            } else if (tab === 'templates') {
                const res = await automationApi.listTemplates();
                setTemplates(res.templates || []);
            } else if (tab === 'executions') {
                const params: any = {};
                if (tenantId) params.tenant_id = tenantId;
                const res = await automationApi.listExecutions(params);
                setExecutions(res.executions || []);
            } else if (tab === 'credentials') {
                const params: any = {};
                if (tenantId) params.tenant_id = tenantId;
                const res = await automationApi.listCredentials(params);
                setCredentials(res.credentials || []);
            }
        } catch (e: any) {
            console.error('Failed to fetch:', e);
        }
        setLoading(false);
    }, [tab, tenantId, statusFilter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleCreate = () => {
        router.push('/automations/builder');
    };

    const handlePublish = async (id: string) => {
        try {
            await automationApi.publishWorkflow(id);
            fetchData();
        } catch (e) { console.error(e); }
        setActionMenuId(null);
    };

    const handlePause = async (id: string) => {
        try {
            await automationApi.pauseWorkflow(id);
            fetchData();
        } catch (e) { console.error(e); }
        setActionMenuId(null);
    };

    const handleClone = async (id: string) => {
        try {
            await automationApi.cloneWorkflow(id);
            fetchData();
        } catch (e) { console.error(e); }
        setActionMenuId(null);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Archive this workflow?')) return;
        try {
            await automationApi.deleteWorkflow(id);
            fetchData();
        } catch (e) { console.error(e); }
        setActionMenuId(null);
    };

    const [templateLoading, setTemplateLoading] = useState<string | null>(null);

    const handleUseTemplate = async (id: string) => {
        setTemplateLoading(id);
        try {
            const res = await automationApi.useTemplate(id);
            if (res?.id) {
                router.push(`/automations/builder?id=${res.id}`);
            } else {
                alert('Failed to create workflow from template');
            }
        } catch (e: any) {
            console.error(e);
            alert(`Error: ${e?.message || 'Failed to use template'}`);
        }
        setTemplateLoading(null);
    };

    const handleExecute = async (id: string) => {
        try {
            await automationApi.executeWorkflow(id, { input_data: {} });
            setTab('executions');
            fetchData();
        } catch (e) { console.error(e); }
        setActionMenuId(null);
    };

    const statusColor = (s: string) => {
        switch (s) {
            case 'active': return { bg: 'rgba(63,185,80,0.12)', color: '#3fb950' };
            case 'draft': return { bg: 'rgba(139,148,158,0.12)', color: '#8b949e' };
            case 'paused': return { bg: 'rgba(210,153,34,0.12)', color: '#d29922' };
            case 'archived': return { bg: 'rgba(139,148,158,0.08)', color: '#636c76' };
            case 'success': return { bg: 'rgba(63,185,80,0.12)', color: '#3fb950' };
            case 'failed': return { bg: 'rgba(248,81,73,0.12)', color: '#f85149' };
            case 'running': return { bg: 'rgba(47,129,247,0.12)', color: '#2f81f7' };
            default: return { bg: 'rgba(139,148,158,0.12)', color: '#8b949e' };
        }
    };

    const filtered = (items: any[]) => {
        if (!searchTerm) return items;
        const s = searchTerm.toLowerCase();
        return items.filter(i => (i.name || i.workflow_name || '').toLowerCase().includes(s) || (i.description || '').toLowerCase().includes(s));
    };

    const fmtDate = (d: string) => {
        if (!d) return '—';
        const dt = new Date(d);
        return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    };

    const tabItems: { key: ViewTab; label: string; icon: React.ReactNode; count?: number }[] = [
        { key: 'workflows', label: 'Workflows', icon: <Workflow size={16} />, count: workflows.length },
        { key: 'templates', label: 'Templates', icon: <LayoutTemplate size={16} />, count: templates.length },
        { key: 'executions', label: 'Execution History', icon: <Clock size={16} />, count: executions.length },
        { key: 'credentials', label: 'Credentials', icon: <Key size={16} />, count: credentials.length },
    ];

    const handleCreateCredential = async () => {
        if (!credForm.name || !credForm.integration || !credForm.api_key) return;
        try {
            await automationApi.createCredential(credForm);
            setCredForm({ name: '', integration: '', api_key: '' });
            setShowCredModal(false);
            fetchData();
        } catch (e) { console.error(e); }
    };

    const handleDeleteCredential = async (id: string) => {
        if (!confirm('Delete this credential?')) return;
        try {
            await automationApi.deleteCredential(id);
            fetchData();
        } catch (e) { console.error(e); }
    };

    const integrationOptions = [
        { value: 'freshdesk', label: 'Freshdesk', color: '#22c55e' },
        { value: 'onedesk', label: 'OneDesk', color: '#3b82f6' },
        { value: 'virustotal', label: 'VirusTotal', color: '#1a73e8' },
        { value: 'abuseipdb', label: 'AbuseIPDB', color: '#e53935' },
        { value: 'shodan', label: 'Shodan', color: '#c73834' },
        { value: 'hybrid_analysis', label: 'Hybrid Analysis', color: '#f57c00' },
        { value: 'urlscan', label: 'URLScan.io', color: '#00897b' },
        { value: 'greynoise', label: 'GreyNoise', color: '#7b1fa2' },
        { value: 'otx', label: 'AlienVault OTX', color: '#1565c0' },
        { value: 'custom', label: 'Custom / Other', color: '#8b949e' },
    ];

    return (
        <div className="app-container">
            <Sidebar />
            <main className="main-layout" style={{ padding: '2rem', overflow: 'auto' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <div>
                        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Workflow size={28} color="#a371f7" /> Automation Builder
                        </h1>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.3rem 0 0' }}>
                            Create drag-and-drop workflows to automate SOC operations
                        </p>
                    </div>
                    <button
                        onClick={handleCreate}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.65rem 1.2rem', borderRadius: '8px',
                            background: 'linear-gradient(135deg, #a371f7, #8957e5)',
                            color: '#fff', border: 'none', cursor: 'pointer',
                            fontWeight: 700, fontSize: '0.85rem',
                            boxShadow: '0 2px 8px rgba(163,113,247,0.3)',
                        }}
                    >
                        <Plus size={18} /> New Workflow
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '2px', marginBottom: '1.2rem', background: 'var(--bg-secondary)', borderRadius: '10px', padding: '4px' }}>
                    {tabItems.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                                padding: '0.6rem 1rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                fontWeight: tab === t.key ? 700 : 500, fontSize: '0.82rem',
                                background: tab === t.key ? 'var(--bg-primary)' : 'transparent',
                                color: tab === t.key ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                                transition: 'all 0.15s',
                            }}
                        >
                            {t.icon} {t.label}
                            {t.count !== undefined && (
                                <span style={{
                                    fontSize: '0.7rem', padding: '1px 6px', borderRadius: '10px',
                                    background: tab === t.key ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
                                    color: tab === t.key ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                                    fontWeight: 600,
                                }}>{t.count}</span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Search + Filter Bar */}
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
                    <div style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.5rem 0.75rem', borderRadius: '8px',
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                    }}>
                        <Search size={16} color="var(--text-tertiary)" />
                        <input
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            placeholder="Search workflows..."
                            style={{
                                flex: 1, border: 'none', background: 'transparent',
                                color: 'var(--text-primary)', fontSize: '0.83rem', outline: 'none',
                            }}
                        />
                    </div>
                    {tab === 'workflows' && (
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            style={{
                                padding: '0.5rem 0.75rem', borderRadius: '8px', fontSize: '0.83rem',
                                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                                color: 'var(--text-primary)', cursor: 'pointer',
                            }}
                        >
                            <option value="">All Status</option>
                            <option value="draft">Draft</option>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                        </select>
                    )}
                    <button
                        onClick={fetchData}
                        style={{
                            display: 'flex', alignItems: 'center', padding: '0.5rem',
                            borderRadius: '8px', border: '1px solid var(--border-color)',
                            background: 'var(--bg-secondary)', cursor: 'pointer', color: 'var(--text-secondary)',
                        }}
                    >
                        <RefreshCw size={16} />
                    </button>
                </div>

                {/* Content */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-tertiary)' }}>
                        Loading...
                    </div>
                ) : tab === 'workflows' ? (
                    /* ── Workflows Grid ── */
                    filtered(workflows).length === 0 ? (
                        <div style={{
                            textAlign: 'center', padding: '4rem 2rem',
                            background: 'var(--bg-secondary)', borderRadius: '12px',
                            border: '1px dashed var(--border-color)',
                        }}>
                            <Workflow size={48} color="var(--text-tertiary)" style={{ marginBottom: '1rem' }} />
                            <h3 style={{ color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>No workflows yet</h3>
                            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', margin: '0 0 1.5rem' }}>
                                Create your first automation or start from a template
                            </p>
                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                                <button onClick={handleCreate} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                    padding: '0.5rem 1rem', borderRadius: '8px',
                                    background: 'linear-gradient(135deg, #a371f7, #8957e5)',
                                    color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem',
                                }}>
                                    <Plus size={16} /> New Workflow
                                </button>
                                <button onClick={() => setTab('templates')} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                    padding: '0.5rem 1rem', borderRadius: '8px',
                                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                    color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem',
                                }}>
                                    <LayoutTemplate size={16} /> Browse Templates
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
                            {filtered(workflows).map((wf: any) => {
                                const sc = statusColor(wf.status);
                                return (
                                    <div
                                        key={wf.id}
                                        style={{
                                            background: 'var(--bg-secondary)', borderRadius: '12px',
                                            border: '1px solid var(--border-color)', padding: '1.25rem',
                                            cursor: 'pointer', transition: 'all 0.15s',
                                            position: 'relative',
                                        }}
                                        onClick={() => router.push(`/automations/builder?id=${wf.id}`)}
                                        onMouseOver={e => { e.currentTarget.style.borderColor = '#a371f7'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(163,113,247,0.15)'; }}
                                        onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none'; }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <div style={{
                                                    width: 36, height: 36, borderRadius: '10px',
                                                    background: 'linear-gradient(135deg, rgba(163,113,247,0.15), rgba(137,87,229,0.1))',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                }}>
                                                    <GitBranch size={18} color="#a371f7" />
                                                </div>
                                                <div>
                                                    <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                                                        {wf.name}
                                                    </h3>
                                                    <span style={{
                                                        fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px',
                                                        background: sc.bg, color: sc.color, fontWeight: 600,
                                                    }}>{wf.status}</span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={e => { e.stopPropagation(); setActionMenuId(actionMenuId === wf.id ? null : wf.id); }}
                                                style={{ padding: '4px', borderRadius: '6px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)' }}
                                            >
                                                <MoreVertical size={16} />
                                            </button>
                                            {actionMenuId === wf.id && (
                                                <div
                                                    onClick={e => e.stopPropagation()}
                                                    style={{
                                                        position: 'absolute', right: 12, top: 48, zIndex: 100,
                                                        background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                                                        borderRadius: '8px', padding: '4px', minWidth: 160,
                                                        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                                                    }}
                                                >
                                                    {wf.status === 'draft' && (
                                                        <button onClick={() => handlePublish(wf.id)} style={menuBtnStyle}><Play size={14} color="#3fb950" /> Activate</button>
                                                    )}
                                                    {wf.status === 'active' && (
                                                        <button onClick={() => handlePause(wf.id)} style={menuBtnStyle}><Pause size={14} color="#d29922" /> Pause</button>
                                                    )}
                                                    {wf.status === 'paused' && (
                                                        <button onClick={() => handlePublish(wf.id)} style={menuBtnStyle}><Play size={14} color="#3fb950" /> Resume</button>
                                                    )}
                                                    <button onClick={() => handleExecute(wf.id)} style={menuBtnStyle}><Zap size={14} color="#a371f7" /> Run Now</button>
                                                    <button onClick={() => handleClone(wf.id)} style={menuBtnStyle}><Copy size={14} /> Duplicate</button>
                                                    <div style={{ borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />
                                                    <button onClick={() => handleDelete(wf.id)} style={{ ...menuBtnStyle, color: '#f85149' }}><Trash2 size={14} /> Archive</button>
                                                </div>
                                            )}
                                        </div>
                                        {wf.description && (
                                            <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: '0 0 0.75rem', lineHeight: 1.4 }}>
                                                {wf.description.length > 100 ? wf.description.slice(0, 100) + '...' : wf.description}
                                            </p>
                                        )}
                                        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.73rem', color: 'var(--text-tertiary)' }}>
                                            <span>{wf.node_count || 0} nodes</span>
                                            <span>{wf.execution_count || 0} runs</span>
                                            {wf.last_run_status && (
                                                <span style={{ color: statusColor(wf.last_run_status).color }}>
                                                    Last: {wf.last_run_status}
                                                </span>
                                            )}
                                            <span style={{ marginLeft: 'auto' }}>{fmtDate(wf.updated_at)}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )
                ) : tab === 'templates' ? (
                    /* ── Templates Grid ── */
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
                        {filtered(templates).map((t: any) => (
                            <div
                                key={t.id}
                                style={{
                                    background: 'var(--bg-secondary)', borderRadius: '12px',
                                    border: '1px solid var(--border-color)', padding: '1.25rem',
                                    transition: 'all 0.15s',
                                }}
                                onMouseOver={e => { e.currentTarget.style.borderColor = '#a371f7'; }}
                                onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                    <LayoutTemplate size={20} color="#a371f7" />
                                    <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t.name}</h3>
                                </div>
                                {t.category && (
                                    <span style={{
                                        display: 'inline-block', fontSize: '0.68rem', padding: '2px 8px', borderRadius: '6px',
                                        background: 'rgba(163,113,247,0.12)', color: '#a371f7', fontWeight: 600,
                                        marginBottom: '0.5rem',
                                    }}>{t.category}</span>
                                )}
                                <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: '0 0 1rem', lineHeight: 1.4 }}>
                                    {t.description}
                                </p>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{t.usage_count || 0} uses</span>
                                    <button
                                        onClick={() => handleUseTemplate(t.id)}
                                        disabled={templateLoading === t.id}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.3rem',
                                            padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.78rem',
                                            background: templateLoading === t.id ? 'rgba(163,113,247,0.3)' : 'linear-gradient(135deg, #a371f7, #8957e5)',
                                            color: '#fff', border: 'none', cursor: templateLoading === t.id ? 'wait' : 'pointer', fontWeight: 600,
                                            opacity: templateLoading === t.id ? 0.7 : 1,
                                        }}
                                    >
                                        {templateLoading === t.id ? 'Creating...' : <>Use Template <ArrowRight size={14} /></>}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : tab === 'executions' ? (
                    /* ── Execution History ── */
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    {['Workflow', 'Trigger', 'Status', 'Duration', 'Nodes', 'Started At'].map(h => (
                                        <th key={h} style={{
                                            padding: '0.75rem 1rem', textAlign: 'left',
                                            color: 'var(--text-tertiary)', fontWeight: 600, fontSize: '0.75rem',
                                            textTransform: 'uppercase', letterSpacing: '0.03em',
                                        }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered(executions).length === 0 ? (
                                    <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>No executions yet</td></tr>
                                ) : filtered(executions).map((ex: any) => {
                                    const sc = statusColor(ex.status);
                                    return (
                                        <tr
                                            key={ex.id}
                                            style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                                            onClick={() => router.push(`/automations/builder?id=${ex.workflow_id}&execution=${ex.id}`)}
                                            onMouseOver={e => { e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                                            onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
                                        >
                                            <td style={{ padding: '0.65rem 1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{ex.workflow_name || 'Unknown'}</td>
                                            <td style={{ padding: '0.65rem 1rem', color: 'var(--text-secondary)' }}>{ex.trigger_type}</td>
                                            <td style={{ padding: '0.65rem 1rem' }}>
                                                <span style={{ fontSize: '0.73rem', padding: '2px 8px', borderRadius: '6px', background: sc.bg, color: sc.color, fontWeight: 600 }}>
                                                    {ex.status}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.65rem 1rem', color: 'var(--text-secondary)' }}>
                                                {ex.duration_ms ? `${(ex.duration_ms / 1000).toFixed(1)}s` : '—'}
                                            </td>
                                            <td style={{ padding: '0.65rem 1rem', color: 'var(--text-secondary)' }}>
                                                {ex.nodes_executed || 0} / {ex.nodes_total || 0}
                                                {(ex.nodes_failed || 0) > 0 && <span style={{ color: '#f85149', marginLeft: '4px' }}>({ex.nodes_failed} failed)</span>}
                                            </td>
                                            <td style={{ padding: '0.65rem 1rem', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>{fmtDate(ex.started_at)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    /* ── Credentials Management ── */
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.83rem', margin: 0 }}>
                                Store API keys for enrichment integrations. Credentials are encrypted and used by workflow nodes.
                            </p>
                            <button
                                onClick={() => setShowCredModal(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                    padding: '0.5rem 1rem', borderRadius: '8px',
                                    background: 'linear-gradient(135deg, #a371f7, #8957e5)',
                                    color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem',
                                }}
                            >
                                <Plus size={16} /> Add Credential
                            </button>
                        </div>

                        {credentials.length === 0 ? (
                            <div style={{
                                textAlign: 'center', padding: '4rem 2rem',
                                background: 'var(--bg-secondary)', borderRadius: '12px',
                                border: '1px dashed var(--border-color)',
                            }}>
                                <Key size={48} color="var(--text-tertiary)" style={{ marginBottom: '1rem' }} />
                                <h3 style={{ color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>No credentials stored</h3>
                                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', margin: '0 0 1.5rem' }}>
                                    Add API keys for VirusTotal, AbuseIPDB, and other integrations
                                </p>
                                <button onClick={() => setShowCredModal(true)} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem', margin: '0 auto',
                                    padding: '0.5rem 1rem', borderRadius: '8px',
                                    background: 'linear-gradient(135deg, #a371f7, #8957e5)',
                                    color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem',
                                }}>
                                    <Plus size={16} /> Add Your First Credential
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
                                {credentials.map((cred: any) => {
                                    const integ = integrationOptions.find(i => i.value === cred.integration);
                                    return (
                                        <div
                                            key={cred.id}
                                            style={{
                                                background: 'var(--bg-secondary)', borderRadius: '12px',
                                                border: '1px solid var(--border-color)', padding: '1.25rem',
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <div style={{
                                                        width: 36, height: 36, borderRadius: '10px',
                                                        background: `${integ?.color || '#8b949e'}20`,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    }}>
                                                        <Shield size={18} color={integ?.color || '#8b949e'} />
                                                    </div>
                                                    <div>
                                                        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{cred.name}</h3>
                                                        <span style={{
                                                            fontSize: '0.7rem', padding: '2px 8px', borderRadius: '6px',
                                                            background: `${integ?.color || '#8b949e'}18`, color: integ?.color || '#8b949e',
                                                            fontWeight: 600,
                                                        }}>{integ?.label || cred.integration}</span>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleDeleteCredential(cred.id)}
                                                    style={{ padding: '4px', borderRadius: '6px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)' }}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.73rem', color: 'var(--text-tertiary)' }}>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><EyeOff size={12} /> {cred.api_key_preview}</span>
                                                <span>Created by: {cred.created_by || 'system'}</span>
                                                <span style={{ marginLeft: 'auto' }}>{fmtDate(cred.created_at)}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Add Credential Modal */}
                        {showCredModal && (
                            <div style={{
                                position: 'fixed', inset: 0, zIndex: 1000,
                                background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                                onClick={() => setShowCredModal(false)}
                            >
                                <div
                                    onClick={e => e.stopPropagation()}
                                    style={{
                                        background: 'var(--bg-secondary)', borderRadius: '16px',
                                        border: '1px solid var(--border-color)', padding: '2rem',
                                        width: '100%', maxWidth: 460,
                                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                                    }}
                                >
                                    <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Key size={22} color="#a371f7" /> Add Credential
                                    </h2>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Name</label>
                                            <input
                                                type="text"
                                                value={credForm.name}
                                                onChange={e => setCredForm({ ...credForm, name: e.target.value })}
                                                placeholder="e.g. Production VT Key"
                                                style={{
                                                    width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px',
                                                    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
                                                    color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
                                                    boxSizing: 'border-box',
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Integration</label>
                                            <select
                                                value={credForm.integration}
                                                onChange={e => setCredForm({ ...credForm, integration: e.target.value })}
                                                style={{
                                                    width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px',
                                                    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
                                                    color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
                                                    boxSizing: 'border-box',
                                                }}
                                            >
                                                <option value="">Select integration...</option>
                                                {integrationOptions.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>API Key</label>
                                            <input
                                                type="password"
                                                value={credForm.api_key}
                                                onChange={e => setCredForm({ ...credForm, api_key: e.target.value })}
                                                placeholder="Enter your API key"
                                                style={{
                                                    width: '100%', padding: '0.55rem 0.75rem', borderRadius: '8px',
                                                    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
                                                    color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
                                                    fontFamily: 'monospace', boxSizing: 'border-box',
                                                }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                                        <button
                                            onClick={() => setShowCredModal(false)}
                                            style={{
                                                padding: '0.5rem 1rem', borderRadius: '8px',
                                                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                                color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.83rem',
                                            }}
                                        >Cancel</button>
                                        <button
                                            onClick={handleCreateCredential}
                                            disabled={!credForm.name || !credForm.integration || !credForm.api_key}
                                            style={{
                                                padding: '0.5rem 1rem', borderRadius: '8px',
                                                background: (!credForm.name || !credForm.integration || !credForm.api_key) ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, #a371f7, #8957e5)',
                                                color: (!credForm.name || !credForm.integration || !credForm.api_key) ? 'var(--text-tertiary)' : '#fff',
                                                border: 'none', cursor: (!credForm.name || !credForm.integration || !credForm.api_key) ? 'not-allowed' : 'pointer',
                                                fontWeight: 700, fontSize: '0.83rem',
                                            }}
                                        >
                                            Save Credential
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

const menuBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
    padding: '0.45rem 0.75rem', border: 'none', borderRadius: '6px',
    background: 'transparent', cursor: 'pointer', fontSize: '0.8rem',
    color: 'var(--text-secondary)', textAlign: 'left' as const,
    fontWeight: 500,
};
