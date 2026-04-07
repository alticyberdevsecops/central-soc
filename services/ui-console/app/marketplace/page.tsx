'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import {
    Store, Puzzle, CheckCircle, XCircle, ChevronDown, ChevronUp,
    Eye, EyeOff, Copy, Check, Loader2, AlertCircle, Globe, Key, Mail,
    ToggleLeft, ToggleRight, Users, RefreshCw, Trash2, ExternalLink
} from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import { tenantApi, integrationApi } from '@/lib/api';

// ─── Brand constants ──────────────────────────────────────────────────────────
const FS_COLOR = '#00AC69';
const SN_COLOR = '#81B5A1';
const FD_COLOR = '#0176D3';

// ─── Helpers ────────────────────────────────────────────────────────────────
function getWebhookUrl(tenantId: string): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.protocol}//${window.location.hostname}:8012/incidents/webhooks/freshservice?tenant_id=${tenantId}`;
}

function getSnWebhookUrl(tenantId: string): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.protocol}//${window.location.hostname}:8012/incidents/webhooks/servicenow?tenant_id=${tenantId}`;
}

function getFdWebhookUrl(tenantId: string): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.protocol}//${window.location.hostname}:8012/incidents/webhooks/freshdesk?tenant_id=${tenantId}`;
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function MarketplacePage() {
    const router = useRouter();
    const userRole = Cookies.get('user_role') || '';
    const myTenantId = Cookies.get('tenant_id') || '';
    const isAdmin = userRole === 'super_admin' || userRole === 'customer_admin';
    const isSuperAdmin = userRole === 'super_admin';

    const [activeTab, setActiveTab] = useState<'integrations'>('integrations');
    const [tenants, setTenants] = useState<any[]>([]);
    const [configs, setConfigs] = useState<Record<string, any>>({});      // tenantId → freshservice config
    const [snConfigs, setSnConfigs] = useState<Record<string, any>>({});  // tenantId → servicenow config
    const [fdConfigs, setFdConfigs] = useState<Record<string, any>>({});  // tenantId → freshdesk config
    const [loading, setLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);

    // Redirect non-admins
    useEffect(() => {
        if (!isAdmin) { router.replace('/dashboard'); }
    }, []);

    // Load tenants + configs
    useEffect(() => {
        if (!isAdmin) return;
        setLoading(true);
        const load = async () => {
            try {
                if (isSuperAdmin) {
                    const { tenants: all } = await tenantApi.list();
                    setTenants(all || []);
                    const results = await Promise.allSettled(
                        (all || []).map((t: any) =>
                            integrationApi.listConfigs(t.id).catch(() => ({ integrations: [] }))
                        )
                    );
                    const map: Record<string, any> = {};
                    const snMap: Record<string, any> = {};
                    const fdMap: Record<string, any> = {};
                    (all || []).forEach((t: any, i: number) => {
                        const r = results[i];
                        if (r.status === 'fulfilled') {
                            const intList = r.value?.integrations || [];
                            const fs = intList.find((c: any) => c.integration === 'freshservice');
                            const sn = intList.find((c: any) => c.integration === 'servicenow');
                            const fd = intList.find((c: any) => c.integration === 'freshdesk');
                            if (fs) map[t.id] = fs;
                            if (sn) snMap[t.id] = sn;
                            if (fd) fdMap[t.id] = fd;
                        }
                    });
                    setConfigs(map);
                    setSnConfigs(snMap);
                    setFdConfigs(fdMap);
                } else {
                    // customer_admin: only own tenant
                    const data = await integrationApi.listConfigs(myTenantId).catch(() => ({ integrations: [] }));
                    const intList = data?.integrations || [];
                    const fs = intList.find((c: any) => c.integration === 'freshservice');
                    const sn = intList.find((c: any) => c.integration === 'servicenow');
                    const fd = intList.find((c: any) => c.integration === 'freshdesk');
                    const tenantData = await tenantApi.get(myTenantId).catch(() => null);
                    if (tenantData) setTenants([tenantData]);
                    if (fs) setConfigs({ [myTenantId]: fs });
                    if (sn) setSnConfigs({ [myTenantId]: sn });
                    if (fd) setFdConfigs({ [myTenantId]: fd });
                }
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [refreshKey]);

    const onRefresh = () => setRefreshKey(k => k + 1);

    return (
        <div className="app-container">
            <Sidebar />
            <div className="main-layout">
                {/* ── Header ── */}
                <div className="header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                        {/* Gradient accent bar + icon */}
                        <div style={{ width: 4, height: 36, borderRadius: 4, background: 'linear-gradient(180deg, var(--accent-primary), var(--accent-secondary, var(--accent-primary)))', flexShrink: 0 }} />
                        <Store size={20} style={{ color: 'var(--accent-primary)' }} />
                        <div>
                            <h1 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                                Integration Marketplace
                            </h1>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: 0 }}>
                                Connect third-party tools and automate bidirectional ticket sync
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onRefresh}
                        style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '0.4rem 0.85rem', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, transition: 'all 0.15s' }}
                    >
                        <RefreshCw size={14} /> Refresh
                    </button>
                </div>

                <div className="content-area">
                    {/* ── Tabs ── */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
                        <button style={{
                            padding: '0.6rem 1.2rem',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            border: 'none',
                            cursor: 'pointer',
                            background: 'transparent',
                            color: 'var(--accent-primary)',
                            borderBottom: '2px solid var(--accent-primary)',
                            transition: 'all 0.15s',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}>
                            <Puzzle size={14} /> Integrations
                        </button>
                    </div>

                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-tertiary)', padding: '3rem 0' }}>
                            <Loader2 size={18} className="spin" /> Loading integrations…
                        </div>
                    ) : (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: '1.25rem',
                            alignItems: 'start',
                        }}>
                            <FreshserviceCard
                                tenants={tenants}
                                configs={configs}
                                isSuperAdmin={isSuperAdmin}
                                myTenantId={myTenantId}
                                onRefresh={onRefresh}
                            />
                            <ServiceNowCard
                                tenants={tenants}
                                configs={snConfigs}
                                isSuperAdmin={isSuperAdmin}
                                myTenantId={myTenantId}
                                onRefresh={onRefresh}
                            />
                            <FreshdeskCard
                                tenants={tenants}
                                configs={fdConfigs}
                                isSuperAdmin={isSuperAdmin}
                                myTenantId={myTenantId}
                                onRefresh={onRefresh}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Feature chips renderer ───────────────────────────────────────────────────
