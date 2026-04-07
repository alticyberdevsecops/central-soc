'use client';

import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';
import { 
  Timer, AlertTriangle, CheckCircle, Clock, TrendingUp, 
  User, Shield, Zap, Search, Calendar, Filter, Share2, Download,
  ChevronRight, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { slaApi } from '@/lib/api';

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

interface PremiumSLADashboardProps {
  tenantId: string;
}

export default function PremiumSLADashboard({ tenantId }: PremiumSLADashboardProps) {
  const [summary, setSummary] = useState<any>(null);
  const [analysts, setAnalysts] = useState<any[]>([]);
  const [timeSeries, setTimeSeries] = useState<any[]>([]);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeMetric, setActiveMetric] = useState('mttr_resolution'); // 'mttd', 'mttr_response', 'mttr_resolution'

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchData = (isInitial = false) => {
    if (isInitial) setLoading(true);
    const params = tenantId ? { tenant_id: tenantId } : {};
    // Use allSettled so one failing endpoint doesn't block the others
    Promise.allSettled([
      slaApi.getSummary(params),
      slaApi.getAnalysts(params),
      slaApi.getTimeSeries({ ...params, days: 30 })
    ]).then(([sumRes, anlRes, tsRes]) => {
      if (sumRes.status === 'fulfilled') setSummary(sumRes.value);
      if (anlRes.status === 'fulfilled') setAnalysts(anlRes.value?.analysts || []);
      if (tsRes.status === 'fulfilled') setTimeSeries(tsRes.value?.series || []);
    }).finally(() => { if (isInitial) setLoading(false); });
  };

  useEffect(() => {
    if (mounted) {
      fetchData(true);
      const interval = setInterval(() => fetchData(false), 30000);
      return () => clearInterval(interval);
    }
  }, [tenantId, mounted]);

  if (!mounted || loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5rem', color: 'var(--text-tertiary)' }}>
        <div style={{ animation: 'spin 1s linear infinite', marginRight: '0.75rem' }}><Zap size={20} /></div>
        Loading Premium Dashboard...
      </div>
    );
  }

  const COLORS = ['#00C4B3', '#F04E23', '#7B68EE', '#FFB81C', '#FF5252'];

  // Distribution for Pie Chart
  const distributionData = [
    { name: 'Compliant', value: Math.max(0, (summary?.total_incidents || 0) - ((summary?.first_response_breaches || 0) + (summary?.resolution_breaches || 0))) },
    { name: 'FR Breaches', value: summary?.first_response_breaches || 0 },
    { name: 'Res Breaches', value: summary?.resolution_breaches || 0 },
  ].filter(d => d.value > 0);

  // If no data yet, show a placeholder for the pie chart
  if (distributionData.length === 0 && !loading) {
      distributionData.push({ name: 'No Data', value: 1 });
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '16px',
    padding: '1.25rem',
    position: 'relative',
    overflow: 'hidden',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease'
  };

  const bgIconStyle: React.CSSProperties = {
    position: 'absolute',
    top: '-10px',
    right: '-10px',
    opacity: 0.1,
    transform: 'rotate(-10deg)',
    pointerEvents: 'none'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ── Metric Cards ── */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
        gap: '1.25rem' 
      }}>
        {/* Compliance Card */}
        <div style={cardStyle}>
          <div style={bgIconStyle}><Shield size={80} color="#00C4B3" /></div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ padding: '0.4rem', background: 'rgba(0, 196, 179, 0.1)', borderRadius: '8px' }}>
                <Shield size={16} color="#00C4B3" />
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overall Compliance</span>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              {pct(summary?.resolution_compliance_pct)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.65rem', color: '#10b981', fontWeight: 700, background: 'rgba(16, 185, 129, 0.1)', width: 'fit-content', padding: '0.15rem 0.5rem', borderRadius: '12px' }}>
              <ArrowUpRight size={10} /> +2.4% vs last month
            </div>
          </div>
        </div>

        {/* MTTD Card */}
        <div style={cardStyle}>
          <div style={bgIconStyle}><Search size={80} color="#7B68EE" /></div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ padding: '0.4rem', background: 'rgba(123, 104, 238, 0.1)', borderRadius: '8px' }}>
                <Search size={16} color="#7B68EE" />
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg MTTD</span>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              {timeSeries.length > 0 ? fmtMin(timeSeries.reduce((acc, curr) => acc + (curr.mttd || 0), 0) / timeSeries.length) : '—'}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>Mean Time to Detect Threats</div>
          </div>
        </div>

        {/* MTTR Response Card */}
        <div style={cardStyle}>
          <div style={bgIconStyle}><Zap size={80} color="#FFB81C" /></div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ padding: '0.4rem', background: 'rgba(255, 184, 28, 0.1)', borderRadius: '8px' }}>
                <Zap size={16} color="#FFB81C" />
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg MTTR (Response)</span>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              {fmtMin(summary?.avg_first_response_min)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.65rem', color: '#f59e0b', fontWeight: 700, background: 'rgba(245, 158, 11, 0.1)', width: 'fit-content', padding: '0.15rem 0.5rem', borderRadius: '12px' }}>
              {summary?.first_response_breaches || 0} active breaches
            </div>
          </div>
        </div>

        {/* MTTR Resolve Card */}
        <div style={cardStyle}>
          <div style={bgIconStyle}><CheckCircle size={80} color="#F04E23" /></div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ padding: '0.4rem', background: 'rgba(240, 78, 35, 0.1)', borderRadius: '8px' }}>
                <CheckCircle size={16} color="#F04E23" />
              </div>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Avg MTTR (Resolve)</span>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              {fmtMin(summary?.avg_resolution_min)}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>{summary?.resolved || 0} total resolutions</div>
          </div>
        </div>
      </div>

      {/* ── Charts Section ── */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', 
        gap: '1.5rem' 
      }}>
        {/* Performance Trends */}
        <div style={{ ...cardStyle, gridColumn: 'span 2' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Performance Dynamics</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Real-time analysis of response and resolution velocity</p>
            </div>
            <div style={{ display: 'flex', background: 'var(--bg-primary)', padding: '4px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
              {[
                { id: 'mttd', label: 'MTTD', color: '#7B68EE' },
                { id: 'mttr_response', label: 'Respond', color: '#FFB81C' },
                { id: 'mttr_resolution', label: 'Resolve', color: '#F04E23' }
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setActiveMetric(m.id)}
                  style={{
                    padding: '0.4rem 1rem',
                    borderRadius: '8px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    background: activeMetric === m.id ? m.color : 'transparent',
                    color: activeMetric === m.id ? (m.id === 'mttr_response' ? '#000' : '#fff') : 'var(--text-secondary)'
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: '320px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeSeries} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="var(--text-tertiary)"
                  fontSize={10}
                  tickFormatter={(val) => val ? val.split('-').slice(1).join('/') : ''}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis stroke="var(--text-tertiary)" fontSize={10} axisLine={false} tickLine={false} unit="m" />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', color: 'var(--text-primary)' }}
                  formatter={(value: any) => [`${value}m`, activeMetric === 'mttd' ? 'MTTD' : activeMetric === 'mttr_response' ? 'Respond' : 'Resolve']}
                  labelFormatter={(label) => label ? `Date: ${label}` : ''}
                />
                <Bar
                  dataKey={activeMetric}
                  fill={activeMetric === 'mttd' ? '#7B68EE' : activeMetric === 'mttr_response' ? '#FFB81C' : '#F04E23'}
                  radius={[4, 4, 0, 0]}
                  animationDuration={800}
                >
                  <LabelList
                    dataKey={activeMetric}
                    position="insideTop"
                    offset={10}
                    formatter={(val: any) => val != null ? `${Math.round(val)}m` : ''}
                    style={{
                      fill: activeMetric === 'mttr_response' ? '#000' : '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Health Distribution */}
        <div style={{ ...cardStyle }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>SLA Health Distribution</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: '1.5rem' }}>Breakdown of compliant vs breached incidents</p>
          
          <div style={{ position: 'relative', height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distributionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={85}
                  paddingAngle={8}
                  dataKey="value"
                  animationDuration={1000}
                >
                  {distributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Healthy</span>
              <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-primary)' }}>{pct(summary?.resolution_compliance_pct)}</span>
            </div>
          </div>

          <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {distributionData.map((item, idx) => (
              <div key={item.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: COLORS[idx % COLORS.length] }}></div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{item.name}</span>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontWeight: 800 }}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Analyst Leaderboard ── */}
      <div className="table-container">
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>Team Velocity Leaderboard</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Top performing analysts across efficiency metrics</p>
          </div>
          <button style={{ 
            display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', 
            background: 'var(--bg-primary)', border: '1px solid var(--border-color)', 
            borderRadius: '10px', fontSize: '0.7rem', fontWeight: 700, 
            color: 'var(--text-secondary)', cursor: 'pointer' 
          }}>
            <Download size={14} /> Export Report
          </button>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table className="incident-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ padding: '1rem 1.5rem', textAlign: 'left' }}>Analyst</th>
                <th style={{ padding: '1rem 1.5rem', textAlign: 'left' }}>Velocity</th>
                <th style={{ padding: '1rem 1.5rem', textAlign: 'center' }}>Responded</th>
                <th style={{ padding: '1rem 1.5rem', textAlign: 'center' }}>Resolved</th>
                <th style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {analysts.map((a, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '1.25rem 1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                        {a.analyst_name ? a.analyst_name.charAt(0) : <User size={16} />}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>{a.analyst_name || a.analyst_email}</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>Security Analyst</span>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', width: '140px' }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 700 }}>FR: {fmtMin(a.avg_first_response_min)}</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 700 }}>RS: {fmtMin(a.avg_resolution_min)}</span>
                      </div>
                      <div style={{ width: '140px', height: '4px', background: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: '#00C4B3', width: `${pct(a.compliance_pct)}` }}></div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem', textAlign: 'center' }}>
                    <span style={{ padding: '0.2rem 0.6rem', borderRadius: '6px', background: 'var(--bg-tertiary)', fontSize: '0.75rem', fontWeight: 800 }}>{a.assigned_count}</span>
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem', textAlign: 'center' }}>
                    <span style={{ padding: '0.2rem 0.6rem', borderRadius: '6px', background: 'var(--bg-tertiary)', fontSize: '0.75rem', fontWeight: 800 }}>{a.resolved_count}</span>
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right' }}>
                    <span style={{ 
                      fontSize: '0.85rem', fontWeight: 900, 
                      color: a.compliance_pct >= 90 ? '#00C4B3' : a.compliance_pct >= 70 ? '#FFB81C' : '#F04E23' 
                    }}>
                      {pct(a.compliance_pct)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
