'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
    ArrowLeft, User, Shield, Server, Hash, Clock, Globe,
    MessageSquare, Activity, File, Link2, ShieldAlert,
    AlertTriangle, Zap, Target, ChevronDown, ChevronUp,
    Tag, Cpu, Network, Eye, Brain, Mail, Monitor,
    Edit2, Check, X as XIcon, Save as SaveIcon, Pencil,
    Trash2, Plus, Building2, Info, FileText, BookOpen,
    TicketPlus, Loader2, ArrowRight, Terminal, Crosshair, Fingerprint
} from 'lucide-react';
import { incidentApi, slaApi, integrationApi } from '@/lib/api';
import { format, formatDistanceToNow } from 'date-fns';
import Sidebar from '@/components/Sidebar';
import MailPreviewModal from '@/components/MailPreviewModal';
import CommunicationTimeline from '@/components/CommunicationTimeline';
import DOMPurify from 'dompurify';
import Cookies from 'js-cookie';
import DynamicList from '@/components/DynamicList';

const WS_URL = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8012`
    : (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8012');

/* ─── helpers ─── */
const SEVER_COLORS: Record<string, { bg: string; color: string; border: string }> = {
    critical: { bg: 'rgba(248,81,73,0.12)', color: '#f85149', border: 'rgba(248,81,73,0.35)' },
    high: { bg: 'rgba(240,104,94,0.12)', color: '#f07b4e', border: 'rgba(240,104,94,0.35)' },
    medium: { bg: 'rgba(210,153,34,0.12)', color: '#d29922', border: 'rgba(210,153,34,0.35)' },
    low: { bg: 'rgba(63,185,80,0.12)', color: '#3fb950', border: 'rgba(63,185,80,0.35)' },
    info: { bg: 'rgba(68,147,248,0.12)', color: '#4493f8', border: 'rgba(68,147,248,0.35)' },
};
const sevColor = (s = 'medium') => SEVER_COLORS[s.toLowerCase()] ?? SEVER_COLORS.medium;

const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
    'new': { bg: 'rgba(47,129,247,0.12)', color: '#2f81f7', border: 'rgba(47,129,247,0.35)' },
    'triaging': { bg: 'rgba(210,153,34,0.12)', color: '#d29922', border: 'rgba(210,153,34,0.35)' },
    'in_progress': { bg: 'rgba(163,113,247,0.12)', color: '#a371f7', border: 'rgba(163,113,247,0.35)' },
    'resolved': { bg: 'rgba(63,185,80,0.12)', color: '#3fb950', border: 'rgba(63,185,80,0.35)' },
    'false_positive': { bg: 'rgba(125,133,144,0.12)', color: '#7d8590', border: 'rgba(125,133,144,0.35)' },
    'escalated': { bg: 'rgba(248,81,73,0.12)', color: '#f85149', border: 'rgba(248,81,73,0.35)' },
    'sent to customer': { bg: 'rgba(56,166,229,0.12)', color: '#38a6e5', border: 'rgba(56,166,229,0.35)' },
    'customer response received': { bg: 'rgba(226,135,67,0.12)', color: '#e28743', border: 'rgba(226,135,67,0.35)' },
    'ai triaging': { bg: 'rgba(163,113,247,0.12)', color: '#a371f7', border: 'rgba(163,113,247,0.35)' },
};
const statColor = (s = 'new') => STATUS_COLORS[s.toLowerCase()] ?? STATUS_COLORS['new'];

function Badge({ label, color = 'var(--text-tertiary)', bg = 'var(--bg-tertiary)', border = 'var(--border-color)' }: any) {
    return (
        <span style={{
            display: 'inline-block', padding: '0.15rem 0.55rem',
            borderRadius: '9999px', fontSize: '0.6rem', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            background: bg, color, border: `1px solid ${border}`, whiteSpace: 'nowrap'
        }}>{label}</span>
    );
}

function SeverityBadge({ severity }: { severity?: string }) {
    const s = severity?.toLowerCase() ?? 'medium';
    const c = sevColor(s);
    return <Badge label={s} color={c.color} bg={c.bg} border={c.border} />;
}

/* ─── Reusable sub-components for Inline Editing (Sync with Creation UI) ─── */

const SectionHeader = ({ icon, iconBg, iconBorder, title, optional, required }: {
    icon: React.ReactNode; iconBg: string; iconBorder: string; title: string; optional?: boolean; required?: boolean;
}) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1.25rem' }}>
        <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: iconBg, border: `1px solid ${iconBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>{title}{required && <span style={{ color: '#f85149', marginLeft: '4px' }}>*</span>}</h3>
        {optional && !required && <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 400 }}>Optional</span>}
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

const tableStyles: Record<string, React.CSSProperties> = {
    wrapper: {
        border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
        overflow: 'hidden', marginBottom: '0.5rem', width: '100%'
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

function Section({ id, icon, title, children, accent = 'var(--accent-primary)', headerAction }: any) {
    return (
        <section id={id} style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)', padding: '1.25rem', display: 'flex',
            flexDirection: 'column', gap: '1rem',
            scrollMarginTop: 'var(--header-height, 80px)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ color: accent }}>{icon}</div>
                <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>{title}</span>
                {headerAction}
            </div>
            {children}
        </section>
    );
}

/* ─── Section Navigation Sidebar ─── */
interface NavSection { id: string; label: string; icon: React.ReactNode; available: boolean; }

function SectionNav({ sections, embedded = false }: { sections: NavSection[]; embedded?: boolean }) {
    const [active, setActive] = useState<string>('');
    const available = sections.filter(s => s.available);

    useEffect(() => {
        if (available.length === 0) return;
        const ratios = new Map<string, number>();

        const observers = available.map(({ id }) => {
            const el = document.getElementById(id);
            if (!el) return null;
            const obs = new IntersectionObserver(([entry]) => {
                ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
                const best = Array.from(ratios.entries()).reduce((a, b) => b[1] > a[1] ? b : a, ['', 0] as [string, number]);
                if (best[1] > 0) setActive(best[0] as string);
            }, { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: '-80px 0px -40% 0px' });
            obs.observe(el);
            return obs;
        });

        return () => observers.forEach(o => o?.disconnect());
    }, [available.map(s => s.id).join(',')]);

    const scrollTo = (id: string) => {
        const target = document.getElementById(id);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActive(id);
        }
    };

    if (available.length === 0) return null;

    const NAV_COLORS: Record<string, string> = {
        'sec-summary':    'var(--accent-primary)',
        'sec-resolution': 'var(--status-low)',
        'sec-mitre':      '#ff7b72',
        'sec-alerts':     '#a371f7',
        'sec-hosts':      'var(--accent-primary)',
        'sec-users':      'var(--status-medium)',
        'sec-network':    'var(--status-info)',
        'sec-files':      'var(--status-medium)',
        'sec-iocs':       '#ff7b72',
        'sec-timeline':   'var(--accent-primary)',
    };

    const inner = (
        <>
            <div style={{
                fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
                marginBottom: '0.4rem', paddingLeft: embedded ? '0.25rem' : '0.5rem'
            }}>
                JUMP TO SECTION
            </div>
            {available.map(sec => {
                const isActive = active === sec.id;
                const accentColor = NAV_COLORS[sec.id] ?? 'var(--accent-primary)';
                const rgbFallback = accentColor === 'var(--accent-primary)' ? '47,129,247'
                    : accentColor === '#a371f7' ? '163,113,247'
                    : accentColor === '#ff7b72' ? '255,123,114'
                    : accentColor === 'var(--status-medium)' ? '210,153,34'
                    : accentColor === 'var(--status-info)' ? '68,147,248'
                    : accentColor === 'var(--status-low)' ? '63,185,80'
                    : '47,129,247';
                return (
                    <button
                        key={sec.id}
                        onClick={() => scrollTo(sec.id)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                            padding: '0.5rem 0.65rem',
                            borderRadius: '6px',
                            background: isActive ? `rgba(${rgbFallback},0.12)` : 'transparent',
                            border: `1px solid ${isActive ? accentColor : 'transparent'}`,
                            cursor: 'pointer', textAlign: 'left', width: '100%',
                            transition: 'all 0.15s',
                            color: isActive ? accentColor : 'var(--text-secondary)',
                        }}
                        onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                        onMouseOut={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    >
                        <span style={{ flexShrink: 0, display: 'flex', color: isActive ? accentColor : 'var(--text-tertiary)', opacity: isActive ? 1 : 0.7 }}>
                            {sec.icon}
                        </span>
                        <span style={{
                            fontSize: '0.82rem', fontWeight: isActive ? 600 : 500,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                            {sec.label}
                        </span>
                        {isActive && (
                            <span style={{
                                marginLeft: 'auto', width: 5, height: 5,
                                borderRadius: '50%', background: accentColor, flexShrink: 0
                            }} />
                        )}
                    </button>
                );
            })}
        </>
    );

    if (embedded) return <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>{inner}</div>;

    return (
        <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '0.85rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.15rem',
        }}>
            {inner}
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
    if (!value || value === 'N/A' || value === '') return null;
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            gap: '1.5rem', padding: '0.5rem 0',
            borderBottom: '1px solid var(--border-subtle)'
        }}>
            <span style={{
                fontSize: '0.72rem', color: 'var(--text-tertiary)',
                whiteSpace: 'nowrap', minWidth: '140px', flexShrink: 0,
                textTransform: 'capitalize'
            }}>{label}</span>
            <span style={{
                fontSize: '0.8rem', color: 'var(--text-primary)',
                fontWeight: 500, textAlign: 'right', wordBreak: 'break-all'
            }}>{value}</span>
        </div>
    );
}

