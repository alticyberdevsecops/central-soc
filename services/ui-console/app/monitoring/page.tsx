'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import IncidentTable from '@/components/IncidentTable';
import {
    Activity, Filter, RefreshCw, Search, Clock,
    ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X, SlidersHorizontal
} from 'lucide-react';
import Cookies from 'js-cookie';
import { incidentApi, tenantApi } from '@/lib/api';

const WS_URL = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8012`
    : (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8012');
const PAGE_SIZE = 50;

const SEVERITY_OPTIONS = [
    { value: '', label: 'All', color: 'var(--text-secondary)' },
    { value: 'critical', label: 'Critical', color: '#f85149' },
    { value: 'high', label: 'High', color: '#f0685e' },
    { value: 'medium', label: 'Medium', color: '#d29922' },
    { value: 'low', label: 'Low', color: '#3fb950' },
    { value: 'informational', label: 'Info', color: '#4493f8' },
];

const STATUS_OPTIONS = [
    { value: '', label: 'All', color: 'var(--text-secondary)' },
    { value: 'new', label: 'New', color: '#2f81f7' },
    { value: 'triaging', label: 'Triaging', color: '#d29922' },
    { value: 'ai triaging', label: 'AI Triaging', color: '#a371f7' },
    { value: 'in_progress', label: 'In Progress', color: '#8b5cf6' },
    { value: 'sent to customer', label: 'Sent', color: '#38a6e5' },
    { value: 'customer response received', label: 'Response', color: '#e28743' },
    { value: 'resolved', label: 'Resolved', color: '#3fb950' },
    { value: 'false_positive', label: 'False +', color: '#7d8590' },
    { value: 'escalated', label: 'Escalated', color: '#f85149' },
];

export default function Monitoring() {
    const [incidents, setIncidents] = useState<any[]>([]);
    const [tenants, setTenants] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    // Seed tenant_id from cookie so incidents are visible on first load
    const cookieTenantId = Cookies.get('tenant_id') || '';
    const userRole = Cookies.get('user_role') || '';
    const [filters, setFilters] = useState({
        tenant_id: cookieTenantId,   // default: whatever tenant is active
        severity: '',
        status: ''
    });

    // Debounce search input → searchQuery (400ms)
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setSearchQuery(searchInput.trim());
        }, 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [searchInput]);

    const fetchIncidents = useCallback(async (targetPage?: number) => {
        try {
            const p = targetPage ?? page;
            const params: any = { page_size: PAGE_SIZE, page: p, sort_by: 'last_updated_at', sort_dir: 'desc' };
            if (filters.tenant_id) params.tenant_id = filters.tenant_id;
            if (filters.severity) params.severity = filters.severity;
            if (filters.status) params.status = filters.status;
            if (searchQuery) params.search = searchQuery;

            const data = await incidentApi.list(params);
            setIncidents(data.incidents || []);
            setTotalPages(data.total_pages || 1);
            setTotal(data.total || 0);
            setLastUpdated(new Date());
        } catch (err) {
            console.error('Failed to fetch incidents:', err);
        } finally {
            setLoading(false);
        }
    }, [filters, page, searchQuery]);

    const fetchTenants = async () => {
        if (userRole !== 'super_admin') return;
        try {
            const data = await tenantApi.list();
            setTenants(data.tenants || []);
        } catch (err) {
            console.error('Failed to fetch tenants:', err);
        }
    };

    useEffect(() => {
        setPage(1);
    }, [filters.tenant_id, filters.severity, filters.status, searchQuery]);

    useEffect(() => {
        fetchIncidents(page);
        fetchTenants();

        // 1. Periodic refresh fallback (every 30s)
        const pollInterval = setInterval(() => fetchIncidents(page), 30000);

        // 2. WebSocket setup with reconnection logic
        let ws: WebSocket | null = null;
        let reconnectTimeout: NodeJS.Timeout;

        const connectWS = () => {
            const token = Cookies.get('soc_token');
            if (!token) return;

            ws = new WebSocket(`${WS_URL}/ws/incidents?token=${token}`);

            ws.onmessage = (event) => {
                const data = json_parse_safe(event.data);
                if (data && (data.event_type === 'new_incident' || data.event_type === 'incident_updated')) {
                    fetchIncidents(page);
                }
            };

            ws.onclose = () => {
                console.log('Monitoring WS closed. Retrying in 5s...');
                reconnectTimeout = setTimeout(connectWS, 5000);
            };

            ws.onerror = (err) => {
                console.error('Monitoring WS error', err);
                ws?.close();
            };
        };

        connectWS();

        return () => {
            clearInterval(pollInterval);
            if (ws) ws.close();
            clearTimeout(reconnectTimeout);
        };
    }, [fetchIncidents, page]);

    const json_parse_safe = (str: string) => {
        try { return JSON.parse(str); } catch { return null; }
    };

    const goToPage = (p: number) => {
        if (p < 1 || p > totalPages) return;
        setPage(p);
    };

    const clearFilters = () => { setFilters({ tenant_id: cookieTenantId, severity: '', status: '' }); setSearchInput(''); };
    const hasActiveFilters = !!(filters.severity || filters.status || filters.tenant_id || searchQuery);

    const startItem = (page - 1) * PAGE_SIZE + 1;
    const endItem = Math.min(page * PAGE_SIZE, total);

    return (
        <div className="app-container">
            <Sidebar />
            <div className="main-layout">
                {/* ── Header ── */}
                <header className="header">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Live Monitoring</h2>
                            <div className="live-badge">
                                <div className="pulse-dot" style={{ background: 'var(--accent-primary)' }} />
                                STREAMING
                            </div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)', padding: '0.15rem 0.5rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                <Clock size={10} />
                                Last sync: {lastUpdated.toLocaleTimeString()}
                            </div>
                            {!loading && (
                                <span style={{
                                    fontSize: '0.72rem',
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-color)',
                                    padding: '0.15rem 0.6rem',
                                    borderRadius: '9999px',
                                    color: 'var(--text-tertiary)',
                                    fontWeight: 600,
                                }}>
                                    {total.toLocaleString()} incidents
                                </span>
                            )}
                        </div>
                        <button
                            onClick={() => fetchIncidents(page)}
                            style={{
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-color)',
                                padding: '0.35rem 0.75rem',
                                borderRadius: 'var(--radius-md)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                fontSize: '0.78rem',
                                cursor: 'pointer',
                                color: 'var(--text-secondary)',
                                transition: 'all 0.15s',
                            }}
                        >
                            <RefreshCw size={13} /> Refresh
                        </button>
                    </div>
                </header>

                <main className="content-area" style={{ padding: '1.25rem 1.5rem', gap: '1rem' }}>

                    {/* ── Search Bar ── */}
                    <div className="liquid-glass" style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.45rem 0.85rem',
                    }}>
                        <Search size={15} style={{ color: searchQuery ? 'var(--accent-primary)' : 'var(--text-tertiary)', flexShrink: 0, transition: 'color 0.2s' }} />
                        <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search incidents — ticket ID, title, host, IOC, MITRE technique, tenant..."
                            style={{
                                flex: 1,
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                color: 'var(--text-primary)',
                                fontSize: '0.82rem',
                                fontWeight: 500,
                                padding: '0.25rem 0',
                                caretColor: 'var(--accent-primary)',
                            }}
                        />
                        {searchInput && (
                            <button
                                onClick={() => setSearchInput('')}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 22, height: 22, borderRadius: '50%',
                                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                    color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0,
                                    transition: 'all 0.15s',
                                }}
                            >
                                <X size={11} />
                            </button>
                        )}
                    </div>

                    {/* ── Filter Chips Toolbar ── */}
                    <div className="liquid-glass" style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        flexWrap: 'wrap',
                        padding: '0.55rem 1rem',
                    }}>
                        {/* Filter icon + label */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-tertiary)', marginRight: '0.1rem' }}>
                            <SlidersHorizontal size={13} />
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                                Severity
                            </span>
                        </div>

                        {/* Severity Chips */}
                        {SEVERITY_OPTIONS.map(({ value, label, color }) => {
                            const isActive = filters.severity === value;
                            return (
                                <button
                                    key={value}
                                    onClick={() => setFilters(f => ({ ...f, severity: value }))}
                                    style={{
                                        padding: '0.25rem 0.65rem',
                                        borderRadius: '9999px',
                                        fontSize: '0.71rem',
                                        fontWeight: isActive ? 700 : 500,
                                        border: `1px solid ${isActive ? color : 'var(--border-color)'}`,
                                        cursor: 'pointer',
                                        transition: 'all 0.18s',
                                        background: isActive ? `${color}18` : 'var(--bg-tertiary)',
                                        color: isActive ? color : 'var(--text-secondary)',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {label}
                                </button>
                            );
                        })}

                        {/* Divider */}
                        <div style={{ width: '1px', height: '18px', background: 'var(--border-color)', margin: '0 0.3rem', flexShrink: 0 }} />

                        {/* Status label */}
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap', marginRight: '0.1rem' }}>
                            Status
                        </span>

                        {/* Status Chips */}
                        {STATUS_OPTIONS.map(({ value, label, color }) => {
                            const isActive = filters.status === value;
                            return (
                                <button
                                    key={value}
                                    onClick={() => setFilters(f => ({ ...f, status: value }))}
                                    style={{
                                        padding: '0.25rem 0.65rem',
                                        borderRadius: '9999px',
                                        fontSize: '0.71rem',
                                        fontWeight: isActive ? 700 : 500,
                                        border: `1px solid ${isActive ? color : 'var(--border-color)'}`,
                                        cursor: 'pointer',
                                        transition: 'all 0.18s',
                                        background: isActive ? `${color}18` : 'var(--bg-tertiary)',
                                        color: isActive ? color : 'var(--text-secondary)',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {label}
                                </button>
                            );
                        })}

                        {/* Tenant dropdown — only for super_admin */}
                        {tenants.length > 0 && (
                            <>
                                <div style={{ width: '1px', height: '18px', background: 'var(--border-color)', margin: '0 0.3rem', flexShrink: 0 }} />
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                                    Tenant
                                </span>
                                <select
                                    value={filters.tenant_id}
                                    onChange={(e) => setFilters(f => ({ ...f, tenant_id: e.target.value }))}
                                    style={{
                                        background: filters.tenant_id ? 'rgba(47,129,247,0.1)' : 'transparent',
                                        border: `1px solid ${filters.tenant_id ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                                        color: filters.tenant_id ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                                        padding: '0.2rem 0.55rem',
                                        borderRadius: '9999px',
                                        fontSize: '0.71rem',
                                        fontWeight: 500,
                                        outline: 'none',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <option value="">All Tenants</option>
                                    {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                            </>
                        )}

                        {/* Spacer */}
                        <div style={{ flex: 1 }} />

                        {/* Active filter count + clear */}
                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    padding: '0.22rem 0.6rem',
                                    borderRadius: '9999px',
                                    fontSize: '0.71rem',
                                    fontWeight: 600,
                                    border: '1px solid var(--border-color)',
                                    cursor: 'pointer',
                                    background: 'var(--bg-tertiary)',
                                    color: 'var(--text-secondary)',
                                    transition: 'all 0.15s',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                <X size={11} /> Clear filters
                            </button>
                        )}
                    </div>

                    {/* ── Incident Feed Card ── */}
                    <div className="detail-card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {/* Feed Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <Activity size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Incident Feed
                            </span>
                            {!loading && total > 0 && (
                                <span style={{
                                    fontSize: '0.68rem',
                                    background: 'var(--bg-tertiary)',
                                    padding: '0.12rem 0.45rem',
                                    borderRadius: '4px',
                                    color: 'var(--text-secondary)',
                                    fontWeight: 600,
                                }}>
                                    {startItem}–{endItem} of {total}
                                </span>
                            )}
                        </div>

                        {/* Table */}
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {loading ? (
                                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                                    Loading feed...
                                </div>
                            ) : incidents.length === 0 ? (
                                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                                    No incidents match the current filters.
                                </div>
                            ) : (
                                <IncidentTable incidents={incidents} showTenant={true} onRefresh={() => fetchIncidents(page)} />
                            )}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                paddingTop: '0.6rem',
                                borderTop: '1px solid var(--border-color)',
                            }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                                    Page {page} of {totalPages}
                                </span>
                                <div style={{ display: 'flex', gap: '0.3rem' }}>
                                    <PaginationButton onClick={() => goToPage(1)} disabled={page === 1} title="First page">
                                        <ChevronsLeft size={14} />
                                    </PaginationButton>
                                    <PaginationButton onClick={() => goToPage(page - 1)} disabled={page === 1} title="Previous page">
                                        <ChevronLeft size={14} />
                                    </PaginationButton>

                                    {getPageNumbers(page, totalPages).map((p, i) =>
                                        p === '...' ? (
                                            <span key={`ellipsis-${i}`} style={{ padding: '0.3rem 0.2rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>…</span>
                                        ) : (
                                            <PaginationButton
                                                key={p}
                                                onClick={() => goToPage(p as number)}
                                                active={page === p}
                                            >
                                                {p}
                                            </PaginationButton>
                                        )
                                    )}

                                    <PaginationButton onClick={() => goToPage(page + 1)} disabled={page === totalPages} title="Next page">
                                        <ChevronRight size={14} />
                                    </PaginationButton>
                                    <PaginationButton onClick={() => goToPage(totalPages)} disabled={page === totalPages} title="Last page">
                                        <ChevronsRight size={14} />
                                    </PaginationButton>
                                </div>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────
   Sub-Components
   ───────────────────────────────────────────── */

function PaginationButton({ children, onClick, disabled, active, title }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    title?: string;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '1.9rem',
                height: '1.9rem',
                padding: '0 0.35rem',
                fontSize: '0.72rem',
                fontWeight: active ? 700 : 500,
                borderRadius: '6px',
                border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: active ? 'rgba(47, 129, 247, 0.15)' : 'var(--bg-tertiary)',
                color: active ? 'var(--accent-primary)' : disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                transition: 'all 0.15s',
            }}
        >
            {children}
        </button>
    );
}

function getPageNumbers(current: number, total: number): (number | string)[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | string)[] = [];
    if (current <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push('...', total);
    } else if (current >= total - 3) {
        pages.push(1, '...');
        for (let i = total - 4; i <= total; i++) pages.push(i);
    } else {
        pages.push(1, '...', current - 1, current, current + 1, '...', total);
    }
    return pages;
}
