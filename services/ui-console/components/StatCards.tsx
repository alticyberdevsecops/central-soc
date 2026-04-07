'use client';

import { ShieldAlert, AlertTriangle, Activity, CheckCircle } from 'lucide-react';

export default function StatCards({ stats }: { stats: any }) {
    if (!stats) return null;

    const { summary } = stats;

    return (
        <div className="stat-card-grid">
            <StatCard
                label="Critical Threats"
                value={summary.critical_count}
                icon={<ShieldAlert size={28} style={{ color: 'var(--status-critical)' }} />}
                subtext="Requires Immediate Action"
                type="critical"
            />
            <StatCard
                label="Open Cases"
                value={summary.new_count + summary.triaging_count + summary.in_progress_count}
                icon={<AlertTriangle size={28} style={{ color: 'var(--status-medium)' }} />}
                subtext={`${summary.new_count} Unassigned`}
                type="warning"
            />
            <StatCard
                label="Last 24 Hours"
                value={summary.last_24h}
                icon={<Activity size={28} style={{ color: 'var(--status-info)' }} />}
                subtext="Total Alert Volume"
            />
            <StatCard
                label="High Priority"
                value={summary.high_count || 0}
                icon={<AlertTriangle size={28} style={{ color: 'var(--status-high)' }} />}
                subtext="Action Recommended"
                type="warning"
            />
        </div>
    );
}

function StatCard({ label, value, icon, subtext, type }: any) {
    return (
        <div className={`stat-card ${type || ''}`}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                    <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{value}</div>
                </div>
                <div style={{
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-tertiary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    {icon}
                </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--text-tertiary)' }} />
                {subtext}
            </div>
        </div>
    );
}