/* ─── Helpers ─── */
function ScoreBadge({ label, score, color }: { label: string, score: number, color: string }) {
    return (
        <div style={{
            background: 'var(--bg-tertiary)', padding: '0.5rem 0.75rem',
            borderRadius: 'var(--radius-md)', border: `1px solid var(--border-color)`,
            display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: '80px'
        }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{label}</span>
            <span style={{ fontSize: '1rem', fontWeight: 800, color }}>{score}</span>
        </div>
    );
}

/* ─── Alert card (one XSIAM alert/issue stitched into the incident) ─── */
function AlertCard({ alert, index }: { alert: any; index: number }) {
    const [expanded, setExpanded] = useState(false);
    const [showRaw, setShowRaw] = useState(false);
    const sc = sevColor(alert.severity);

    const mitreTactics: string[] = alert.mitre_tactic_id_and_name
        ? [alert.mitre_tactic_id_and_name]
        : [];
    const mitreTechs: string[] = alert.mitre_technique_id_and_name
        ? [alert.mitre_technique_id_and_name]
        : [];

    return (
        <div style={{
            border: `1px solid ${sc.border}`,
            borderLeft: `4px solid ${sc.color}`,
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-secondary)',
            overflow: 'hidden',
            transition: 'all 0.2s',
            boxShadow: expanded ? '0 8px 30px rgba(0,0,0,0.3)' : 'none'
        }}>
            {/* Header row */}
            <div
                onClick={() => setExpanded(x => !x)}
                style={{
                    padding: '1rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '1rem',
                    background: expanded ? 'rgba(255,255,255,0.03)' : 'transparent',
                    borderBottom: expanded ? '1px solid var(--border-subtle)' : 'none'
                }}
            >
                <div style={{ marginTop: '4px', color: sc.color, flexShrink: 0 }}>
                    <ShieldAlert size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                        <span style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                            {alert.name || alert.alert_name || `Alert #${index + 1}`}
                        </span>
                        <SeverityBadge severity={alert.severity} />
                        {alert.alert_source && (
                            <Badge label={alert.alert_source} color='var(--text-secondary)' bg='var(--bg-tertiary)' border='var(--border-color)' />
                        )}
                        {alert.category && (
                            <Badge label={alert.category} color='#a371f7' bg='rgba(163,113,247,0.12)' border='rgba(163,113,247,0.3)' />
                        )}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.6rem', lineHeight: 1.5 }}>
                        {alert.description || alert.action_pretty || '—'}
                    </div>
                    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                        {alert.host_name && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                <Server size={12} style={{ color: 'var(--accent-primary)' }} /> {alert.host_name}
                            </div>
                        )}
                        {alert.user_name && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                <User size={12} style={{ color: 'var(--status-medium)' }} /> {alert.user_name}
                            </div>
                        )}
                        {(alert.source_insert_ts || alert.detection_timestamp || alert.Time) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                <Clock size={12} />
                                {new Date(alert.source_insert_ts || alert.detection_timestamp || alert.Time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: '4px' }}>
                    {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div style={{ padding: '1.5rem', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {/* ── Tabs/Actions ── */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowRaw(!showRaw); }}
                            style={{
                                background: showRaw ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                                color: showRaw ? 'white' : 'var(--text-secondary)',
                                border: '1px solid var(--border-color)',
                                padding: '0.4rem 0.8rem',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '0.4rem'
                            }}
                        >
                            <Eye size={12} /> {showRaw ? 'STORY VIEW' : 'TECHNICAL DATA'}
                        </button>
                    </div>

                    {showRaw ? (
                        <div style={{
                            background: 'var(--bg-tertiary)', padding: '1.25rem', borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)', maxHeight: '600px',
                            overflowY: 'auto', overflowX: 'hidden',
                            fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
                            color: 'var(--text-primary)', lineHeight: 1.6, minWidth: 0
                        }}>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(alert, null, 2)}</pre>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>

                            {/* Process Forensics EXHAUSTIVE */}
                            <div style={{ background: 'var(--bg-tertiary)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--status-info)' }}>
                                    <Activity size={14} />
                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Process Activity</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <InfoRow label="Actor Process" value={alert.actor_process_image_name} />
                                    <InfoRow label="Instance ID" value={alert.actor_process_instance_id} />
                                    <InfoRow label="Actor Path" value={alert.actor_process_image_path} />
                                    <InfoRow label="Command Line" value={<code style={{ display: 'block', background: 'var(--bg-elevated)', padding: '0.5rem', borderRadius: '4px', fontSize: '0.72rem', marginTop: '0.2rem', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>{alert.actor_process_image_cmd || alert.actor_process_command_line || '—'}</code>} />
                                    <InfoRow label="Actor Hash" value={alert.actor_process_image_sha256} />
                                    <InfoRow label="Actor Verdict" value={alert.actor_process_image_sha256_verdict} />
                                    <InfoRow label="Parent Process" value={alert.causality_actor_process_image_name} />
                                    <InfoRow label="Parent Path" value={alert.causality_actor_process_image_path} />
                                    <InfoRow label="Parent CMD" value={alert.causality_actor_process_image_cmd} />
                                    <InfoRow label="Signature" value={alert.actor_process_image_signature} />
                                    <InfoRow label="Signer" value={alert.actor_process_image_signature_vendor} />
                                </div>
                            </div>

                            {/* Network Forensics EXHAUSTIVE */}
                            <div style={{ background: 'var(--bg-tertiary)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--accent-primary)' }}>
                                    <Network size={14} />
                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Network & Connectivity</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <InfoRow label="Local IP" value={alert.action_local_ip || alert.local_ip} />
                                    <InfoRow label="Local Port" value={alert.action_local_port || alert.local_port} />
                                    <InfoRow label="Remote IP" value={alert.action_remote_ip || alert.remote_ip} />
                                    <InfoRow label="Remote Port" value={alert.action_remote_port || alert.remote_port} />
                                    <InfoRow label="Country" value={alert.action_country || alert.dst_action_country} />
                                    <InfoRow label="Target Host" value={alert.action_external_hostname} />
                                    <InfoRow label="Host Verdict" value={alert.action_external_hostname_verdict} />
                                    <InfoRow label="IPv6 (Local)" value={alert.action_local_ip_v6} />
                                    <InfoRow label="IPv6 (Remote)" value={alert.action_remote_ip_v6} />
                                    <InfoRow label="Local Verdict" value={alert.action_local_ip_verdict} />
                                    <InfoRow label="Remote Verdict" value={alert.action_remote_ip_verdict} />
                                </div>
                            </div>

                            {/* File & Ops EXHAUSTIVE */}
                            <div style={{ background: 'var(--bg-tertiary)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--status-medium)' }}>
                                    <File size={14} />
                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>File Operations</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <InfoRow label="Target File" value={alert.action_file_name} />
                                    <InfoRow label="File Path" value={alert.action_file_path} />
                                    <InfoRow label="File Hash" value={alert.action_file_sha256} />
                                    <InfoRow label="File Verdict" value={alert.action_file_sha256_verdict} />
                                    <InfoRow label="OS Process" value={alert.os_actor_process_image_name} />
                                    <InfoRow label="OS Path" value={alert.os_actor_process_image_path} />
                                    <InfoRow label="OS Hash" value={alert.os_actor_process_image_sha256} />
                                    <InfoRow label="OS Verdict" value={alert.os_actor_process_image_sha256_verdict} />
                                </div>
                            </div>

                            {/* Endpoint & Metadata */}
                            <div style={{ background: 'var(--bg-tertiary)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-tertiary)' }}>
                                    <Tag size={14} />
                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Endpoint & ID Context</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <InfoRow label="Alert ID" value={alert.alert_id} />
                                    <InfoRow label="Endpoint ID" value={alert.endpoint_id || alert.agent_id} />
                                    <InfoRow label="Source" value={alert.source || alert.alert_source} />
                                    <InfoRow label="Category" value={alert.category} />
                                    <InfoRow label="Action" value={alert.action} />
                                    <InfoRow label="MITRE Tactic" value={alert.mitre_tactic_id_and_name} />
                                    <InfoRow label="MITRE Tech" value={alert.mitre_technique_id_and_name} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/* ─── Main Page ─── */
export default function IncidentDetail() {
    const { id } = useParams() as { id: string };
    const router = useRouter();
    const [incident, setIncident] = useState<any>(null);
    const [newComment, setNewComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [showIncidentTechnical, setShowIncidentTechnical] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    
    // SLA State
    const [slaData, setSlaData] = useState<any>(null);
    // Communication interactions for side-panel activity feed
    const [sidebarInteractions, setSidebarInteractions] = useState<any[]>([]);

    // Editing State
    const [editSection, setEditSection] = useState<string | null>(null);
    const [editData, setEditData] = useState<any>({});
    const [saving, setSaving] = useState(false);
    const [userRole, setUserRole] = useState<string | null>(null);
    const [hasITSMIntegration, setHasITSMIntegration] = useState(false);

    useEffect(() => {
        setUserRole(Cookies.get('user_role') || null);
    }, []);

    const isEditLocked = userRole === 'analyst' && (incident?.status === 'sent to customer' || incident?.status === 'customer response received');

    const startEditing = (sectionId: string, initialData: any) => {
        setEditSection(sectionId);
        
        let dataToEdit = JSON.parse(JSON.stringify(initialData || {}));
        
        // Handle specific section initializations
        if (sectionId === 'assets') {
            const currentAssets = rawPayload.asset_details || [];
            dataToEdit.asset_details = currentAssets.length > 0 
                ? JSON.parse(JSON.stringify(currentAssets))
                : [{ detection_method: '', source_ip: '', log_source: '', action: 'block' }];
        } else if (sectionId === 'iocs') {
            const currentIocs = incident.iocs || [];
            dataToEdit.iocs = currentIocs.length > 0
                ? currentIocs.map((ioc: any) => {
                    if (typeof ioc === 'object' && ioc !== null) return { ...ioc };
                    return { category: 'IP', signature: String(ioc), domain_name: '' };
                })
                : [{ category: 'IP', signature: '', domain_name: '' }];
        } else if (sectionId === 'mitre') {
            dataToEdit.mitre_tactics = incident.mitre_tactics || [];
            dataToEdit.mitre_techniques = incident.mitre_techniques || [];
        } else if (sectionId === 'analysis' || sectionId === 'observations' || sectionId === 'impact' || sectionId === 'recommendations') {
            dataToEdit.observations = rawPayload.observations || [];
            dataToEdit.business_impact = rawPayload.business_impact || [];
            dataToEdit.recommendations = rawPayload.recommendations || [];
            // If we're targeting a specific subsection, we still load all but focus is UI-side
            setEditSection('analysis'); 
        } else if (sectionId === 'basics') {
            dataToEdit.title = incident.title;
            dataToEdit.severity = incident.severity;
            dataToEdit.status = incident.status;
            dataToEdit.description = incident.description;
        }
        
        setEditData(dataToEdit);
    };

    const cancelEditing = () => {
        setEditSection(null);
        setEditData({});
    };

    const handleSaveEdit = async () => {
        setSaving(true);
        try {
            const payload: any = { ...editData };
            
            // Cleanup and transform specific fields for API
            if (editSection === 'assets') {
                payload.asset_details = (editData.asset_details || []).filter((a: any) => a.detection_method || a.source_ip);
                delete payload.asset_raw; // Remove legacy field if it exists
            } else if (editSection === 'iocs') {
                payload.iocs = (editData.iocs || []).filter((i: any) => i.signature);
            } else if (editSection === 'mitre') {
                // Ensure they are arrays
                payload.mitre_tactics = Array.isArray(editData.mitre_tactics) ? editData.mitre_tactics : [];
                payload.mitre_techniques = Array.isArray(editData.mitre_techniques) ? editData.mitre_techniques : [];
                // Synchronize with mitre_attack
                const maxLen = Math.max(payload.mitre_tactics.length, payload.mitre_techniques.length);
                payload.mitre_attack = Array.from({ length: maxLen }).map((_, i) => ({
                    tactic: payload.mitre_tactics[i] || '',
                    technique: payload.mitre_techniques[i] || ''
                }));
            } else if (editSection === 'analysis') {
                payload.observations = (editData.observations || []).filter(Boolean);
                payload.business_impact = (editData.business_impact || []).filter(Boolean);
                payload.recommendations = (editData.recommendations || []).filter(Boolean);
            }

            await incidentApi.update(id, payload);
            setEditSection(null);
            fetchIncident();
        } catch (err: any) {
            alert(`Failed to update: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveEditDirectly = async (data: any) => {
        if (isEditLocked) return;
        try {
            setSaving(true);
            setIncident((prev: any) => prev ? { ...prev, ...data } : prev);
            await incidentApi.update(id, data);
            if (data.status) {
                fetchIncident();
            }
        } catch (err: any) {
            alert(`Save failed: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    // Always-allowed save for status & severity — bypasses isEditLocked.
    // Also syncs to ITSM automatically via the backend PATCH endpoint.
    const handleSaveStatusSeverity = async (data: { status?: string; severity?: string }) => {
        try {
            // Optimistic update so UI changes instantly
            setIncident((prev: any) => prev ? { ...prev, ...data } : prev);
            await incidentApi.update(id, data);
            // Re-fetch to get fresh data (SLA panel, header gradient, etc.)
            fetchIncident();
        } catch (err: any) {
            // Revert optimistic update on failure
            fetchIncident();
            alert(`Save failed: ${err.message}`);
        }
    };

    const updateRow = (field: string, index: number, subfield: string, value: string) => {
        const rows = [...(rawPayload[field] || [])];
        rows[index] = { ...rows[index], [subfield]: value };
        handleSaveEditDirectly({ [field]: rows });
    };

    const removeRow = (field: string, index: number) => {
        const rows = (rawPayload[field] || []).filter((_: any, i: number) => i !== index);
        handleSaveEditDirectly({ [field]: rows });
    };

    const addRow = (field: string, template: any) => {
        const rows = [...(rawPayload[field] || []), template];
        handleSaveEditDirectly({ [field]: rows });
    };

    const updateMitreRow = (index: number, field: 'tactic' | 'technique', value: string) => {
        const tactics = [...(incident.mitre_tactics || [])];
        const techniques = [...(incident.mitre_techniques || [])];
        if (field === 'tactic') tactics[index] = value;
        else techniques[index] = value;
        
        // Synchronize with mitre_attack for the preview modal
        const maxLen = Math.max(tactics.length, techniques.length);
        const attack = Array.from({ length: maxLen }).map((_, i) => ({ 
            tactic: tactics[i] || '', 
            technique: techniques[i] || '' 
        }));
        
        handleSaveEditDirectly({ 
            mitre_tactics: tactics, 
            mitre_techniques: techniques,
            mitre_attack: attack
        });
    };

    const removeMitreRow = (index: number) => {
        const tactics = (incident.mitre_tactics || []).filter((_: any, i: number) => i !== index);
        const techniques = (incident.mitre_techniques || []).filter((_: any, i: number) => i !== index);
        
        // Synchronize with mitre_attack for the preview modal
        const maxLen = Math.max(tactics.length, techniques.length);
        const attack = Array.from({ length: maxLen }).map((_, i) => ({ 
            tactic: tactics[i] || '', 
            technique: techniques[i] || '' 
        }));
        
        handleSaveEditDirectly({ 
            mitre_tactics: tactics, 
            mitre_techniques: techniques,
            mitre_attack: attack
        });
    };

    const addMitreRow = () => {
        const tactics = [...(incident.mitre_tactics || []), ''];
        const techniques = [...(incident.mitre_techniques || []), ''];
        
        const maxLen = Math.max(tactics.length, techniques.length);
        const attack = Array.from({ length: maxLen }).map((_, i) => ({ 
            tactic: tactics[i] || '', 
            technique: techniques[i] || '' 
        }));

        handleSaveEditDirectly({ 
            mitre_tactics: tactics, 
            mitre_techniques: techniques,
            mitre_attack: attack
        });
    };

    const analyzingRef = useRef(false); // synchronous guard — prevents race condition on fast double-click
    const [analyzeResult, setAnalyzeResult] = useState<{ status?: string; job_id?: string; error?: string } | null>(null);
    const [showMailPreview, setShowMailPreview] = useState(false);

    const loadAnalyzeState = (inc: any) => {
        if (inc?.agentic_job_id) {
            setAnalyzeResult({ status: 'queued', job_id: inc.agentic_job_id });
            // Do NOT set analyzing to true here, we want to allow re-sending
        }
    };

    const fetchIncident = async () => {
        try {
            const data = await incidentApi.get(id);

            // Redirect to Ticket ID for cleaner URLs if provided with UUID
            if (data.ticket_id && id !== data.ticket_id) {
                router.replace(`/incidents/${data.ticket_id}`);
                return;
            }

            if (data.raw_payload && typeof data.raw_payload === 'string') {
                try { data.raw_payload = JSON.parse(data.raw_payload); } catch (_) { }
            }
            setIncident(data);
            loadAnalyzeState(data);

            // Check if tenant has any ITSM integration enabled — if so, disable manual email notification
            const tenantId = data.tenant_id;
            if (tenantId) {
                try {
                    const intData = await integrationApi.listConfigs(tenantId);
                    const itsm = ['freshservice', 'freshdesk', 'servicenow'];
                    const active = (intData.integrations || []).some(
                        (cfg: any) => itsm.includes(cfg.integration) && cfg.is_enabled
                    );
                    setHasITSMIntegration(active);
                } catch (_) { /* non-critical */ }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchIncident(); }, [id]);

    // Load SLA data + interactions for sidebar activity feed
    useEffect(() => {
        if (!id) return;
        slaApi.getIncidentSla(id).then(setSlaData).catch(() => setSlaData(null));
        incidentApi.getInteractions(id)
            .then((data: any[]) => setSidebarInteractions(data))
            .catch(() => setSidebarInteractions([]));
    }, [id, refreshTrigger]);

    useEffect(() => {
        // WebSocket logic for real-time updates
        const token = Cookies.get('soc_token');
        if (!token || !id) return;
        
        const wsUrl = `${WS_URL}/ws/incidents?token=${token}`;
        
        let ws: WebSocket | null = null;
        let reconnectTimeout: any = null;

        const connectWS = () => {
            console.log("Incident Page connecting to WebSocket...");
            ws = new WebSocket(wsUrl);

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.event_type === 'incident_updated' && 
                        (data.incident_id === id || data.incident_id === incident?.ticket_id)) {
                        console.log("Real-time update received:", data.update_type || 'generic');
                        const hasStatusChange = data.status || (data.updates && data.updates.includes('status'));
                        const isSignificant = data.update_type === 'reply_sent' || data.update_type === 'email_sent';
                        if (hasStatusChange || isSignificant) {
                            fetchIncident();
                            setRefreshTrigger(prev => prev + 1);
                        }
                    }
                } catch (e) {
                    console.error("WS parse error", e);
                }
            };

            ws.onclose = () => {
                console.log("incident WS closed, reconnecting...");
                reconnectTimeout = setTimeout(connectWS, 3000);
            };

            ws.onerror = (err) => {
                console.error("WS error", err);
                ws?.close();
            };
        };

        connectWS();

        return () => {
            if (ws) ws.close();
            clearTimeout(reconnectTimeout);
        };
    }, [id, incident?.ticket_id]);

    const handleAnalyze = async () => {
        // Synchronous guard — prevents race condition where fast double-click fires
        // before React re-renders the disabled={analyzing} attribute
        if (analyzingRef.current || isEditLocked) return;
        analyzingRef.current = true;
        setAnalyzing(true);
        setAnalyzeResult(null);
        try {
            const data = await incidentApi.analyze(id);
            setAnalyzeResult({ status: data.status, job_id: data.job_id });
            // Refetch incident to get the updated agentic_job_id saved by backend
            fetchIncident();
        } catch (err: any) {
            setAnalyzeResult({ error: err?.message ?? 'Network error — is the Agentic SOC running on port 9000?' });
        } finally {
            analyzingRef.current = false;
            setAnalyzing(false);
        }
    };

    const handleAddComment = async () => {
        if (!newComment.trim()) return;
        setSubmitting(true);
        try {
            await incidentApi.addComment(id, newComment);
            setNewComment('');
            fetchIncident();
        } catch (err) {
            console.error('Failed to add comment', err);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', flexDirection: 'column', gap: '1rem' }}>
            <Activity className="animate-spin" style={{ color: 'var(--accent-primary)' }} size={32} />
            <span style={{ color: '#848d97', fontWeight: 500 }}>Reconstructing incident artifacts...</span>
        </div>
    );

    if (!incident) return <div style={{ padding: '2rem', color: 'var(--status-critical)' }}>Incident reference not found.</div>;

    const sc = sevColor(incident.severity);
    const rawPayload = incident.raw_payload ?? {};
    const alerts: any[] = rawPayload.alerts ?? [];
    const fileArtifacts: any[] = rawPayload.file_artifacts ?? [];
    const networkArtifacts: any[] = rawPayload.network_artifacts ?? [];
    const incidentMeta = rawPayload.incident ?? {};

    // SLA helpers
    const slaMetrics = slaData?.metrics ?? {};
    const slaEvents: any[] = slaData?.events ?? [];
    const formatMins = (m: number | undefined | null): string => {
        if (m === undefined || m === null) return '—';
        const abs = Math.abs(m);
        if (abs < 1) return `${Math.round(abs * 60)}s`;
        if (abs < 60) return `${Math.round(abs)}m`;
        const h = Math.floor(abs / 60);
        const min = Math.round(abs % 60);
        return min > 0 ? `${h}h ${min}m` : `${h}h`;
    };
    const frTarget   = slaMetrics?.targets?.first_response_min;
    const resTarget  = slaMetrics?.targets?.resolution_min;
    const frActual   = slaMetrics?.first_response_min;
    const resActual  = slaMetrics?.resolution_min;
    const frRemain   = slaMetrics?.fr_remaining_min;
    const resRemain  = slaMetrics?.res_remaining_min;
    const frPct      = slaMetrics?.fr_pct_elapsed ?? 0;
    const resPct     = slaMetrics?.res_pct_elapsed ?? 0;
    const frBreached = slaMetrics?.first_response_breached ?? false;
    const resBreached= slaMetrics?.resolution_breached ?? false;

    // Find milestone timestamps from events
    const firstRespEvent = slaEvents.find((e: any) => e.event_type === 'first_response' || e.event_type === 'first_response_set');
    const resolvedEvent  = slaEvents.find((e: any) => e.event_type === 'resolved' || e.event_type === 'resolution_set');

    const slaTimeline = [
        { milestone: 'Incident Created', time: incident?.created_at, status: 'completed' },
        ...(firstRespEvent ? [{ milestone: 'First Response', time: firstRespEvent.created_at, status: frBreached ? 'breached' : 'completed' }] : []),
        ...(resolvedEvent  ? [{ milestone: 'Resolved',       time: resolvedEvent.created_at,  status: resBreached ? 'breached' : 'completed' }] : []),
    ].filter(item => item.time);

    const navSections: NavSection[] = [
        { id: 'sec-timeline',   label: 'Communication Timeline',  icon: <MessageSquare size={12} />, available: true },
        { id: 'sec-summary',    label: incident.source_vendor === 'manual' ? 'Ticket Details' : 'Executive Summary', icon: <Activity size={12} />,    available: true },
        { id: 'sec-analysis',   label: 'Analysis & Findings',      icon: <Eye size={12} />,         available: true },
        { id: 'sec-resolution', label: 'Resolution Context',       icon: <Shield size={12} />,      available: !!incidentMeta.resolve_comment },
        { id: 'sec-mitre',      label: 'MITRE ATT&CK',            icon: <Target size={12} />,      available: true },
        { id: 'sec-alerts',     label: `Stitched Alerts (${alerts.length})`, icon: <Zap size={12} />, available: alerts.length > 0 },
        { id: 'sec-hosts',      label: 'Affected Infrastructure', icon: <Server size={12} />,      available: incident.affected_hosts?.length > 0 },
        { id: 'sec-users',      label: 'Involved Users',          icon: <User size={12} />,        available: incident.affected_users?.length > 0 },
        { id: 'sec-network',    label: 'Network Entities',        icon: <Network size={12} />,     available: networkArtifacts.length > 0 },
        { id: 'sec-files',      label: 'File Artifacts',          icon: <File size={12} />,        available: fileArtifacts.length > 0 },
        { id: 'sec-assets',     label: 'Asset Details',           icon: <Monitor size={12} />,     available: true },
        { id: 'sec-iocs',       label: 'IOCs',                    icon: <Crosshair size={12} />,      available: true },
        // NOTE: SLA Timeline (sec-sla) is intentionally excluded from JUMP TO SECTION as it resides in the right sidebar.
    ];

    return (
        <div className="app-container" style={{ height: '100vh', overflow: 'hidden', display: 'flex' }}>
            <Sidebar contextNav={<SectionNav sections={navSections} embedded />} />
            <div className="main-layout" style={{ 
                flex: 1, height: '100vh', display: 'flex', flexDirection: 'column',
                backgroundColor: 'var(--bg-primary)', 
                backgroundImage: `radial-gradient(circle at top right, ${sc.bg} 0%, transparent 45%)`,
                overflow: 'hidden'
            }}>

                {/* ── Header ── */}
                <header className="header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                        <button onClick={() => router.back()} className="hover-scale" style={{
                            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                            padding: '0.6rem', borderRadius: 'var(--radius-md)',
                            color: 'var(--text-secondary)', cursor: 'pointer'
                        }}>
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                <Shield size={18} style={{ color: sc.color }} />
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <span style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 900,
                                        color: 'var(--text-primary)',
                                        background: 'var(--bg-tertiary)',
                                        padding: '0.2rem 0.6rem',
                                        borderRadius: 'var(--radius-sm)',
                                        border: '1px solid var(--border-subtle)',
                                        fontFamily: 'var(--font-mono)'
                                    }}>
                                        {incident.ticket_id || `${((incident.tenant_name as string) || 'SOC').slice(0, 4).toUpperCase()}-${incident.vendor_incident_id}`}
                                    </span>
                                    <h2 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                                        {editSection === 'header' ? (
                                            <input 
                                                className="login-input"
                                                value={editData.title ?? incident.title}
                                                onChange={e => setEditData({...editData, title: e.target.value})}
                                                style={{ fontSize: 'inherit', fontWeight: 'inherit', width: '400px', height: '32px' }}
                                            />
                                        ) : incident.title}
                                    </h2>
                                    {editSection === 'header' ? (
                                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                                            <button onClick={handleSaveEdit} disabled={saving} style={{ background: 'var(--status-success)', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>
                                                {saving ? '...' : 'SAVE'}
                                            </button>
                                            <button onClick={cancelEditing} style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: 'none', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>
                                                CANCEL
                                            </button>
                                        </div>
                                    ) : !isEditLocked && (
                                        <button onClick={() => startEditing('header', { title: incident.title, severity: incident.severity, status: incident.status })} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
                                            <Edit2 size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginLeft: '2rem' }}>
                                {incident.source_vendor?.toUpperCase()} • VENDOR_ID: {incident.vendor_incident_id}
                                {incident.tenant_name && ` • CLIENT: ${incident.tenant_name}`}
                            </span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                        {editSection === 'header' ? (
                            <div style={{ display: 'flex', gap: '0.6rem' }}>
                                <SelectWithChevron
                                    value={editData.severity ?? incident.severity}
                                    onChange={(e: any) => setEditData({...editData, severity: e.target.value})}
                                    style={{ fontSize: '0.7rem', height: '28px', padding: '0 1rem 0 0.5rem' }}
                                >
                                    <option value="critical">CRITICAL</option>
                                    <option value="high">HIGH</option>
                                    <option value="medium">MEDIUM</option>
                                    <option value="low">LOW</option>
                                    <option value="info">INFO</option>
                                </SelectWithChevron>
                                <SelectWithChevron
                                    value={editData.status ?? incident.status}
                                    onChange={(e: any) => setEditData({...editData, status: e.target.value})}
                                    style={{ fontSize: '0.7rem', height: '28px', padding: '0 1rem 0 0.5rem' }}
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
                        ) : (
                            <>
                                {/* Severity — always editable inline select styled as a badge */}
                                <div style={{ position: 'relative', display: 'inline-flex' }}>
                                    <select
                                        value={incident.severity ?? 'medium'}
                                        onChange={(e: any) => handleSaveStatusSeverity({ severity: e.target.value })}
                                        style={{
                                            appearance: 'none',
                                            padding: '2px 20px 2px 8px',
                                            fontSize: '0.7rem',
                                            fontWeight: 800,
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.04em',
                                            background: sevColor(incident.severity ?? 'medium').bg,
                                            color: sevColor(incident.severity ?? 'medium').color,
                                            border: `1px solid ${sevColor(incident.severity ?? 'medium').border}`,
                                            borderRadius: '5px',
                                            cursor: 'pointer',
                                            outline: 'none',
                                        }}
                                    >
                                        <option value="critical">CRITICAL</option>
                                        <option value="high">HIGH</option>
                                        <option value="medium">MEDIUM</option>
                                        <option value="low">LOW</option>
                                        <option value="info">INFO</option>
                                    </select>
                                    <ChevronDown size={10} style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: sevColor(incident.severity ?? 'medium').color }} />
                                </div>
                                {/* Status — always editable inline select styled as a badge */}
                                <div style={{ position: 'relative', display: 'inline-flex' }}>
                                    <select
                                        value={incident.status ?? 'new'}
                                        onChange={(e: any) => handleSaveStatusSeverity({ status: e.target.value })}
                                        style={{
                                            appearance: 'none',
                                            padding: '2px 20px 2px 8px',
                                            fontSize: '0.7rem',
                                            fontWeight: 700,
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.04em',
                                            background: statColor(incident.status).bg,
                                            color: statColor(incident.status).color,
                                            border: `1px solid ${statColor(incident.status).border}`,
                                            borderRadius: '5px',
                                            cursor: 'pointer',
                                            outline: 'none',
                                        }}
                                    >
                                        <option value="new">NEW</option>
                                        <option value="triaging">TRIAGING</option>
                                        <option value="sent to customer">SENT TO CUSTOMER</option>
                                        <option value="customer response received">RESPONSE RECEIVED</option>
                                        <option value="in_progress">IN PROGRESS</option>
                                        <option value="resolved">RESOLVED</option>
                                        <option value="false_positive">FALSE POSITIVE</option>
                                        <option value="escalated">ESCALATED</option>
                                    </select>
                                    <ChevronDown size={10} style={{ position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: statColor(incident.status).color }} />
                                </div>
                            </>
                        )}
                        {alerts.length > 0 && (
                            <Badge label={`${alerts.length} alert${alerts.length > 1 ? 's' : ''} stitched`} color='#a371f7' bg='rgba(163,113,247,0.12)' border='rgba(163,113,247,0.3)' />
                        )}
                    </div>
                </header>


                {/* ── Body ── */}
                <main className="content-area" style={{ flex: 1, overflow: 'hidden', padding: '1.5rem 2rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem', height: '100%', alignItems: 'stretch' }}>
                        {/* ── MIDDLE column (Scrollable Details) ── */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', paddingBottom: '4rem', minWidth: 0, overflowY: 'auto', paddingRight: '0.5rem' }} className="custom-scrollbar">
                            <Section
                                id="sec-timeline"
                                icon={<MessageSquare size={16} />}
                                title="Communication Timeline"
                                accent='var(--accent-primary)'
                            >
                                <CommunicationTimeline 
                                    incidentId={incident.id} 
                                    incidentTicketId={incident.ticket_id} 
                                    refreshTrigger={refreshTrigger}
                                />
                            </Section>

                            {incident.source_vendor === 'manual' ? (
                                /* ═══ MANUAL INCIDENT (CREATION UI) ═══ */
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            
                                    {/* Section 1: Ticket Details */}
                                    <div id="sec-summary" className="detail-card" style={{ padding: '2rem', scrollMarginTop: 'var(--header-height, 80px)' }}>
                                        <SectionHeader 
                                            icon={<TicketPlus size={18} color="var(--accent-primary)" />} 
                                            iconBg="rgba(47,129,247,0.1)" iconBorder="rgba(47,129,247,0.25)" 
                                            title="Ticket Details" 
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Incident Name *</label>
                                                <input 
                                                    className="login-input" 
                                                    defaultValue={incident.title} 
                                                    onBlur={e => handleSaveEditDirectly({ title: e.target.value })}
                                                    placeholder="e.g. Unusual VPN access from ASN"
                                                    disabled={isEditLocked}
                                                />
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Incident ID</label>
                                                <div style={{ position: 'relative' }}>
                                                    <Fingerprint size={16} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                                                    <input 
                                                        className="login-input" 
                                                        style={{ paddingLeft: '2.5rem' }}
                                                        value={incident.ticket_id} 
                                                        disabled
                                                    />
                                                </div>
                                                <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Auto-generated ID or enter custom ID in creation.</p>
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Description</label>
                                                <textarea 
                                                    className="login-input" 
                                                    style={{ minHeight: '120px', padding: '0.75rem' }}
                                                    defaultValue={incident.description}
                                                    onBlur={e => handleSaveEditDirectly({ description: e.target.value })}
                                                    placeholder="Provide a detailed description..."
                                                    disabled={isEditLocked}
                                                />
                                            </div>

                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                    <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Incident Severity</label>
                                                    <SelectWithChevron 
                                                        style={{ borderLeft: `3px solid ${sevColor(incident.severity).color}` }}
                                                        value={incident.severity}
                                                        onChange={(e: any) => handleSaveEditDirectly({ severity: e.target.value })}
                                                        disabled={isEditLocked}
                                                    >
                                                        <option value="critical">Critical</option>
                                                        <option value="high">High</option>
                                                        <option value="medium">Medium</option>
                                                        <option value="low">Low</option>
                                                        <option value="informational">Informational</option>
                                                    </SelectWithChevron>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                    <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Status</label>
                                                    <SelectWithChevron 
                                                        value={incident.status}
                                                        onChange={(e: any) => handleSaveEditDirectly({ status: e.target.value })}
                                                        disabled={isEditLocked}
                                                    >
                                                        <option value="new">New</option>
                                                        {userRole !== 'analyst' && (
                                                            <>
                                                                <option value="triaging">Triaging</option>
                                                                <option value="in_progress">In Progress</option>
                                                                <option value="resolved">Resolved</option>
                                                                <option value="false_positive">False Positive</option>
                                                                <option value="escalated">Escalated</option>
                                                            </>
                                                        )}
                                                    </SelectWithChevron>
                                                </div>
                                            </div>

                                            <div style={{ gridTemplateColumns: '1fr 1fr', gap: '1.5rem', display: 'grid' }}>
                                                <div style={{ flexDirection: 'column', gap: '0.4rem', display: 'flex' }}>
                                                    <label style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700 }}><Clock size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Alert Arrival Timestamp</label>
                                                    <input 
                                                        type="datetime-local" 
                                                        className="login-input" 
                                                        defaultValue={rawPayload.alert_arrival_timestamp ? format(new Date(rawPayload.alert_arrival_timestamp), "yyyy-MM-dd'T'HH:mm") : ''}
                                                        onBlur={e => handleSaveEditDirectly({ alert_arrival_timestamp: e.target.value })}
                                                        disabled={isEditLocked}
                                                    />
                                                </div>
                                                <div style={{ flexDirection: 'column', gap: '0.4rem', display: 'flex' }}>
                                                    <label style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700 }}>Alert ID(s)</label>
                                                    <input 
                                                        className="login-input" 
                                                        defaultValue={(rawPayload.alert_ids || []).join(', ')}
                                                        onBlur={e => handleSaveEditDirectly({ alert_ids: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                                        placeholder="e.g. 4306443, 4304939 (comma-separated)"
                                                        disabled={isEditLocked}
                                                    />
                                                </div>
                                            </div>

                                            <div style={{ flexDirection: 'column', gap: '0.4rem', display: 'flex' }}>
                                                <label style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: 700 }}><Terminal size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> Command Initiated</label>
                                                <input 
                                                    className="login-input" 
                                                    defaultValue={rawPayload.command_initiated || ''}
                                                    onBlur={e => handleSaveEditDirectly({ command_initiated: e.target.value })}
                                                    placeholder="e.g. powershell.exe -enc ... or N/A"
                                                    disabled={isEditLocked}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Section 2: Analysis & Findings */}
                                    <div id="sec-analysis" className="detail-card" style={{ padding: '2rem', scrollMarginTop: 'var(--header-height, 80px)' }}>
                                        <SectionHeader 
                                            icon={<Eye size={18} color="#a371f7" />} 
                                            iconBg="rgba(163,113,247,0.1)" iconBorder="rgba(163,113,247,0.2)" 
                                            title="Analysis & Findings" required={true}
                                        />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    <Eye size={14} /> Observations
                                                </div>
                                                <DynamicList items={rawPayload.observations || []} setItems={v => handleSaveEditDirectly({ observations: v })} placeholder="e.g. The user accessed the VPN..." disabled={isEditLocked} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    <Zap size={14} /> Business Impact
                                                </div>
                                                <DynamicList items={rawPayload.business_impact || []} setItems={v => handleSaveEditDirectly({ business_impact: v })} placeholder="e.g. A successful login from unusual country..." disabled={isEditLocked} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    <BookOpen size={14} /> Recommendations
                                                </div>
                                                <DynamicList items={rawPayload.recommendations || []} setItems={v => handleSaveEditDirectly({ recommendations: v })} placeholder="e.g. Validate the login activity..." disabled={isEditLocked} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Section 3: MITRE ATT&CK */}
                                    <div id="sec-mitre" className="detail-card" style={{ padding: '2rem', scrollMarginTop: 'var(--header-height, 80px)' }}>
                                        <SectionHeader 
                                            icon={<Target size={18} color="#d29922" />} 
                                            iconBg="rgba(210,153,34,0.1)" iconBorder="rgba(210,153,34,0.2)" 
                                            title="MITRE ATT&CK" required={true}
                                        />
                                        <div style={tableStyles.wrapper}>
                                            <div style={{ ...tableStyles.headerRow, gridTemplateColumns: '1fr 1fr 40px' }}>
                                                <span>Tactic</span>
                                                <span>Technique</span>
                                                <span></span>
                                            </div>
                                            {/* Handle mitre_tactics / mitre_techniques arrays as combined rows */}
                                            {(incident.mitre_tactics || []).map((t: string, i: number) => (
                                                <div key={i} style={{ ...tableStyles.row, gridTemplateColumns: '1fr 1fr 40px' }}>
                                                    <input style={tableStyles.cell} value={t} onChange={e => updateMitreRow(i, 'tactic', e.target.value)} placeholder="TA0001" disabled={isEditLocked} />
                                                    <input style={tableStyles.cell} value={incident.mitre_techniques?.[i] || ''} onChange={e => updateMitreRow(i, 'technique', e.target.value)} placeholder="T1078" disabled={isEditLocked} />
                                                    <button style={tableStyles.delBtn} onClick={() => removeMitreRow(i)} disabled={isEditLocked}><Trash2 size={14} /></button>
                                                </div>
                                            ))}
                                        </div>
                                        <button style={tableStyles.addBtn} onClick={() => addMitreRow()} disabled={isEditLocked}>
                                            <Plus size={14} /> Add MITRE Entry
                                        </button>
                                    </div>

                                    {/* Section 4: Asset Details */}
                                    <div id="sec-assets" className="detail-card" style={{ padding: '2rem', scrollMarginTop: 'var(--header-height, 80px)' }}>
                                        <SectionHeader 
                                            icon={<Monitor size={18} color="#3fb950" />} 
                                            iconBg="rgba(63,185,80,0.1)" iconBorder="rgba(63,185,80,0.2)" 
                                            title="Asset Details" required={true}
                                        />
                                        <div style={tableStyles.wrapper}>
                                            <div style={{ ...tableStyles.headerRow, gridTemplateColumns: '1fr 1fr 1fr 1fr 40px' }}>
                                                <span>Detection Method</span>
                                                <span>Source IP</span>
                                                <span>Log Source</span>
                                                <span>Action</span>
                                                <span></span>
                                            </div>
                                            {(rawPayload.asset_details || []).map((row: any, i: number) => (
                                                <div key={i} style={{ ...tableStyles.row, gridTemplateColumns: '1fr 1fr 1fr 1fr 40px' }}>
                                                    <input style={tableStyles.cell} value={row.detection_method ?? ''} onChange={e => updateRow('asset_details', i, 'detection_method', e.target.value)} placeholder="e.g. EDR" disabled={isEditLocked} />
                                                    <input style={tableStyles.cell} value={row.source_ip ?? ''} onChange={e => updateRow('asset_details', i, 'source_ip', e.target.value)} placeholder="0.0.0.0" disabled={isEditLocked} />
                                                    <input style={tableStyles.cell} value={row.log_source ?? ''} onChange={e => updateRow('asset_details', i, 'log_source', e.target.value)} placeholder="Zscalar" disabled={isEditLocked} />
                                                    <div style={{ padding: '0 0.5rem' }}>
                                                        <SelectWithChevron value={row.action || 'allow'}
                                                            onChange={(e: any) => updateRow('asset_details', i, 'action', e.target.value)}
                                                            style={{ height: '28px', fontSize: '0.75rem', padding: '0 1.5rem 0 0.5rem' }}
                                                            disabled={isEditLocked}>
                                                            <option value="allow">ALLOW</option>
                                                            <option value="block">BLOCK</option>
                                                            <option value="quarantine">QUARANTINE</option>
                                                        </SelectWithChevron>
                                                    </div>
                                                    <button style={tableStyles.delBtn} onClick={() => removeRow('asset_details', i)} disabled={isEditLocked}><Trash2 size={14} /></button>
                                                </div>
                                            ))}
                                        </div>
                                        <button style={tableStyles.addBtn} onClick={() => addRow('asset_details', { detection_method: '', source_ip: '', log_source: '', action: 'allow' })} disabled={isEditLocked}>
                                            <Plus size={14} /> Add Asset
                                        </button>
                                    </div>

                                    {/* Section 5: IOCs */}
                                    <div id="sec-iocs" className="detail-card" style={{ padding: '2rem', scrollMarginTop: 'var(--header-height, 80px)' }}>
                                        <SectionHeader 
                                            icon={<Crosshair size={18} color="#f07b4e" />} 
                                            iconBg="rgba(240,123,78,0.1)" iconBorder="rgba(240,123,78,0.2)" 
                                            title="Indicators of Compromise (IOCs)" required={true}
                                        />
                                        <div style={tableStyles.wrapper}>
                                            <div style={{ ...tableStyles.headerRow, gridTemplateColumns: '1fr 1fr 1fr 40px' }}>
                                                <span>Signature</span>
                                                <span>Domain Name</span>
                                                <span>Category</span>
                                                <span></span>
                                            </div>
                                            {(rawPayload.iocs || []).map((row: any, i: number) => (
                                                <div key={i} style={{ ...tableStyles.row, gridTemplateColumns: '1fr 1fr 1fr 40px' }}>
                                                    <input style={tableStyles.cell} value={row.signature ?? ''} onChange={e => updateRow('iocs', i, 'signature', e.target.value)} placeholder="e.g. SHA256" disabled={isEditLocked} />
                                                    <input style={tableStyles.cell} value={row.domain_name ?? ''} onChange={e => updateRow('iocs', i, 'domain_name', e.target.value)} placeholder="example.com" disabled={isEditLocked} />
                                                    <input style={tableStyles.cell} value={row.category ?? ''} onChange={e => updateRow('iocs', i, 'category', e.target.value)} placeholder="Malware" disabled={isEditLocked} />
                                                    <button style={tableStyles.delBtn} onClick={() => removeRow('iocs', i)} disabled={isEditLocked}><Trash2 size={14} /></button>
                                                </div>
                                            ))}
                                        </div>
                                        <button 
                                            style={tableStyles.addBtn} 
                                            onClick={() => addRow('iocs', { signature: '', domain_name: '', category: '' })}
                                            disabled={isEditLocked}
                                        >
                                            <Plus size={14} /> Add IOC
                                        </button>
                                    </div>

                                </div>
                            ) : (
                                /* ═══ API INCIDENT (TECHNICAL/STORY VIEW) ═══ */
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minWidth: 0 }}>
                            
                                    {/* Summary & Metadata Expansion */}
                                    <Section
                                        id="sec-summary"
                                        icon={<Activity size={16} />}
                                        title="Executive Summary & Core Metadata"
                                        accent={sc.color}
                                        style={{ scrollMarginTop: 'var(--header-height)' }}
                                        headerAction={
                                                <div style={{ display: 'flex', gap: '0.6rem', marginLeft: 'auto' }}>
                                                    {editSection === 'summary' || editSection === 'analysis' ? (
                                                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                            <button onClick={handleSaveEdit} disabled={saving} style={{ background: 'var(--status-success)', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
                                                                <Check size={12} /> {saving ? 'SAVING...' : 'SAVE CHANGES'}
                                                            </button>
                                                            <button onClick={cancelEditing} style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: 'none', borderRadius: '4px', padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
                                                                <XIcon size={12} /> CANCEL
                                                            </button>
                                                        </div>
                                                    ) : incident.source_vendor === 'manual' && !isEditLocked && (
                                                         <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                             <button
                                                                 onClick={() => startEditing('summary', { description: incident.description, notes: incident.raw_payload?.incident?.notes })}
                                                                 style={{
                                                                     background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                                                                     border: '1px solid var(--border-color)', padding: '0.35rem 0.7rem',
                                                                     borderRadius: 'var(--radius-sm)', fontSize: '0.65rem', fontWeight: 700,
                                                                     cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem'
                                                                 }}
                                                             >
                                                                 <Edit2 size={12} /> EDIT INFO
                                                             </button>
                                                         </div>
                                                     )}
                                                    <button
                                                        onClick={() => setShowIncidentTechnical(!showIncidentTechnical)}
                                                        style={{
                                                            background: showIncidentTechnical ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                                                            color: showIncidentTechnical ? 'white' : 'var(--text-secondary)',
                                                            border: '1px solid var(--border-color)',
                                                            padding: '0.35rem 0.7rem',
                                                            borderRadius: 'var(--radius-sm)',
                                                            fontSize: '0.65rem',
                                                            fontWeight: 700,
                                                            cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', gap: '0.4rem'
                                                        }}
                                                    >
                                                        <Eye size={12} /> {showIncidentTechnical ? 'STORY VIEW' : 'TECHNICAL VIEW'}
                                                    </button>
                                                </div>
                                        }
                                    >
                                        {showIncidentTechnical ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                                <div style={{
                                                    background: 'var(--bg-tertiary)', padding: '1.25rem', borderRadius: 'var(--radius-md)',
                                                    border: '1px solid var(--border-color)', maxHeight: '500px',
                                                    overflowY: 'auto', overflowX: 'hidden',
                                                    fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
                                                    color: 'var(--text-primary)', lineHeight: 1.6, minWidth: 0
                                                }}>
                                                    <div style={{ marginBottom: '1rem', color: 'var(--accent-primary)', fontWeight: 800 }}>INCIDENT RAW DATA</div>
                                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(incident, null, 2)}</pre>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0 3rem' }}>
                                                    {Object.entries(incidentMeta).map(([key, val]) => (
                                                        <InfoRow key={key} label={key.replace(/_/g, ' ')} value={typeof val === 'object' ? JSON.stringify(val) : String(val)} />
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                                {editSection === 'summary' ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                            <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Detailed Description</label>
                                                            <textarea 
                                                                className="login-input"
                                                                value={editData.description ?? ''}
                                                                onChange={e => setEditData({...editData, description: e.target.value})}
                                                                style={{ width: '100%', minHeight: '120px', padding: '0.75rem', fontSize: '0.9rem', lineHeight: 1.5 }}
                                                                placeholder="Provide a detailed description of the incident..."
                                                            />
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                            <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Analyst Notes</label>
                                                            <textarea 
                                                                className="login-input"
                                                                value={editData.notes ?? ''}
                                                                onChange={e => setEditData({...editData, notes: e.target.value})}
                                                                style={{ width: '100%', minHeight: '80px', padding: '0.75rem', fontSize: '0.9rem', lineHeight: 1.5 }}
                                                                placeholder="Internal notes for SOC analysts..."
                                                            />
                                                        </div>
                                                    </div>
                                                ) : editSection === 'analysis' ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
                                                        <div>
                                                            <SectionHeader icon={<Eye size={16} color="#a371f7" />} iconBg="rgba(163,113,247,0.1)" iconBorder="rgba(163,113,247,0.2)" title="Observations" required={true} />
                                                            <DynamicList items={editData.observations || []} setItems={v => setEditData({...editData, observations: v})} placeholder="Describe an observation..." />
                                                        </div>
                                                        <div>
                                                            <SectionHeader icon={<Zap size={16} color="#f07b4e" />} iconBg="rgba(240,123,78,0.1)" iconBorder="rgba(240,123,78,0.2)" title="Business Impact" required={true} />
                                                            <DynamicList items={editData.business_impact || []} setItems={v => setEditData({...editData, business_impact: v})} placeholder="Describe impact..." />
                                                        </div>
                                                        <div>
                                                            <SectionHeader icon={<BookOpen size={16} color="#3fb950" />} iconBg="rgba(63,185,80,0.1)" iconBorder="rgba(63,185,80,0.2)" title="Recommendations" required={true} />
                                                            <DynamicList items={editData.recommendations || []} setItems={v => setEditData({...editData, recommendations: v})} placeholder="Add recommendation..." />
                                                        </div>
                                                    </div>
                                                ) : incident.source_vendor === 'manual' ? (
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
                                                         <div className="detail-card" style={{ padding: '1.5rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                                                             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                                                 <SectionHeader icon={<Eye size={14} color="#a371f7" />} iconBg="rgba(163,113,247,0.1)" iconBorder="rgba(163,113,247,0.2)" title="Observations" />
                                                                 {!isEditLocked && <button onClick={() => startEditing('analysis', {})} style={{ color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}><Edit2 size={12} /></button>}
                                                             </div>
                                                             <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                                 {(rawPayload.observations || []).length > 0 ? (rawPayload.observations || []).map((item: string, idx: number) => (
                                                                     <li key={idx} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                                                         <span style={{ color: '#a371f7', fontWeight: 800 }}>•</span> {item}
                                                                     </li>
                                                                 )) : <li style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No observations...</li>}
                                                             </ul>
                                                         </div>

                                                         <div className="detail-card" style={{ padding: '1.5rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                                                             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                                                 <SectionHeader icon={<Zap size={14} color="#f07b4e" />} iconBg="rgba(240,123,78,0.1)" iconBorder="rgba(240,123,78,0.2)" title="Business Impact" />
                                                                 {!isEditLocked && <button onClick={() => startEditing('analysis', {})} style={{ color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}><Edit2 size={12} /></button>}
                                                             </div>
                                                             <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                                 {(rawPayload.business_impact || []).length > 0 ? (rawPayload.business_impact || []).map((item: string, idx: number) => (
                                                                     <li key={idx} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                                                         <span style={{ color: '#f07b4e', fontWeight: 800 }}>•</span> {item}
                                                                     </li>
                                                                 )) : <li style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No impact defined...</li>}
                                                             </ul>
                                                         </div>

                                                         <div className="detail-card" style={{ padding: '1.5rem', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                                                             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                                                 <SectionHeader icon={<BookOpen size={14} color="#3fb950" />} iconBg="rgba(63,185,80,0.1)" iconBorder="rgba(63,185,80,0.2)" title="Recommendations" />
                                                                 {!isEditLocked && <button onClick={() => startEditing('analysis', {})} style={{ color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}><Edit2 size={12} /></button>}
                                                             </div>
                                                             <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                                 {(rawPayload.recommendations || []).length > 0 ? (rawPayload.recommendations || []).map((item: string, idx: number) => (
                                                                     <li key={idx} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                                                         <span style={{ color: '#3fb950', fontWeight: 800 }}>•</span> {item}
                                                                     </li>
                                                                 )) : <li style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No recommendations...</li>}
                                                             </ul>
                                                         </div>
                                                     </div>
                                                ) : (
                                                    <>
                                                        <div>
                                                            <p style={{ color: 'var(--text-primary)', lineHeight: 1.65, fontSize: '0.95rem', fontWeight: 500 }}>
                                                                {incident.description || 'No description available.'}
                                                            </p>
                                                            {(incidentMeta.notes || incident.raw_payload?.incident?.notes) && (
                                                                <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)', borderLeft: '3px solid var(--border-color)' }}>
                                                                    <strong>Notes:</strong> {incidentMeta.notes || incident.raw_payload?.incident?.notes}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* XSIAM Scores Section */}
                                                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                            <ScoreBadge label="Aggregated" score={incidentMeta.aggregated_score || 0} color="var(--accent-primary)" />
                                                            <ScoreBadge label="Rule-Based" score={incidentMeta.rule_based_score || 0} color="var(--status-info)" />
                                                            <ScoreBadge label="Predicted" score={incidentMeta.predicted_score || 0} color="#a371f7" />
                                                            <ScoreBadge label="Manual" score={incidentMeta.manual_score || 0} color="var(--status-medium)" />
                                                        </div>

                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0 3rem' }}>
                                                            <InfoRow label="First Seen" value={<span suppressHydrationWarning>{format(new Date(incident.source_created_at || incident.created_at), 'dd MMM yyyy, HH:mm')} IST</span>} />
                                                            {rawPayload.alert_arrival_timestamp && <InfoRow label="Alert Arrival" value={new Date(rawPayload.alert_arrival_timestamp).toLocaleString()} />}
                                                            <InfoRow label="XDR Link" value={incidentMeta.xdr_url ? <a href={incidentMeta.xdr_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>Open in XSIAM ↗</a> : 'N/A'} />
                                                            <InfoRow label="Owner" value={incidentMeta.assigned_user_pretty_name || incident.assigned_to_name || 'Unassigned'} />
                                                            <InfoRow label="Owner Mail" value={incidentMeta.assigned_user_mail} />
                                                            <InfoRow label="Detection Time" value={incidentMeta.detection_time ? new Date(incidentMeta.detection_time).toLocaleString() : 'N/A'} />
                                                            <InfoRow label="Modification" value={incidentMeta.modification_time ? new Date(incidentMeta.modification_time).toLocaleString() : 'N/A'} />
                                                            <InfoRow label="Grouping Status" value={incidentMeta.alerts_grouping_status} />
                                                            {rawPayload.command_initiated && <InfoRow label="Command Initiated" value={<code style={{ background: 'var(--bg-tertiary)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>{rawPayload.command_initiated}</code>} />}
                                                            <InfoRow label="Incident Domain" value={incidentMeta.incident_domain} />
                                                            <InfoRow label="Manual Sev" value={incidentMeta.manual_severity} />
                                                            <InfoRow label="Manual Desc" value={incidentMeta.manual_description} />
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </Section>

                                    {/* Analysis & Findings (Common Data) */}
                                    {(rawPayload.observations?.length > 0 || rawPayload.business_impact?.length > 0 || rawPayload.recommendations?.length > 0) && (
                                        <Section id="sec-analysis" icon={<Eye size={16} />} title="Analysis & Findings" accent="#a371f7">
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                                                {rawPayload.observations?.length > 0 && (
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#a371f7', textTransform: 'uppercase', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                            <Eye size={12} /> Observations
                                                        </div>
                                                        <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                            {rawPayload.observations.map((obs: string, idx: number) => <li key={idx} style={{ marginBottom: '0.4rem', whiteSpace: 'pre-wrap' }}>{obs}</li>)}
                                                        </ul>
                                                    </div>
                                                )}
                                                {rawPayload.business_impact?.length > 0 && (
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#f07b4e', textTransform: 'uppercase', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                            <Zap size={12} /> Business Impact
                                                        </div>
                                                        <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                            {rawPayload.business_impact.map((imp: string, idx: number) => <li key={idx} style={{ marginBottom: '0.4rem', whiteSpace: 'pre-wrap' }}>{imp}</li>)}
                                                        </ul>
                                                    </div>
                                                )}
                                                {rawPayload.recommendations?.length > 0 && (
                                                    <div>
                                                        <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#3fb950', textTransform: 'uppercase', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                            <Shield size={12} /> Recommendations
                                                        </div>
                                                        <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                            {rawPayload.recommendations.map((rec: string, idx: number) => <li key={idx} style={{ marginBottom: '0.4rem', whiteSpace: 'pre-wrap' }}>{rec}</li>)}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        </Section>
                                    )}

                                    {/* Resolution Details */}
                                    {incidentMeta.resolve_comment && (
                                        <Section id="sec-resolution" icon={<Shield size={16} />} title="Resolution Context" accent='var(--status-success)'>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <InfoRow label="Resolved At" value={incidentMeta.resolved_timestamp ? new Date(incidentMeta.resolved_timestamp).toLocaleString() : '—'} />
                                                <InfoRow label="Resolution Notes" value={incidentMeta.resolve_comment} />
                                            </div>
                                        </Section>
                                    )}

                                    {/* MITRE for incident */}
                                    <Section 
                                        id="sec-mitre" 
                                        icon={<Target size={16} />} 
                                        title="MITRE ATT&CK Coverage" 
                                        accent='#ff7b72'
                                        headerAction={
                                            <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
                                                {editSection === 'mitre' ? (
                                                     <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                        <button onClick={handleSaveEdit} disabled={saving} style={{ background: 'var(--status-success)', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                            <Check size={12} /> {saving ? '...' : 'SAVE'}
                                                        </button>
                                                        <button onClick={cancelEditing} style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: 'none', borderRadius: '4px', padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.65rem' }}>
                                                            <XIcon size={12} />
                                                        </button>
                                                    </div>
                                                ) : !isEditLocked && (
                                                     <button
                                                         onClick={() => startEditing('mitre', { mitre_tactics: incident.mitre_tactics?.join(', '), mitre_techniques: incident.mitre_techniques?.join(', ') })}
                                                         style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                                                     >
                                                         <Edit2 size={14} />
                                                     </button>
                                                 )}
                                            </div>
                                        }
                                    >
                                        {editSection === 'mitre' ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                                <div>
                                                    <SectionHeader icon={<Target size={16} color="#ff7b72" />} iconBg="rgba(255,123,114,0.1)" iconBorder="rgba(255,123,114,0.2)" title="Tactics" required={true} />
                                                    <DynamicList 
                                                        items={editData.mitre_tactics || []} 
                                                        setItems={v => setEditData({...editData, mitre_tactics: v})} 
                                                        placeholder="e.g. Initial Access" 
                                                    />
                                                </div>
                                                <div>
                                                    <SectionHeader icon={<Cpu size={16} color="#ffa657" />} iconBg="rgba(255,166,87,0.1)" iconBorder="rgba(255,166,87,0.2)" title="Techniques" required={true} />
                                                    <DynamicList 
                                                        items={editData.mitre_techniques || []} 
                                                        setItems={v => setEditData({...editData, mitre_techniques: v})} 
                                                        placeholder="e.g. T1566" 
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {incident.mitre_tactics?.length > 0 && (
                                                    <div>
                                                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tactics</div>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                            {incident.mitre_tactics.map((t: string, i: number) => (
                                                                <Badge key={i} label={t} color='#ff7b72' bg='rgba(255,123,114,0.1)' border='rgba(255,123,114,0.3)' />
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {incident.mitre_techniques?.length > 0 && (
                                                    <div>
                                                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Techniques</div>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                            {incident.mitre_techniques.map((t: string, i: number) => (
                                                                <Badge key={i} label={t} color='#ffa657' bg='rgba(255,166,87,0.1)' border='rgba(255,166,87,0.3)' />
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {!incident.mitre_tactics?.length && !incident.mitre_techniques?.length && (
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No MITRE data mapped to this incident.</div>
                                                )}
                                            </div>
                                        )}
                                    </Section>

                                    {/* ── STITCHED ALERTS / ISSUES ── */}
                                    {alerts.length > 0 && (
                                        <Section id="sec-alerts" icon={<Zap size={16} />} title={`Stitched Alerts & Issues (${alerts.length})`} accent='#a371f7'>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                                {alerts.map((alert: any, i: number) => (
                                                    <AlertCard key={alert.alert_id ?? i} alert={alert} index={i} />
                                                ))}
                                            </div>
                                        </Section>
                                    )}

                                    {/* Affected Hosts */}
                                    {incident.affected_hosts?.length > 0 && (
                                        <Section id="sec-hosts" icon={<Server size={16} />} title="Affected Infrastructure" accent='var(--accent-primary)'>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                                                {incident.affected_hosts.map((host: any, i: number) => (
                                                    <div key={i} className="hover-glow" style={{
                                                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                                                        padding: '0.75rem', background: 'var(--bg-tertiary)',
                                                        borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)'
                                                    }}>
                                                        <Cpu size={18} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                                                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                                            <span style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host.hostname?.split(':')[0]}</span>
                                                            {host.ip && <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{host.ip}</span>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </Section>
                                    )}

                                    {/* Affected Users */}
                                    {incident.affected_users?.length > 0 && (
                                        <Section id="sec-users" icon={<User size={16} />} title="Involved Users" accent='var(--status-medium)'>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                {incident.affected_users.map((u: any, i: number) => (
                                                    <div key={i} style={{
                                                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                        padding: '0.4rem 0.75rem', background: 'var(--bg-tertiary)',
                                                        borderRadius: '9999px', border: '1px solid var(--border-color)',
                                                        fontSize: '0.78rem', fontWeight: 500
                                                    }}>
                                                        <User size={12} style={{ color: 'var(--status-medium)' }} />
                                                        {u.username}
                                                    </div>
                                                ))}
                                            </div>
                                        </Section>
                                    )}

                                    {/* Network Artifacts */}
                                    {networkArtifacts.length > 0 && (
                                        <Section id="sec-network" icon={<Network size={16} />} title="Network Entities" accent='var(--status-info)'>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                                {networkArtifacts.map((net: any, i: number) => (
                                                    <div key={i} style={{
                                                        padding: '0.65rem 0.85rem', background: 'var(--bg-tertiary)',
                                                        borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                                        borderLeft: '3px solid var(--status-info)'
                                                    }}>
                                                        <div style={{ fontSize: '0.65rem', color: 'var(--status-info)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.25rem' }}>{net.type}</div>
                                                        <div style={{ fontSize: '0.82rem', fontWeight: 600, wordBreak: 'break-all' }}>{net.network_domain || net.network_remote_ip || '—'}</div>
                                                        {net.network_remote_port && <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Port {net.network_remote_port} • {net.network_country}</div>}
                                                        {net.alert_count > 0 && <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>{net.alert_count} alerts</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        </Section>
                                    )}

                                    {/* File Artifacts */}
                                    {fileArtifacts.length > 0 && (
                                        <Section id="sec-files" icon={<File size={16} />} title="File Artifacts" accent='var(--status-medium)'>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {fileArtifacts.map((file: any, i: number) => (
                                                    <div key={i} style={{
                                                        padding: '0.65rem 0.85rem', background: 'var(--bg-tertiary)',
                                                        borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                                                        borderLeft: `3px solid ${file.file_wildfire_verdict === 'MALWARE' ? 'var(--status-critical)' : 'var(--status-medium)'}`
                                                    }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                                            <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{file.file_name || 'Unnamed File'}</span>
                                                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                                                                {file.is_malicious && <ShieldAlert size={13} style={{ color: 'var(--status-critical)' }} />}
                                                                {file.file_wildfire_verdict && (
                                                                    <Badge
                                                                        label={file.file_wildfire_verdict}
                                                                        color={file.file_wildfire_verdict === 'MALWARE' ? 'white' : 'var(--text-tertiary)'}
                                                                        bg={file.file_wildfire_verdict === 'MALWARE' ? 'var(--status-critical)' : 'var(--bg-primary)'}
                                                                        border='transparent'
                                                                    />
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                                                            {file.File_sha256 || file.file_sha256}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </Section>
                                    )}

                                    {/* Asset Details (Manual) */}
                                    <Section 
                                        id="sec-assets" 
                                        icon={<Monitor size={16} />} 
                                        title="Asset Details" 
                                        accent="#3fb950"
                                        headerAction={
                                            <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
                                                {editSection === 'assets' ? (
                                                     <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                        <button onClick={handleSaveEdit} disabled={saving} style={{ background: 'var(--status-success)', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.65rem' }}>
                                                            {saving ? '...' : <Check size={12} />}
                                                        </button>
                                                        <button onClick={cancelEditing} style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: 'none', borderRadius: '4px', padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.65rem' }}>
                                                            <XIcon size={12} />
                                                        </button>
                                                    </div>
                                                ) : incident.source_vendor === 'manual' && !isEditLocked && (
                                                    <button
                                                        onClick={() => startEditing('assets', { asset_raw: rawPayload.asset_details?.map((a: any) => `${a.detection_method || ''},${a.source_ip || ''},${a.log_source || ''},${a.action || ''}`).join('\n') })}
                                                        style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        }
                                    >
                                        {editSection === 'assets' ? (
                                            <div style={tableStyles.wrapper}>
                                                <div style={{ ...tableStyles.headerRow, gridTemplateColumns: '1fr 1fr 1fr 0.8fr 40px' }}>
                                                    <span>Detection Method</span>
                                                    <span>Source IP</span>
                                                    <span>Log Source</span>
                                                    <span>Action</span>
                                                    <span />
                                                </div>
                                                {(editData.asset_details || []).map((asset: any, i: number) => (
                                                    <div key={i} style={{ ...tableStyles.row, gridTemplateColumns: '1fr 1fr 1fr 0.8fr 40px' }}>
                                                        <input style={tableStyles.cell} placeholder="e.g. Brute Force" value={asset.detection_method ?? ''}
                                                            onChange={e => { const n = [...editData.asset_details]; n[i].detection_method = e.target.value; setEditData({...editData, asset_details: n}); }} />
                                                        <input style={tableStyles.cell} placeholder="e.g. 1.2.3.4" value={asset.source_ip ?? ''}
                                                            onChange={e => { const n = [...editData.asset_details]; n[i].source_ip = e.target.value; setEditData({...editData, asset_details: n}); }} />
                                                        <input style={tableStyles.cell} placeholder="e.g. paloalto" value={asset.log_source ?? ''}
                                                            onChange={e => { const n = [...editData.asset_details]; n[i].log_source = e.target.value; setEditData({...editData, asset_details: n}); }} />
                                                        <div style={{ padding: '0 0.5rem' }}>
                                                            <SelectWithChevron value={asset.action || 'allow'}
                                                                onChange={(e: any) => { const n = [...editData.asset_details]; n[i].action = e.target.value; setEditData({...editData, asset_details: n}); }}
                                                                style={{ height: '28px', fontSize: '0.75rem', padding: '0 1.5rem 0 0.5rem' }}>
                                                                <option value="allow">Allow</option>
                                                                <option value="block">Block</option>
                                                                <option value="quarantine">Quarantine</option>
                                                            </SelectWithChevron>
                                                        </div>
                                                        <button type="button" style={tableStyles.delBtn} onClick={() => setEditData({...editData, asset_details: editData.asset_details.filter((_: any, j: number) => j !== i)})}>
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button type="button" style={tableStyles.addBtn} onClick={() => setEditData({...editData, asset_details: [...(editData.asset_details || []), { detection_method: '', source_ip: '', log_source: '', action: 'allow' }]})}>
                                                    <Plus size={14} /> Add Asset Row
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                {rawPayload.asset_details?.length > 0 ? (
                                                    <>
                                                        <div style={{
                                                            display: 'grid',
                                                            gridTemplateColumns: '1.2fr 1fr 1fr 0.8fr',
                                                            padding: '0.65rem 0.85rem',
                                                            background: 'rgba(63,185,80,0.06)',
                                                            borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
                                                            fontSize: '0.65rem',
                                                            fontWeight: 800,
                                                            color: 'var(--text-tertiary)',
                                                            textTransform: 'uppercase',
                                                            borderBottom: '1px solid var(--border-subtle)'
                                                        }}>
                                                            <span>Detection</span><span>Source IP</span><span>Log Source</span><span>Action</span>
                                                        </div>
                                                        {rawPayload.asset_details.map((asset: any, i: number) => (
                                                            <div key={i} style={{
                                                                display: 'grid',
                                                                gridTemplateColumns: '1.2fr 1fr 1fr 0.8fr',
                                                                padding: '0.65rem 0.85rem',
                                                                background: 'var(--bg-tertiary)',
                                                                borderRadius: 'var(--radius-md)',
                                                                border: '1px solid var(--border-subtle)',
                                                                fontSize: '0.82rem',
                                                                alignItems: 'center'
                                                            }}>
                                                                <span style={{ fontWeight: 600 }}>{asset.detection_method || '—'}</span>
                                                                <code style={{ fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{asset.source_ip || '—'}</code>
                                                                <span style={{ color: 'var(--text-secondary)' }}>{asset.log_source || '—'}</span>
                                                                <span>
                                                                    <Badge
                                                                        label={asset.action || 'unknown'}
                                                                        color={asset.action?.toLowerCase() === 'allow' ? 'var(--status-low)' : 'var(--status-critical)'}
                                                                        bg={asset.action?.toLowerCase() === 'allow' ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)'}
                                                                        border='transparent'
                                                                    />
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </>
                                                ) : (
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '1rem' }}>No asset details specified.</div>
                                                )}
                                            </div>
                                        )}
                                    </Section>

                                    {/* IOCs */}
                                    <Section 
                                        id="sec-iocs" 
                                        icon={<Eye size={16} />} 
                                        title="Indicators of Compromise" 
                                        accent='#ff7b72'
                                        headerAction={
                                            <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
                                                {editSection === 'iocs' ? (
                                                     <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                        <button onClick={handleSaveEdit} disabled={saving} style={{ background: 'var(--status-success)', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.65rem' }}>
                                                            {saving ? '...' : <Check size={12} />}
                                                        </button>
                                                        <button onClick={cancelEditing} style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: 'none', borderRadius: '4px', padding: '0.35rem 0.7rem', cursor: 'pointer', fontSize: '0.65rem' }}>
                                                            <XIcon size={12} />
                                                        </button>
                                                    </div>
                                                ) : incident.source_vendor === 'manual' && !isEditLocked && (
                                                    <button
                                                        onClick={() => startEditing('iocs', { iocs: incident.iocs?.join(', ') })}
                                                        style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        }
                                    >
                                        {editSection === 'iocs' ? (
                                            <div style={tableStyles.wrapper}>
                                                <div style={{ ...tableStyles.headerRow, gridTemplateColumns: '1fr 1fr 1fr 40px' }}>
                                                    <span>Category</span>
                                                    <span>Signature / Value</span>
                                                    <span>Domain Name (Optional)</span>
                                                    <span />
                                                </div>
                                                {(editData.iocs || []).map((ioc: any, i: number) => (
                                                    <div key={i} style={{ ...tableStyles.row, gridTemplateColumns: '1fr 1fr 1fr 40px' }}>
                                                        <div style={{ padding: '0 0.5rem' }}>
                                                            <SelectWithChevron value={ioc.category ?? 'IP'}
                                                                onChange={(e: any) => { const n = [...editData.iocs]; n[i].category = e.target.value; setEditData({...editData, iocs: n}); }}
                                                                style={{ height: '28px', fontSize: '0.75rem', padding: '0 1.5rem 0 0.5rem' }}>
                                                                <option value="IP">IP</option>
                                                                <option value="Domain">Domain</option>
                                                                <option value="Hash">Hash</option>
                                                                <option value="URL">URL</option>
                                                                <option value="Registry">Registry</option>
                                                            </SelectWithChevron>
                                                        </div>
                                                        <input style={tableStyles.cell} placeholder="e.g. 1.2.3.4 or malware.exe" value={ioc.signature ?? ''}
                                                            onChange={e => { const n = [...editData.iocs]; n[i].signature = e.target.value; setEditData({...editData, iocs: n}); }} />
                                                        <input style={tableStyles.cell} placeholder="e.g. evil.com" value={ioc.domain_name ?? ''}
                                                            onChange={e => { const n = [...editData.iocs]; n[i].domain_name = e.target.value; setEditData({...editData, iocs: n}); }} />
                                                        <button type="button" style={tableStyles.delBtn} onClick={() => setEditData({...editData, iocs: editData.iocs.filter((_: any, j: number) => j !== i)})}>
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button type="button" style={tableStyles.addBtn} onClick={() => setEditData({...editData, iocs: [...(editData.iocs || []), { category: 'IP', signature: '', domain_name: '' }]})}>
                                                    <Plus size={14} /> Add IOC Row
                                                </button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                                                {incident.iocs?.length > 0 ? (
                                                    incident.iocs.map((ioc: any, i: number) => {
                                                        if (typeof ioc === 'object' && ioc !== null) {
                                                            const label = [
                                                                ioc.category && `[${ioc.category}]`,
                                                                ioc.signature,
                                                                ioc.domain_name && `(${ioc.domain_name})`
                                                            ].filter(Boolean).join(' ');
                                                            return <Badge key={i} label={label || 'Unknown IOC'} color='#ff7b72' bg='rgba(255,123,114,0.1)' border='rgba(255,123,114,0.3)' />;
                                                        }
                                                        return <Badge key={i} label={String(ioc)} color='#ff7b72' bg='rgba(255,123,114,0.1)' border='rgba(255,123,114,0.3)' />;
                                                    })
                                                ) : (
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No IOCs identified.</div>
                                                )}
                                            </div>
                                        )}
                                    </Section>
                                </div>
                            )}
                        </div>

                        {/* ── RIGHT column (Actions & SLA) ── */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', height: '100%', overflowY: 'auto', paddingRight: '0.5rem', paddingBottom: '2rem' }} className="custom-scrollbar">
                            
                            {/* ── Send Mail Notification ── */}
                            {(() => {
                                const firstMailSent = !!(incident?.notification_message_id);
                                const isDisabled = hasITSMIntegration || firstMailSent;
                                const tooltipTitle = hasITSMIntegration
                                    ? 'Notifications are handled by your ITSM integration (Freshservice / Freshdesk / ServiceNow)'
                                    : firstMailSent
                                        ? 'First mail already sent — use the Communication Timeline to reply'
                                        : '';
                                return (
                                <div style={{ position: 'relative' }} title={tooltipTitle}>
                                    <button
                                        onClick={() => setShowMailPreview(true)}
                                        disabled={isDisabled}
                                        style={{
                                            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            gap: '0.6rem', padding: '0.85rem 1rem',
                                            background: isDisabled ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, rgba(47,129,247,0.12), rgba(47,129,247,0.04))',
                                            border: isDisabled ? '1px solid var(--border-color)' : '1px solid rgba(47,129,247,0.3)',
                                            borderRadius: 'var(--radius-lg)',
                                            color: isDisabled ? 'var(--text-tertiary)' : '#4493f8', fontSize: '0.78rem', fontWeight: 700,
                                            textTransform: 'uppercase', letterSpacing: '0.06em',
                                            cursor: isDisabled ? 'not-allowed' : 'pointer',
                                            transition: 'all 0.2s ease',
                                            opacity: isDisabled ? 0.6 : 1
                                        }}
                                        onMouseOver={(e) => {
                                            if (isDisabled) return;
                                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(47,129,247,0.22), rgba(47,129,247,0.10))';
                                            e.currentTarget.style.borderColor = 'rgba(47,129,247,0.5)';
                                            e.currentTarget.style.transform = 'translateY(-1px)';
                                            e.currentTarget.style.boxShadow = '0 4px 16px rgba(47,129,247,0.15)';
                                        }}
                                        onMouseOut={(e) => {
                                            if (isDisabled) return;
                                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(47,129,247,0.12), rgba(47,129,247,0.04))';
                                            e.currentTarget.style.borderColor = 'rgba(47,129,247,0.3)';
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = 'none';
                                        }}
                                    >
                                        <Mail size={15} />
                                        Preview & Send Notification
                                    </button>
                                    {hasITSMIntegration && (
                                        <div style={{
                                            marginTop: '0.4rem', fontSize: '0.7rem', color: 'var(--text-tertiary)',
                                            display: 'flex', alignItems: 'center', gap: '0.35rem',
                                            justifyContent: 'center',
                                        }}>
                                            <TicketPlus size={11} />
                                            Managed via ITSM integration
                                        </div>
                                    )}
                                    {!hasITSMIntegration && firstMailSent && (
                                        <div style={{
                                            marginTop: '0.4rem', fontSize: '0.7rem', color: 'var(--text-tertiary)',
                                            display: 'flex', alignItems: 'center', gap: '0.35rem',
                                            justifyContent: 'center',
                                        }}>
                                            <Mail size={11} />
                                            Reply via Communication Timeline
                                        </div>
                                    )}
                                </div>
                                );
                            })()}

                            {/* ── SLA Timeline ── */}
                            <Section id="sec-sla" icon={<Clock size={16} />} title="SLA Timeline" accent="#f0883e">
                                {slaData ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {/* Time to First Response */}
                                        <div style={{ background: frBreached ? 'rgba(248,81,73,0.08)' : 'rgba(240,136,62,0.08)', padding: '0.85rem', borderRadius: '10px', border: `1px solid ${frBreached ? 'rgba(248,81,73,0.25)' : 'rgba(240,136,62,0.15)'}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                                                <div style={{ fontSize: '0.6rem', color: frBreached ? '#f85149' : '#f0883e', fontWeight: 800, textTransform: 'uppercase' }}>
                                                    Time to First Response {frBreached && '⚠'}
                                                </div>
                                                <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>Limit: {formatMins(frTarget)}</div>
                                            </div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: frBreached ? '#f85149' : 'var(--text-primary)' }}>
                                                {frActual != null ? formatMins(frActual) : (frRemain != null ? `${formatMins(frRemain)} left` : '—')}
                                            </div>
                                            <div style={{ marginTop: '0.5rem', height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                                                <div style={{ height: '100%', borderRadius: '2px', width: `${Math.min(frPct, 100)}%`, background: frBreached ? '#f85149' : frPct > 75 ? '#d29922' : '#f0883e' }} />
                                            </div>
                                        </div>

                                        {/* Time to Resolve */}
                                        <div style={{ background: resBreached ? 'rgba(248,81,73,0.08)' : 'rgba(47,129,247,0.08)', padding: '0.85rem', borderRadius: '10px', border: `1px solid ${resBreached ? 'rgba(248,81,73,0.25)' : 'rgba(47,129,247,0.15)'}` }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                                                <div style={{ fontSize: '0.6rem', color: resBreached ? '#f85149' : 'var(--accent-primary)', fontWeight: 800, textTransform: 'uppercase' }}>
                                                    Time to Resolve {resBreached && '⚠'}
                                                </div>
                                                <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>Limit: {formatMins(resTarget)}</div>
                                            </div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: resBreached ? '#f85149' : 'var(--text-primary)' }}>
                                                {resActual != null ? formatMins(resActual) : (resRemain != null ? `${formatMins(resRemain)} left` : '—')}
                                            </div>
                                            <div style={{ marginTop: '0.5rem', height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                                                <div style={{ height: '100%', borderRadius: '2px', width: `${Math.min(resPct, 100)}%`, background: resBreached ? '#f85149' : resPct > 75 ? '#d29922' : 'var(--accent-primary)' }} />
                                            </div>
                                        </div>

                                        {/* ── Activity Feed ── */}
                                        {(() => {
                                            type ActivityItem = { time: string; label: string; sub: string; dot: string; };
                                            const items: ActivityItem[] = [];

                                            // Incident created
                                            if (incident?.created_at) {
                                                items.push({ time: incident.created_at, label: 'Incident Created', sub: `ID: ${incident.ticket_id || id}`, dot: '#3fb950' });
                                            }

                                            // Status change events from sla_events
                                            const statusLabel = (s: string) => s
                                                ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                                                : '—';
                                            const statusDot: Record<string, string> = {
                                                'new': '#6e7681',
                                                'triaging': '#d29922',
                                                'ai triaging': '#a371f7',
                                                'in_progress': '#47bfed',
                                                'escalated': '#f0883e',
                                                'sent to customer': '#2f81f7',
                                                'customer response received': '#3fb950',
                                                'resolved': '#3fb950',
                                                'false_positive': '#f85149',
                                            };
                                            (slaData?.events || []).forEach((ev: any) => {
                                                if (ev.event_type === 'status_change' && ev.new_value) {
                                                    const actor = ev.actor_name ? ` · ${ev.actor_name}` : '';
                                                    items.push({
                                                        time: ev.created_at,
                                                        label: `Status → ${statusLabel(ev.new_value)}`,
                                                        sub: `was ${statusLabel(ev.old_value || 'new')}${actor}`,
                                                        dot: statusDot[ev.new_value] || '#6e7681',
                                                    });
                                                } else if (ev.event_type === 'resolved') {
                                                    const actor = ev.actor_name ? ` · ${ev.actor_name}` : '';
                                                    items.push({
                                                        time: ev.created_at,
                                                        label: 'Incident Resolved',
                                                        sub: `Closed${actor}`,
                                                        dot: '#3fb950',
                                                    });
                                                } else if (ev.event_type === 'escalated') {
                                                    const meta = ev.metadata ? (typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : ev.metadata) : {};
                                                    items.push({
                                                        time: ev.created_at,
                                                        label: `Escalated to Level ${meta.to_level || '?'}`,
                                                        sub: `from Level ${meta.from_level || '?'}`,
                                                        dot: '#f0883e',
                                                    });
                                                } else if (ev.event_type === 'sla_breach') {
                                                    const meta = ev.metadata ? (typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : ev.metadata) : {};
                                                    items.push({
                                                        time: ev.created_at,
                                                        label: `SLA Breach — ${meta.type === 'first_response' ? 'First Response' : 'Resolution'}`,
                                                        sub: `${Math.round(meta.elapsed_min || 0)}m elapsed / ${meta.target_min || '?'}m limit`,
                                                        dot: '#f85149',
                                                    });
                                                } else if (ev.event_type === 'sla_warning') {
                                                    const meta = ev.metadata ? (typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : ev.metadata) : {};
                                                    items.push({
                                                        time: ev.created_at,
                                                        label: `SLA Warning — ${meta.type === 'first_response' ? 'First Response' : 'Resolution'}`,
                                                        sub: `${Math.round(meta.pct || 0)}% elapsed`,
                                                        dot: '#d29922',
                                                    });
                                                }
                                            });

                                            // All communication interactions
                                            sidebarInteractions.forEach((ix: any) => {
                                                const src = ix.interaction_source || 'email';
                                                const isITSM = ['freshservice','freshdesk','servicenow'].includes(src);
                                                const srcLabel = src === 'freshservice' ? 'Freshservice' : src === 'freshdesk' ? 'Freshdesk' : src === 'servicenow' ? 'ServiceNow' : 'Email';
                                                const dir = ix.direction === 'outbound' ? 'Sent' : 'Received';
                                                const dot = isITSM
                                                    ? (src === 'freshservice' ? '#22c55e' : src === 'freshdesk' ? '#06b6d4' : '#f59e0b')
                                                    : (ix.direction === 'outbound' ? '#47bfed' : '#3fb950');
                                                items.push({
                                                    time: ix.created_at,
                                                    label: ix.subject || `${srcLabel} ${dir}`,
                                                    sub: `${srcLabel} · ${dir}`,
                                                    dot,
                                                });
                                            });

                                            // Newest first
                                            items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

                                            if (items.length === 0) return null;
                                            return (
                                                <div style={{ marginTop: '0.25rem' }}>
                                                    <div style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.07em', marginBottom: '0.6rem' }}>Activity</div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0', paddingLeft: '0.6rem', borderLeft: '2px solid var(--border-subtle)', maxHeight: '320px', overflowY: 'auto' }}>
                                                        {items.map((item, i) => (
                                                            <div key={i} style={{ position: 'relative', paddingLeft: '0.85rem', paddingBottom: '0.75rem' }}>
                                                                <div style={{ position: 'absolute', left: '-5px', top: '4px', width: '8px', height: '8px', borderRadius: '50%', background: item.dot, border: '2px solid var(--bg-primary)', flexShrink: 0 }} />
                                                                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.3, wordBreak: 'break-word' }}>{item.label}</div>
                                                                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.15rem', flexWrap: 'wrap' }}>
                                                                    <span style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)' }}>{format(new Date(item.time), 'MMM d, HH:mm')}</span>
                                                                    <span style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', opacity: 0.6 }}>·</span>
                                                                    <span style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)' }}>{item.sub}</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                ) : (
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: 0 }}>SLA data not available</p>
                                )}
                            </Section>

                            {/* ── Analyze with Agent ── */}
                            <section style={{
                                background: 'var(--bg-secondary)', border: '1px solid rgba(163,113,247,0.35)',
                                borderRadius: 'var(--radius-lg)', padding: '1.25rem',
                                display: 'flex', flexDirection: 'column', gap: '1rem'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <Zap size={16} style={{ color: '#a371f7' }} />
                                    <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)' }}>Autonomous SOC</span>
                                </div>

                                <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', lineHeight: 1.55, margin: 0 }}>
                                    Send the full incident payload to the Agentic SOC swarm for autonomous triage and verdict.
                                </p>

                                {analyzeResult && (
                                    <div style={{
                                        padding: '0.75rem 0.9rem',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: '0.78rem',
                                        fontWeight: 500,
                                        ...(analyzeResult.error
                                            ? { background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.35)', color: '#f85149' }
                                            : { background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.35)', color: '#3fb950' })
                                    }}>
                                        {analyzeResult.error ? (
                                            <>❌ {analyzeResult.error}</>
                                        ) : (
                                            <>
                                                {incident?.agentic_job_id && analyzeResult.job_id === incident.agentic_job_id ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                                                        <Activity size={12} />
                                                        <span>Previously dispatched for analysis.</span>
                                                    </div>
                                                ) : (
                                                    <>✅ Queued! Job&nbsp;<strong>#{analyzeResult.job_id}</strong> dispatched to agent swarm.</>
                                                )}

                                                <a
                                                    href="http://localhost:9000/dashboard"
                                                    target="_blank" rel="noreferrer"
                                                    style={{ display: 'block', marginTop: '0.4rem', color: '#3fb950', textDecoration: 'underline', fontSize: '0.72rem' }}
                                                >
                                                    Track on Agentic SOC dashboard ↗
                                                </a>
                                            </>
                                        )}
                                    </div>
                                )}

                                <button
                                    onClick={handleAnalyze}
                                    disabled={analyzing || incident?.ai_status === 'pending' || isEditLocked}
                                    style={{
                                        width: '100%', padding: '0.85rem',
                                        borderRadius: 'var(--radius-md)',
                                        border: 'none',
                                        cursor: (analyzing || incident?.ai_status === 'pending' || isEditLocked) ? 'not-allowed' : 'pointer',
                                        fontWeight: 700, fontSize: '0.73rem', textTransform: 'uppercase',
                                        letterSpacing: '0.06em', color: 'white',
                                        opacity: (analyzing || incident?.ai_status === 'pending' || isEditLocked) ? 0.7 : 1,
                                        background: (analyzing || incident?.ai_status === 'pending' || isEditLocked)
                                            ? 'rgba(163,113,247,0.4)'
                                            : 'linear-gradient(135deg, #a371f7 0%, #6e40c9 100%)',
                                        boxShadow: (analyzing || incident?.ai_status === 'pending' || isEditLocked) ? 'none' : '0 4px 20px rgba(163,113,247,0.35)',
                                        transition: 'all 0.2s',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                                    }}
                                >
                                    <Zap size={14} />
                                    {analyzing
                                        ? 'Dispatching to Agent Swarm...'
                                        : incident?.ai_status === 'pending'
                                            ? 'Analysis In Progress...'
                                            : (incident?.agentic_job_id ? 'Re-analyze with Agent' : 'Analyze with Agent')
                                    }
                                </button>

                                {/* Verdict Status Button */}
                                <button
                                    onClick={() => {
                                        if (incident?.ai_status === 'completed') {
                                            router.push(`/incidents/${id}/verdict`);
                                        }
                                    }}
                                    disabled={incident?.ai_status !== 'completed'}
                                    style={{
                                        width: '100%', padding: '0.85rem',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: incident?.ai_status === 'completed' ? 'pointer' : 'not-allowed',
                                        fontWeight: 700, fontSize: '0.73rem', textTransform: 'uppercase',
                                        letterSpacing: '0.06em', color: 'white',
                                        background: incident?.ai_status === 'completed'
                                            ? 'linear-gradient(135deg, #2ea44f 0%, #238636 100%)' // Green
                                            : 'rgba(248, 81, 73, 0.15)', // Faded Red
                                        border: incident?.ai_status === 'completed'
                                            ? 'none'
                                            : '1px solid rgba(248, 81, 73, 0.4)',
                                        transition: 'all 0.2s',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                        boxShadow: incident?.ai_status === 'completed' ? '0 4px 15px rgba(46,164,79,0.25)' : 'none'
                                    }}
                                >
                                    <Brain size={14} />
                                    {incident?.ai_status === 'completed' ? 'View AI Verdict' : 'No AI Verdict Yet'}
                                </button>
                            </section>

                            {/* Quick stats sidebar card */}
                            <Section icon={<AlertTriangle size={16} />} title="Incident Stats" accent={sc.color}>
                                <InfoRow label="Alert Count" value={alerts.length > 0 ? `${alerts.length} stitched alerts` : 'No alerts'} />
                                <InfoRow label="Vendor ID" value={incident.vendor_incident_id} />
                                <InfoRow label="Source" value={incident.source_vendor?.toUpperCase()} />
                                <InfoRow label="Tenant" value={incident.tenant_name || incident.tenant_id?.slice(0, 8)} />
                                <InfoRow label="Last Updated" value={<span suppressHydrationWarning>{formatDistanceToNow(new Date(incident.updated_at || incident.created_at), { addSuffix: true })}</span>} />
                                {incidentMeta.manual_severity && <InfoRow label="XSIAM Severity" value={incidentMeta.manual_severity} />}
                                {incidentMeta.starred && <InfoRow label="Starred" value="Yes ⭐" />}
                            </Section>
                        </div>
                    </div>
                </main>
            </div>

            {/* ── Mail Preview Modal ── */}
            <MailPreviewModal
                incident={incident}
                open={showMailPreview}
                onClose={() => setShowMailPreview(false)}
                onIncidentUpdated={fetchIncident}
            />
        </div>
    );
}