function FeatureChips({ features, brandColor }: { features: string[]; brandColor: string }) {
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.6rem' }}>
            {features.map(f => (
                <span key={f} style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: `${brandColor}15`, color: brandColor, border: `1px solid ${brandColor}30`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {f}
                </span>
            ))}
        </div>
    );
}

// ─── Freshservice Card ───────────────────────────────────────────────────────
const FS_FEATURES = ['ITSM', 'Bidirectional Sync', 'Status Mirror', 'Priority Sync', 'Webhook'];

function FreshserviceCard({
    tenants, configs, isSuperAdmin, myTenantId, onRefresh
}: {
    tenants: any[];
    configs: Record<string, any>;
    isSuperAdmin: boolean;
    myTenantId: string;
    onRefresh: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
    const [configuringTenant, setConfiguringTenant] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

    const enabledCount = Object.values(configs).filter((c: any) => c.is_enabled).length;
    const totalCount = isSuperAdmin ? tenants.length : 1;

    const showToast = (msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3500);
    };

    // ── Bulk operations ──────────────────────────────────────────────────────
    const handleBulkToggle = async (enable: boolean) => {
        if (!selectedTenants.length) return;
        if (enable) {
            const missing = selectedTenants.filter(tid => !configs[tid]?.config?.domain);
            if (missing.length) {
                const names = tenants.filter(t => missing.includes(t.id)).map(t => t.name || t.slug).join(', ');
                showToast(`Configure Freshservice first for: ${names}`, false);
                return;
            }
        }
        setBulkBusy(true);
        try {
            await integrationApi.bulkToggle({ tenant_ids: selectedTenants, integration: 'freshservice', is_enabled: enable });
            showToast(`Freshservice ${enable ? 'enabled' : 'disabled'} for ${selectedTenants.length} tenant(s)`);
            setSelectedTenants([]);
            onRefresh();
        } catch (err: any) {
            showToast(err.message || 'Bulk operation failed', false);
        } finally {
            setBulkBusy(false);
        }
    };

    const toggleSelectTenant = (tid: string) =>
        setSelectedTenants(prev => prev.includes(tid) ? prev.filter(x => x !== tid) : [...prev, tid]);

    const selectAll = () => setSelectedTenants(tenants.map(t => t.id));
    const clearAll = () => setSelectedTenants([]);

    // Card status badge
    let badgeColor = '#57606a', badgeLabel = 'NOT CONFIGURED';
    if (enabledCount > 0 && enabledCount === totalCount) { badgeColor = '#3fb950'; badgeLabel = 'ACTIVE'; }
    else if (enabledCount > 0) { badgeColor = '#d29922'; badgeLabel = `PARTIAL (${enabledCount}/${totalCount})`; }

    const isNotConfigured = badgeLabel === 'NOT CONFIGURED';

    return (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.25)', transition: 'box-shadow 0.2s', borderTop: `3px solid ${FS_COLOR}` }}>
            {/* ── Card Header ── */}
            <div style={{ padding: '1.25rem', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                {/* FS Logo */}
                <div style={{ width: 56, height: 56, borderRadius: 12, background: 'linear-gradient(135deg,#00AC69,#007f50)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,172,105,0.35)' }}>
                    <span style={{ fontWeight: 900, fontSize: '1.15rem', color: '#fff' }}>FS</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Freshservice</span>
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${badgeColor}20`, color: badgeColor, border: `1px solid ${badgeColor}40` }}>
                            {badgeLabel}
                        </span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: '4px 0 0', lineHeight: 1.4 }}>
                        ITSM · Bidirectional ticket sync · Status &amp; priority mirroring
                    </p>
                    <FeatureChips features={FS_FEATURES} brandColor={FS_COLOR} />
                </div>
                <button
                    onClick={() => setExpanded(e => !e)}
                    style={{
                        background: expanded ? `${FS_COLOR}18` : 'var(--bg-tertiary)',
                        border: `1px solid ${expanded ? FS_COLOR : 'var(--border-color)'}`,
                        borderRadius: 8, padding: '0.45rem 1rem', cursor: 'pointer',
                        color: expanded ? FS_COLOR : 'var(--text-secondary)',
                        fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                        transition: 'all 0.2s'
                    }}
                >
                    {expanded ? <><ChevronUp size={14} /> Close</> : <><ChevronDown size={14} /> Configure</>}
                </button>
            </div>

            {/* ── Expanded Panel ── */}
            {expanded && (
                <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
                    {isSuperAdmin ? (
                        // ── Super Admin: tenant list ──────────────────────────────
                        <div>
                            {/* Bulk action bar */}
                            {selectedTenants.length > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.75rem 1.25rem', background: 'var(--accent-soft)', borderBottom: '1px solid var(--border-color)' }}>
                                    <Users size={14} style={{ color: 'var(--accent-primary)' }} />
                                    <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 600 }}>{selectedTenants.length} selected</span>
                                    <button onClick={() => handleBulkToggle(true)} disabled={bulkBusy} style={bulkBtn('#3fb950')}>
                                        {bulkBusy ? <Loader2 size={12} /> : <ToggleRight size={12} />} Enable
                                    </button>
                                    <button onClick={() => handleBulkToggle(false)} disabled={bulkBusy} style={bulkBtn('#f85149')}>
                                        {bulkBusy ? <Loader2 size={12} /> : <ToggleLeft size={12} />} Disable
                                    </button>
                                    <button onClick={clearAll} style={{ ...bulkBtn('#57606a'), marginLeft: 'auto' }}>Clear</button>
                                </div>
                            )}

                            {/* Tenant header row */}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--border-color)', gap: 10 }}>
                                <input type="checkbox" checked={selectedTenants.length === tenants.length && tenants.length > 0} onChange={e => e.target.checked ? selectAll() : clearAll()} style={{ cursor: 'pointer' }} />
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>Tenant</span>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 90 }}>Status</span>
                                <span style={{ width: 100 }} />
                            </div>

                            {/* Tenant rows */}
                            {tenants.map(t => {
                                const cfg = configs[t.id];
                                const isEnabled = cfg?.is_enabled || false;
                                const hasConfig = !!(cfg?.config?.domain);
                                const isConfiguring = configuringTenant === t.id;
                                return (
                                    <TenantRow
                                        key={t.id}
                                        t={t}
                                        cfg={cfg}
                                        isEnabled={isEnabled}
                                        hasConfig={hasConfig}
                                        isConfiguring={isConfiguring}
                                        selected={selectedTenants.includes(t.id)}
                                        onToggleSelect={() => toggleSelectTenant(t.id)}
                                        onToggleConfigure={() => setConfiguringTenant(isConfiguring ? null : t.id)}
                                        brandColor={FS_COLOR}
                                        subLabel={hasConfig ? `${cfg.config.domain}.freshservice.com` : undefined}
                                    >
                                        {isConfiguring && (
                                            <TenantConfigForm
                                                tenantId={t.id}
                                                existing={cfg}
                                                onSaved={() => { onRefresh(); setConfiguringTenant(null); showToast('Saved!'); }}
                                                onDeleted={() => { onRefresh(); setConfiguringTenant(null); showToast('Integration removed'); }}
                                            />
                                        )}
                                    </TenantRow>
                                );
                            })}
                        </div>
                    ) : (
                        // ── Customer Admin: single tenant form ────────────────────
                        <TenantConfigForm
                            tenantId={myTenantId}
                            existing={configs[myTenantId]}
                            onSaved={() => { onRefresh(); showToast('Saved!'); }}
                            onDeleted={() => { onRefresh(); showToast('Integration removed'); }}
                        />
                    )}
                </div>
            )}

            {/* ── Toast ── */}
            {toast && (
                <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '0.75rem 1.25rem', borderRadius: 10, background: toast.ok ? '#1a3a1f' : '#3a1a1a', border: `1px solid ${toast.ok ? '#3fb950' : '#f85149'}`, color: toast.ok ? '#3fb950' : '#f85149', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
                    {toast.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {toast.msg}
                </div>
            )}
        </div>
    );
}

// ─── Shared Tenant Row ────────────────────────────────────────────────────────
function TenantRow({
    t, cfg, isEnabled, hasConfig, isConfiguring, selected, onToggleSelect, onToggleConfigure, brandColor, subLabel, children
}: {
    t: any;
    cfg: any;
    isEnabled: boolean;
    hasConfig: boolean;
    isConfiguring: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    onToggleConfigure: () => void;
    brandColor: string;
    subLabel?: string;
    children?: React.ReactNode;
}) {
    const [hovered, setHovered] = useState(false);

    return (
        <div key={t.id}>
            <div
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                style={{ display: 'flex', alignItems: 'center', padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border-subtle, var(--border-color))', gap: 10, background: hovered ? 'rgba(255,255,255,0.025)' : 'transparent', transition: 'background 0.15s' }}
            >
                <input type="checkbox" checked={selected} onChange={onToggleSelect} style={{ cursor: 'pointer' }} />
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{t.name || t.slug || t.id}</div>
                    {subLabel && <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{subLabel}</div>}
                </div>
                <div style={{ width: 90 }}>
                    <StatusPill enabled={isEnabled} hasConfig={hasConfig} />
                </div>
                <button
                    onClick={onToggleConfigure}
                    style={{ width: 105, padding: '0.38rem 0.75rem', borderRadius: 7, border: `1px solid ${isConfiguring ? brandColor : 'var(--border-color)'}`, background: isConfiguring ? `${brandColor}15` : 'var(--bg-tertiary)', color: isConfiguring ? brandColor : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, transition: 'all 0.15s' }}
                >
                    {isConfiguring ? 'Close ▲' : 'Configure ▸'}
                </button>
            </div>
            {children}
        </div>
    );
}

// ─── Tenant Config Form ──────────────────────────────────────────────────────
function TenantConfigForm({ tenantId, existing, onSaved, onDeleted }: {
    tenantId: string;
    existing: any;
    onSaved: () => void;
    onDeleted: () => void;
}) {
    const [domain, setDomain] = useState(existing?.config?.domain || '');
    const [apiKey, setApiKey] = useState('');           // never pre-fill api_key (masked)
    const [email, setEmail] = useState(existing?.config?.requester_email || '');
    const [enabled, setEnabled] = useState(existing?.is_enabled ?? false);
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [copied, setCopied] = useState(false);
    const webhookUrl = getWebhookUrl(tenantId);

    const handleSave = async () => {
        if (!domain.trim()) { setError('Freshservice domain is required'); return; }
        if (!email.trim()) { setError('Requester email is required'); return; }
        // If editing without re-entering key, skip key in config update unless provided
        const configPayload: any = { domain: domain.trim(), requester_email: email.trim() };
        if (apiKey.trim()) configPayload.api_key = apiKey.trim();
        else if (!existing?.config?.domain) { setError('API Key is required for new integrations'); return; }
        setError(''); setSaving(true);
        try {
            await integrationApi.upsertConfig(tenantId, 'freshservice', { is_enabled: enabled, config: configPayload });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            onSaved();
        } catch (e: any) {
            setError(e.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Remove Freshservice integration for this tenant?')) return;
        setDeleting(true);
        try {
            await integrationApi.deleteConfig(tenantId, 'freshservice');
            onDeleted();
        } catch (e: any) {
            setError(e.message || 'Delete failed');
        } finally {
            setDeleting(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(webhookUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5, display: 'block' };
    const inputStyle: React.CSSProperties = { width: '100%', padding: '0.55rem 0.75rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' };

    return (
        <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--bg-secondary)' }}>
            {/* Enable toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.9rem', background: 'var(--bg-tertiary)', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>Enable Freshservice Sync</span>
                <button
                    onClick={() => setEnabled((prev: boolean) => !prev)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                >
                    {enabled
                        ? <ToggleRight size={32} color="#3fb950" />
                        : <ToggleLeft size={32} color="#57606a" />}
                </button>
            </div>

            {/* Domain */}
            <div>
                <label style={labelStyle}><Globe size={11} style={{ display: 'inline', marginRight: 4 }} />Freshservice Domain</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="yourcompany" style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>.freshservice.com</span>
                </div>
            </div>

            {/* API Key */}
            <div>
                <label style={labelStyle}><Key size={11} style={{ display: 'inline', marginRight: 4 }} />API Key {existing?.config?.domain && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, textTransform: 'none' }}>(leave blank to keep existing)</span>}</label>
                <div style={{ position: 'relative' }}>
                    <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={existing?.config?.domain ? '••••••••••••' : 'Enter API Key'} style={{ ...inputStyle, paddingRight: 40 }} />
                    <button onClick={() => setShowKey(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0 }}>
                        {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                </div>
            </div>

            {/* Requester Email */}
            <div>
                <label style={labelStyle}><Mail size={11} style={{ display: 'inline', marginRight: 4 }} />Requester Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="soc@yourcompany.com" style={inputStyle} />
                <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>Tickets are created in Freshservice under this email.</p>
            </div>

            {/* Error */}
            {error && (
                <div style={{ display: 'flex', gap: 6, color: '#f85149', fontSize: '0.8rem', alignItems: 'center' }}>
                    <AlertCircle size={14} /> {error}
                </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none', background: saved ? '#3fb950' : 'var(--accent-primary)', color: '#fff', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    {saving ? <><Loader2 size={14} /> Saving…</> : saved ? <><Check size={14} /> Saved!</> : 'Save & Apply'}
                </button>
                {existing?.config?.domain && (
                    <button onClick={handleDelete} disabled={deleting} style={{ padding: '0.55rem 0.9rem', borderRadius: 8, border: '1px solid #f85149', background: 'transparent', color: '#f85149', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {deleting ? <Loader2 size={13} /> : <Trash2 size={13} />} Remove
                    </button>
                )}
            </div>

            {/* Webhook URL — shown when config exists */}
            {existing?.config?.domain && (
                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                        📌 Your Freshservice Webhook URL
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ flex: 1, fontSize: '0.72rem', color: 'var(--accent-primary)', wordBreak: 'break-all', background: 'var(--bg-tertiary)', padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border-color)' }}>
                            {webhookUrl}
                        </code>
                        <button onClick={handleCopy} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 7, padding: '0.4rem 0.6rem', cursor: 'pointer', color: copied ? '#3fb950' : 'var(--text-secondary)', flexShrink: 0 }}>
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                    </div>
                    <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>Setup in Freshservice:</strong><br />
                        1. Admin → Workflow Automator → New Rule<br />
                        2. Trigger: <em>Ticket Updated</em> · Condition: Tag contains <code style={{ background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: 4 }}>central-soc</code><br />
                        3. Action: Trigger Webhook → POST → paste URL above → JSON → All Ticket Properties<br />
                        4. Save &amp; Activate
                    </div>
                    <a href={`https://${existing.config.domain}.freshservice.com/a/admin/automations/observer`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: '0.75rem', color: 'var(--accent-primary)', textDecoration: 'none' }}>
                        Open Freshservice Automations <ExternalLink size={11} />
                    </a>
                </div>
            )}
        </div>
    );
}

