'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { authApi, incidentApi, tenantApi, userApi, integrationApi } from '@/lib/api';
import Cookies from 'js-cookie';
import {
    TicketPlus, AlertTriangle, CheckCircle, ChevronDown,
    FileText, Tag, Monitor, Users, Shield, Loader2,
    ArrowRight, User, Building2, Info, Plus, Trash2,
    Clock, Terminal, Crosshair, Fingerprint, Target,
    Eye, Zap, BookOpen, Calendar, List, Paperclip, X, Upload
} from 'lucide-react';
import { format, parse, isValid } from 'date-fns';
import DynamicList from '@/components/DynamicList';

interface TenantItem { id: string; name: string; slug: string; }
interface UserItem { id: string; full_name: string; email: string; role: string; tenant_id?: string; }

const SEVERITIES = [
    { value: 'critical', label: 'Critical', color: '#f85149', bg: 'rgba(248,81,73,0.12)' },
    { value: 'high', label: 'High', color: '#f0685e', bg: 'rgba(240,104,94,0.12)' },
    { value: 'medium', label: 'Medium', color: '#d29922', bg: 'rgba(210,153,34,0.12)' },
    { value: 'low', label: 'Low', color: '#3fb950', bg: 'rgba(63,185,80,0.12)' },
    { value: 'informational', label: 'Informational', color: '#4493f8', bg: 'rgba(68,147,248,0.12)' },
];

const STATUSES = [
    { value: 'new', label: 'New' },
    { value: 'triaging', label: 'Triaging' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'sent to customer', label: 'Sent to Customer' },
    { value: 'customer response received', label: 'Customer Response Received' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'false_positive', label: 'False Positive' },
    { value: 'escalated', label: 'Escalated' },
];

/* ──── Reusable sub-components ──── */

