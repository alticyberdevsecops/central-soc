'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { formatDistanceToNow } from 'date-fns';
import { MoreVertical, Trash2, User, Monitor, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { incidentApi } from '@/lib/api';
import Cookies from 'js-cookie';

export default function IncidentTable({ incidents, showTenant = false, onRefresh }: {
    incidents: any[];
    showTenant?: boolean;
    onRefresh?: () => void;
}) {
    const router = useRouter();
    const userRole = Cookies.get('user_role') || '';
    const isAdmin = userRole === 'super_admin' || userRole === 'customer_admin';

    const [menuOpen, setMenuOpen] = useState<string | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<{ id: string; ticketId: string } | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [portalReady, setPortalReady] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Portal needs to wait for mount (SSR safety)
    useEffect(() => {
        setPortalReady(true);
    }, []);

    // Close menu on outside click
    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(null);
                setMenuPos(null);
            }
        };
        // Use timeout so the opening click doesn't immediately close it
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handler);
        }, 10);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handler);
        };
    }, [menuOpen]);

    const handleRowClick = (inc: any) => {
        router.push(`/incidents/${inc.ticket_id || inc.id}`);
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        setDeleting(true);
        try {
            await incidentApi.delete(confirmDelete.id);
            setConfirmDelete(null);
            setMenuOpen(null);
            setMenuPos(null);
            if (onRefresh) onRefresh();
        } catch (err: any) {
            alert(err.message || 'Failed to delete incident');
        } finally {
            setDeleting(false);
        }
    };

    const openMenu = (e: React.MouseEvent<HTMLButtonElement>, incId: string) => {
        e.stopPropagation();
        e.preventDefault();
        if (menuOpen === incId) {
            setMenuOpen(null);
            setMenuPos(null);
        } else {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuPos({ top: rect.bottom + 4, left: rect.right - 170 });
            setMenuOpen(incId);
        }
    };

    if (incidents.length === 0) {
        return (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
                No incidents found. Total zero-day peace.
            </div>
        );
    }

    return (
        <>
            <div style={{ overflowX: 'auto', position: 'relative' }}>
                <table className="incident-table">
                    <thead>
                        <tr>
                            <th>Severity</th>
                            {showTenant && <th>Tenant</th>}
                            <th>Incident Details</th>
                            <th>Source</th>
                            <th>Assets / Users</th>
                            <th>Status</th>
                            <th>Time</th>
                            <th style={{ textAlign: 'right', width: '50px' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {incidents.map((inc) => (
                            <tr
                                key={inc.id}
                                onClick={() => handleRowClick(inc)}
                                style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(47,129,247,0.04)')}
                                onMouseOut={(e) => (e.currentTarget.style.background = '')}
                            >
                                <td style={{ width: '100px' }}>
                                    <SeverityBadge severity={inc.severity} />
                                </td>
                                {showTenant && (
                                    <td>
                                        <span style={{
                                            fontSize: '0.7rem', fontWeight: 700,
                                            color: 'var(--accent-primary)',
                                            background: 'rgba(47, 129, 247, 0.1)',
                                            padding: '0.2rem 0.5rem', borderRadius: '4px',
                                            border: '1px solid rgba(47, 129, 247, 0.2)',
                                        }}>
                                            {inc.tenant_name || inc.tenant_id?.slice(0, 8)}
                                        </span>
                                    </td>
                                )}
                                <td style={{ maxWidth: '400px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{
                                                fontSize: '0.65rem', fontWeight: 900,
                                                color: 'var(--text-tertiary)',
                                                background: 'var(--bg-tertiary)',
                                                padding: '0.1rem 0.4rem', borderRadius: '3px',
                                                border: '1px solid var(--border-subtle)',
                                                fontFamily: 'var(--font-mono)',
                                            }}>
                                                {inc.ticket_id || `${(inc.tenant_name || 'SOC').slice(0, 4).toUpperCase()}-${inc.vendor_incident_id}`}
                                            </span>
                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{inc.title}</span>
                                        </div>
                                        <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginLeft: '0.2rem' }}>
                                            Original ID: {inc.vendor_incident_id}
                                        </span>
                                    </div>
                                </td>
                                <td>
                                    <SourceBadge vendor={inc.source_vendor} />
                                </td>
                                <td>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        {inc.affected_hosts?.length > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)' }}>
                                                <Monitor size={14} style={{ color: 'var(--accent-primary)' }} />
                                                <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{inc.affected_hosts.length}</span>
                                            </div>
                                        )}
                                        {inc.affected_users?.length > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)' }}>
                                                <User size={14} style={{ color: 'var(--status-medium)' }} />
                                                <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{inc.affected_users.length}</span>
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <StatusBadge status={inc.status} />
                                        {(() => {
                                            const breached = inc.sla_first_response_breached || inc.sla_resolution_breached;
                                            // Compute approaching breach from created_at for non-breached, non-resolved incidents
                                            if (breached) {
                                                return (
                                                    <span title={`SLA Breach: ${inc.sla_first_response_breached ? 'First Response' : ''}${inc.sla_first_response_breached && inc.sla_resolution_breached ? ' + ' : ''}${inc.sla_resolution_breached ? 'Resolution' : ''}`}
                                                        style={{ display: 'flex', alignItems: 'center' }}>
                                                        <AlertTriangle size={14} color="#f85149" />
                                                    </span>
                                                );
                                            }
                                            // Warning indicators for approaching breach
                                            if (inc.sla_fr_warning_sent || inc.sla_res_warning_sent) {
                                                return (
                                                    <span title="SLA approaching breach" style={{ display: 'flex', alignItems: 'center' }}>
                                                        <Clock size={13} color="#f0883e" />
                                                    </span>
                                                );
                                            }
                                            return null;
                                        })()}
                                    </div>
                                </td>
                                <td style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                        <span suppressHydrationWarning>{formatDistanceToNow(new Date(inc.created_at), { addSuffix: true })}</span>
                                        <span suppressHydrationWarning style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                            {new Date(inc.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                                        </span>
                                        {(() => {
                                            const updatedMs = inc.last_updated_at ? new Date(inc.last_updated_at).getTime() : (inc.updated_at ? new Date(inc.updated_at).getTime() : 0);
                                            const createdMs = new Date(inc.created_at).getTime();
                                            if (!updatedMs || updatedMs - createdMs < 10000) return null;
                                            return (
                                                <span suppressHydrationWarning style={{
                                                    fontSize: '0.65rem', color: '#a371f7',
                                                    display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 500,
                                                }}>
                                                    <RefreshCw size={10} />
                                                    {formatDistanceToNow(new Date(updatedMs), { addSuffix: true })}
                                                </span>
                                            );
                                        })()}
                                    </div>
                                </td>
                                {/* Settings kebab button */}
                                <td style={{ textAlign: 'right' }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <button
                                        onClick={(e) => openMenu(e, inc.id)}
                                        style={{
                                            display: 'inline-flex', padding: '0.4rem',
                                            borderRadius: 'var(--radius-md)',
                                            background: menuOpen === inc.id ? 'var(--bg-tertiary)' : 'transparent',
                                            color: 'var(--text-tertiary)', border: 'none',
                                            cursor: 'pointer', transition: 'all 0.15s',
                                        }}
                                        onMouseOver={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                                        onMouseOut={(e) => {
                                            if (menuOpen !== inc.id) { e.currentTarget.style.background = 'transparent'; }
                                            e.currentTarget.style.color = 'var(--text-tertiary)';
                                        }}
                                    >
                                        <MoreVertical size={15} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ─── Portal: Dropdown Menu (rendered in document.body to escape overflow/backdrop-filter) ─── */}
            {portalReady && menuOpen && menuPos && createPortal(
                <div ref={menuRef} style={{
                    position: 'fixed',
                    top: `${menuPos.top}px`,
                    left: `${menuPos.left}px`,
                    zIndex: 99999,
                    minWidth: '170px',
                    background: 'var(--bg-elevated, #1c2128)',
                    border: '1px solid var(--border-color, #373e47)',
                    borderRadius: '8px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                    overflow: 'hidden',
                }}>
                    {isAdmin && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const inc = incidents.find(i => i.id === menuOpen);
                                if (inc) {
                                    setConfirmDelete({ id: inc.id, ticketId: inc.ticket_id || inc.id });
                                }
                                setMenuOpen(null);
                                setMenuPos(null);
                            }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.6rem',
                                width: '100%', padding: '0.6rem 0.85rem',
                                background: 'transparent', border: 'none',
                                color: '#f85149', fontSize: '0.8rem', fontWeight: 500,
                                cursor: 'pointer', textAlign: 'left',
                                transition: 'background 0.12s',
                            }}
                            onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(248,81,73,0.08)')}
                            onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                            <Trash2 size={14} /> Delete Incident
                        </button>
                    )}
                    {!isAdmin && (
                        <div style={{ padding: '0.6rem 0.85rem', color: 'var(--text-tertiary, #7d8590)', fontSize: '0.78rem' }}>
                            No actions available
                        </div>
                    )}
                </div>,
                document.body
            )}

            {/* ─── Portal: Delete Confirmation Modal ─── */}
            {portalReady && confirmDelete && createPortal(
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 100000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                }} onClick={() => !deleting && setConfirmDelete(null)}>
                    <div
                        style={{
                            background: 'var(--bg-elevated, #1c2128)', border: '1px solid var(--border-color, #373e47)',
                            borderRadius: '12px', padding: '2rem',
                            maxWidth: '420px', width: '90%',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{
                            width: '48px', height: '48px', borderRadius: '50%',
                            background: 'rgba(248,81,73,0.1)', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', marginBottom: '1rem',
                        }}>
                            <Trash2 size={22} color="#f85149" />
                        </div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary, #e6edf3)' }}>
                            Delete Incident
                        </h3>
                        <p style={{ color: 'var(--text-secondary, #9da5b0)', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                            Are you sure you want to delete <strong style={{ color: 'var(--text-primary, #e6edf3)' }}>{confirmDelete.ticketId}</strong>?
                        </p>
                        <p style={{ color: 'var(--text-tertiary, #7d8590)', fontSize: '0.78rem', marginBottom: '1.5rem' }}>
                            This action cannot be undone. The incident and all its comments will be permanently removed.
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setConfirmDelete(null)}
                                disabled={deleting}
                                style={{
                                    padding: '0.55rem 1.1rem', borderRadius: '8px',
                                    background: 'var(--bg-tertiary, #2d333b)', border: '1px solid var(--border-color, #373e47)',
                                    color: 'var(--text-secondary, #9da5b0)', fontSize: '0.82rem', fontWeight: 600,
                                    cursor: 'pointer',
                                }}
                            >Cancel</button>
                            <button
                                onClick={handleDelete}
                                disabled={deleting}
                                style={{
                                    padding: '0.55rem 1.1rem', borderRadius: '8px',
                                    background: deleting ? 'rgba(248,81,73,0.4)' : '#f85149',
                                    border: 'none', color: '#fff',
                                    fontSize: '0.82rem', fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer',
                                }}
                            >{deleting ? 'Deleting...' : 'Delete'}</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}

function SeverityBadge({ severity }: { severity: string }) {
    const configs: any = {
        critical: { bg: 'rgba(248, 81, 73, 0.1)', color: 'var(--status-critical)', border: 'rgba(248, 81, 73, 0.2)' },
        high: { bg: 'rgba(240, 104, 94, 0.1)', color: 'var(--status-high)', border: 'rgba(240, 104, 94, 0.2)' },
        medium: { bg: 'rgba(210, 153, 34, 0.1)', color: 'var(--status-medium)', border: 'rgba(210, 153, 34, 0.2)' },
        low: { bg: 'rgba(63, 185, 80, 0.1)', color: 'var(--status-low)', border: 'rgba(63, 185, 80, 0.2)' },
        informational: { bg: 'rgba(68, 147, 248, 0.1)', color: 'var(--status-info)', border: 'rgba(68, 147, 248, 0.2)' },
    };
    const config = configs[severity.toLowerCase()] || configs.medium;
    return (
        <span style={{
            display: 'inline-block', padding: '0.2rem 0.6rem',
            borderRadius: '9999px', fontSize: '0.65rem', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.05em',
            background: config.bg, color: config.color,
            border: `1px solid ${config.border}`, whiteSpace: 'nowrap',
        }}>{severity}</span>
    );
}

function StatusBadge({ status }: { status: string }) {
    const labels: any = {
        new: { text: 'New', color: 'var(--accent-primary)', bg: 'rgba(47, 129, 247, 0.1)' },
        triaging: { text: 'Triaging', color: 'var(--status-medium)', bg: 'rgba(210, 153, 34, 0.1)' },
        'ai triaging': { text: 'AI Triaging', color: '#a371f7', bg: 'rgba(163, 113, 247, 0.1)' },
        in_progress: { text: 'In Progress', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
        'sent to customer': { text: 'Sent to Customer', color: '#38a6e5', bg: 'rgba(56, 166, 229, 0.1)' },
        'customer response received': { text: 'Response Received', color: '#e28743', bg: 'rgba(226, 135, 67, 0.1)' },
        resolved: { text: 'Resolved', color: 'var(--status-low)', bg: 'rgba(63, 185, 80, 0.1)' },
        false_positive: { text: 'False Positive', color: 'var(--text-tertiary)', bg: 'var(--bg-tertiary)' },
        escalated: { text: 'Escalated', color: 'var(--status-critical)', bg: 'rgba(248, 81, 73, 0.1)' },
    };
    const config = labels[status] || labels.new;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: config.color }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 500, color: config.color }}>{config.text}</span>
        </div>
    );
}

function SourceBadge({ vendor }: { vendor: string }) {
    return (
        <span style={{
            fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)',
            background: 'var(--bg-tertiary)', padding: '0.25rem 0.6rem',
            borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
            textTransform: 'uppercase',
        }}>{vendor}</span>
    );
}