// ─── Freshdesk Card ───────────────────────────────────────────────────────────
const FD_FEATURES = ['Customer Support', 'Bidirectional Sync', 'Priority Mirror', 'Status Sync', 'Webhook'];

function FreshdeskCard({
    tenants, configs, isSuperAdmin, myTenantId, onRefresh
}: {
    tenants: any[];
    configs: Record<string, any>;
    isSuperAdmin: boolean;
    myTenantId: string;
    onRefresh: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
    const [configuringTenant, setConfiguringTenant] = useState<string | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

    const enabledCount = Object.values(configs).filter((c: any) => c.is_enabled).length;
    const totalCount = isSuperAdmin ? tenants.length : 1;

    const showToast = (msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3500);
    };

    const handleBulkToggle = async (enable: boolean) => {
        if (!selectedTenants.length) return;
        if (enable) {
            const missing = selectedTenants.filter(tid => !configs[tid]?.config?.domain);
            if (missing.length) {
                const names = tenants.filter(t => missing.includes(t.id)).map(t => t.name || t.slug).join(', ');
                showToast(`Configure Freshdesk first for: ${names}`, false);
                return;
            }
        }
        setBulkBusy(true);
        try {
            await integrationApi.bulkToggle({ tenant_ids: selectedTenants, integration: 'freshdesk', is_enabled: enable });
            showToast(`Freshdesk ${enable ? 'enabled' : 'disabled'} for ${selectedTenants.length} tenant(s)`);
            setSelectedTenants([]);
            onRefresh();
        } catch (err: any) {
            showToast(err.message || 'Bulk operation failed', false);
        } finally {
            setBulkBusy(false);
        }
    };

    const toggleSelectTenant = (tid: string) =>
        setSelectedTenants(prev => prev.includes(tid) ? prev.filter(x => x !== tid) : [...prev, tid]);

    const selectAll = () => setSelectedTenants(tenants.map(t => t.id));
    const clearAll = () => setSelectedTenants([]);

    let badgeColor = '#57606a', badgeLabel = 'NOT CONFIGURED';
    if (enabledCount > 0 && enabledCount === totalCount) { badgeColor = '#3fb950'; badgeLabel = 'ACTIVE'; }
    else if (enabledCount > 0) { badgeColor = '#d29922'; badgeLabel = `PARTIAL (${enabledCount}/${totalCount})`; }

    const isNotConfigured = badgeLabel === 'NOT CONFIGURED';

    return (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.25)', transition: 'box-shadow 0.2s', borderTop: `3px solid ${FD_COLOR}` }}>
            {/* ── Card Header ── */}
            <div style={{ padding: '1.25rem', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                {/* FD Logo */}
                <div style={{ width: 56, height: 56, borderRadius: 12, background: 'linear-gradient(135deg,#0176D3,#01549a)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(1,118,211,0.35)' }}>
                    <span style={{ fontWeight: 900, fontSize: '1.1rem', color: '#fff', letterSpacing: '-1px' }}>FD</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Freshdesk</span>
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${badgeColor}20`, color: badgeColor, border: `1px solid ${badgeColor}40` }}>
                            {badgeLabel}
                        </span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: '4px 0 0', lineHeight: 1.4 }}>
                        Customer Support · Bidirectional ticket sync · Priority &amp; status mirroring
                    </p>
                    <FeatureChips features={FD_FEATURES} brandColor={FD_COLOR} />
                </div>
                <button
                    onClick={() => setExpanded(e => !e)}
                    style={{
                        background: expanded ? `${FD_COLOR}18` : 'var(--bg-tertiary)',
                        border: `1px solid ${expanded ? FD_COLOR : 'var(--border-color)'}`,
                        borderRadius: 8, padding: '0.45rem 1rem', cursor: 'pointer',
                        color: expanded ? FD_COLOR : 'var(--text-secondary)',
                        fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                        transition: 'all 0.2s'
                    }}
                >
                    {expanded ? <><ChevronUp size={14} /> Close</> : <><ChevronDown size={14} /> Configure</>}
                </button>
            </div>

            {/* ── Expanded Panel ── */}
            {expanded && (
                <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
                    {isSuperAdmin ? (
                        <div>
                            {selectedTenants.length > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.75rem 1.25rem', background: 'var(--accent-soft)', borderBottom: '1px solid var(--border-color)' }}>
                                    <Users size={14} style={{ color: 'var(--accent-primary)' }} />
                                    <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 600 }}>{selectedTenants.length} selected</span>
                                    <button onClick={() => handleBulkToggle(true)} disabled={bulkBusy} style={bulkBtn('#3fb950')}>
                                        {bulkBusy ? <Loader2 size={12} /> : <ToggleRight size={12} />} Enable
                                    </button>
                                    <button onClick={() => handleBulkToggle(false)} disabled={bulkBusy} style={bulkBtn('#f85149')}>
                                        {bulkBusy ? <Loader2 size={12} /> : <ToggleLeft size={12} />} Disable
                                    </button>
                                    <button onClick={clearAll} style={{ ...bulkBtn('#57606a'), marginLeft: 'auto' }}>Clear</button>
                                </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--border-color)', gap: 10 }}>
                                <input type="checkbox" checked={selectedTenants.length === tenants.length && tenants.length > 0} onChange={e => e.target.checked ? selectAll() : clearAll()} style={{ cursor: 'pointer' }} />
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>Tenant</span>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 90 }}>Status</span>
                                <span style={{ width: 100 }} />
                            </div>
                            {tenants.map(t => {
                                const cfg = configs[t.id];
                                const isEnabled = cfg?.is_enabled || false;
                                const hasConfig = !!(cfg?.config?.domain);
                                const isConfiguring = configuringTenant === t.id;
                                return (
                                    <TenantRow
                                        key={t.id}
                                        t={t}
                                        cfg={cfg}
                                        isEnabled={isEnabled}
                                        hasConfig={hasConfig}
                                        isConfiguring={isConfiguring}
                                        selected={selectedTenants.includes(t.id)}
                                        onToggleSelect={() => toggleSelectTenant(t.id)}
                                        onToggleConfigure={() => setConfiguringTenant(isConfiguring ? null : t.id)}
                                        brandColor={FD_COLOR}
                                        subLabel={hasConfig ? `${cfg.config.domain}.freshdesk.com` : undefined}
                                    >
                                        {isConfiguring && (
                                            <FDTenantConfigForm
                                                tenantId={t.id}
                                                existing={cfg}
                                                onSaved={() => { onRefresh(); setConfiguringTenant(null); showToast('Saved!'); }}
                                                onDeleted={() => { onRefresh(); setConfiguringTenant(null); showToast('Integration removed'); }}
                                            />
                                        )}
                                    </TenantRow>
                                );
                            })}
                        </div>
                    ) : (
                        <FDTenantConfigForm
                            tenantId={myTenantId}
                            existing={configs[myTenantId]}
                            onSaved={() => { onRefresh(); showToast('Saved!'); }}
                            onDeleted={() => { onRefresh(); showToast('Integration removed'); }}
                        />
                    )}
                </div>
            )}

            {toast && (
                <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '0.75rem 1.25rem', borderRadius: 10, background: toast.ok ? '#1a3a1f' : '#3a1a1a', border: `1px solid ${toast.ok ? '#3fb950' : '#f85149'}`, color: toast.ok ? '#3fb950' : '#f85149', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
                    {toast.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {toast.msg}
                </div>
            )}
        </div>
    );
}

// ─── Freshdesk Tenant Config Form ─────────────────────────────────────────────
function FDTenantConfigForm({ tenantId, existing, onSaved, onDeleted }: {
    tenantId: string;
    existing: any;
    onSaved: () => void;
    onDeleted: () => void;
}) {
    const [domain, setDomain] = useState(existing?.config?.domain || '');
    const [apiKey, setApiKey] = useState('');
    const [email, setEmail] = useState(existing?.config?.requester_email || '');
    const [enabled, setEnabled] = useState(existing?.is_enabled ?? false);
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [copied, setCopied] = useState(false);
    const webhookUrl = getFdWebhookUrl(tenantId);

    const handleSave = async () => {
        if (!domain.trim()) { setError('Freshdesk domain is required'); return; }
        if (!email.trim()) { setError('Requester email is required'); return; }
        const configPayload: any = { domain: domain.trim(), requester_email: email.trim() };
        if (apiKey.trim()) configPayload.api_key = apiKey.trim();
        else if (!existing?.config?.domain) { setError('API Key is required for new integrations'); return; }
        setError(''); setSaving(true);
        try {
            await integrationApi.upsertConfig(tenantId, 'freshdesk', { is_enabled: enabled, config: configPayload });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            onSaved();
        } catch (e: any) {
            setError(e.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Remove Freshdesk integration for this tenant?')) return;
        setDeleting(true);
        try {
            await integrationApi.deleteConfig(tenantId, 'freshdesk');
            onDeleted();
        } catch (e: any) {
            setError(e.message || 'Delete failed');
        } finally {
            setDeleting(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(webhookUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5, display: 'block' };
    const inputStyle: React.CSSProperties = { width: '100%', padding: '0.55rem 0.75rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' };

    return (
        <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--bg-secondary)' }}>
            {/* Enable toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.9rem', background: 'var(--bg-tertiary)', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>Enable Freshdesk Sync</span>
                <button
                    onClick={() => setEnabled((prev: boolean) => !prev)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                >
                    {enabled ? <ToggleRight size={32} color="#3fb950" /> : <ToggleLeft size={32} color="#57606a" />}
                </button>
            </div>

            {/* Domain */}
            <div>
                <label style={labelStyle}><Globe size={11} style={{ display: 'inline', marginRight: 4 }} />Freshdesk Domain</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="yourcompany" style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>.freshdesk.com</span>
                </div>
            </div>

            {/* API Key */}
            <div>
                <label style={labelStyle}>
                    <Key size={11} style={{ display: 'inline', marginRight: 4 }} />
                    API Key {existing?.config?.domain && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, textTransform: 'none' }}>(leave blank to keep existing)</span>}
                </label>
                <div style={{ position: 'relative' }}>
                    <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={existing?.config?.domain ? '••••••••••••' : 'Enter API Key'} style={{ ...inputStyle, paddingRight: 40 }} />
                    <button onClick={() => setShowKey((s: boolean) => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0 }}>
                        {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
                    Found in Freshdesk → Profile Settings → Your API Key.
                </p>
            </div>

            {/* Requester Email */}
            <div>
                <label style={labelStyle}><Mail size={11} style={{ display: 'inline', marginRight: 4 }} />Requester Email</label>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="soc@yourcompany.com" style={inputStyle} />
                <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>Tickets will be created in Freshdesk under this email address.</p>
            </div>

            {error && (
                <div style={{ display: 'flex', gap: 6, color: '#f85149', fontSize: '0.8rem', alignItems: 'center' }}>
                    <AlertCircle size={14} /> {error}
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none', background: saved ? '#3fb950' : 'var(--accent-primary)', color: '#fff', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    {saving ? <><Loader2 size={14} /> Saving…</> : saved ? <><Check size={14} /> Saved!</> : 'Save & Apply'}
                </button>
                {existing?.config?.domain && (
                    <button onClick={handleDelete} disabled={deleting} style={{ padding: '0.55rem 0.9rem', borderRadius: 8, border: '1px solid #f85149', background: 'transparent', color: '#f85149', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {deleting ? <Loader2 size={13} /> : <Trash2 size={13} />} Remove
                    </button>
                )}
            </div>

            {/* Webhook URL — shown when config exists */}
            {existing?.config?.domain && (
                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                        📌 Your Freshdesk Webhook URL
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ flex: 1, fontSize: '0.72rem', color: 'var(--accent-primary)', wordBreak: 'break-all', background: 'var(--bg-tertiary)', padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border-color)' }}>
                            {webhookUrl}
                        </code>
                        <button onClick={handleCopy} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 7, padding: '0.4rem 0.6rem', cursor: 'pointer', color: copied ? '#3fb950' : 'var(--text-secondary)', flexShrink: 0 }}>
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                    </div>
                    <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>Setup in Freshdesk:</strong><br />
                        1. Admin → Automation → Ticket Updates (Observer)<br />
                        2. Condition: Tag → contains → <code style={{ background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: 4 }}>central-soc</code><br />
                        3. Action: Trigger Webhook → POST → paste URL above → JSON → All Ticket Properties<br />
                        4. Save &amp; Activate
                    </div>
                    <a href={`https://${existing.config.domain}.freshdesk.com/a/admin/automations/observer`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: '0.75rem', color: 'var(--accent-primary)', textDecoration: 'none' }}>
                        Open Freshdesk Automations <ExternalLink size={11} />
                    </a>
                </div>
            )}
        </div>
    );
}