const SectionHeader = ({ icon, iconBg, iconBorder, title, optional }: {
    icon: React.ReactNode; iconBg: string; iconBorder: string; title: string; optional?: boolean;
}) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1.75rem' }}>
        <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: iconBg, border: `1px solid ${iconBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>
            {title} {!optional && <span style={{ color: '#ff4d4f', marginLeft: '2px' }}>*</span>}
        </h3>
        {optional && <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>Optional</span>}
    </div>
);

const SelectWithChevron = ({ value, onChange, children, style }: any) => (
    <div style={{ position: 'relative' }}>
        <select className="login-input"
            style={{ appearance: 'none', paddingRight: '2.5rem', ...style }}
            value={value} onChange={onChange}
        >{children}</select>
        <ChevronDown size={16} style={{
            position: 'absolute', right: '0.75rem', top: '50%',
            transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-tertiary)',
        }} />
    </div>
);

/* Dynamic row table styles */
const tableStyles: Record<string, React.CSSProperties> = {
    wrapper: {
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
        overflow: 'hidden', marginBottom: '0.5rem',
    },
    headerRow: {
        display: 'grid', gap: 0,
        background: 'rgba(47,129,247,0.06)', borderBottom: '1px solid var(--border-color)',
        padding: '0.55rem 0.75rem', fontSize: '0.72rem', fontWeight: 700,
        color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.05em',
    },
    cell: {
        padding: '0.45rem 0.5rem', background: 'transparent', border: 'none',
        color: 'var(--text-primary)', fontSize: '0.84rem', outline: 'none',
        fontFamily: 'inherit', width: '100%',
    },
    row: {
        display: 'grid', gap: 0,
        borderBottom: '1px solid var(--border-subtle)', alignItems: 'center',
    },
    addBtn: {
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.5rem 0.85rem', background: 'transparent',
        border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)',
        color: 'var(--accent-primary)', fontSize: '0.8rem', fontWeight: 600,
        cursor: 'pointer', marginTop: '0.5rem', width: '100%', justifyContent: 'center',
    },
    delBtn: {
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'var(--text-tertiary)', padding: '0.25rem', borderRadius: '4px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
};


export default function CreateTicketPage() {
    const router = useRouter();
    const userRole = Cookies.get('user_role') || 'analyst';
    const userTenantId = Cookies.get('tenant_id') || '';
    const isAdmin = userRole === 'super_admin' || userRole === 'customer_admin';
    const isAnalyst = userRole === 'analyst';

    const [currentUser, setCurrentUser] = useState<{ id: string; full_name: string; email: string } | null>(null);
    const datetimeInputRef = useRef<HTMLInputElement>(null);

    /* ─── Core fields ─── */
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [severity, setSeverity] = useState('medium');
    const [status, setStatus] = useState('new');
    const [tenantId, setTenantId] = useState(userTenantId || '');
    const [createdById, setCreatedById] = useState('');

    /* ─── Incident ID (user-editable, optional override) ─── */
    const [incidentId, setIncidentId] = useState('');

    /* ─── Alert details ─── */
    const [alertIds, setAlertIds] = useState('');
    const [alertArrivalTimestamp, setAlertArrivalTimestamp] = useState('');
    const [commandInitiated, setCommandInitiated] = useState('');

    /* ─── Asset Details (dynamic rows) ─── */
    const [assetDetails, setAssetDetails] = useState<{ detection_method: string; source_ip: string; log_source: string; action: string }[]>([]);

    /* ─── IOCs (dynamic rows) ─── */
    const [iocs, setIocs] = useState<{ signature: string; domain_name: string; category: string }[]>([]);

    /* ─── MITRE ATT&CK (dynamic rows) ─── */
    const [mitreAttack, setMitreAttack] = useState<{ tactic: string; technique: string }[]>([]);

    /* ─── Analysis (dynamic lists) ─── */
    const [observations, setObservations] = useState<string[]>([]);
    const [businessImpact, setBusinessImpact] = useState<string[]>([]);
    const [recommendations, setRecommendations] = useState<string[]>([]);


    /* ─── ITSM attachments ─── */
    const [itsmFiles, setItsmFiles] = useState<File[]>([]);
    const [hasITSM, setHasITSM] = useState(false);
    const [itsmUploadStatus, setItsmUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');

    /* ─── Data / UI ─── */
    const [tenants, setTenants] = useState<TenantItem[]>([]);
    const [users, setUsers] = useState<UserItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState<{ id: string; ticket_id: string } | null>(null);

    useEffect(() => {
        const init = async () => {
            try {
                const me = await authApi.me();
                setCurrentUser({ id: me.id, full_name: me.full_name, email: me.email });
                if (!isAdmin) setCreatedById(me.id);
                if (isAnalyst) setStatus('new');
                if (userRole === 'super_admin') {
                    const t = await tenantApi.list();
                    setTenants(t.tenants || t || []);
                }
                if (isAdmin) {
                    try { const u = await userApi.list(); setUsers(u.users || []); } catch { }
                }
                // Check if the tenant has an ITSM integration
                const resolvedTid = userTenantId || tenantId;
                if (resolvedTid) {
                    try {
                        const configs = await integrationApi.listConfigs(resolvedTid);
                        const itsmIntegrations = ['freshservice', 'freshdesk', 'servicenow'];
                        const hasActive = configs.some((c: any) => itsmIntegrations.includes(c.integration) && c.is_enabled);
                        setHasITSM(hasActive);
                    } catch { }
                }
            } catch (err) { console.error('Init error:', err); }
        };
        init();
    }, [userRole, isAdmin, userTenantId, tenantId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) { setError('Title is required'); return; }
        const resolvedTenantId = (userRole === 'super_admin') ? tenantId : userTenantId;
        if (!resolvedTenantId) { setError('Please select a tenant'); return; }

        if (isAnalyst) {
            if (!description.trim()) { setError('Description is required'); return; }
            if (!alertIds.trim()) { setError('Alert ID(s) are required'); return; }
            if (!alertArrivalTimestamp.trim()) { setError('Alert Arrival Timestamp is required'); return; }
            if (!commandInitiated.trim()) { setError('Command Initiated is required'); return; }
            if (assetDetails.filter(a => a.detection_method || a.source_ip || a.log_source || a.action).length === 0) {
                setError('At least one Asset Detail is required'); return;
            }
            if (iocs.filter(i => i.signature || i.domain_name || i.category).length === 0) {
                setError('At least one IOC is required'); return;
            }
            if (mitreAttack.filter(m => m.tactic || m.technique).length === 0) {
                setError('At least one MITRE ATT&CK entry is required'); return;
            }
            if (observations.filter(Boolean).length === 0) { setError('At least one Observation is required'); return; }
            if (businessImpact.filter(Boolean).length === 0) { setError('At least one Business Impact is required'); return; }
            if (recommendations.filter(Boolean).length === 0) { setError('At least one Recommendation is required'); return; }
        }

        setLoading(true); setError(''); setSuccess(null);

        try {
            let isoTimestamp = null;
            if (alertArrivalTimestamp.trim()) {
                const parsedDate = parse(alertArrivalTimestamp.trim(), 'dd/MM/yyyy hh:mm aa', new Date());
                if (!isValid(parsedDate)) {
                    // Try alternative formats if the above fails (e.g. without AM/PM or leading zeros)
                    setError('Invalid timestamp format. Use dd/mm/yyyy hh:mm AM/PM');
                    setLoading(false);
                    return;
                }
                isoTimestamp = format(parsedDate, "yyyy-MM-dd'T'HH:mm:ss");
            }

            const payload: any = {
                title: title.trim(),
                description: description.trim(),
                severity, status,
                tenant_id: resolvedTenantId,
                alert_ids: alertIds.split(',').map(a => a.trim()).filter(Boolean),
                alert_arrival_timestamp: isoTimestamp,
                command_initiated: commandInitiated.trim() || null,
                asset_details: assetDetails.filter(a => a.detection_method || a.source_ip || a.log_source || a.action),
                iocs: iocs.filter(i => i.signature || i.domain_name || i.category),
                mitre_attack: mitreAttack.filter(m => m.tactic || m.technique),
                observations: observations.filter(Boolean),
                business_impact: businessImpact.filter(Boolean),
                recommendations: recommendations.filter(Boolean),
            };
            if (incidentId.trim()) payload.incident_id = incidentId.trim();
            if (createdById) payload.created_by_id = createdById;

            const result = await incidentApi.create(payload);
            setSuccess({ id: result.id, ticket_id: result.ticket_id });

            // If ITSM files attached, upload them to the ITSM ticket (endpoint retries internally)
            if (itsmFiles.length > 0) {
                setItsmUploadStatus('uploading');
                try {
                    const fd = new FormData();
                    fd.append('body', `Attachments uploaded at ticket creation by analyst.`);
                    itsmFiles.forEach(f => fd.append('files', f));
                    await incidentApi.itsmComment(result.id, fd);
                    setItsmUploadStatus('done');
                } catch {
                    setItsmUploadStatus('error');
                }
            }
        } catch (err: any) {
            setError(err.message || 'Failed to create ticket');
        } finally { setLoading(false); }
    };

    const getCreatedByName = () => {
        if (!isAdmin && currentUser) return currentUser.full_name;
        const selected = users.find(u => u.id === createdById);
        return selected ? selected.full_name : null;
    };
    const RequiredMark = () => isAnalyst ? <span style={{ color: '#ff4d4f', marginLeft: '2px' }}>*</span> : null;

    /* ─── Asset Detail row helpers ─── */
    const addAssetRow = () => setAssetDetails([...assetDetails, { detection_method: '', source_ip: '', log_source: '', action: 'allow' }]);
    const updateAsset = (i: number, field: string, val: string) => {
        const n = [...assetDetails]; (n[i] as any)[field] = val; setAssetDetails(n);
    };
    const removeAsset = (i: number) => setAssetDetails(assetDetails.filter((_, j) => j !== i));

    /* IOC row helpers */
    const addIocRow = () => setIocs([...iocs, { signature: '', domain_name: '', category: '' }]);
    const updateIoc = (i: number, field: string, val: string) => {
        const n = [...iocs]; (n[i] as any)[field] = val; setIocs(n);
    };
    const removeIoc = (i: number) => setIocs(iocs.filter((_, j) => j !== i));

    /* MITRE row helpers */
    const addMitreRow = () => setMitreAttack([...mitreAttack, { tactic: '', technique: '' }]);
    const updateMitre = (i: number, field: string, val: string) => {
        const n = [...mitreAttack]; (n[i] as any)[field] = val; setMitreAttack(n);
    };
    const removeMitre = (i: number) => setMitreAttack(mitreAttack.filter((_, j) => j !== i));

    const resetForm = () => {
        setTitle(''); setDescription(''); setSeverity('medium'); setStatus('new'); setIncidentId('');
        setAlertIds(''); setAlertArrivalTimestamp(''); setCommandInitiated('');
        setAssetDetails([]); setIocs([]); setMitreAttack([]);
        setObservations([]); setBusinessImpact([]); setRecommendations([]);
        if (isAdmin) setCreatedById('');
        setSuccess(null);
    };

    const selectedSeverity = SEVERITIES.find(s => s.value === severity);

    return (
        <div className="app-container">
            <Sidebar />
            <div className="main-layout">
                {/* Header */}
                <header className="header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <TicketPlus size={22} style={{ color: 'var(--accent-primary)' }} />
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Create Ticket</h2>
                        <span className="status-badge" style={{
                            background: 'rgba(47,129,247,0.1)', color: 'var(--accent-primary)',
                            border: '1px solid rgba(47,129,247,0.25)',
                        }}>MANUAL ENTRY</span>
                    </div>
                </header>

                <main className="content-area" style={{ maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
                    {/* ═══ SUCCESS STATE ═══ */}
                    {success ? (
                        <div className="detail-card" style={{ textAlign: 'center', padding: '3rem' }}>
                            <div style={{
                                width: '80px', height: '80px', borderRadius: '50%',
                                background: 'rgba(63,185,80,0.1)', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', margin: '0 auto 1.5rem'
                            }}>
                                <CheckCircle size={40} color="var(--status-low)" />
                            </div>
                            <h3 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Ticket Created Successfully</h3>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Your ticket has been registered in the system.</p>
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                padding: '0.5rem 1.25rem', background: 'var(--bg-tertiary)',
                                borderRadius: 'var(--radius-md)', marginBottom: itsmUploadStatus !== 'idle' ? '1rem' : '2rem',
                                fontSize: '1rem', fontWeight: 700, color: 'var(--accent-primary)',
                            }}><FileText size={18} />{success.ticket_id}</div>

                            {itsmUploadStatus === 'uploading' && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', marginBottom: '2rem', color: '#f59e0b', fontSize: '0.85rem', fontWeight: 600 }}>
                                    <Loader2 size={16} className="animate-spin" />
                                    Uploading attachments to ITSM ticket...
                                </div>
                            )}
                            {itsmUploadStatus === 'done' && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', marginBottom: '2rem', color: '#3fb950', fontSize: '0.85rem', fontWeight: 600 }}>
                                    <CheckCircle size={16} />
                                    Attachments uploaded to ITSM ticket successfully
                                </div>
                            )}
                            {itsmUploadStatus === 'error' && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', marginBottom: '2rem', color: '#f85149', fontSize: '0.85rem', fontWeight: 600 }}>
                                    <AlertTriangle size={16} />
                                    Ticket created but ITSM attachment upload failed — you can retry from the incident page
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                                <button className="login-button" style={{ width: 'auto', padding: '0.75rem 1.5rem' }}
                                    onClick={() => router.push(`/incidents/${success.id}`)}>
                                    View Ticket <ArrowRight size={16} />
                                </button>
                                <button className="login-button" style={{
                                    width: 'auto', padding: '0.75rem 1.5rem',
                                    background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                                    boxShadow: 'none', border: '1px solid var(--border-color)',
                                }} onClick={resetForm}>Create Another</button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit}>
                            {/* Error */}
                            {error && (
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem',
                                    background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.25)',
                                    borderRadius: 'var(--radius-md)', marginBottom: '1.5rem',
                                    color: 'var(--status-critical)', fontSize: '0.88rem',
                                }}><AlertTriangle size={18} />{error}</div>
                            )}

                            {/* ═══ SECTION 1: Ticket Details ═══ */}
                            <div className="detail-card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                                <SectionHeader
                                    icon={<FileText size={16} color="var(--accent-primary)" />}
                                    iconBg="rgba(47,129,247,0.1)" iconBorder="rgba(47,129,247,0.2)"
                                    title="Ticket Details"
                                />
                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                    <label className="input-label">Title <RequiredMark /></label>
                                    <input type="text" className="login-input"
                                        placeholder="e.g. Unusual login from Russia"
                                        value={title} onChange={e => setTitle(e.target.value)} />
                                </div>

                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                    <label className="input-label">Incident ID <RequiredMark /></label>
                                    <div style={{ position: 'relative' }}>
                                        <input type="text" className="login-input"
                                            placeholder="Auto-generated (e.g. ATPL-0001) — or enter custom ID"
                                            value={incidentId} onChange={e => setIncidentId(e.target.value)}
                                            style={{ paddingLeft: '2.5rem' }}
                                        />
                                        <Fingerprint size={15} style={{
                                            position: 'absolute', left: '0.75rem', top: '50%',
                                            transform: 'translateY(-50%)', color: 'var(--text-tertiary)',
                                        }} />
                                    </div>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '0.3rem', display: 'block' }}>
                                        Leave blank for auto-generated ID (TENANT-XXXX format, e.g. ATPL-0001)
                                    </span>
                                </div>

                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                    <label className="input-label">Description <RequiredMark /></label>
                                    <textarea className="login-input"
                                        style={{ height: '120px', resize: 'vertical', padding: '0.75rem' }}
                                        placeholder="Provide a detailed description of the incident or issue..."
                                        value={description} onChange={e => setDescription(e.target.value)} />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
                                    <div className="input-group">
                                        <label className="input-label">Incident Severity</label>
                                        <SelectWithChevron value={severity} onChange={(e: any) => setSeverity(e.target.value)}
                                            style={{ borderLeft: `3px solid ${selectedSeverity?.color || 'var(--border-color)'}` }}>
                                            {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                        </SelectWithChevron>
                                    </div>
                                    <div className="input-group">
                                        <label className="input-label">Status <RequiredMark /></label>
                                         <SelectWithChevron value={status} onChange={(e: any) => setStatus(e.target.value)} disabled={isAnalyst}>
                                             {STATUSES.filter(s => !isAnalyst || s.value === 'new').map(s => (
                                                 <option key={s.value} value={s.value}>{s.label}</option>
                                             ))}
                                         </SelectWithChevron>
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                    <div className="input-group">
                                        <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span>
                                                <Clock size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                                                Alert Arrival Timestamp <RequiredMark />
                                            </span>
                                            <button type="button"
                                                onClick={() => setAlertArrivalTimestamp(format(new Date(), 'dd/MM/yyyy hh:mm aa'))}
                                                style={{
                                                    fontSize: '0.7rem', color: 'var(--accent-primary)',
                                                    background: 'none', cursor: 'pointer',
                                                    padding: '2px 6px', borderRadius: '4px',
                                                    border: '1px solid var(--accent-soft)'
                                                }}>
                                                Now
                                            </button>
                                        </label>
                                        <div style={{ position: 'relative' }}>
                                             {/* Hidden native picker */}
                                             <input
                                                 type="datetime-local"
                                                 ref={datetimeInputRef}
                                                 style={{
                                                     position: 'absolute',
                                                     visibility: 'hidden',
                                                     width: 0, height: 0,
                                                     top: '50%', left: '1rem'
                                                 }}
                                                 onChange={(e) => {
                                                     if (e.target.value) {
                                                         const date = new Date(e.target.value);
                                                         setAlertArrivalTimestamp(format(date, 'dd/MM/yyyy hh:mm aa'));
                                                     }
                                                 }}
                                             />
                                             <input type="text" className="login-input"
                                                 placeholder="dd/mm/yyyy 12:00 AM/PM"
                                                 value={alertArrivalTimestamp}
                                                 onChange={e => setAlertArrivalTimestamp(e.target.value)}
                                                 style={{ paddingLeft: '2.5rem' }}
                                             />
                                             <Calendar 
                                                 size={15} 
                                                 onClick={() => datetimeInputRef.current?.showPicker()}
                                                 style={{
                                                     position: 'absolute', left: '0.75rem', top: '50%',
                                                     transform: 'translateY(-50%)', color: 'var(--accent-primary)',
                                                     cursor: 'pointer'
                                                 }} 
                                             />
                                         </div>
                                        <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: '0.3rem', display: 'block' }}>
                                            Format: Day/Month/Year Hour:Minute AM/PM
                                        </span>
                                    </div>
                                    <div className="input-group">
                                        <label className="input-label">Alert ID(s) <RequiredMark /></label>
                                        <input type="text" className="login-input"
                                            placeholder="e.g. 4306443, 4304939 (comma-separated)"
                                            value={alertIds} onChange={e => setAlertIds(e.target.value)} />
                                    </div>
                                </div>

                                <div className="input-group" style={{ marginTop: '1.25rem' }}>
                                    <label className="input-label">
                                        <Terminal size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                                        Command Initiated <RequiredMark />
                                    </label>
                                    <input type="text" className="login-input"
                                        placeholder="e.g. powershell.exe -enc ... or N/A"
                                        value={commandInitiated} onChange={e => setCommandInitiated(e.target.value)} />
                                </div>
                            </div>

                            {/* ═══ SECTION 2: Asset Details ═══ */}
                            <div className="detail-card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                                <SectionHeader
                                    icon={<Monitor size={16} color="#3fb950" />}
                                    iconBg="rgba(63,185,80,0.1)" iconBorder="rgba(63,185,80,0.2)"
                                    title="Asset Details" optional={!isAnalyst}
                                />
                                {assetDetails.length > 0 && (
                                    <div style={tableStyles.wrapper}>
                                        <div style={{ ...tableStyles.headerRow, gridTemplateColumns: '1fr 1fr 1fr 0.8fr 36px' }}>
                                            <span>Detection Method</span><span>Source IP</span><span>Log Source</span><span>Action</span><span></span>
                                        </div>
                                        {assetDetails.map((row, i) => (
                                            <div key={i} style={{ ...tableStyles.row, gridTemplateColumns: '1fr 1fr 1fr 0.8fr 36px' }}>
                                                <input style={tableStyles.cell} placeholder="XDR Analytics BIOC" value={row.detection_method}
                                                    onChange={e => updateAsset(i, 'detection_method', e.target.value)} />
                                                <input style={tableStyles.cell} placeholder="103.140.135.1162" value={row.source_ip}
                                                    onChange={e => updateAsset(i, 'source_ip', e.target.value)} />
                                                <input style={tableStyles.cell} placeholder="Zscaler/ZPA" value={row.log_source}
                                                    onChange={e => updateAsset(i, 'log_source', e.target.value)} />
                                                <div style={{ padding: '0 0.5rem' }}>
                                                    <SelectWithChevron value={row.action || 'allow'}
                                                        onChange={(e: any) => updateAsset(i, 'action', e.target.value)}
                                                        style={{ height: '32px', fontSize: '0.8rem', padding: '0 2.5rem 0 0.75rem' }}>
                                                        <option value="allow">Allow</option>
                                                        <option value="block">Block</option>
                                                        <option value="quarantine">Quarantine</option>
                                                    </SelectWithChevron>
                                                </div>
                                                <button type="button" style={tableStyles.delBtn} onClick={() => removeAsset(i)}><Trash2 size={13} /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <button type="button" style={tableStyles.addBtn} onClick={addAssetRow}>
                                    <Plus size={14} /> Add Asset
                                </button>
                            </div>

                            {/* ═══ SECTION 3: IOCs ═══ */}
                            <div className="detail-card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                                <SectionHeader
                                    icon={<Shield size={16} color="#f85149" />}
                                    iconBg="rgba(248,81,73,0.1)" iconBorder="rgba(248,81,73,0.2)"
                                    title="Indicators of Compromise (IOCs)" optional={!isAnalyst}
                                />
                                {iocs.length > 0 && (
                                    <div style={tableStyles.wrapper}>
                                        <div style={{ ...tableStyles.headerRow, gridTemplateColumns: '1.2fr 1fr 0.8fr 36px' }}>
                                            <span>Signature</span><span>Domain Name</span><span>Category</span><span></span>
                                        </div>
                                        {iocs.map((row, i) => (
                                            <div key={i} style={{ ...tableStyles.row, gridTemplateColumns: '1.2fr 1fr 0.8fr 36px' }}>
                                                <input style={tableStyles.cell} placeholder="SIGNATURE_UNAVAILABLE" value={row.signature}
                                                    onChange={e => updateIoc(i, 'signature', e.target.value)} />
                                                <input style={tableStyles.cell} placeholder="example.com" value={row.domain_name}
                                                    onChange={e => updateIoc(i, 'domain_name', e.target.value)} />
                                                <input style={tableStyles.cell} placeholder="Initial Access" value={row.category}
                                                    onChange={e => updateIoc(i, 'category', e.target.value)} />
                                                <button type="button" style={tableStyles.delBtn} onClick={() => removeIoc(i)}><Trash2 size={13} /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <button type="button" style={tableStyles.addBtn} onClick={addIocRow}>
                                    <Plus size={14} /> Add IOC
                                </button>
                            </div>

                            {/* ═══ SECTION 4: MITRE ATT&CK ═══ */}
                            <div className="detail-card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                                <SectionHeader
                                    icon={<Crosshair size={16} color="#a371f7" />}
                                    iconBg="rgba(163,113,247,0.1)" iconBorder="rgba(163,113,247,0.2)"
                                    title="MITRE ATT&CK Mapping" optional={!isAnalyst}
                                />
                                {mitreAttack.length > 0 && (
                                    <div style={tableStyles.wrapper}>
                                        <div style={{ ...tableStyles.headerRow, gridTemplateColumns: '1.5fr 1fr 36px' }}>
                                            <span>Tactic</span><span>Technique</span><span></span>
                                        </div>
                                        {mitreAttack.map((row, i) => (
                                            <div key={i} style={{ ...tableStyles.row, gridTemplateColumns: '1.5fr 1fr 36px' }}>
                                                <input style={tableStyles.cell} placeholder="TA0001 - Initial Access" value={row.tactic}
                                                    onChange={e => updateMitre(i, 'tactic', e.target.value)} />
                                                <input style={tableStyles.cell} placeholder="T1078.002 - Valid Accounts" value={row.technique}
                                                    onChange={e => updateMitre(i, 'technique', e.target.value)} />
                                                <button type="button" style={tableStyles.delBtn} onClick={() => removeMitre(i)}><Trash2 size={13} /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <button type="button" style={tableStyles.addBtn} onClick={addMitreRow}>
                                    <Plus size={14} /> Add MITRE Entry
                                </button>
                            </div>

                            {/* ═══ SECTION 5: Analysis ═══ */}
                            <div className="detail-card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                                <SectionHeader
                                    icon={<Eye size={16} color="#d29922" />}
                                    iconBg="rgba(210,153,34,0.1)" iconBorder="rgba(210,153,34,0.2)"
                                    title="Analysis Details" optional={!isAnalyst}
                                />

                                {/* Observations */}
                                <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                                    <label className="input-label">
                                        <Eye size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                                        Observations
                                    </label>
                                    <DynamicList items={observations} setItems={setObservations}
                                        placeholder="e.g. The user accessed the VPN from an unusual location..." />
                                </div>

                                {/* Business Impact */}
                                <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                                    <label className="input-label">
                                        <Zap size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                                        Business Impact
                                    </label>
                                    <DynamicList items={businessImpact} setItems={setBusinessImpact}
                                        placeholder="e.g. A successful login from an unusual country may indicate unauthorized access..." />
                                </div>

                                {/* Recommendations */}
                                <div className="input-group">
                                    <label className="input-label">
                                        <BookOpen size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                                        Recommendations
                                    </label>
                                    <DynamicList items={recommendations} setItems={setRecommendations}
                                        placeholder="e.g. Validate the login activity with the user..." />
                                </div>
                            </div>

                            {/* ═══ SECTION 6: Tenant & Created By ═══ */}
                            <div className="detail-card" style={{ padding: '2rem', marginBottom: '1.5rem' }}>
                                <SectionHeader
                                    icon={<Building2 size={16} color="#935fff" />}
                                    iconBg="rgba(147,95,255,0.1)" iconBorder="rgba(147,95,255,0.2)"
                                    title="Tenant & Creator"
                                />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                    {/* Tenant */}
                                    <div className="input-group">
                                        <label className="input-label">
                                            <Building2 size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                                            Associate Tenant <span style={{ color: 'var(--status-critical)' }}>*</span>
                                        </label>
                                        {userRole === 'super_admin' ? (
                                            <SelectWithChevron value={tenantId} onChange={(e: any) => setTenantId(e.target.value)}>
                                                <option value="">Select tenant...</option>
                                                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                            </SelectWithChevron>
                                        ) : (
                                            <div style={{
                                                padding: '0.7rem 0.9rem', background: 'var(--bg-elevated)',
                                                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                                                color: 'var(--text-secondary)', fontSize: '0.875rem',
                                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            }}>
                                                <Shield size={14} color="var(--accent-primary)" /> Your Tenant
                                                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Auto-assigned</span>
                                            </div>
                                        )}
                                    </div>
                                    {/* Created By */}
                                    <div className="input-group">
                                        <label className="input-label">
                                            <User size={13} style={{ marginRight: '0.3rem', verticalAlign: 'middle' }} />
                                            Created By <span style={{ color: 'var(--status-critical)' }}>*</span>
                                        </label>
                                        {isAdmin ? (
                                            <SelectWithChevron value={createdById} onChange={(e: any) => setCreatedById(e.target.value)}>
                                                <option value="">Select user...</option>
                                                {users.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
                                            </SelectWithChevron>
                                        ) : (
                                            <div style={{
                                                padding: '0.7rem 0.9rem', background: 'var(--bg-elevated)',
                                                border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
                                                color: 'var(--text-primary)', fontSize: '0.875rem',
                                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            }}>
                                                <div style={{
                                                    width: '24px', height: '24px', borderRadius: '50%',
                                                    background: 'var(--accent-soft)', display: 'flex',
                                                    alignItems: 'center', justifyContent: 'center',
                                                    fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent-primary)',
                                                }}>{currentUser?.full_name?.charAt(0)?.toUpperCase() || '?'}</div>
                                                <span style={{ fontWeight: 600 }}>{currentUser?.full_name || 'Loading...'}</span>
                                                <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>You</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {isAdmin && createdById && (
                                    <div style={{
                                        marginTop: '1.25rem', padding: '0.75rem 1rem',
                                        background: 'rgba(47,129,247,0.05)', border: '1px solid rgba(47,129,247,0.12)',
                                        borderRadius: 'var(--radius-md)',
                                        display: 'flex', alignItems: 'center', gap: '0.6rem',
                                        fontSize: '0.82rem', color: 'var(--text-secondary)',
                                    }}>
                                        <Info size={15} color="var(--accent-primary)" />
                                        This ticket will be recorded as created by{' '}
                                        <strong style={{ color: 'var(--text-primary)' }}>{getCreatedByName()}</strong>
                                        {' '}and submitted by you
                                    </div>
                                )}
                            </div>


                            {/* ═══ ITSM Attachments — only shown when tenant has an active ITSM integration ═══ */}
                            {hasITSM && (
                            <div style={{
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-lg)',
                                padding: '1.5rem',
                                marginBottom: '1.5rem',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1rem' }}>
                                    <div style={{
                                        width: '32px', height: '32px', borderRadius: '8px',
                                        background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <Paperclip size={16} color="#f59e0b" />
                                    </div>
                                    <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>ITSM Attachments</h3>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>Optional — sent to ITSM ticket on creation</span>
                                </div>

                                <label style={{ cursor: 'pointer', display: 'block' }}>
                                    <input
                                        type="file"
                                        multiple
                                        style={{ display: 'none' }}
                                        onChange={(e) => {
                                            if (e.target.files) setItsmFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                                        }}
                                    />
                                    <div style={{
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                        gap: '0.6rem', padding: '1.5rem',
                                        border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-md)',
                                        background: 'var(--bg-tertiary)', cursor: 'pointer',
                                        transition: 'border-color 0.2s',
                                    }}>
                                        <Upload size={24} style={{ color: 'var(--text-tertiary)', opacity: 0.6 }} />
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                            Click to attach files
                                        </span>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                                            Files will be attached to the ITSM ticket after creation
                                        </span>
                                    </div>
                                </label>

                                {itsmFiles.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
                                        {itsmFiles.map((f, i) => (
                                            <div key={i} style={{
                                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                                padding: '0.35rem 0.7rem', background: 'rgba(245,158,11,0.08)',
                                                border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-sm)',
                                                fontSize: '0.72rem', fontWeight: 600, color: '#f59e0b',
                                            }}>
                                                <Paperclip size={11} />
                                                {f.name}
                                                <button
                                                    type="button"
                                                    onClick={() => setItsmFiles(prev => prev.filter((_, idx) => idx !== i))}
                                                    style={{ border: 'none', background: 'none', color: '#f85149', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            )}

                            {/* ═══ Submit ═══ */}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', paddingBottom: '2rem' }}>
                                <button type="button" className="login-button" style={{
                                    width: 'auto', padding: '0.8rem 1.5rem',
                                    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                                    boxShadow: 'none', border: '1px solid var(--border-color)',
                                }} onClick={() => router.back()}>Cancel</button>
                                <button type="submit" className="login-button"
                                    style={{ width: 'auto', padding: '0.8rem 2rem' }} disabled={loading}>
                                    {loading ? (<><Loader2 size={18} className="animate-spin" /> Creating...</>)
                                        : (<><TicketPlus size={18} /> Create Ticket</>)}
                                </button>
                            </div>
                        </form>
                    )}
                </main>
            </div>
        </div>
    );
}
