'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Mail, X, Send, AlertTriangle, ChevronDown, CheckCircle, MessageSquare, Paperclip, User, Clock, Trash2, Edit2, Check, Plus, Shield, Target, Monitor, Eye, Zap, Info, FileText, BookOpen, Globe, Tag } from 'lucide-react';
import { tenantApi, incidentApi, authApi } from '@/lib/api';
import Cookies from 'js-cookie';
import DynamicList from './DynamicList';

const SEV_COLORS: Record<string, string> = {
    critical: '#f85149',
    high: '#f0685e',
    medium: '#d29922',
    low: '#3fb950',
    informational: '#4493f8',
    info: '#4493f8',
};

const SEV_BG: Record<string, string> = {
    critical: 'rgba(248,81,73,0.15)',
    high: 'rgba(240,104,94,0.15)',
    medium: 'rgba(210,153,34,0.15)',
    low: 'rgba(63,185,80,0.15)',
    informational: 'rgba(68,147,248,0.15)',
    info: 'rgba(68,147,248,0.15)',
};

/* ─── Email Template Color Palette (Theme Aware) ─── */
const getE = (isLight: boolean) => ({
    bg: isLight ? '#f6f8fa' : '#0d1520',
    headerBg: isLight ? '#ffffff' : '#0a1018',
    labelBg: isLight ? '#eef3f7' : '#142a3a',
    valueBg: isLight ? '#ffffff' : '#0f1e2d',
    subHeaderBg: isLight ? '#2f81f7' : '#1a4a5a',
    border: isLight ? '#d0d7de' : '#1e3a4a',
    text: isLight ? '#1f2328' : '#dce4ec',
    textMuted: isLight ? '#57606a' : '#8aa0b8',
    accent: '#2f81f7',
    labelColor: isLight ? '#0969da' : '#8cc8e0',
});

interface Props {
    incident: any;
    open: boolean;
    onClose: () => void;
    onIncidentUpdated?: () => void;
}

