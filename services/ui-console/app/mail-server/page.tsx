'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import Cookies from 'js-cookie';
import { apiRequest, tenantApi } from '@/lib/api';
import {
    Mail, Server, Shield, Save, AlertCircle, CheckCircle, Loader2,
    Eye, EyeOff, Send, RefreshCw, Lock, Globe, Hash, User, AtSign,
    Plus, Pencil, Trash2, ArrowLeft, Tag, Building2, Users,
} from 'lucide-react';

/* ─── Types ─── */
interface MailingConfig {
    id?: string;
    label: string;
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_pass: string;
    imap_host: string;
    imap_port: number;
    imap_user: string;
    imap_pass: string;
    from_email: string;
    is_active: boolean;
    created_at?: string;
}

interface TenantAssignment {
    id: string;
    tenant_id: string;
    tenant_name: string;
}

interface GroupedMailConfig extends MailingConfig {
    group_id: string;
    tenants: TenantAssignment[];
}

const DEFAULT_CONFIG: MailingConfig = {
    label: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_pass: '',
    imap_host: '',
    imap_port: 993,
    imap_user: '',
    imap_pass: '',
    from_email: '',
    is_active: true,
};

type ViewMode = 'list' | 'add' | 'edit';

export default function MailServerPage() {
    const userRole = Cookies.get('user_role') || '';
    const cookieTenantId = Cookies.get('tenant_id') || '';
    const isSuperAdmin = userRole === 'super_admin';

    /* ── State ── */
    const [tenants, setTenants] = useState<any[]>([]);
    // Super admin: grouped configs; regular user: flat list
    const [groupedConfigs, setGroupedConfigs] = useState<GroupedMailConfig[]>([]);
    const [flatConfigs, setFlatConfigs] = useState<MailingConfig[]>([]);

    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [editConfig, setEditConfig] = useState<MailingConfig>(DEFAULT_CONFIG);
    const [editGroupId, setEditGroupId] = useState<string | null>(null);
    const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);

    const [showSmtpPass, setShowSmtpPass] = useState(false);
    const [showImapPass, setShowImapPass] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
    const [testEmail, setTestEmail] = useState('');

    /* ── Fetch tenants (super_admin) ── */
    useEffect(() => {
        if (!isSuperAdmin) return;
        apiRequest('/tenants').then((data: any) => {
            setTenants(data.tenants || []);
        }).catch(() => {});
    }, []);

    /* ── Fetch configs ── */
    const fetchConfigs = async () => {
        setLoading(true);
        try {
            if (isSuperAdmin) {
                const data = await tenantApi.listAllMailingConfigsGrouped();
                setGroupedConfigs(data.configs || []);
            } else {
                if (!cookieTenantId) { setLoading(false); return; }
                const data = await tenantApi.listMailingConfigs(cookieTenantId);
                setFlatConfigs(data.configs || []);
            }
        } catch (err) {
            console.error('Failed to load mailing configs:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchConfigs(); }, []);

    const updateField = (field: keyof MailingConfig, value: string | boolean | number) => {
        setEditConfig(prev => ({ ...prev, [field]: value }));
        setStatus(null);
    };

    const toggleTenant = (tenantId: string) => {
        setSelectedTenantIds(prev =>
            prev.includes(tenantId) ? prev.filter(id => id !== tenantId) : [...prev, tenantId]
        );
    };

    /* ── Save ── */
    const handleSave = async () => {
        if (!editConfig.label) {
            setStatus({ type: 'error', message: 'Server label is required.' });
            return;
        }
        if (!editConfig.smtp_host || !editConfig.from_email) {
            setStatus({ type: 'error', message: 'SMTP Host and From Email are required.' });
            return;
        }
        if (isSuperAdmin && selectedTenantIds.length === 0) {
            setStatus({ type: 'error', message: 'Select at least one tenant to assign this server to.' });
            return;
        }

        setSaving(true);
        try {
            if (isSuperAdmin) {
                const payload = { ...editConfig, tenant_ids: selectedTenantIds };
                if (viewMode === 'edit' && editGroupId) {
                    await tenantApi.updateMailingConfigGroup(editGroupId, payload);
                    setStatus({ type: 'success', message: 'Mail server updated successfully.' });
                } else {
                    await tenantApi.createMailingConfigGroup(payload);
                    setStatus({ type: 'success', message: 'Mail server created successfully.' });
                }
            } else {
                if (viewMode === 'edit' && editConfig.id) {
                    await tenantApi.updateMailingConfig(cookieTenantId, editConfig.id, editConfig);
                    setStatus({ type: 'success', message: 'Mail server updated successfully.' });
                } else {
                    await tenantApi.createMailingConfig(cookieTenantId, editConfig);
                    setStatus({ type: 'success', message: 'Mail server created successfully.' });
                }
            }
            await fetchConfigs();
            setTimeout(() => { setViewMode('list'); setStatus(null); }, 800);
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to save configuration.' });
        } finally {
            setSaving(false);
        }
    };

    /* ── Delete ── */
    const handleDelete = async (key: string, isGroup: boolean) => {
        if (!confirm('Delete this mail server configuration?')) return;
        setDeleting(key);
        try {
            if (isGroup) {
                await tenantApi.deleteMailingConfigGroup(key);
            } else {
                await tenantApi.deleteMailingConfig(cookieTenantId, key);
            }
            await fetchConfigs();
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to delete.' });
        } finally {
            setDeleting(null);
        }
    };

    /* ── Test SMTP ── */
    const handleTest = async () => {
        if (!testEmail) { setStatus({ type: 'error', message: 'Enter a test email address.' }); return; }
        if (!editConfig.smtp_host || !editConfig.smtp_user || !editConfig.smtp_pass || !editConfig.from_email) {
            setStatus({ type: 'error', message: 'Fill in SMTP Host, Username, Password, and From Email first.' });
            return;
        }
        setTesting(true);
        setStatus({ type: 'info', message: `Sending test email to ${testEmail}...` });
        try {
            await tenantApi.testSmtp({
                smtp_host: editConfig.smtp_host, smtp_port: editConfig.smtp_port,
                smtp_user: editConfig.smtp_user, smtp_pass: editConfig.smtp_pass,
                from_email: editConfig.from_email, test_recipient: testEmail,
            });
            setStatus({ type: 'success', message: `Test email sent successfully to ${testEmail}!` });
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'SMTP connection test failed.' });
        } finally {
            setTesting(false);
        }
    };

    /* ── Open Add ── */
    const openAdd = () => {
        setEditConfig({ ...DEFAULT_CONFIG });
        setEditGroupId(null);
        setSelectedTenantIds([]);
        setShowSmtpPass(false);
        setShowImapPass(false);
        setStatus(null);
        setTestEmail('');
        setViewMode('add');
    };

    /* ── Open Edit ── */
    const openEditGrouped = (cfg: GroupedMailConfig) => {
        setEditConfig({
            label: cfg.label, smtp_host: cfg.smtp_host, smtp_port: cfg.smtp_port,
            smtp_user: '', smtp_pass: '',  // don't prefill passwords
            imap_host: cfg.imap_host || '', imap_port: cfg.imap_port || 993,
            imap_user: '', imap_pass: '',
            from_email: cfg.from_email, is_active: cfg.is_active,
        });
        setEditGroupId(cfg.group_id);
        setSelectedTenantIds(cfg.tenants.map(t => t.tenant_id));
        setShowSmtpPass(false);
        setShowImapPass(false);
        setStatus(null);
        setTestEmail('');
        setViewMode('edit');
    };

    const openEditFlat = (cfg: MailingConfig) => {
        setEditConfig({ ...cfg });
        setEditGroupId(null);
        setSelectedTenantIds([]);
        setShowSmtpPass(false);
        setShowImapPass(false);
        setStatus(null);
        setTestEmail('');
        setViewMode('edit');
    };

    /* ─── Styles ─── */
    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '0.7rem 0.85rem',
        background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
        fontSize: '0.85rem', fontWeight: 500, outline: 'none', transition: 'all 0.2s',
    };
    const labelStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '0.4rem',
    };
    const cardStyle: React.CSSProperties = {
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-lg)', padding: '1.5rem',
    };

    if (loading) {
        return (
            <div className="app-container">
                <Sidebar />
                <div className="main-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Loader2 className="animate-spin" size={32} color="var(--accent-primary)" />
                </div>
            </div>
        );
    }

    /* ─────────── LIST VIEW ─────────── */
    const renderList = () => {
        const configs = isSuperAdmin ? groupedConfigs : flatConfigs;
        const isEmpty = configs.length === 0;

        return (
            <main className="content-area" style={{ padding: '2rem', gap: '1.5rem', background: 'var(--bg-primary)' }}>
                {status && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.65rem',
                        padding: '0.85rem 1.25rem', borderRadius: 'var(--radius-md)',
                        background: status.type === 'success' ? 'rgba(63,185,80,0.06)' : 'rgba(248,81,73,0.06)',
                        border: `1px solid ${status.type === 'success' ? 'rgba(63,185,80,0.2)' : 'rgba(248,81,73,0.2)'}`,
                        fontSize: '0.82rem', fontWeight: 600,
                        color: status.type === 'success' ? 'var(--status-low)' : 'var(--status-critical)',
                    }}>
                        {status.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                        {status.message}
                    </div>
                )}

                {/* Add New Server Button */}
                <button
                    onClick={openAdd}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '1rem 1.5rem', background: 'var(--bg-secondary)',
                        border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-lg)',
                        color: 'var(--accent-primary)', fontSize: '0.88rem', fontWeight: 700,
                        cursor: 'pointer', transition: 'all 0.2s', width: '100%',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.background = 'var(--accent-soft)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                >
                    <Plus size={20} />
                    Add New Mail Server
                </button>

                {isEmpty ? (
                    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-tertiary)', fontSize: '0.88rem' }}>
                        <Mail size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                        <p style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>No Mail Servers Configured</p>
                        <p>Click &quot;Add New Mail Server&quot; to configure your first SMTP/IMAP server.</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {isSuperAdmin
                            ? groupedConfigs.map((cfg) => (
                                <div key={cfg.group_id} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '0.85rem', transition: 'border-color 0.2s' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                        {/* Icon */}
                                        <div style={{
                                            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                                            background: cfg.is_active ? 'rgba(63,185,80,0.1)' : 'rgba(139,148,158,0.1)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            <Server size={20} color={cfg.is_active ? 'var(--status-low)' : 'var(--text-tertiary)'} />
                                        </div>
                                        {/* Info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                                                <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                    {cfg.label || 'Unnamed Server'}
                                                </span>
                                                <span style={{
                                                    fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.55rem',
                                                    borderRadius: 20,
                                                    background: cfg.is_active ? 'rgba(63,185,80,0.12)' : 'rgba(139,148,158,0.12)',
                                                    color: cfg.is_active ? 'var(--status-low)' : 'var(--text-tertiary)',
                                                    textTransform: 'uppercase', letterSpacing: '0.05em',
                                                }}>
                                                    {cfg.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                    <Globe size={12} /> {cfg.smtp_host}:{cfg.smtp_port}
                                                </span>
                                                <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                    <AtSign size={12} /> {cfg.from_email}
                                                </span>
                                                {cfg.imap_host && (
                                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                        <Mail size={12} /> IMAP: {cfg.imap_host}:{cfg.imap_port}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {/* Actions */}
                                        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                            <button
                                                onClick={() => openEditGrouped(cfg)}
                                                title="Edit"
                                                style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.color = 'var(--accent-primary)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                                            >
                                                <Pencil size={15} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(cfg.group_id, true)}
                                                disabled={deleting === cfg.group_id}
                                                title="Delete"
                                                style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', opacity: deleting === cfg.group_id ? 0.5 : 1 }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--status-critical)'; e.currentTarget.style.color = 'var(--status-critical)'; }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                                            >
                                                {deleting === cfg.group_id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                                            </button>
                                        </div>
                                    </div>
                                    {/* Tenant Badges */}
                                    {cfg.tenants && cfg.tenants.length > 0 && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                                            <Users size={13} color="var(--text-tertiary)" />
                                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Assigned to:</span>
                                            {cfg.tenants.map(t => (
                                                <span key={t.tenant_id} style={{
                                                    fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.6rem',
                                                    borderRadius: 20, background: 'var(--accent-soft)',
                                                    color: 'var(--accent-primary)', border: '1px solid rgba(56,139,253,0.2)',
                                                }}>
                                                    {t.tenant_name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))
                            : flatConfigs.map((cfg) => (
                                <div key={cfg.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: '1.25rem', transition: 'border-color 0.2s' }}>
                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: cfg.is_active ? 'rgba(63,185,80,0.1)' : 'rgba(139,148,158,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <Server size={20} color={cfg.is_active ? 'var(--status-low)' : 'var(--text-tertiary)'} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
                                            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{cfg.label || 'Unnamed Server'}</span>
                                            <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: 20, background: cfg.is_active ? 'rgba(63,185,80,0.12)' : 'rgba(139,148,158,0.12)', color: cfg.is_active ? 'var(--status-low)' : 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                {cfg.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Globe size={12} /> {cfg.smtp_host}:{cfg.smtp_port}</span>
                                            <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}><AtSign size={12} /> {cfg.from_email}</span>
                                            {cfg.imap_host && <span style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}><Mail size={12} /> IMAP: {cfg.imap_host}:{cfg.imap_port}</span>}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                        <button onClick={() => openEditFlat(cfg)} title="Edit" style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.color = 'var(--accent-primary)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}><Pencil size={15} /></button>
                                        <button onClick={() => cfg.id && handleDelete(cfg.id, false)} disabled={deleting === cfg.id} title="Delete" style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', opacity: deleting === cfg.id ? 0.5 : 1 }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--status-critical)'; e.currentTarget.style.color = 'var(--status-critical)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
                                            {deleting === cfg.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                                        </button>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                )}
            </main>
        );
    };

    /* ─────────── FORM VIEW (Add / Edit) ─────────── */
    const renderForm = () => (
        <main className="content-area" style={{ padding: '2rem', gap: '2rem', background: 'var(--bg-primary)' }}>
            {status && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.65rem',
                    padding: '0.85rem 1.25rem', borderRadius: 'var(--radius-md)',
                    background: status.type === 'success' ? 'rgba(63,185,80,0.06)' : status.type === 'error' ? 'rgba(248,81,73,0.06)' : 'rgba(56,139,253,0.06)',
                    border: `1px solid ${status.type === 'success' ? 'rgba(63,185,80,0.2)' : status.type === 'error' ? 'rgba(248,81,73,0.2)' : 'rgba(56,139,253,0.2)'}`,
                    fontSize: '0.82rem', fontWeight: 600,
                    color: status.type === 'success' ? 'var(--status-low)' : status.type === 'error' ? 'var(--status-critical)' : 'var(--accent-primary)',
                }}>
                    {status.type === 'success' ? <CheckCircle size={16} /> : status.type === 'error' ? <AlertCircle size={16} /> : <Loader2 size={16} className="animate-spin" />}
                    {status.message}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: '2rem', alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                    {/* ── Server Identity ── */}
                    <section style={cardStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                            <Tag size={18} color="var(--accent-primary)" />
                            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-primary)' }}>Server Identity</h3>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                            <div>
                                <label style={labelStyle}><Tag size={13} /> Server Label</label>
                                <input type="text" placeholder="e.g. Gmail SOC, O365 Production" value={editConfig.label} onChange={(e) => updateField('label', e.target.value)} style={inputStyle} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', height: '100%', paddingTop: '1.5rem' }}>
                                <input type="checkbox" id="is_active" checked={editConfig.is_active} onChange={(e) => updateField('is_active', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                                <label htmlFor="is_active" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>Enable This Server</label>
                            </div>
                        </div>
                    </section>

                    {/* ── Assign to Tenants (super_admin only) ── */}
                    {isSuperAdmin && (
                        <section style={cardStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                                <Users size={18} color="var(--accent-primary)" />
                                <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-primary)' }}>Assign to Tenants</h3>
                                <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                                    {selectedTenantIds.length} selected
                                </span>
                            </div>
                            {tenants.length === 0 ? (
                                <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>No tenants available.</p>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.65rem' }}>
                                    {tenants.map((t: any) => {
                                        const checked = selectedTenantIds.includes(t.id);
                                        return (
                                            <label
                                                key={t.id}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.65rem',
                                                    padding: '0.6rem 0.85rem',
                                                    border: `1px solid ${checked ? 'rgba(56,139,253,0.4)' : 'var(--border-color)'}`,
                                                    borderRadius: 'var(--radius-md)',
                                                    background: checked ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
                                                    cursor: 'pointer', transition: 'all 0.15s',
                                                    userSelect: 'none',
                                                }}
                                                onClick={() => toggleTenant(t.id)}
                                            >
                                                <div style={{
                                                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                                                    border: `2px solid ${checked ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                                                    background: checked ? 'var(--accent-primary)' : 'transparent',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    transition: 'all 0.15s',
                                                }}>
                                                    {checked && (
                                                        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                                                            <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                    )}
                                                </div>
                                                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: checked ? 'var(--accent-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {t.name}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    )}

                    {/* ── SMTP Configuration ── */}
                    <section style={cardStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                            <Server size={18} color="var(--accent-primary)" />
                            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-primary)' }}>SMTP (Outgoing)</h3>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '1.25rem' }}>
                                <div>
                                    <label style={labelStyle}><Globe size={13} /> SMTP Host</label>
                                    <input type="text" placeholder="smtp.gmail.com" value={editConfig.smtp_host} onChange={(e) => updateField('smtp_host', e.target.value)} style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}><Hash size={13} /> Port</label>
                                    <input type="number" placeholder="587" value={editConfig.smtp_port} onChange={(e) => updateField('smtp_port', parseInt(e.target.value) || 587)} style={inputStyle} />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                <div>
                                    <label style={labelStyle}><User size={13} /> Username</label>
                                    <input type="text" placeholder="soc@company.com" value={editConfig.smtp_user} onChange={(e) => updateField('smtp_user', e.target.value)} style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}><Lock size={13} /> Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <input type={showSmtpPass ? 'text' : 'password'} value={editConfig.smtp_pass} onChange={(e) => updateField('smtp_pass', e.target.value)} style={{ ...inputStyle, paddingRight: '2.5rem' }} />
                                        <button onClick={() => setShowSmtpPass(!showSmtpPass)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4 }}>
                                            {showSmtpPass ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label style={labelStyle}><AtSign size={13} /> From Email</label>
                                <input type="email" placeholder="soc-alerts@company.com" value={editConfig.from_email} onChange={(e) => updateField('from_email', e.target.value)} style={inputStyle} />
                            </div>
                        </div>
                    </section>

                    {/* ── IMAP Configuration ── */}
                    <section style={cardStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                            <Mail size={18} color="var(--accent-primary)" />
                            <h3 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-primary)' }}>IMAP (Inbound Polling)</h3>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: '1.25rem' }}>
                                <div>
                                    <label style={labelStyle}><Globe size={13} /> IMAP Host</label>
                                    <input type="text" placeholder="imap.gmail.com" value={editConfig.imap_host} onChange={(e) => updateField('imap_host', e.target.value)} style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}><Hash size={13} /> Port</label>
                                    <input type="number" placeholder="993" value={editConfig.imap_port} onChange={(e) => updateField('imap_port', parseInt(e.target.value) || 993)} style={inputStyle} />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                <div>
                                    <label style={labelStyle}><User size={13} /> Username</label>
                                    <input type="text" placeholder="soc@company.com" value={editConfig.imap_user} onChange={(e) => updateField('imap_user', e.target.value)} style={inputStyle} />
                                </div>
                                <div>
                                    <label style={labelStyle}><Lock size={13} /> Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <input type={showImapPass ? 'text' : 'password'} value={editConfig.imap_pass} onChange={(e) => updateField('imap_pass', e.target.value)} style={{ ...inputStyle, paddingRight: '2.5rem' }} />
                                        <button onClick={() => setShowImapPass(!showImapPass)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4 }}>
                                            {showImapPass ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* ── Save Button ── */}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: '0.75rem', width: '100%', padding: '1rem',
                            background: 'var(--accent-primary)', color: 'white',
                            borderRadius: 'var(--radius-lg)', fontWeight: 700, fontSize: '0.9rem',
                            cursor: saving ? 'not-allowed' : 'pointer', border: 'none',
                            transition: 'transform 0.1s, opacity 0.2s', opacity: saving ? 0.7 : 1,
                        }}
                    >
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {saving ? 'Saving...' : viewMode === 'edit' ? 'Update Configuration' : 'Save Configuration'}
                    </button>
                </div>

                {/* ── Right Sidebar: Tests & Help ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={cardStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
                            <Send size={16} color="var(--accent-primary)" />
                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Connection Test</span>
                        </div>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                            Verify your server settings by sending a test email. This validates the SMTP handshake and authentication.
                        </p>
                        <div style={{ marginBottom: '1.25rem' }}>
                            <label style={labelStyle}>Recipient Email</label>
                            <input type="email" placeholder="test@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} style={inputStyle} />
                        </div>
                        <button
                            onClick={handleTest}
                            disabled={testing}
                            style={{
                                width: '100%', padding: '0.75rem', background: 'transparent',
                                border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-md)',
                                color: 'var(--accent-primary)', fontSize: '0.78rem', fontWeight: 700,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                            }}
                        >
                            {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Run Connectivity Test
                        </button>
                    </div>

                    <div style={{ ...cardStyle, background: 'var(--bg-elevated)', borderStyle: 'dashed' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
                            <Shield size={16} color="var(--status-low)" />
                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Security Note</span>
                        </div>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.6, margin: 0 }}>
                            We recommend using <strong>App Passwords</strong> for services like Gmail or O365.
                            Ensure that the SOC service has access to the IMAP <code>INBOX</code> if you want to track customer replies.
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );

    const totalConfigs = isSuperAdmin ? groupedConfigs.length : flatConfigs.length;

    return (
        <div className="app-container">
            <Sidebar />
            <div className="main-layout">
                <header className="header" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        {viewMode !== 'list' && (
                            <button
                                onClick={() => { setViewMode('list'); setStatus(null); }}
                                style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.color = 'var(--accent-primary)'; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                            >
                                <ArrowLeft size={16} />
                            </button>
                        )}
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Mail size={18} color="var(--accent-primary)" />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                                {viewMode === 'list' ? 'Mail Server Configuration' : viewMode === 'add' ? 'Add Mail Server' : 'Edit Mail Server'}
                            </h2>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>
                                {viewMode === 'list'
                                    ? `${totalConfigs} server${totalConfigs !== 1 ? 's' : ''} configured`
                                    : 'Configure SMTP for notifications and IMAP for inbound replies'}
                            </span>
                        </div>
                    </div>
                </header>

                {viewMode === 'list' ? renderList() : renderForm()}
            </div>
        </div>
    );
}