// ─── ServiceNow Card ──────────────────────────────────────────────────────────
const SN_FEATURES = ['ITSM', 'Bidirectional Sync', 'Urgency/Impact', 'State Mirror', 'REST API'];

function ServiceNowCard({
    tenants, configs, isSuperAdmin, myTenantId, onRefresh
}: {
    tenants: any[];
    configs: Record<string, any>;
    isSuperAdmin: boolean;
    myTenantId: string;
    onRefresh: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
    const [configuringTenant, setConfiguringTenant] = useState<string | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

    const enabledCount = Object.values(configs).filter((c: any) => c.is_enabled).length;
    const totalCount = isSuperAdmin ? tenants.length : 1;

    const showToast = (msg: string, ok = true) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3500);
    };

    const handleBulkToggle = async (enable: boolean) => {
        if (!selectedTenants.length) return;
        if (enable) {
            const missing = selectedTenants.filter(tid => !configs[tid]?.config?.instance);
            if (missing.length) {
                const names = tenants.filter(t => missing.includes(t.id)).map(t => t.name || t.slug).join(', ');
                showToast(`Configure ServiceNow first for: ${names}`, false);
                return;
            }
        }
        setBulkBusy(true);
        try {
            await integrationApi.bulkToggle({ tenant_ids: selectedTenants, integration: 'servicenow', is_enabled: enable });
            showToast(`ServiceNow ${enable ? 'enabled' : 'disabled'} for ${selectedTenants.length} tenant(s)`);
            setSelectedTenants([]);
            onRefresh();
        } catch (err: any) {
            showToast(err.message || 'Bulk operation failed', false);
        } finally {
            setBulkBusy(false);
        }
    };

    const toggleSelectTenant = (tid: string) =>
        setSelectedTenants(prev => prev.includes(tid) ? prev.filter(x => x !== tid) : [...prev, tid]);

    const selectAll = () => setSelectedTenants(tenants.map(t => t.id));
    const clearAll = () => setSelectedTenants([]);

    let badgeColor = '#57606a', badgeLabel = 'NOT CONFIGURED';
    if (enabledCount > 0 && enabledCount === totalCount) { badgeColor = '#3fb950'; badgeLabel = 'ACTIVE'; }
    else if (enabledCount > 0) { badgeColor = '#d29922'; badgeLabel = `PARTIAL (${enabledCount}/${totalCount})`; }

    const isNotConfigured = badgeLabel === 'NOT CONFIGURED';

    return (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.25)', transition: 'box-shadow 0.2s', borderTop: `3px solid ${SN_COLOR}` }}>
            {/* ── Card Header ── */}
            <div style={{ padding: '1.25rem', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                {/* SN Logo */}
                <div style={{ width: 56, height: 56, borderRadius: 12, background: 'linear-gradient(135deg,#293E40,#62D84E)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(129,181,161,0.35)' }}>
                    <span style={{ fontWeight: 900, fontSize: '1.1rem', color: '#fff', letterSpacing: '-1px' }}>SN</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>ServiceNow</span>
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${badgeColor}20`, color: badgeColor, border: `1px solid ${badgeColor}40` }}>
                            {badgeLabel}
                        </span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: '4px 0 0', lineHeight: 1.4 }}>
                        ITSM · Bidirectional ticket sync · Urgency &amp; impact mirroring
                    </p>
                    <FeatureChips features={SN_FEATURES} brandColor={SN_COLOR} />
                </div>
                <button
                    onClick={() => setExpanded(e => !e)}
                    style={{
                        background: expanded ? `${SN_COLOR}18` : 'var(--bg-tertiary)',
                        border: `1px solid ${expanded ? SN_COLOR : 'var(--border-color)'}`,
                        borderRadius: 8, padding: '0.45rem 1rem', cursor: 'pointer',
                        color: expanded ? SN_COLOR : 'var(--text-secondary)',
                        fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                        transition: 'all 0.2s'
                    }}
                >
                    {expanded ? <><ChevronUp size={14} /> Close</> : <><ChevronDown size={14} /> Configure</>}
                </button>
            </div>

            {/* ── Expanded Panel ── */}
            {expanded && (
                <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
                    {isSuperAdmin ? (
                        <div>
                            {selectedTenants.length > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.75rem 1.25rem', background: 'var(--accent-soft)', borderBottom: '1px solid var(--border-color)' }}>
                                    <Users size={14} style={{ color: 'var(--accent-primary)' }} />
                                    <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 600 }}>{selectedTenants.length} selected</span>
                                    <button onClick={() => handleBulkToggle(true)} disabled={bulkBusy} style={bulkBtn('#3fb950')}>
                                        {bulkBusy ? <Loader2 size={12} /> : <ToggleRight size={12} />} Enable
                                    </button>
                                    <button onClick={() => handleBulkToggle(false)} disabled={bulkBusy} style={bulkBtn('#f85149')}>
                                        {bulkBusy ? <Loader2 size={12} /> : <ToggleLeft size={12} />} Disable
                                    </button>
                                    <button onClick={clearAll} style={{ ...bulkBtn('#57606a'), marginLeft: 'auto' }}>Clear</button>
                                </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--border-color)', gap: 10 }}>
                                <input type="checkbox" checked={selectedTenants.length === tenants.length && tenants.length > 0} onChange={e => e.target.checked ? selectAll() : clearAll()} style={{ cursor: 'pointer' }} />
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>Tenant</span>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 90 }}>Status</span>
                                <span style={{ width: 100 }} />
                            </div>
                            {tenants.map(t => {
                                const cfg = configs[t.id];
                                const isEnabled = cfg?.is_enabled || false;
                                const hasConfig = !!(cfg?.config?.instance);
                                const isConfiguring = configuringTenant === t.id;
                                return (
                                    <TenantRow
                                        key={t.id}
                                        t={t}
                                        cfg={cfg}
                                        isEnabled={isEnabled}
                                        hasConfig={hasConfig}
                                        isConfiguring={isConfiguring}
                                        selected={selectedTenants.includes(t.id)}
                                        onToggleSelect={() => toggleSelectTenant(t.id)}
                                        onToggleConfigure={() => setConfiguringTenant(isConfiguring ? null : t.id)}
                                        brandColor={SN_COLOR}
                                        subLabel={hasConfig ? `${cfg.config.instance}.service-now.com` : undefined}
                                    >
                                        {isConfiguring && (
                                            <SNTenantConfigForm
                                                tenantId={t.id}
                                                existing={cfg}
                                                onSaved={() => { onRefresh(); setConfiguringTenant(null); showToast('Saved!'); }}
                                                onDeleted={() => { onRefresh(); setConfiguringTenant(null); showToast('Integration removed'); }}
                                            />
                                        )}
                                    </TenantRow>
                                );
                            })}
                        </div>
                    ) : (
                        <SNTenantConfigForm
                            tenantId={myTenantId}
                            existing={configs[myTenantId]}
                            onSaved={() => { onRefresh(); showToast('Saved!'); }}
                            onDeleted={() => { onRefresh(); showToast('Integration removed'); }}
                        />
                    )}
                </div>
            )}

            {toast && (
                <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '0.75rem 1.25rem', borderRadius: 10, background: toast.ok ? '#1a3a1f' : '#3a1a1a', border: `1px solid ${toast.ok ? '#3fb950' : '#f85149'}`, color: toast.ok ? '#3fb950' : '#f85149', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
                    {toast.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {toast.msg}
                </div>
            )}
        </div>
    );
}

// ─── ServiceNow Tenant Config Form ───────────────────────────────────────────
function SNTenantConfigForm({ tenantId, existing, onSaved, onDeleted }: {
    tenantId: string;
    existing: any;
    onSaved: () => void;
    onDeleted: () => void;
}) {
    const [instance, setInstance] = useState(existing?.config?.instance || '');
    const [username, setUsername] = useState(existing?.config?.username || '');
    const [password, setPassword] = useState('');   // never pre-fill
    const [callerId, setCallerId] = useState(existing?.config?.caller_id || '');
    const [enabled, setEnabled] = useState(existing?.is_enabled ?? false);
    const [showPwd, setShowPwd] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [copied, setCopied] = useState(false);
    const webhookUrl = getSnWebhookUrl(tenantId);

    const handleSave = async () => {
        if (!instance.trim()) { setError('ServiceNow instance name is required'); return; }
        if (!username.trim()) { setError('Username is required'); return; }
        const configPayload: any = { instance: instance.trim(), username: username.trim() };
        if (password.trim()) configPayload.password = password.trim();
        else if (!existing?.config?.instance) { setError('Password is required for new integrations'); return; }
        if (callerId.trim()) configPayload.caller_id = callerId.trim();
        setError(''); setSaving(true);
        try {
            await integrationApi.upsertConfig(tenantId, 'servicenow', { is_enabled: enabled, config: configPayload });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            onSaved();
        } catch (e: any) {
            setError(e.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Remove ServiceNow integration for this tenant?')) return;
        setDeleting(true);
        try {
            await integrationApi.deleteConfig(tenantId, 'servicenow');
            onDeleted();
        } catch (e: any) {
            setError(e.message || 'Delete failed');
        } finally {
            setDeleting(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(webhookUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const labelStyle: React.CSSProperties = { fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5, display: 'block' };
    const inputStyle: React.CSSProperties = { width: '100%', padding: '0.55rem 0.75rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' };

    return (
        <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--bg-secondary)' }}>
            {/* Enable toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.9rem', background: 'var(--bg-tertiary)', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>Enable ServiceNow Sync</span>
                <button
                    onClick={() => setEnabled((prev: boolean) => !prev)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                >
                    {enabled
                        ? <ToggleRight size={32} color="#3fb950" />
                        : <ToggleLeft size={32} color="#57606a" />}
                </button>
            </div>

            {/* Instance */}
            <div>
                <label style={labelStyle}><Globe size={11} style={{ display: 'inline', marginRight: 4 }} />ServiceNow Instance</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input value={instance} onChange={e => setInstance(e.target.value)} placeholder="yourcompany" style={{ ...inputStyle, flex: 1 }} />
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>.service-now.com</span>
                </div>
            </div>

            {/* Username */}
            <div>
                <label style={labelStyle}><Key size={11} style={{ display: 'inline', marginRight: 4 }} />Username</label>
                <input value={username} onChange={e => setUsername(e.target.value)} placeholder="soc_integration" style={inputStyle} />
            </div>

            {/* Password */}
            <div>
                <label style={labelStyle}>
                    <Key size={11} style={{ display: 'inline', marginRight: 4 }} />
                    Password {existing?.config?.instance && <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, textTransform: 'none' }}>(leave blank to keep existing)</span>}
                </label>
                <div style={{ position: 'relative' }}>
                    <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={existing?.config?.instance ? '••••••••••••' : 'Enter password'} style={{ ...inputStyle, paddingRight: 40 }} />
                    <button onClick={() => setShowPwd((s: boolean) => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0 }}>
                        {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                </div>
            </div>

            {/* Caller ID (optional) */}
            <div>
                <label style={labelStyle}>Caller sys_id <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--text-tertiary)' }}>(optional)</span></label>
                <input value={callerId} onChange={e => setCallerId(e.target.value)} placeholder="sys_id of default caller user" style={inputStyle} />
                <p style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
                    The sys_id of the ServiceNow user to set as caller on created incidents.
                </p>
            </div>

            {error && (
                <div style={{ display: 'flex', gap: 6, color: '#f85149', fontSize: '0.8rem', alignItems: 'center' }}>
                    <AlertCircle size={14} /> {error}
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: 'none', background: saved ? '#3fb950' : 'var(--accent-primary)', color: '#fff', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    {saving ? <><Loader2 size={14} /> Saving…</> : saved ? <><Check size={14} /> Saved!</> : 'Save & Apply'}
                </button>
                {existing?.config?.instance && (
                    <button onClick={handleDelete} disabled={deleting} style={{ padding: '0.55rem 0.9rem', borderRadius: 8, border: '1px solid #f85149', background: 'transparent', color: '#f85149', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {deleting ? <Loader2 size={13} /> : <Trash2 size={13} />} Remove
                    </button>
                )}
            </div>

            {/* Webhook URL — shown when config exists */}
            {existing?.config?.instance && (
                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                        📌 Your ServiceNow Webhook URL
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ flex: 1, fontSize: '0.72rem', color: 'var(--accent-primary)', wordBreak: 'break-all', background: 'var(--bg-tertiary)', padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border-color)' }}>
                            {webhookUrl}
                        </code>
                        <button onClick={handleCopy} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 7, padding: '0.4rem 0.6rem', cursor: 'pointer', color: copied ? '#3fb950' : 'var(--text-secondary)', flexShrink: 0 }}>
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                    </div>
                    <div style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.7 }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>Setup in ServiceNow:</strong><br />
                        1. Studio → Business Rules → New Rule on <em>incident</em> table<br />
                        2. When: <em>after update</em> · Condition: filter as needed<br />
                        3. Advanced → Script Action → POST to webhook URL above<br />
                        4. Payload: <code style={{ background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: 4 }}>{'{"sys_id":"'+'"'+'+current.sys_id,"state":"+current.state+"}'}</code><br />
                        5. Save &amp; Activate rule
                    </div>
                    <a href={`https://${existing.config.instance}.service-now.com/nav_to.do?uri=sys_script.list`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: '0.75rem', color: 'var(--accent-primary)', textDecoration: 'none' }}>
                        Open ServiceNow Business Rules <ExternalLink size={11} />
                    </a>
                </div>
            )}
        </div>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function StatusPill({ enabled, hasConfig }: { enabled: boolean; hasConfig: boolean }) {
    if (!hasConfig) return <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#57606a', background: 'rgba(87,96,106,0.12)', padding: '2px 8px', borderRadius: 20 }}>Not set</span>;
    if (enabled) return <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#3fb950', background: 'rgba(63,185,80,0.12)', padding: '2px 8px', borderRadius: 20 }}>● Active</span>;
    return <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#d29922', background: 'rgba(210,153,34,0.12)', padding: '2px 8px', borderRadius: 20 }}>○ Disabled</span>;
}

function bulkBtn(color: string): React.CSSProperties {
    return { padding: '0.3rem 0.8rem', borderRadius: 7, border: `1px solid ${color}`, background: `${color}15`, color, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 };
}
