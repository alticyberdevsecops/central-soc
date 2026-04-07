'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { slaApi, tenantApi } from '@/lib/api';
import Cookies from 'js-cookie';
import {
    Timer, AlertTriangle, CheckCircle, Clock, TrendingUp,
    User, ChevronRight, ArrowUpRight, ArrowDownRight, Shield,
} from 'lucide-react';

// ── Helpers ──
function fmtMin(minutes: number | null | undefined): string {
    if (minutes == null || isNaN(minutes)) return '—';
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function pct(val: number | null | undefined): string {
    if (val == null || isNaN(val)) return '—';
    return `${Math.round(val)}%`;
}

const CARD: React.CSSProperties = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
    borderRadius: '12px', padding: '1.25rem',
};

const STAT_CARD: React.CSSProperties = {
    ...CARD, display: 'flex', flexDirection: 'column', gap: '8px',
};

export default function SLADashboardPage() {
    const userRole = Cookies.get('user_role') || '';
    const cookieTenant = Cookies.get('tenant_id') || '';
    const isSuperAdmin = userRole === 'super_admin';

    const [tenants, setTenants] = useState<any[]>([]);
    const [selectedTenantId, setSelectedTenantId] = useState(cookieTenant);
    const [summary, setSummary] = useState<any>(null);
    const [analysts, setAnalysts] = useState<any[]>([]);
    const [selectedAnalyst, setSelectedAnalyst] = useState<any>(null);
    const [analystDetail, setAnalystDetail] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Load tenants for super_admin
    useEffect(() => {
        if (isSuperAdmin) {
            tenantApi.list().then((data: any) => {
                const list = data?.tenants || [];
                setTenants(list);
                if (!selectedTenantId && list.length > 0) setSelectedTenantId(list[0].id);
            });
        }
    }, []);

    // Load SLA data
    useEffect(() => {
        if (!selectedTenantId) { setLoading(false); return; }
        setLoading(true);
        Promise.all([
            slaApi.getSummary({ tenant_id: selectedTenantId }).catch(() => null),
            slaApi.getAnalysts({ tenant_id: selectedTenantId }).catch(() => ({ analysts: [] })),
        ]).then(([sum, anl]) => {
            setSummary(sum);
            setAnalysts(anl?.analysts || []);
        }).finally(() => setLoading(false));
    }, [selectedTenantId]);

    // Load analyst detail
    useEffect(() => {
        if (!selectedAnalyst) { setAnalystDetail(null); return; }
        slaApi.getAnalyst(selectedAnalyst.user_id || selectedAnalyst.analyst_id, { tenant_id: selectedTenantId })
            .then(setAnalystDetail).catch(() => setAnalystDetail(null));
    }, [selectedAnalyst]);

    return (
        <div className="app-container">
            <Sidebar />
            <div className="main-layout">
                <main className="main-content" style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: 42, height: 42, borderRadius: '10px',
                                background: 'rgba(47,129,247,0.12)', display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Timer size={22} color="#2f81f7" />
                            </div>
                            <div>
                                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                                    SLA Dashboard
                                </h1>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', margin: 0 }}>
                                    Service Level Agreement compliance & analyst performance
                                </p>
                            </div>
                        </div>
                        {isSuperAdmin && tenants.length > 0 && (
                            <select
                                value={selectedTenantId}
                                onChange={e => { setSelectedTenantId(e.target.value); setSelectedAnalyst(null); }}
                                style={{
                                    padding: '8px 14px', borderRadius: '8px',
                                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                    color: 'var(--text-primary)', fontSize: '0.85rem',
                                }}
                            >
                                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                        )}
                    </div>

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                            Loading SLA data...
                        </div>
                    ) : !selectedTenantId ? (
                        <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-tertiary)' }}>
                            No tenant selected
                        </div>
                    ) : (
                        <>
                            {/* ── Summary Cards ── */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div style={STAT_CARD}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Shield size={16} color="#2f81f7" />
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            Overall Compliance
                                        </span>
                                    </div>
                                    <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                        {pct(summary?.compliance_pct)}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                        {summary?.total_incidents ?? 0} total incidents
                                    </span>
                                </div>

                                <div style={STAT_CARD}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Clock size={16} color="#f0883e" />
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            Avg First Response
                                        </span>
                                    </div>
                                    <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                        {fmtMin(summary?.avg_first_response_min)}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: (summary?.first_response_breach_count > 0) ? '#f85149' : '#3fb950' }}>
                                        {summary?.first_response_breach_count ?? 0} breaches
                                    </span>
                                </div>

                                <div style={STAT_CARD}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <CheckCircle size={16} color="#3fb950" />
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            Avg Resolution
                                        </span>
                                    </div>
                                    <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                        {fmtMin(summary?.avg_resolution_min)}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: (summary?.resolution_breach_count > 0) ? '#f85149' : '#3fb950' }}>
                                        {summary?.resolution_breach_count ?? 0} breaches
                                    </span>
                                </div>

                                <div style={STAT_CARD}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <AlertTriangle size={16} color="#f85149" />
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            Total Breaches
                                        </span>
                                    </div>
                                    <span style={{ fontSize: '2rem', fontWeight: 800, color: (summary?.first_response_breach_count + summary?.resolution_breach_count > 0) ? '#f85149' : 'var(--text-primary)' }}>
                                        {(summary?.first_response_breach_count ?? 0) + (summary?.resolution_breach_count ?? 0)}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                        first response + resolution
                                    </span>
                                </div>
                            </div>

                            {/* ── Analyst Table ── */}
                            <div style={CARD}>
                                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <User size={18} /> Analyst Performance
                                </h3>

                                {analysts.length === 0 ? (
                                    <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem 0' }}>
                                        No analyst data available yet. SLA events will appear as incidents are processed.
                                    </p>
                                ) : (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                    {['Analyst', 'Incidents', 'Avg First Response', 'Avg Resolution', 'FR Breaches', 'Res Breaches', 'Compliance', ''].map(h => (
                                                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                            {h}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {analysts.map((a: any, i: number) => {
                                                    const complianceColor = (a.compliance_pct ?? 100) >= 90 ? '#3fb950' : (a.compliance_pct ?? 100) >= 70 ? '#f0883e' : '#f85149';
                                                    return (
                                                        <tr key={i} style={{
                                                            borderBottom: '1px solid var(--border-color)',
                                                            cursor: 'pointer',
                                                            background: selectedAnalyst?.user_id === a.user_id ? 'var(--accent-soft)' : 'transparent',
                                                        }}
                                                            onClick={() => setSelectedAnalyst(a)}
                                                            onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                                                            onMouseOut={e => (e.currentTarget.style.background = selectedAnalyst?.user_id === a.user_id ? 'var(--accent-soft)' : 'transparent')}
                                                        >
                                                            <td style={{ padding: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                                {a.full_name || a.email || a.user_id}
                                                            </td>
                                                            <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>{a.incident_count ?? 0}</td>
                                                            <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>{fmtMin(a.avg_first_response_min)}</td>
                                                            <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>{fmtMin(a.avg_resolution_min)}</td>
                                                            <td style={{ padding: '12px' }}>
                                                                <span style={{ color: (a.fr_breach_count > 0) ? '#f85149' : '#3fb950', fontWeight: 600 }}>
                                                                    {a.fr_breach_count ?? 0}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '12px' }}>
                                                                <span style={{ color: (a.res_breach_count > 0) ? '#f85149' : '#3fb950', fontWeight: 600 }}>
                                                                    {a.res_breach_count ?? 0}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '12px' }}>
                                                                <span style={{
                                                                    padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 700,
                                                                    background: `${complianceColor}18`, color: complianceColor,
                                                                }}>
                                                                    {pct(a.compliance_pct)}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '12px' }}>
                                                                <ChevronRight size={16} color="var(--text-tertiary)" />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* ── Analyst Detail Panel ── */}
                            {selectedAnalyst && analystDetail && (
                                <div style={{ ...CARD, marginTop: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                                            {selectedAnalyst.full_name || selectedAnalyst.email || 'Analyst'} — Incident Breakdown
                                        </h3>
                                        <button
                                            onClick={() => setSelectedAnalyst(null)}
                                            style={{
                                                padding: '6px 12px', borderRadius: '6px', fontSize: '0.8rem',
                                                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                                color: 'var(--text-secondary)', cursor: 'pointer',
                                            }}
                                        >
                                            Close
                                        </button>
                                    </div>
                                    {analystDetail.incidents?.length > 0 ? (
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                        {['Incident', 'Title', 'Status', 'Assigned', 'First Response', 'Resolution', 'FR Breach', 'Res Breach'].map(h => (
                                                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase' }}>
                                                                {h}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {analystDetail.incidents.map((inc: any, i: number) => (
                                                        <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                            <td style={{ padding: '8px 10px', color: '#2f81f7', fontWeight: 600, cursor: 'pointer' }}
                                                                onClick={() => window.location.href = `/incidents/${inc.id}`}>
                                                                {(inc.incident_id || inc.id || '').toString().slice(0, 8)}...
                                                            </td>
                                                            <td style={{ padding: '8px 10px', color: 'var(--text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                {inc.title || inc.name || '—'}
                                                            </td>
                                                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{inc.status || '—'}</td>
                                                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                                                                {inc.assigned_at ? new Date(inc.assigned_at).toLocaleString() : '—'}
                                                            </td>
                                                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{fmtMin(inc.first_response_min)}</td>
                                                            <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>{fmtMin(inc.resolution_min)}</td>
                                                            <td style={{ padding: '8px 10px' }}>
                                                                {inc.sla_first_response_breached
                                                                    ? <AlertTriangle size={14} color="#f85149" />
                                                                    : <CheckCircle size={14} color="#3fb950" />}
                                                            </td>
                                                            <td style={{ padding: '8px 10px' }}>
                                                                {inc.sla_resolution_breached
                                                                    ? <AlertTriangle size={14} color="#f85149" />
                                                                    : <CheckCircle size={14} color="#3fb950" />}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <p style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '1.5rem' }}>
                                            No incident details available
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
