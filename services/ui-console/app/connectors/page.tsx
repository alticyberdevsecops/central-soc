'use client';

import React, { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { Settings, Shield, Power, ExternalLink, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { tenantApi, apiRequest } from '@/lib/api';
import Cookies from 'js-cookie';

export default function Connectors() {
    const [connectors, setConnectors] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState<string | null>(null);
    const [editingConnector, setEditingConnector] = useState<any | null>(null);
    const [editForm, setEditForm] = useState({ api_key: '', api_key_id: '', base_url: '', is_enabled: false });
    const [isSaving, setIsSaving] = useState(false);

    const fetchConnectors = async () => {
        const userRole = Cookies.get('user_role') || '';
        const tenantId = Cookies.get('tenant_id') || '';
        try {
            if (userRole === 'super_admin') {
                const data = await tenantApi.list();
                const allTenants = data.tenants || [];
                const promises = allTenants.map((t: any) => tenantApi.listConnectors(t.id).catch(() => ({ connectors: [] })));
                const results = await Promise.all(promises);
                const combined = results.flatMap((r: any, idx: number) => {
                    return (r.connectors || []).map((conn: any) => ({
                        ...conn,
                        tenant_name: allTenants[idx].name
                    }));
                });
                setConnectors(combined);
            } else if (tenantId) {
                const data = await tenantApi.listConnectors(tenantId);
                setConnectors(data.connectors || []);
            }
        } catch (err) {
            console.error("Failed to load connectors:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConnectors();
    }, []);

    const handleToggle = async (connector: any) => {
        setToggling(connector.id);
        try {
            await tenantApi.updateConnector(connector.tenant_id, connector.id, { is_enabled: !connector.is_enabled });
            await fetch('/api/connectors/reload', { method: 'POST' }).catch(() => { });
            try { await apiRequest('/connectors/reload', { method: 'POST' }); } catch (e) { }
            await fetchConnectors();
        } catch (err) {
            console.error("Failed to toggle connector:", err);
            alert("Failed to update connector status");
        } finally {
            setToggling(null);
        }
    };

    const openEditModal = (connector: any) => {
        setEditingConnector(connector);
        setEditForm({
            api_key: connector.credentials?.api_key || '',
            api_key_id: connector.credentials?.api_key_id || '',
            base_url: connector.credentials?.base_url || '',
            is_enabled: connector.is_enabled
        });
    };

    const closeEditModal = () => {
        setEditingConnector(null);
    };

    const handleSaveConnector = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingConnector) return;
        setIsSaving(true);
        try {
            await tenantApi.updateConnector(editingConnector.tenant_id, editingConnector.id, {
                is_enabled: editForm.is_enabled,
                credentials: {
                    api_key: editForm.api_key,
                    api_key_id: editForm.api_key_id,
                    base_url: editForm.base_url
                }
            });
            await fetch('/api/connectors/reload', { method: 'POST' }).catch(() => { });
            try { await apiRequest('/connectors/reload', { method: 'POST' }); } catch (err) { }
            await fetchConnectors();
            closeEditModal();
        } catch (err) {
            console.error("Failed to update connector settings:", err);
            alert("Failed to update connector. Please check your inputs.");
        } finally {
            setIsSaving(false);
        }
    };

    const activeCount = connectors.filter(c => c.is_enabled).length;
    const failureCount = connectors.filter(c => c.last_poll_status === 'error').length;
    const vendorMap: any = { xsiam: 'Palo Alto XSIAM', crowdstrike: 'CrowdStrike Falcon', defender: 'Microsoft Defender', sentinelone: 'SentinelOne' };

    return (
        <div className="app-container">
            <Sidebar />
            <div className="main-layout">
                <header className="header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Data Connectors</h2>
                        <div className="status-badge" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                            {activeCount}/{connectors.length} ACTIVE
                        </div>
                    </div>
                </header>

                <main className="content-area">
                    <div className="stat-card-grid">
                        <div className="stat-card">
                            <span className="info-label">Ingestion Rate</span>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0.25rem 0' }}>~4.2k <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>EPS</span></div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Static bandwidth metric</span>
                        </div>
                        <div className={`stat-card ${failureCount > 0 ? 'warning' : 'success'}`}>
                            <span className="info-label">Connector Failures</span>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0.25rem 0', color: failureCount > 0 ? 'var(--status-critical)' : 'inherit' }}>{failureCount}</div>
                            <span style={{ fontSize: '0.75rem', color: failureCount > 0 ? 'var(--status-critical)' : 'var(--status-low)' }}>
                                {failureCount > 0 ? 'Review connector logs' : 'All live connectors healthy'}
                            </span>
                        </div>
                    </div>

                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem' }}>
                            <Loader2 className="animate-spin text-gray-500" size={32} />
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
                            {connectors.length === 0 && (
                                <div className="detail-card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem' }}>
                                    <AlertCircle size={48} className="text-[#848d97] mx-auto mb-4" />
                                    <h3 className="text-xl font-bold mb-2">No Connectors Found</h3>
                                    <p className="text-[#848d97]">There are no provisioned integrations for this environment yet.</p>
                                </div>
                            )}
                            {connectors.map((connector) => (
                                <div key={connector.id} className="detail-card" style={{ gap: '1rem', border: connector.is_enabled ? '1px solid var(--border-color)' : '1px dashed var(--border-color)', opacity: connector.is_enabled ? 1 : 0.7 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-md)', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Shield size={20} style={{ color: connector.is_enabled ? 'var(--accent-primary)' : 'var(--text-tertiary)' }} />
                                            </div>
                                            <div>
                                                <h4 style={{ fontWeight: 700, fontSize: '1rem' }}>{connector.label || vendorMap[connector.vendor] || connector.vendor}</h4>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                                                    {connector.tenant_name ? `${connector.tenant_name} • ` : ''}{connector.vendor}
                                                </span>
                                            </div>
                                        </div>
                                        <div style={{
                                            padding: '0.25rem 0.5rem',
                                            borderRadius: '4px',
                                            fontSize: '0.65rem',
                                            fontWeight: 800,
                                            background: connector.is_enabled ? 'rgba(63, 185, 80, 0.1)' : 'rgba(243, 167, 71, 0.1)',
                                            color: connector.is_enabled ? 'var(--status-low)' : '#f3a747',
                                            border: `1px solid ${connector.is_enabled ? 'rgba(63, 185, 80, 0.2)' : 'rgba(243, 167, 71, 0.2)'}`
                                        }}>
                                            {connector.is_enabled ? 'LIVE' : 'PAUSED'}
                                        </div>
                                    </div>

                                    <div className="info-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                        <div className="info-item">
                                            <span className="info-label">Interval</span>
                                            <span className="info-value">{connector.poll_interval_sec} sec</span>
                                        </div>
                                        <div className="info-item">
                                            <span className="info-label">Last Sync Status</span>
                                            <span className="info-value" style={{ color: connector.last_poll_status === 'error' ? 'var(--status-critical)' : 'inherit' }}>
                                                {connector.last_poll_status ? connector.last_poll_status.toUpperCase() : 'PENDING'}
                                            </span>
                                        </div>
                                    </div>

                                    {connector.last_error_msg && (
                                        <div style={{ marginTop: '0.5rem', padding: '0.5rem', borderRadius: '4px', background: 'rgba(248, 81, 73, 0.1)', border: '1px solid rgba(248, 81, 73, 0.2)', fontSize: '0.75rem', color: 'var(--status-critical)' }}>
                                            <strong style={{ display: 'block', marginBottom: '0.2rem' }}>Error Detail:</strong>
                                            {connector.last_error_msg}
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                                        <button
                                            onClick={() => handleToggle(connector)}
                                            disabled={toggling === connector.id}
                                            style={{
                                                flex: 1,
                                                padding: '0.5rem',
                                                background: connector.is_enabled ? 'var(--bg-tertiary)' : 'var(--accent-primary)',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-md)',
                                                color: connector.is_enabled ? 'var(--text-primary)' : 'white',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '0.5rem',
                                                cursor: toggling === connector.id ? 'wait' : 'pointer'
                                            }}
                                        >
                                            {toggling === connector.id ? (
                                                <Loader2 size={14} className="animate-spin" />
                                            ) : (
                                                connector.is_enabled ? <><Power size={14} /> Pause</> : <><RefreshCw size={14} /> Resume</>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => openEditModal(connector)}
                                            style={{
                                                padding: '0.5rem',
                                                background: 'var(--bg-tertiary)',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-md)',
                                                color: 'var(--text-secondary)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                cursor: 'pointer'
                                            }}>
                                            <Settings size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </main>

                {editingConnector && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeEditModal} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
                        <div className="bg-[#1c2128] border border-[#30363d] rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', width: '100%', maxWidth: '450px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Shield size={18} style={{ color: 'var(--accent-primary)' }} />
                                    Edit Connector
                                </h3>
                                <button onClick={closeEditModal} style={{ color: 'var(--text-tertiary)', background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
                            </div>

                            <form onSubmit={handleSaveConnector} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Base URL</label>
                                    <input
                                        type="url"
                                        placeholder="https://api-xyz.xdr.in.paloaltonetworks.com"
                                        value={editForm.base_url}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, base_url: e.target.value }))}
                                        style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                        required
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>API Key ID</label>
                                    <input
                                        type="text"
                                        value={editForm.api_key_id}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, api_key_id: e.target.value }))}
                                        style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                        required
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)' }}>API Key</label>
                                    <input
                                        type="password"
                                        value={editForm.api_key}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, api_key: e.target.value }))}
                                        style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
                                        required
                                    />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                    <input
                                        type="checkbox"
                                        id="enableConnector"
                                        checked={editForm.is_enabled}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, is_enabled: e.target.checked }))}
                                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                    />
                                    <label htmlFor="enableConnector" style={{ fontSize: '0.9rem', cursor: 'pointer', flex: 1 }}>Enable Connector Data Fetching</label>
                                </div>

                                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                    <button
                                        type="button"
                                        onClick={closeEditModal}
                                        style={{ flex: 1, padding: '0.6rem', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', borderRadius: '4px', fontWeight: 600, cursor: 'pointer' }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isSaving}
                                        style={{ flex: 1, padding: '0.6rem', border: 'none', background: 'var(--accent-primary)', color: 'white', borderRadius: '4px', fontWeight: 600, cursor: isSaving ? 'wait' : 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                                    >
                                        {isSaving && <Loader2 size={16} className="animate-spin" />}
                                        {isSaving ? 'Saving...' : 'Save Configuration'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}
