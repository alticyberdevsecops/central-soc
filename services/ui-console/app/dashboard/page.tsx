'use client';

import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import {
    Shield, AlertTriangle, Clock, RefreshCw, Activity, TrendingUp,
    ShieldAlert, ShieldCheck, Zap, Eye, BarChart3, PieChart as PieChartIcon,
    Layers, ArrowUpRight, ArrowDownRight, Timer, CheckCircle, User, ChevronRight
} from 'lucide-react';
import { incidentApi, tenantApi, apiRequest, slaApi, authApi } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import SOCFlowHero from '@/components/SOCFlowHero';
import PremiumSLADashboard from '@/components/PremiumSLADashboard';
import CISODashboard from '@/components/CISODashboard';
import {
    PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
    Tooltip, CartesianGrid, RadialBarChart, RadialBar, Legend
} from 'recharts';

const WS_URL = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8012`
    : (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8012');

const SEVERITY_COLORS: Record<string, string> = {
    critical: '#f85149',
    high: '#f0685e',
    medium: '#d29922',
    low: '#3fb950',
    informational: '#4493f8',
};

const STATUS_COLORS: Record<string, string> = {
    new: '#2f81f7',
    triaging: '#d29922',
    in_progress: '#a371f7',
    resolved: '#3fb950',
    false_positive: '#7d8590',
    escalated: '#f85149',
    'sent_to_customer': '#38a6e5',
    'customer_response': '#e28743',
    'ai_triaging': '#a371f7',
};

type DashboardTab = 'overview' | 'sla' | 'ciso';

// ── SLA Helpers ──
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

export default function Dashboard() {
    const [activeTab, setActiveTab] = useState<DashboardTab>('ciso');
    const [stats, setStats] = useState<any>(null);
    const [tenants, setTenants] = useState<any[]>([]);
    const [userRole] = useState(Cookies.get('user_role') || '');
    const [userDashboards, setUserDashboards] = useState<string[]>([]);
    const [selectedTenant, setSelectedTenant] = useState('');
    const [loading, setLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [tenantStats, setTenantStats] = useState<Record<string, any>>({});
    const [slaSummary, setSlaSummary] = useState<any>(null);

    const isSuperAdmin = userRole === 'super_admin';

    const fetchDashboardData = async () => {
        try {
            // Always fetch fresh user info so we get current tenant assignments
            // without requiring a re-login after an admin adds a new tenant
            let liveAssignedIds: string[] = [];
            if (!isSuperAdmin) {
                try {
                    const me = await authApi.me();
                    liveAssignedIds = (me?.tenant_ids || []).map((id: any) => String(id));
                    setUserDashboards(me?.dashboards || []);
                    
                    // If current active tab is not allowed, switch to the first allowed one
                    const allowed = me?.dashboards || [];
                    // Commented out to ensure CISO dashboard remains the default
                    // if (allowed.length > 0 && !allowed.includes('all') && !allowed.includes(activeTab)) {
                    //     setActiveTab(allowed[0] as DashboardTab);
                    // }
                    
                    // Keep cookie in sync so other pages stay consistent
                    if (liveAssignedIds.length > 0) {
                        Cookies.set('tenant_ids', JSON.stringify(liveAssignedIds), { expires: 1 });
                        Cookies.set('tenant_id', liveAssignedIds[0], { expires: 1 });
                    }
                } catch { /* fallback to cookie below */ }

                if (!liveAssignedIds.length) {
                    try { liveAssignedIds = JSON.parse(Cookies.get('tenant_ids') || '[]'); }
                    catch { liveAssignedIds = []; }
                }
            }

            const isMultiTenant = liveAssignedIds.length > 1;
            // Only pass tenant_id param when user has explicitly selected one
            const effectiveTenant = selectedTenant && (isSuperAdmin || liveAssignedIds.includes(selectedTenant))
                ? selectedTenant : '';
            const params: any = effectiveTenant ? { tenant_id: effectiveTenant } : {};

            const [statsData, tenantsData] = await Promise.all([
                incidentApi.stats(params),
                isSuperAdmin
                    ? tenantApi.list()
                    : isMultiTenant
                        // Fetch every assigned tenant in parallel
                        ? Promise.all(
                            liveAssignedIds.map((id: string) =>
                                tenantApi.get(id).catch(() => null)
                            )
                          ).then((results: any[]) => ({ tenants: results.filter(Boolean) }))
                        : liveAssignedIds[0]
                            ? tenantApi.get(liveAssignedIds[0]).then((t: any) => ({ tenants: [t] })).catch(() => ({ tenants: [] }))
                            : Promise.resolve({ tenants: [] })
            ]);
            setStats(statsData);
            setTenants(tenantsData.tenants);
            setLastUpdated(new Date());

            // Auto-select first tenant if none selected and we have tenants
            if (!selectedTenant && tenantsData.tenants?.length > 0) {
                setSelectedTenant(tenantsData.tenants[0].id);
            }

            // Fetch SLA summary
            const slaParams: any = selectedTenant ? { tenant_id: selectedTenant } : {};
            slaApi.getSummary(slaParams).then(setSlaSummary).catch(() => setSlaSummary(null));

            // Fetch per-tenant stats for the flow visualization
            if (tenantsData.tenants?.length > 0) {
                const perTenantStats: Record<string, any> = {};
                const results = await Promise.allSettled(
                    tenantsData.tenants.map((t: any) =>
                        apiRequest(`/tenants/${t.id}/stats`).then((s: any) => ({ id: t.id, stats: s }))
                    )
                );
                results.forEach((r) => {
                    if (r.status === 'fulfilled' && r.value) {
                        perTenantStats[r.value.id] = r.value.stats;
                    }
                });
                setTenantStats(perTenantStats);
            }
        } catch (err) {
            console.error('Failed to fetch dashboard data', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboardData();

        // 1. Periodic refresh fallback (every 30s)
        const pollInterval = setInterval(fetchDashboardData, 30000);

        // 2. WebSocket setup with reconnection logic
        let ws: WebSocket | null = null;
        let reconnectTimeout: NodeJS.Timeout;

        const connectWS = () => {
            const token = Cookies.get('soc_token');
            if (!token) return;

            ws = new WebSocket(`${WS_URL}/ws/incidents?token=${token}`);

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.event_type === 'new_incident' || data.event_type === 'incident_updated') {
                        fetchDashboardData();
                    }
                } catch { }
            };

            ws.onclose = () => {
                console.log('Dashboard WS closed. Retrying in 5s...');
                reconnectTimeout = setTimeout(connectWS, 5000);
            };

            ws.onerror = (err) => {
                console.error('Dashboard WS error', err);
                ws?.close();
            };
        };

        connectWS();

        return () => {
            clearInterval(pollInterval);
            if (ws) ws.close();
            clearTimeout(reconnectTimeout);
        };
    }, [selectedTenant]);



    // SLA Dashboard is handled by PremiumSLADashboard component

    const handleForceSync = async () => {
        setIsSyncing(true);
        try {
            await apiRequest('/connectors/reload', { method: 'POST' });
            await fetchDashboardData();
        } catch (err) {
            console.error('Failed to force sync', err);
        } finally {
            setTimeout(() => setIsSyncing(false), 1000);
        }
    };

    if (loading) return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', color: 'var(--text-tertiary)' }}>
            Initializing SOC Console...
        </div>
    );

    if (!stats) return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', color: 'var(--text-tertiary)', flexDirection: 'column', gap: '1rem' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--status-critical)' }}>Failed to connect to SOC API</span>
            <span style={{ fontSize: '0.8rem' }}>Check network connectivity to the API gateway</span>
            <button onClick={() => { setLoading(true); fetchDashboardData(); }} style={{ marginTop: '0.5rem', padding: '0.6rem 1.5rem', borderRadius: '8px', background: 'var(--accent-primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                Retry
            </button>
        </div>
    );

    const { summary, by_vendor } = stats;
    const totalIncidents = summary.total_incidents || (summary.critical_count + summary.high_count + summary.medium_count + summary.low_count + (summary.informational_count || 0));
    const openCases = summary.new_count + summary.triaging_count + (summary.ai_triaging_count || 0) + summary.in_progress_count + (summary.sent_to_customer_count || 0) + (summary.customer_response_count || 0) + (summary.escalated_count || 0);

    // Chart data
    const severityData = [
        { name: 'Critical', value: summary.critical_count, color: SEVERITY_COLORS.critical },
        { name: 'High', value: summary.high_count, color: SEVERITY_COLORS.high },
        { name: 'Medium', value: summary.medium_count, color: SEVERITY_COLORS.medium },
        { name: 'Low', value: summary.low_count, color: SEVERITY_COLORS.low },
        { name: 'Informational', value: summary.informational_count || 0, color: SEVERITY_COLORS.informational },
    ].filter(d => d.value > 0);

    const statusData = [
        { name: 'New', value: summary.new_count, color: STATUS_COLORS.new },
        { name: 'Triaging', value: summary.triaging_count, color: STATUS_COLORS.triaging },
        { name: 'AI Triaging', value: summary.ai_triaging_count || 0, color: STATUS_COLORS.ai_triaging },
        { name: 'In Progress', value: summary.in_progress_count, color: STATUS_COLORS.in_progress },
        { name: 'Escalated', value: summary.escalated_count || 0, color: STATUS_COLORS.escalated },
        { name: 'Sent to Customer', value: summary.sent_to_customer_count || 0, color: STATUS_COLORS.sent_to_customer },
        { name: 'Response Received', value: summary.customer_response_count || 0, color: STATUS_COLORS.customer_response },
    ].filter(d => d.value > 0);

    const vendorData = (by_vendor || [])
        .filter((v: any) => v.vendor)
        .map((v: any) => ({ name: v.vendor?.toUpperCase(), count: v.count }))
        .sort((a: any, b: any) => b.count - a.count);

    const volumeData = [
        { name: 'Last 24h', value: summary.last_24h, fill: '#2f81f7' },
        { name: 'Last 7d', value: summary.last_7d, fill: '#a371f7' },
        { name: 'Total', value: totalIncidents, fill: '#3fb950' },
    ];

    const criticalPercent = totalIncidents > 0 ? Math.round((summary.critical_count / totalIncidents) * 100) : 0;
    const highPercent = totalIncidents > 0 ? Math.round((summary.high_count / totalIncidents) * 100) : 0;

    const tabs = ([
        { key: 'overview', label: 'Overview', icon: <BarChart3 size={16} /> },
        { key: 'sla', label: 'SLA Dashboard', icon: <Timer size={16} /> },
        { key: 'ciso', label: 'CISO Dashboard', icon: <Shield size={16} /> },
    ] as { key: DashboardTab; label: string; icon: React.ReactNode }[]).filter(tab => {
        if (userRole === 'super_admin' || userRole === 'customer_admin' || userDashboards.includes('all')) return true;
        if (userDashboards.length === 0) return true; // Default to all if not set yet (or for existing users)
        return userDashboards.includes(tab.key);
    });

    return (
        <div className="app-container">
            <Sidebar />
            <div className="main-layout">
                <header className="header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Security Dashboard</h2>
                        <div className="live-badge">
                            <div className="pulse-dot" />
                            LIVE
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)', padding: '0.2rem 0.5rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <Clock size={10} />
                            Last sync: {lastUpdated.toLocaleTimeString()}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        {(isSuperAdmin || userRole === 'dashboard_manager') && (
                            <select
                                value={selectedTenant}
                                onChange={(e) => setSelectedTenant(e.target.value)}
                                style={{
                                    background: 'var(--bg-tertiary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '0.5rem 1rem',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.85rem',
                                    outline: 'none',
                                    minWidth: '180px'
                                }}
                            >
                                <option value="">All Tenants</option>
                                {tenants.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                            </select>
                        )}
                        <button
                            onClick={handleForceSync}
                            disabled={isSyncing}
                            style={{
                                background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-color)',
                                padding: '0.5rem 0.8rem',
                                borderRadius: 'var(--radius-md)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                fontSize: '0.8rem',
                                cursor: isSyncing ? 'wait' : 'pointer',
                                color: isSyncing ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            }}
                        >
                            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} /> Sync
                        </button>
                    </div>
                </header>

                {/* ── Tab Bar ── */}
                <div style={{
                    display: 'flex', gap: '0', borderBottom: '1px solid var(--border-color)',
                    padding: '0 2rem', background: 'var(--bg-secondary)',
                }}>
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '12px 20px',
                                fontSize: '0.85rem', fontWeight: activeTab === tab.key ? 700 : 500,
                                color: activeTab === tab.key ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                                background: 'transparent', border: 'none',
                                borderBottom: activeTab === tab.key ? '2px solid var(--accent-primary)' : '2px solid transparent',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                marginBottom: '-1px',
                            }}
                            onMouseOver={e => { if (activeTab !== tab.key) e.currentTarget.style.color = 'var(--text-secondary)'; }}
                            onMouseOut={e => { if (activeTab !== tab.key) e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </div>

                {/* ── Tab Content ── */}
                {activeTab === 'overview' ? (
                    <main className="content-area" style={{ gap: '1.5rem' }}>
                        {/* ── Row 1: KPI Cards ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
                            <KPICard
                                label="Total Incidents"
                                value={totalIncidents}
                                icon={<Layers size={22} />}
                                iconColor="var(--accent-primary)"
                                topBorder="var(--accent-primary)"
                            />
                            <KPICard
                                label="Critical"
                                value={summary.critical_count}
                                icon={<ShieldAlert size={22} />}
                                iconColor="var(--status-critical)"
                                topBorder="var(--status-critical)"
                                subtitle={`${criticalPercent}% of total`}
                            />
                            <KPICard
                                label="High Severity"
                                value={summary.high_count}
                                icon={<AlertTriangle size={22} />}
                                iconColor="var(--status-high)"
                                topBorder="var(--status-high)"
                                subtitle={`${highPercent}% of total`}
                            />
                            <KPICard
                                label="Open Cases"
                                value={openCases}
                                icon={<Eye size={22} />}
                                iconColor="var(--status-medium)"
                                topBorder="var(--status-medium)"
                                subtitle={`${summary.new_count} new`}
                            />
                            <KPICard
                                label="Last 24 Hours"
                                value={summary.last_24h}
                                icon={<Zap size={22} />}
                                iconColor="#a371f7"
                                topBorder="#a371f7"
                                subtitle={`${summary.last_7d} in 7 days`}
                            />
                        </div>

                        {/* ── Hero: Animated SOC Flow Pipeline ── */}
                        <SOCFlowHero stats={stats} tenants={tenants} tenantStats={tenantStats} />

                        {/* ── SLA Compliance Widget ── */}
                        {slaSummary && (
                            <div style={{
                                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                                borderRadius: '12px', padding: '1.25rem',
                                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: '8px',
                                        background: 'rgba(47,129,247,0.1)', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                    }}>
                                        <Clock size={18} color="#2f81f7" />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            SLA Compliance
                                        </div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                            {slaSummary.resolution_compliance_pct != null ? `${Math.round(slaSummary.resolution_compliance_pct)}%` : '—'}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg First Response</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {slaSummary.avg_first_response_min != null ? (slaSummary.avg_first_response_min < 60 ? `${Math.round(slaSummary.avg_first_response_min)}m` : `${Math.floor(slaSummary.avg_first_response_min / 60)}h ${Math.round(slaSummary.avg_first_response_min % 60)}m`) : '—'}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>FR Breaches</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: (slaSummary.first_response_breaches > 0) ? '#f85149' : '#3fb950' }}>
                                        {slaSummary.first_response_breaches ?? 0}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Res Breaches</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: (slaSummary.resolution_breaches > 0) ? '#f85149' : '#3fb950' }}>
                                        {slaSummary.resolution_breaches ?? 0}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Row 2: Severity + Status Donut Charts ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                            <ChartCard title="Severity Distribution" icon={<PieChartIcon size={16} />}>
                                {severityData.length > 0 ? (
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <ResponsiveContainer width="60%" height={220}>
                                            <PieChart>
                                                <Pie
                                                    data={severityData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={55}
                                                    outerRadius={85}
                                                    paddingAngle={3}
                                                    dataKey="value"
                                                    stroke="none"
                                                >
                                                    {severityData.map((entry, i) => (
                                                        <Cell key={i} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '0.8rem' }}
                                                    itemStyle={{ color: '#e6edf3' }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            {severityData.map((d, i) => (
                                                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color }} />
                                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{d.name}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{d.value}</span>
                                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                                                            {totalIncidents > 0 ? `${Math.round((d.value / totalIncidents) * 100)}%` : '0%'}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <EmptyChart />
                                )}
                            </ChartCard>

                            <ChartCard title="Incident Status" icon={<Activity size={16} />}>
                                {statusData.length > 0 ? (
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <ResponsiveContainer width="60%" height={220}>
                                            <PieChart>
                                                <Pie
                                                    data={statusData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={55}
                                                    outerRadius={85}
                                                    paddingAngle={3}
                                                    dataKey="value"
                                                    stroke="none"
                                                >
                                                    {statusData.map((entry, i) => (
                                                        <Cell key={i} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '0.8rem' }}
                                                    itemStyle={{ color: '#e6edf3' }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            {statusData.map((d, i) => (
                                                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color }} />
                                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{d.name}</span>
                                                    </div>
                                                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{d.value}</span>
                                                </div>
                                            ))}
                                            <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--bg-tertiary)', borderRadius: '6px', display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Total Open</span>
                                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{openCases}</span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <EmptyChart />
                                )}
                            </ChartCard>
                        </div>

                        {/* ── Row 3: Vendor Breakdown + Volume Stats ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.5rem' }}>
                            <ChartCard title="Incidents by Source" icon={<BarChart3 size={16} />}>
                                {vendorData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={Math.max(200, vendorData.length * 48)}>
                                        <BarChart data={vendorData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(48,54,61,0.5)" horizontal={false} />
                                            <XAxis type="number" tick={{ fill: '#7d8590', fontSize: 11 }} axisLine={{ stroke: '#30363d' }} />
                                            <YAxis
                                                dataKey="name"
                                                type="category"
                                                tick={{ fill: '#848d97', fontSize: 11, fontWeight: 600 }}
                                                axisLine={false}
                                                tickLine={false}
                                                width={100}
                                            />
                                            <Tooltip
                                                contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontSize: '0.8rem' }}
                                                itemStyle={{ color: '#e6edf3' }}
                                                cursor={{ fill: 'rgba(47, 129, 247, 0.05)' }}
                                            />
                                            <Bar dataKey="count" fill="#2f81f7" radius={[0, 6, 6, 0]} barSize={24} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <EmptyChart />
                                )}
                            </ChartCard>

                            <ChartCard title="Incident Volume" icon={<TrendingUp size={16} />}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.5rem 0' }}>
                                    {volumeData.map((item, i) => {
                                        const maxVal = Math.max(...volumeData.map(v => v.value), 1);
                                        const pctVal = Math.round((item.value / maxVal) * 100);
                                        return (
                                            <div key={i}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{item.name}</span>
                                                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{item.value}</span>
                                                </div>
                                                <div style={{ height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                                                    <div style={{
                                                        height: '100%',
                                                        width: `${pctVal}%`,
                                                        background: item.fill,
                                                        borderRadius: '4px',
                                                        transition: 'width 0.6s ease'
                                                    }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Severity Breakdown Bars */}
                                <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        Severity Breakdown
                                    </span>
                                    <div style={{ marginTop: '0.75rem' }}>
                                        {totalIncidents > 0 ? (
                                            <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', gap: '2px' }}>
                                                {[
                                                    { key: 'critical', count: summary.critical_count },
                                                    { key: 'high', count: summary.high_count },
                                                    { key: 'medium', count: summary.medium_count },
                                                    { key: 'low', count: summary.low_count },
                                                    { key: 'informational', count: summary.informational_count || 0 },
                                                ].filter(s => s.count > 0).map(s => (
                                                    <div
                                                        key={s.key}
                                                        title={`${s.key}: ${s.count}`}
                                                        style={{
                                                            flex: s.count,
                                                            background: SEVERITY_COLORS[s.key],
                                                            borderRadius: '2px',
                                                            minWidth: '4px',
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        ) : (
                                            <div style={{ height: '12px', borderRadius: '6px', background: 'var(--bg-tertiary)' }} />
                                        )}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                            {[
                                                { label: 'Critical', count: summary.critical_count, color: SEVERITY_COLORS.critical },
                                                { label: 'High', count: summary.high_count, color: SEVERITY_COLORS.high },
                                                { label: 'Medium', count: summary.medium_count, color: SEVERITY_COLORS.medium },
                                                { label: 'Low', count: summary.low_count, color: SEVERITY_COLORS.low },
                                                { label: 'Info', count: summary.informational_count || 0, color: SEVERITY_COLORS.informational },
                                            ].map(s => (
                                                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
                                                    <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{s.count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </ChartCard>
                        </div>

                        {/* ── Row 4: Threat Matrix + Quick Stats ── */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
                            <ThreatGauge
                                label="Critical Threat Level"
                                value={summary.critical_count}
                                total={totalIncidents}
                                color="var(--status-critical)"
                                description="Requires immediate response"
                            />
                            <ThreatGauge
                                label="Response Backlog"
                                value={openCases}
                                total={totalIncidents}
                                color="var(--status-medium)"
                                description="Cases awaiting action"
                            />
                            <ThreatGauge
                                label="24h Alert Rate"
                                value={summary.last_24h}
                                total={summary.last_7d || 1}
                                color="#a371f7"
                                description={`${summary.last_7d} incidents in last 7 days`}
                            />
                        </div>
                    </main>
                ) : activeTab === 'sla' ? (
                    <main className="content-area" style={{ padding: '0.5rem' }}>
                        <PremiumSLADashboard tenantId={selectedTenant} />
                    </main>
                ) : (
                    <main className="content-area" style={{ padding: '0.5rem' }}>
                         <CISODashboard tenantId={selectedTenant} />
                    </main>
                )}
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────
   Sub-Components
   ───────────────────────────────────────────── */

function SLAStatCard({ icon, label, value, subtitle, subtitleColor, valueColor }: {
    icon: React.ReactNode; label: string; value: string; subtitle: string;
    subtitleColor?: string; valueColor?: string;
}) {
    return (
        <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
            borderRadius: '12px', padding: '1.25rem',
            display: 'flex', flexDirection: 'column', gap: '8px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {icon}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {label}
                </span>
            </div>
            <span style={{ fontSize: '2rem', fontWeight: 800, color: valueColor || 'var(--text-primary)' }}>
                {value}
            </span>
            <span style={{ fontSize: '0.75rem', color: subtitleColor || 'var(--text-tertiary)' }}>
                {subtitle}
            </span>
        </div>
    );
}

function KPICard({ label, value, icon, iconColor, topBorder, subtitle }: {
    label: string; value: number; icon: React.ReactNode; iconColor: string;
    topBorder: string; subtitle?: string;
}) {
    return (
        <div
            className="liquid-glass"
            style={{
                padding: '1.25rem',
                transition: 'transform 0.2s, box-shadow 0.2s, border-color 0.2s',
            }}
            onMouseOver={e => {
                e.currentTarget.style.transform = 'translateY(-3px)';
                e.currentTarget.style.borderColor = topBorder;
            }}
            onMouseOut={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = '';
            }}
        >
            {/* Top colour accent bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: topBorder, zIndex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
                <div>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
                        {label}
                    </div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                        {value}
                    </div>
                    {subtitle && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '0.3rem' }}>{subtitle}</div>
                    )}
                </div>
                <div style={{
                    padding: '0.6rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-tertiary)',
                    color: iconColor,
                    display: 'flex',
                }}>
                    {icon}
                </div>
            </div>
        </div>
    );
}

function ChartCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="liquid-glass" style={{ padding: '1.25rem', transition: 'border-color 0.2s, box-shadow 0.2s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', position: 'relative', zIndex: 1 }}>
                <span style={{ color: 'var(--accent-primary)' }}>{icon}</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
            </div>
            <div style={{ position: 'relative', zIndex: 1 }}>
                {children}
            </div>
        </div>
    );
}

function ThreatGauge({ label, value, total, color, description }: {
    label: string; value: number; total: number; color: string; description: string;
}) {
    const percent = total > 0 ? Math.min(Math.round((value / total) * 100), 100) : 0;
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (percent / 100) * circumference;

    return (
        <div className="liquid-glass" style={{
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.75rem',
            transition: 'border-color 0.2s, box-shadow 0.2s',
        }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'relative', zIndex: 1 }}>
                {label}
            </span>
            <div style={{ position: 'relative', width: 110, height: 110, zIndex: 1 }}>
                <svg width="110" height="110" viewBox="0 0 110 110">
                    <circle cx="55" cy="55" r="45" fill="none" stroke="var(--bg-tertiary)" strokeWidth="8" />
                    <circle
                        cx="55" cy="55" r="45"
                        fill="none"
                        stroke={color}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        transform="rotate(-90 55 55)"
                        style={{ transition: 'stroke-dashoffset 0.8s ease' }}
                    />
                </svg>
                <div style={{
                    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center'
                }}>
                    <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{value}</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{percent}%</span>
                </div>
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textAlign: 'center', position: 'relative', zIndex: 1 }}>{description}</span>
        </div>
    );
}

function EmptyChart() {
    return (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
            No data available
        </div>
    );
}