export default function MailPreviewModal({ incident, open, onClose, onIncidentUpdated }: Props) {
    const [portalReady, setPortalReady] = useState(false);
    const [teams, setTeams] = useState<any[]>([]);
    const [selectedTeamId, setSelectedTeamId] = useState('');
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sendSuccess, setSendSuccess] = useState(false);
    const [isLight, setIsLight] = useState(false);
    const [interactions, setInteractions] = useState<any[]>([]);
    const [replyBody, setReplyBody] = useState('');
    const [attachments, setAttachments] = useState<File[]>([]);
    const [ccEmails, setCcEmails] = useState('');
    const [replying, setReplying] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState<any>(null);
    const [saving, setSaving] = useState(false);

    const SectionHeader = ({ icon, iconBg, iconBorder, title, required }: any) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', margin: '1.25rem 0 0.8rem' }}>
            <div style={{
                width: '28px', height: '28px', borderRadius: '6px',
                background: iconBg, border: `1px solid ${iconBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{icon}</div>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {title} {required && <span style={{ color: 'var(--status-critical)' }}>*</span>}
            </h3>
        </div>
    );

    const SelectWithChevron = ({ value, onChange, children, style }: any) => (
        <div style={{ position: 'relative' }}>
            <select
                style={{ 
                    appearance: 'none', padding: '0.5rem 2.5rem 0.5rem 0.75rem', 
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                    borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem',
                    width: '100%', outline: 'none', ...style 
                }}
                value={value} onChange={onChange}
            >{children}</select>
            <ChevronDown size={14} style={{
                position: 'absolute', right: '0.75rem', top: '50%',
                transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)',
            }} />
        </div>
    );

    const tableStyles = {
        th: {
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.03)',
            borderBottom: '1px solid var(--border-color)',
            fontSize: '10px',
            fontWeight: 700,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase' as const,
            textAlign: 'left' as const,
            letterSpacing: '0.05em'
        },
        td: {
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-subtle)',
            fontSize: '12px'
        },
        input: {
            width: '100%',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            padding: '4px 8px',
            color: 'var(--text-primary)',
            fontSize: '12px',
            outline: 'none'
        },
        delBtn: {
            padding: '4px',
            color: 'var(--status-critical)',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }
    };


    const startEditing = () => {
        const raw = incident.raw_payload || {};
        const mitreAttack = raw.mitre_attack || [];
        const mitreTactics = incident.mitre_tactics || [];
        const mitreTechniques = incident.mitre_techniques || [];
        
        const initialMitre = mitreAttack.length > 0
            ? mitreAttack.map((m: any) => ({ tactic: m.tactic || '', technique: m.technique || '' }))
            : (() => {
                const maxLen = Math.max(mitreTactics.length, mitreTechniques.length);
                return Array.from({ length: maxLen }).map((_, i) => ({
                    tactic: mitreTactics[i] || '',
                    technique: mitreTechniques[i] || ''
                }));
            })();

        if (initialMitre.length === 0) initialMitre.push({ tactic: '', technique: '' });

        const initialAssets = (raw.asset_details || []).map((a: any) => ({
            detection_method: a.detection_method || '',
            source_ip: a.source_ip || '',
            log_source: a.log_source || '',
            action: a.action || 'allow'
        }));
        if (initialAssets.length === 0) initialAssets.push({ detection_method: '', source_ip: '', log_source: '', action: 'allow' });

        const initialIocs = (incident.iocs || []).map((ioc: any) => {
            if (typeof ioc === 'string') return { signature: ioc, domain_name: '', category: '' };
            return { signature: ioc.signature || '', domain_name: ioc.domain_name || '', category: ioc.category || '' };
        });
        if (initialIocs.length === 0) initialIocs.push({ signature: '', domain_name: '', category: '' });

        const initialAffectedHosts = (incident.affected_hosts || []).map((h: any) => ({
            hostname: h.hostname || '',
            ip: h.ip || ''
        }));
        if (initialAffectedHosts.length === 0) initialAffectedHosts.push({ hostname: '', ip: '' });

        const initialAffectedUsers = (incident.affected_users || []).map((u: any) => ({
            username: u.username || ''
        }));
        if (initialAffectedUsers.length === 0) initialAffectedUsers.push({ username: '' });

        setEditData({
            title: incident.title || '',
            severity: (incident.severity || 'medium').toLowerCase(),
            status: incident.status || 'new',
            description: incident.description || '',
            asset_details: initialAssets,
            iocs: initialIocs,
            mitre_attack: initialMitre,
            observations: raw.observations || [''],
            business_impact: raw.business_impact || [''],
            recommendations: raw.recommendations || [''],
            affected_hosts: initialAffectedHosts,
            affected_users: initialAffectedUsers,
            tags: incident.tags || ['']
        });
        setIsEditing(true);
    };

    const handleSaveChanges = async () => {
        setSaving(true);
        try {
            const payload = {
                title: editData.title,
                severity: editData.severity,
                status: editData.status,
                description: editData.description,
                mitre_tactics: editData.mitre_attack.map((m: any) => m.tactic).filter(Boolean),
                mitre_techniques: editData.mitre_attack.map((m: any) => m.technique).filter(Boolean),
                mitre_attack: editData.mitre_attack.filter((m: any) => m.tactic || m.technique),
                iocs: editData.iocs.filter((i: any) => i.signature),
                asset_details: editData.asset_details.filter((a: any) => a.detection_method || a.source_ip),
                observations: editData.observations.filter(Boolean),
                business_impact: editData.business_impact.filter(Boolean),
                recommendations: editData.recommendations.filter(Boolean),
                affected_hosts: editData.affected_hosts.filter((h: any) => h.hostname || h.ip),
                affected_users: editData.affected_users.filter((u: any) => u.username),
                tags: editData.tags.filter(Boolean)
            };

            await incidentApi.update(incident.id, payload);
            setIsEditing(false);
            if (onIncidentUpdated) onIncidentUpdated();
        } catch (err: any) {
            alert(`Failed to save changes: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        const checkTheme = () => {
            const light = document.documentElement.getAttribute('data-theme') === 'light' ||
                document.documentElement.classList.contains('light');
            setIsLight(light);
        };
        checkTheme();
        const obs = new MutationObserver(checkTheme);
        obs.observe(document.documentElement, { attributes: true });
        return () => obs.disconnect();
    }, []);

    const E = getE(isLight);

    useEffect(() => {
        setPortalReady(true);
        if (open) {
            // Priority: Incident's tenant_id -> Cookie tenant_id
            const activeTenantId = incident?.tenant_id || Cookies.get('tenant_id');
            if (activeTenantId) {
                tenantApi.listTeams(activeTenantId).then(data => {
                    setTeams(data.teams || []);
                    if (data.teams?.length > 0) {
                        setSelectedTeamId(data.teams[0].id);
                    }
                });
            }

            if (incident?.id) {
                incidentApi.getInteractions(incident.id).then(data => {
                    setInteractions(data || []);
                });
            }
        }
    }, [open, incident?.id, incident?.tenant_id]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
        }
    };

    const removeAttachment = (index: number) => {
        setAttachments(prev => prev.filter((_, i) => i !== index));
    };

    const handleSendReply = async () => {
        if (!replyBody.trim() || replying) return;
        setReplying(true);
        try {
            const formData = new FormData();
            formData.append('body', replyBody);
            attachments.forEach(file => formData.append('files', file));

            await incidentApi.sendReply(incident.id, formData);
            setReplyBody('');
            setAttachments([]);
            // Refresh interactions
            const updated = await incidentApi.getInteractions(incident.id);
            setInteractions(updated || []);
        } catch (err: any) {
            console.error("Failed to send reply:", err);
            alert(err.message || "Failed to send reply");
        } finally {
            setReplying(false);
        }
    };

    const handleSend = async () => {
        if (!selectedTeamId || sending) return;
        setSending(true);
        setSendError(null);
        setSendSuccess(false);
        try {
            const formData = new FormData();
            formData.append('team_id', selectedTeamId);
            formData.append('cc_emails', ccEmails);
            formData.append('body', replyBody);
            attachments.forEach(file => formData.append('files', file));

            await incidentApi.sendEmail(incident.id, formData);
            setSendSuccess(true);
            setTimeout(() => onClose(), 2000);
        } catch (err: any) {
            setSendError(err.message || 'Failed to send email');
        } finally {
            setSending(false);
        }
    };

    const [userSignature, setUserSignature] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            authApi.listSignatures().then((sigs: any[]) => {
                const def = sigs.find(s => s.is_default_new);
                if (def) setUserSignature(def.content);
            }).catch(console.error);
        }
    }, [open]);

    if (!portalReady || !open || !incident) return null;

    const raw = incident.raw_payload || {};
    const sev = (incident.severity || 'medium').toLowerCase();
    const sevColor = SEV_COLORS[sev] || SEV_COLORS.medium;
    const sevBg = SEV_BG[sev] || SEV_BG.medium;

    /* ── Data Extraction ── */
    const ticketId = incident.ticket_id || incident.vendor_incident_id || '—';
    const alertIds = raw.alert_ids || [];
    const createdAt = incident.created_at ? new Date(incident.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
    const alertArrival = raw.alert_arrival_timestamp || '—';
    const description = incident.description || '—';
    const commandInit = raw.command_initiated || 'N/A';
    const assetDetails = raw.asset_details || [];
    const iocs = Array.isArray(incident.iocs) ? incident.iocs : [];
    const mitreAttack = raw.mitre_attack || [];
    const mitreTactics = incident.mitre_tactics || [];
    const mitreTechniques = incident.mitre_techniques || [];
    const observations = raw.observations || [];
    const businessImpact = raw.business_impact || [];
    const recommendations = raw.recommendations || [];

    /* Build MITRE rows from mitre_attack array (preferred) or fallback to separate arrays */
    const mitreRows = mitreAttack.length > 0
        ? mitreAttack.map((m: any) => ({ tactic: m.tactic || '—', technique: m.technique || '—' }))
        : (() => {
            const maxLen = Math.max(mitreTactics.length, mitreTechniques.length);
            return Array.from({ length: maxLen }).map((_, i) => ({
                tactic: mitreTactics[i] || '—',
                technique: mitreTechniques[i] || '—'
            }));
        })();

    /* IOC rows — can be strings or objects */
    const iocRows = iocs.map((ioc: any) =>
        typeof ioc === 'string'
            ? { signature: ioc, domain_name: '—', category: '—' }
            : { signature: ioc.signature || '—', domain_name: ioc.domain_name || '—', category: ioc.category || '—' }
    );

    const cellStyle = (bg: string, extra?: React.CSSProperties): React.CSSProperties => ({
        padding: '12px 16px',
        background: bg,
        borderBottom: `1px solid ${E.border}`,
        color: E.text,
        fontSize: '13px',
        lineHeight: '1.6',
        verticalAlign: 'top',
        ...extra,
    });

    const labelCell: React.CSSProperties = {
        ...cellStyle(E.labelBg),
        fontWeight: 700,
        fontSize: '11.5px',
        textTransform: 'uppercase' as const,
        letterSpacing: '0.06em',
        color: E.labelColor,
        width: '35%',
    };

    const valueCell: React.CSSProperties = cellStyle(E.valueBg);

    const subThStyle: React.CSSProperties = {
        padding: '8px 12px',
        background: E.subHeaderBg,
        color: '#fff',
        fontSize: '11px',
        fontWeight: 700,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        borderBottom: `1px solid ${E.border}`,
    };

    const subTdStyle: React.CSSProperties = {
        padding: '8px 12px',
        background: E.valueBg,
        color: E.text,
        fontSize: '12.5px',
        borderBottom: `1px solid ${E.border}`,
    };

    return createPortal(
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 100000,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
            }}
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '95%', maxWidth: 780, maxHeight: '92vh',
                    display: 'flex', flexDirection: 'column',
                    background: 'var(--glass-bg, #0d1117)',
                    border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
                    borderRadius: 16,
                    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
                    overflow: 'hidden',
                }}
            >
                {/* ── Modal Header ── */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '1rem 1.5rem',
                    borderBottom: '1px solid var(--border-color, #30363d)',
                    flexShrink: 0,
                }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: 'rgba(47,129,247,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Mail size={18} color="#2f81f7" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary, #e6edf3)', margin: 0 }}>
                            {isEditing ? 'Edit Incident Details' : 'Email Notification Preview'}
                        </h3>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary, #7d8590)' }}>
                            {isEditing ? 'Update data before sending' : 'Incident report for tenant delivery'}
                        </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.6rem', marginRight: '0.8rem' }}>
                        {isEditing ? (
                            <>
                                <button
                                    onClick={handleSaveChanges}
                                    disabled={saving}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                                        padding: '0.4rem 0.8rem', borderRadius: 8,
                                        background: 'var(--status-success)', color: '#fff',
                                        border: 'none', fontSize: '0.75rem', fontWeight: 700, 
                                        cursor: saving ? 'not-allowed' : 'pointer',
                                        opacity: saving ? 0.7 : 1
                                    }}
                                >
                                    {saving ? '...' : <><Check size={14} /> SAVE CHANGES</>}
                                </button>
                                <button
                                    onClick={() => setIsEditing(false)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                                        padding: '0.4rem 0.8rem', borderRadius: 8,
                                        background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                                        border: '1px solid var(--border-color)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer'
                                    }}
                                >
                                    <X size={14} /> CANCEL
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={startEditing}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                    padding: '0.4rem 0.8rem', borderRadius: 8,
                                    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                                    border: '1px solid var(--border-color)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer'
                                }}
                            >
                                <Edit2 size={14} /> EDIT DETAILS
                            </button>
                        )}
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 32, height: 32, borderRadius: 8,
                            background: 'transparent', border: '1px solid var(--border-color, #30363d)',
                            color: 'var(--text-tertiary, #7d8590)', cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* ── Email Body / Editing Form (scrollable) ── */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
                    {sendError && (
                        <div style={{ padding: '0.75rem 1rem', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.2)', borderRadius: '8px', color: 'var(--status-critical)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                            <AlertTriangle size={16} /> {sendError}
                        </div>
                    )}
                    {sendSuccess && (
                        <div style={{ padding: '0.75rem 1rem', background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)', borderRadius: '8px', color: 'var(--status-low)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                            <CheckCircle size={16} /> Incident notification sent and escalation scheduled.
                        </div>
                    )}

                    {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '0.5rem' }}>
                            {/* Section 1: Incident Basics */}
                            <div>
                                <SectionHeader icon={<FileText size={16} color="var(--accent-primary)" />} iconBg="rgba(47,129,247,0.1)" iconBorder="rgba(47,129,247,0.2)" title="Incident Basics" required />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>Title</label>
                                        <input
                                            style={tableStyles.input}
                                            value={editData.title}
                                            onChange={(e) => setEditData({...editData, title: e.target.value})}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>Severity</label>
                                        <SelectWithChevron
                                            value={editData.severity}
                                            onChange={(e: any) => setEditData({...editData, severity: e.target.value})}
                                        >
                                            <option value="critical">CRITICAL</option>
                                            <option value="high">HIGH</option>
                                            <option value="medium">MEDIUM</option>
                                            <option value="low">LOW</option>
                                            <option value="info">INFO</option>
                                        </SelectWithChevron>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>Status</label>
                                        <SelectWithChevron
                                            value={editData.status}
                                            onChange={(e: any) => setEditData({...editData, status: e.target.value})}
                                        >
                                            <option value="new">NEW</option>
                                            <option value="triaging">TRIAGING</option>
                                            <option value="sent to customer">SENT TO CUSTOMER</option>
                                            <option value="customer response received">RESPONSE RECEIVED</option>
                                            <option value="in_progress">IN PROGRESS</option>
                                            <option value="resolved">RESOLVED</option>
                                            <option value="false_positive">FALSE POSITIVE</option>
                                            <option value="escalated">ESCALATED</option>
                                        </SelectWithChevron>
                                    </div>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '0.4rem' }}>Description</label>
                                        <textarea
                                            style={{ ...tableStyles.input, minHeight: '100px', resize: 'vertical' }}
                                            value={editData.description}
                                            onChange={(e) => setEditData({...editData, description: e.target.value})}
                                        />
                                    </div>
                                </div>
                            </div>


                            {/* Section 2: IOCs */}
                            <div>
                                <SectionHeader icon={<Eye size={16} color="#ff7b72" />} iconBg="rgba(255,123,114,0.1)" iconBorder="rgba(255,123,114,0.2)" title="Indicators of Compromise" required />
                                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 40px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-color)', padding: '0.5rem' }}>
                                        <span style={tableStyles.th}>Signature</span>
                                        <span style={tableStyles.th}>Domain Name</span>
                                        <span style={tableStyles.th}>Category</span>
                                        <span />
                                    </div>
                                    {editData.iocs.map((row: any, idx: number) => (
                                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 40px', borderBottom: '1px solid var(--border-subtle)', padding: '0.25rem 0.5rem', alignItems: 'center' }}>
                                            <input style={tableStyles.input} value={row.signature} onChange={(e) => {
                                                const newIocs = [...editData.iocs];
                                                newIocs[idx].signature = e.target.value;
                                                setEditData({...editData, iocs: newIocs});
                                            }} />
                                            <input style={tableStyles.input} value={row.domain_name} onChange={(e) => {
                                                const newIocs = [...editData.iocs];
                                                newIocs[idx].domain_name = e.target.value;
                                                setEditData({...editData, iocs: newIocs});
                                            }} />
                                            <input style={tableStyles.input} value={row.category} onChange={(e) => {
                                                const newIocs = [...editData.iocs];
                                                newIocs[idx].category = e.target.value;
                                                setEditData({...editData, iocs: newIocs});
                                            }} />
                                            <button onClick={() => setEditData({...editData, iocs: editData.iocs.filter((_: any, i: number) => i !== idx)})} style={tableStyles.delBtn}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => setEditData({...editData, iocs: [...editData.iocs, { signature: '', domain_name: '', category: '' }]})}
                                        style={{ width: '100%', padding: '0.6rem', background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                                    >
                                        <Plus size={14} /> ADD IOC ROW
                                    </button>
                                </div>
                            </div>

                             {/* Section 3: MITRE ATT&CK */}
                             <div>
                                <SectionHeader icon={<Target size={16} color="#ffa166" />} iconBg="rgba(255,161,102,0.1)" iconBorder="rgba(255,161,102,0.2)" title="MITRE ATT&CK" required />
                                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 40px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border-color)', padding: '0.5rem' }}>
                                        <span style={tableStyles.th}>Tactic</span>
                                        <span style={tableStyles.th}>Technique</span>
                                        <span />
                                    </div>
                                    {editData.mitre_attack.map((row: any, idx: number) => (
                                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr 40px', borderBottom: '1px solid var(--border-subtle)', padding: '0.25rem 0.5rem', alignItems: 'center' }}>
                                            <input style={tableStyles.input} value={row.tactic} onChange={(e) => {
                                                const newRows = [...editData.mitre_attack];
                                                newRows[idx].tactic = e.target.value;
                                                setEditData({...editData, mitre_attack: newRows});
                                            }} />
                                            <input style={tableStyles.input} value={row.technique} onChange={(e) => {
                                                const newRows = [...editData.mitre_attack];
                                                newRows[idx].technique = e.target.value;
                                                setEditData({...editData, mitre_attack: newRows});
                                            }} />
                                            <button onClick={() => setEditData({...editData, mitre_attack: editData.mitre_attack.filter((_: any, i: number) => i !== idx)})} style={tableStyles.delBtn}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => setEditData({...editData, mitre_attack: [...editData.mitre_attack, { tactic: '', technique: '' }]})}
                                        style={{ width: '100%', padding: '0.6rem', background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                                    >
                                        <Plus size={14} /> ADD MITRE ROW
                                    </button>
                                </div>
                            </div>

                            {/* Section 3: Analysis Findings */}
                            <div>
                                <SectionHeader icon={<Zap size={16} color="#ffa166" />} iconBg="rgba(255,161,102,0.1)" iconBorder="rgba(255,161,102,0.2)" title="Analysis & Findings" required />
                                <DynamicList label="Observations" icon={<Eye size={12} />} items={editData.observations} setItems={(list: any) => setEditData({...editData, observations: list})} placeholder="Enter observation..." />
                                <DynamicList label="Business Impact" icon={<Info size={12} />} items={editData.business_impact} setItems={(list: any) => setEditData({...editData, business_impact: list})} placeholder="Enter impact..." />
                                <DynamicList label="Recommendations" icon={<Shield size={12} />} items={editData.recommendations} setItems={(list: any) => setEditData({...editData, recommendations: list})} placeholder="Enter recommendation..." />

                                <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', padding: '1rem 0', borderTop: '1px solid var(--border-color)' }}>
                                    <button
                                        onClick={handleSaveChanges}
                                        disabled={saving}
                                        style={{
                                            flex: 1, padding: '0.8rem', borderRadius: '8px',
                                            background: 'linear-gradient(135deg, #2ea44f 0%, #238636 100%)',
                                            color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.85rem',
                                            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                                        }}
                                    >
                                        {saving ? 'SAVING...' : <><Check size={16} /> SAVE CHANGES</>}
                                    </button>
                                    <button
                                        onClick={() => setIsEditing(false)}
                                        style={{
                                            padding: '0.8rem 1.5rem', borderRadius: '8px',
                                            background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                                            border: '1px solid var(--border-color)', fontWeight: 600, fontSize: '0.85rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        CANCEL
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            background: E.bg,
                            borderRadius: 8,
                            overflow: 'hidden',
                            border: `1px solid ${E.border}`,
                            fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                        }}>
                            <div style={{ padding: '28px 32px 8px', background: E.headerBg }}>
                                <p style={{ color: isLight ? '#6b7280' : '#7a9ab5', fontSize: '11.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 16px' }}>
                                    PLEASE KEEP THE SUBJECT LINE UNCHANGED
                                </p>
                                <p style={{ color: E.text, fontSize: '14px', margin: '0 0 6px' }}>Hello Team,</p>
                                <p style={{ color: E.textMuted, fontSize: '13px', margin: '0 0 20px' }}>
                                    Greetings from Alticyber SOC!
                                </p>
                                <p style={{ color: E.text, fontSize: '14px', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    A{' '}
                                    <span style={{
                                        display: 'inline-block', padding: '3px 12px', borderRadius: 4,
                                        background: sevColor, color: '#fff',
                                        fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
                                    }}>
                                        {incident.severity?.toUpperCase()}
                                    </span>
                                    {' '}Severity Incident has been triggered.
                                </p>
                                <p style={{ color: E.textMuted, fontSize: '12.5px', margin: '12px 0 24px' }}>
                                    We have observed a {incident.severity?.toUpperCase()} Severity Incident in your environment. Below are the initial details:
                                </p>
                            </div>

                            {/* ── Communication History ── */}
                            {interactions.length > 0 && (
                                <div style={{ padding: '0 32px 24px', background: E.headerBg, borderBottom: `1px solid ${E.border}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                        <MessageSquare size={14} color={E.accent} />
                                        <span style={{ fontSize: '12px', fontWeight: 700, color: E.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Communication History</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {interactions.map((msg, idx) => (
                                            <div key={idx} style={{
                                                background: msg.direction === 'inbound' ? E.labelBg : E.valueBg,
                                                border: `1px solid ${E.border}`,
                                                borderRadius: '8px',
                                                padding: '12px',
                                                position: 'relative'
                                            }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '11px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: msg.direction === 'inbound' ? E.accent : E.text }}>
                                                        <User size={12} />
                                                        {msg.sender_name || msg.from_email}
                                                        <span style={{ fontWeight: 400, color: E.textMuted }}>({msg.direction})</span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: E.textMuted }}>
                                                        <Clock size={12} />
                                                        {new Date(msg.created_at).toLocaleString()}
                                                    </div>
                                                </div>
                                                <div style={{ fontSize: '13px', color: E.text, whiteSpace: 'pre-wrap' }}>
                                                    {msg.body}
                                                </div>
                                                {msg.has_attachments && (
                                                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: E.accent }}>
                                                        <Paperclip size={10} /> Has Attachments
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <tbody>
                                    <EmailRow label="INCIDENT SEVERITY" labelStyle={labelCell} valueStyle={valueCell}>
                                        <span style={{
                                            display: 'inline-block', padding: '3px 14px', borderRadius: 4,
                                            background: sevColor, color: '#fff',
                                            fontSize: '12px', fontWeight: 800, textTransform: 'uppercase',
                                        }}>
                                            {incident.severity?.toUpperCase()}
                                        </span>
                                    </EmailRow>

                                    <EmailRow label="INCIDENT NAME" labelStyle={labelCell} valueStyle={valueCell}>
                                        {incident.title}
                                    </EmailRow>

                                    <EmailRow label="INCIDENT ID" labelStyle={labelCell} valueStyle={valueCell}>
                                        {ticketId}
                                    </EmailRow>

                                    {alertIds.length > 0 && (
                                        <EmailRow label="ALERT ID" labelStyle={labelCell} valueStyle={valueCell}>
                                            {alertIds.join(', ')}
                                        </EmailRow>
                                    )}

                                    <EmailRow label="INCIDENT CREATION TIMESTAMP" labelStyle={labelCell} valueStyle={valueCell}>
                                        {createdAt}
                                    </EmailRow>

                                    {alertArrival !== '—' && (
                                        <EmailRow label="ALERT ARRIVAL TIMESTAMP" labelStyle={labelCell} valueStyle={valueCell}>
                                            {alertArrival}
                                        </EmailRow>
                                    )}

                                    <EmailRow label="DESCRIPTION" labelStyle={labelCell} valueStyle={{ ...valueCell, whiteSpace: 'pre-wrap' as const }}>
                                        {description}
                                    </EmailRow>

                                    <EmailRow label="COMMAND INITIATED" labelStyle={labelCell} valueStyle={valueCell}>
                                        {commandInit}
                                    </EmailRow>

                                    {/* ── Asset Details Sub-Table ── */}
                                    {assetDetails.length > 0 && (
                                        <tr>
                                            <td style={labelCell}>ASSET DETAILS</td>
                                            <td style={{ ...valueCell, padding: '12px' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', borderRadius: 4, overflow: 'hidden' }}>
                                                    <thead>
                                                        <tr>
                                                            <th style={subThStyle}>DETECTION METHOD</th>
                                                            <th style={subThStyle}>SOURCE IP</th>
                                                            <th style={subThStyle}>LOG SOURCE</th>
                                                            <th style={subThStyle}>ACTION</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {assetDetails.map((a: any, i: number) => (
                                                            <tr key={i}>
                                                                <td style={subTdStyle}>{a.detection_method || '—'}</td>
                                                                <td style={subTdStyle}>{a.source_ip || '—'}</td>
                                                                <td style={subTdStyle}>{a.log_source || '—'}</td>
                                                                <td style={subTdStyle}>{a.action || '—'}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </td>
                                        </tr>
                                    )}

                                    {/* ── IOCs Sub-Table ── */}
                                    {iocRows.length > 0 && (
                                        <tr>
                                            <td style={labelCell}>INDICATORS OF COMPROMISE (IOCs)</td>
                                            <td style={{ ...valueCell, padding: '12px' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', borderRadius: 4, overflow: 'hidden' }}>
                                                    <thead>
                                                        <tr>
                                                            <th style={subThStyle}>SIGNATURE</th>
                                                            <th style={subThStyle}>DOMAIN NAME</th>
                                                            <th style={subThStyle}>CATEGORY</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {iocRows.map((ioc: any, i: number) => (
                                                            <tr key={i}>
                                                                <td style={subTdStyle}>{ioc.signature}</td>
                                                                <td style={subTdStyle}>{ioc.domain_name}</td>
                                                                <td style={subTdStyle}>{ioc.category}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </td>
                                        </tr>
                                    )}

                                    {/* ── Affected Hosts ── */}
                                    {(incident.affected_hosts || []).length > 0 && (
                                        <tr>
                                            <td style={labelCell}>AFFECTED HOSTS</td>
                                            <td style={{ ...valueCell, padding: '12px' }}>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                    {(incident.affected_hosts || []).map((h: any, i: number) => (
                                                        <div key={i} style={{ padding: '4px 10px', background: E.bg, border: `1px solid ${E.border}`, borderRadius: '4px', fontSize: '12px' }}>
                                                            <strong style={{ color: E.accent }}>{h.hostname}</strong> {h.ip && `(${h.ip})`}
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    )}

                                    {/* ── Affected Users ── */}
                                    {(incident.affected_users || []).length > 0 && (
                                        <tr>
                                            <td style={labelCell}>INVOLVED USERS</td>
                                            <td style={{ ...valueCell, padding: '12px' }}>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                    {(incident.affected_users || []).map((u: any, i: number) => (
                                                        <div key={i} style={{ padding: '4px 10px', background: E.bg, border: `1px solid ${E.border}`, borderRadius: '4px', fontSize: '12px' }}>
                                                            {u.username}
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    )}

                                    {/* ── Tags ── */}
                                    {(incident.tags || []).length > 0 && (
                                        <tr>
                                            <td style={labelCell}>TAGS</td>
                                            <td style={{ ...valueCell, padding: '12px' }}>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                    {(incident.tags || []).map((tag: string, i: number) => (
                                                        <span key={i} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(47,129,247,0.1)', color: '#2f81f7', border: '1px solid rgba(47,129,247,0.2)' }}>
                                                            #{tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    )}

                                    {/* ── MITRE ATT&CK Sub-Table ── */}
                                    {mitreRows.length > 0 && (
                                        <tr>
                                            <td style={labelCell}>MITRE ATT&CK</td>
                                            <td style={{ ...valueCell, padding: '12px' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', borderRadius: 4, overflow: 'hidden' }}>
                                                    <thead>
                                                        <tr>
                                                            <th style={subThStyle}>TACTIC</th>
                                                            <th style={subThStyle}>TECHNIQUE</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {mitreRows.map((m: any, i: number) => (
                                                            <tr key={i}>
                                                                <td style={subTdStyle}>{m.tactic}</td>
                                                                <td style={subTdStyle}>{m.technique}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </td>
                                        </tr>
                                    )}

                                    {/* ── Observations ── */}
                                    {observations.length > 0 && (
                                        <tr>
                                            <td style={labelCell}>OBSERVATIONS</td>
                                            <td style={valueCell}>
                                                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                                                    {observations.map((o: string, i: number) => (
                                                        <li key={i} style={{ marginBottom: '6px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{o}</li>
                                                    ))}
                                                </ol>
                                            </td>
                                        </tr>
                                    )}

                                    {/* ── Business Impact ── */}
                                    {businessImpact.length > 0 && (
                                        <tr>
                                            <td style={labelCell}>BUSINESS IMPACT</td>
                                            <td style={valueCell}>
                                                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                                                    {businessImpact.map((b: string, i: number) => (
                                                        <li key={i} style={{ marginBottom: '6px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{b}</li>
                                                    ))}
                                                </ol>
                                            </td>
                                        </tr>
                                    )}

                                    {/* ── Recommendations ── */}
                                    {recommendations.length > 0 && (
                                        <tr>
                                            <td style={labelCell}>RECOMMENDATIONS</td>
                                            <td style={valueCell}>
                                                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                                                    {recommendations.map((r: string, i: number) => (
                                                        <li key={i} style={{ marginBottom: '6px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{r}</li>
                                                    ))}
                                                </ol>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>

                            {/* ── Footer ── */}
                            <div style={{ padding: '24px 32px', background: E.headerBg, borderTop: `1px solid ${E.border}` }}>
                                <p style={{ color: E.text, fontSize: '13px', margin: '0 0 12px', lineHeight: '1.7' }}>
                                    To prevent any sort of malicious attack within the organization, it is recommended to take immediate action upon receiving this mail.
                                </p>
                                <p style={{ color: E.textMuted, fontSize: '12.5px', margin: '0 0 20px' }}>
                                    In case of any queries or concerns, please let us know. We'll be glad to assist you.
                                </p>
                                
                                {userSignature ? (
                                    <div 
                                        className="rich-signature-preview"
                                        style={{ 
                                            marginTop: '16px', 
                                            paddingTop: '8px', 
                                            color: E.text,
                                            fontSize: '13px'
                                        }}
                                        dangerouslySetInnerHTML={{ __html: userSignature }}
                                    />
                                ) : (
                                    <>
                                        <p style={{ color: E.textMuted, fontSize: '12.5px', margin: '0 0 6px' }}>Alticyber SOC Notification.</p>
                                        <p style={{ color: E.text, fontSize: '13px', fontWeight: 700, margin: '12px 0 4px' }}>
                                            Thanks and Regards
                                        </p>
                                        <p style={{ color: E.text, fontSize: '13px', fontWeight: 700, margin: 0 }}>
                                            Alticyber Technologies PVT LTD
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Action Section (Always at bottom of scrollable area) ── */}
                    <div style={{ marginTop: '1.5rem', padding: '1.5rem', background: E.labelBg, borderRadius: '12px', border: `1px solid ${E.border}` }}>
                        <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: E.textMuted, textTransform: 'uppercase', marginBottom: '6px' }}>CC Emails (comma separated)</label>
                                    <input
                                        type="text"
                                        value={ccEmails}
                                        onChange={(e) => setCcEmails(e.target.value)}
                                        placeholder="analyst@example.com, manager@example.com"
                                        style={{
                                            width: '100%', padding: '8px 12px',
                                            background: E.valueBg, border: `1px solid ${E.border}`,
                                            borderRadius: '6px', color: E.text, fontSize: '13px',
                                            outline: 'none'
                                        }}
                                    />
                                </div>
                                <div style={{ width: '200px' }}>
                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: E.textMuted, textTransform: 'uppercase', marginBottom: '6px' }}>Recipient Team</label>
                                    <select
                                        value={selectedTeamId}
                                        onChange={(e) => setSelectedTeamId(e.target.value)}
                                        style={{
                                            width: '100%', padding: '8px 12px',
                                            background: E.valueBg, border: `1px solid ${E.border}`,
                                            borderRadius: '6px', color: E.text, fontSize: '13px',
                                            outline: 'none', cursor: 'pointer'
                                        }}
                                    >
                                        <option value="" disabled>Select Team</option>
                                        {teams.map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            
                            <div>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: E.textMuted, textTransform: 'uppercase', marginBottom: '6px' }}>Custom Message (Optional)</label>
                                <textarea
                                    value={replyBody}
                                    onChange={(e) => setReplyBody(e.target.value)}
                                    placeholder="Add a custom note to this notification..."
                                    style={{
                                        width: '100%', minHeight: '80px', padding: '12px',
                                        background: E.valueBg, border: `1px solid ${E.border}`,
                                        borderRadius: '8px', color: E.text, fontSize: '13px',
                                        outline: 'none', resize: 'vertical'
                                    }}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                            {attachments.map((f, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    padding: '4px 8px', background: E.bg, border: `1px solid ${E.border}`,
                                    borderRadius: '6px', fontSize: '11px', color: E.text
                                }}>
                                    <Paperclip size={10} />
                                    <span style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                    <button onClick={() => removeAttachment(i)} style={{ background: 'none', border: 'none', color: '#f85149', cursor: 'pointer', padding: 2 }}>
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                cursor: 'pointer', color: E.accent, fontSize: '12px', fontWeight: 600
                            }}>
                                <Paperclip size={14} />
                                Attach Files
                                <input type="file" multiple onChange={handleFileChange} style={{ display: 'none' }} />
                            </label>
                            <button
                                onClick={handleSend}
                                disabled={!selectedTeamId || sending}
                                style={{
                                    padding: '10px 24px', borderRadius: '8px',
                                    background: selectedTeamId ? '#2f81f7' : 'rgba(47,129,247,0.15)',
                                    color: '#fff', border: 'none',
                                    fontSize: '13px', fontWeight: 700, cursor: selectedTeamId ? 'pointer' : 'not-allowed',
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    transition: 'all 0.2s',
                                    opacity: selectedTeamId ? 1 : 0.6
                                }}
                            >
                                {sending ? 'Sending...' : sendSuccess ? 'Sent Successfully!' : 'SEND TO CUSTOMER'}
                                <Send size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

/* ── Helper: simple table row ── */
function EmailRow({ label, children, labelStyle, valueStyle }: {
    label: string;
    children: React.ReactNode;
    labelStyle: React.CSSProperties;
    valueStyle: React.CSSProperties;
}) {
    return (
        <tr>
            <td style={labelStyle}>{label}</td>
            <td style={valueStyle}>{children}</td>
        </tr>
    );
}
