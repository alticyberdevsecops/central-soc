'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  Shield, TrendingUp, Zap, Users, AlertTriangle, CheckCircle,
  Clock, ArrowUpRight, Activity, Globe, Database, Cloud,
  Fingerprint, ExternalLink, ChevronRight, Info, Search,
  Maximize2, Minimize2, Scale, Target, Cpu, Award, Crosshair, Lock, Briefcase, Download, X,
  UserX, Eye, GitBranch, HardDrive, ShieldCheck
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, LineChart, Line, ReferenceLine, PieChart, Pie
} from 'recharts';
import { xsiamApi } from '@/lib/api';

interface CISODashboardProps {
  tenantId: string;
}

/* ═══════════════════════════════════════════════════════════════
   EXTERNAL SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

const RiskScoreGauge = ({ score, level }: { score: number; level: string }) => {
  const needleRotation = (score / 15) * 180 - 90; // Scale 0-15 to -90 to +90 degrees
  const color = level === 'CRITICAL' ? '#f85149' : level === 'HIGH' ? '#d29922' : level === 'MEDIUM' ? '#e3b341' : '#3fb950';

  return (
    <div style={{ position: 'relative', width: '220px', height: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }}>
      {/* Gauge Background Arcs */}
      <svg width="200" height="100" viewBox="0 0 200 100">
        <path d="M20,100 A80,80 0 0,1 180,100" fill="none" stroke="var(--bg-tertiary)" strokeWidth="12" strokeLinecap="round" />
        {/* Segments */}
        <path d="M20,100 A80,80 0 0,1 60,35" fill="none" stroke="#3fb950" strokeWidth="12" strokeOpacity="0.2" />
        <path d="M60,35 A80,80 0 0,1 100,20" fill="none" stroke="#d29922" strokeWidth="12" strokeOpacity="0.2" />
        <path d="M100,20 A80,80 0 0,1 140,35" fill="none" stroke="#e07d1c" strokeWidth="12" strokeOpacity="0.2" />
        <path d="M140,35 A80,80 0 0,1 180,100" fill="none" stroke="#f85149" strokeWidth="12" strokeOpacity="0.2" />
      </svg>

      {/* Needle */}
      <div style={{
        position: 'absolute', bottom: '10px', left: '50%', width: '2px', height: '70px',
        background: 'var(--text-primary)', transformOrigin: 'bottom center',
        transform: `translateX(-50%) rotate(${needleRotation}deg)`,
        transition: 'transform 1.5s cubic-bezier(0.4, 0, 0.2, 1)',
        zIndex: 10, boxShadow: '0 0 10px rgba(0,0,0,0.5)'
      }}>
        <div style={{ position: 'absolute', top: '-5px', left: '-2px', width: '6px', height: '6px', background: 'var(--text-primary)', borderRadius: '50%' }} />
      </div>

      {/* Center Pivot */}
      <div style={{ position: 'absolute', bottom: '0', left: '50%', transform: 'translateX(-50%)', width: '16px', height: '8px', background: 'var(--bg-primary)', border: '2px solid var(--border-color)', borderBottom: 'none', borderRadius: '16px 16px 0 0', zIndex: 11 }} />

      {/* Score Text */}
      <div style={{ position: 'absolute', bottom: '25px', textAlign: 'center', zIndex: 5 }}>
        <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1 }}>{score.toFixed(1)}</div>
        <div style={{ fontSize: '0.6rem', fontWeight: 900, color, textTransform: 'uppercase', marginTop: '0.2rem' }}>{level} RISK</div>
      </div>

      {/* Labels */}
      <div style={{ position: 'absolute', width: '100%', display: 'flex', justifyContent: 'space-between', padding: '0 15px', bottom: '0', fontSize: '0.5rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
        <span>Low</span>
        <span>Med</span>
        <span>High</span>
        <span>Crit</span>
      </div>
    </div>
  );
};

const MITRE_TACTICS = [
  "Initial Access", "Execution", "Persistence", "Privilege Escalation",
  "Defense Evasion", "Credential Access", "Discovery", "Lateral Movement", 
  "Collection", "Exfiltration", "Command and Control", "Impact"
];

const MitreMatrix = ({ mitre, compact = false }: { mitre: any[]; compact?: boolean }) => {
  const tactics = compact ? MITRE_TACTICS.slice(0, 5) : MITRE_TACTICS;
  const maxCount = Math.max(...mitre.map((t: any) => t.count || 0), 1);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: compact ? 'repeat(5, 1fr)' : 'repeat(3, 1fr)',
      gap: '0.75rem',
      padding: '0.25rem 0'
    }}>
      {tactics.map((tactic) => {
        const found = mitre.find((t: any) =>
          (t.name || '').toLowerCase().includes(tactic.toLowerCase().split(' ')[0]) ||
          (t.tactic || '').toLowerCase().includes(tactic.toLowerCase().split(' ')[0])
        );
        const count = found?.count || 0;
        const intensity = count / maxCount;
        const color = intensity > 0.7 ? '#f85149' : intensity > 0.4 ? '#d29922' : intensity > 0.1 ? '#2f81f7' : '#3fb950';

        return (
          <div key={tactic} style={{
            background: count > 0 ? `${color}08` : 'var(--bg-tertiary)',
            border: `1px solid ${count > 0 ? `${color}30` : 'var(--border-subtle)'}`,
            borderRadius: '10px',
            padding: '0.8rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            minHeight: '80px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {count > 0 && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: color, opacity: 0.6 }} />}
            <div style={{ fontSize: '0.62rem', fontWeight: 900, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tactic}</div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: count > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)', opacity: count > 0 ? 1 : 0.3 }}>{count}</div>
              {count > 0 && (
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, boxShadow: `0 0 10px ${color}` }} />
                </div>
              )}
            </div>
            {found?.techniques && (
              <div style={{ fontSize: '0.55rem', color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: '2px' }}>{found.techniques.length} techniques detected</div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const AlertVolumeChart = ({ data, threshold }: { data: any[]; threshold: number }) => {
  const hasData = data.length > 0;
  return (
    <div style={{ height: '200px', width: '100%', position: 'relative' }}>
      {!hasData && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', zIndex: 10, color: 'var(--text-tertiary)', fontSize: '0.75rem', fontWeight: 700 }}>
          No alert volume data detected in this timeframe
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={hasData ? data : []}>
          <defs>
            <linearGradient id="colorAlert" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="date" stroke="var(--text-tertiary)" fontSize={10} />
          <YAxis stroke="var(--text-tertiary)" fontSize={10} />
          <Tooltip contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.75rem' }} />
          {threshold > 0 && hasData && (
            <ReferenceLine y={threshold} stroke="#f85149" strokeDasharray="5 5" label={{ value: `SPIKE: ${Math.round(threshold)}`, fill: '#f85149', fontSize: 10, position: 'right' }} />
          )}
          <Area type="monotone" dataKey="count" stroke="var(--accent-primary)" strokeWidth={2} fillOpacity={1} fill="url(#colorAlert)" name="Alert Count" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

const ThreatGeographyPanel = ({ intel, attackSurface }: { intel: any[]; attackSurface: any[] }) => {
  const countryMap: Record<string, number> = {};
  intel.forEach((item: any) => {
    const c = item.country || item.origin_country;
    if (c) countryMap[c] = (countryMap[c] || 0) + 1;
  });
  attackSurface.forEach((s: any) => {
    const c = s.country;
    if (c) countryMap[c] = (countryMap[c] || 0) + (s.alert_count || 1);
  });

  const entries = Object.entries(countryMap).sort(([, a], [, b]) => b - a).slice(0, 8);
  const displayData: [string, number][] = entries.map(([k, v]) => [k, v]);
  const isLive = displayData.length > 0;
  const maxVal = isLive ? displayData[0][1] : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
      {displayData.map(([country, count], i) => {
        const pct = (Number(count) / Number(maxVal)) * 100;
        // Threat levels: Extreme (>75%), High (>40%), Medium (>15%), Normal
        const level = pct > 80 ? 'EXTREME' : pct > 50 ? 'HIGH' : pct > 20 ? 'ELEVATED' : 'STABLE';
        const color = level === 'EXTREME' ? '#f85149' : level === 'HIGH' ? '#d29922' : level === 'ELEVATED' ? '#e3b341' : '#2f81f7';
        
        return (
          <div key={String(country)} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.2rem 0' }}>
            <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', width: '18px', textAlign: 'right', flexShrink: 0 }}>#{i + 1}</span>
            <div style={{ width: '100px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>{String(country)}</div>
            <div style={{ flex: 1, height: '14px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, opacity: 0.6, transition: 'width 1s ease' }} />
            </div>
            <div style={{ width: '45px', fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-tertiary)', textAlign: 'right', flexShrink: 0 }}>{Number(count).toLocaleString()}</div>
            <div style={{ width: '50px', fontSize: '0.5rem', fontWeight: 900, color, textAlign: 'center', padding: '0.1rem 0.3rem', background: `${color}15`, borderRadius: '4px', border: `1px solid ${color}30` }}>{level}</div>
          </div>
        );
      })}
      {!isLive && (
        <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textAlign: 'center', padding: '2rem 0', fontStyle: 'italic', border: '1px dashed var(--border-subtle)', borderRadius: '8px' }}>
          No geographic threat telemetry found for this tenant.<br/>
          <span style={{ fontSize: '0.55rem', opacity: 0.7 }}>Ensure XSIAM firewall/IDS logs are correctly ingested.</span>
        </div>
      )}
    </div>
  );
};

const CrownJewelAssets = ({ assets }: { assets: any[] }) => {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
      {(assets || []).map((asset, i) => (
        <div key={i} className="liquid-glass widget-hover" style={{ padding: '1rem', border: `1px solid ${asset.status === 'CRITICAL' ? '#f8514944' : 'var(--border-subtle)'}`, position: 'relative', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ padding: '0.4rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
              {asset.type === 'Database' ? <Database size={16} color="var(--accent-primary)" /> : asset.type === 'Identity' ? <Lock size={16} color="#d29922" /> : <Cpu size={16} color="#2f81f7" />}
            </div>
            <span style={{ fontSize: '0.55rem', fontWeight: 900, color: asset.status === 'CRITICAL' ? '#f85149' : asset.status === 'WARNING' ? '#d29922' : '#3fb950', textTransform: 'uppercase' }}>{asset.status}</span>
          </div>
          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{asset.name}</div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', marginBottom: '0.75rem' }}>{asset.type}</div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', marginBottom: '0.4rem' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Health Score</span>
            <span style={{ fontWeight: 900, color: asset.health_score > 90 ? '#3fb950' : asset.health_score > 70 ? '#d29922' : '#f85149' }}>{asset.health_score}%</span>
          </div>
          <div style={{ height: '4px', background: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${asset.health_score}%`, background: asset.health_score > 90 ? '#3fb950' : asset.health_score > 70 ? '#d29922' : '#f85149', transition: 'width 1.5s ease' }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const AutomationSavingsChart = ({ data }: { data: any[] }) => {
  return (
    <div style={{ height: '120px', width: '100%', marginTop: '1rem' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="date" hide />
          <YAxis hide />
          <Tooltip contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.65rem' }} />
          <Bar dataKey="count" fill="var(--accent-primary)" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fillOpacity={0.4 + (index / data.length) * 0.6} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

const PostureBar = ({ label, score, icon: Icon, color, onClick }: any) => (
  <div onClick={onClick} className="widget-hover" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem', cursor: onClick ? 'pointer' : 'default', padding: '0.5rem', borderRadius: '8px', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Icon size={14} color="var(--text-tertiary)" />
        <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        {onClick && <Download size={12} color="var(--text-tertiary)" style={{ opacity: 0.5 }} />}
        <span style={{ fontSize: '0.75rem', fontWeight: 900, color }}>{score}%</span>
      </div>
    </div>
    <div style={{ height: '6px', width: '100%', background: 'var(--bg-tertiary)', borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
      <div style={{ height: '100%', width: `${score}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}66`, transition: 'width 1.5s cubic-bezier(0.4, 0, 0.2, 1)' }} />
    </div>
  </div>
);

const KPICard = ({ label, value, icon: Icon, color, subtitle, onClick, trendData }: any) => (
  <div onClick={onClick} className="liquid-glass widget-hover" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '120px', position: 'relative', overflow: 'hidden', cursor: onClick ? 'pointer' : 'default', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
    {/* Background Trend Line */}
    {trendData && trendData.length > 0 && (
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '60px', opacity: 0.2, zIndex: 1, pointerEvents: 'none' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id={`color-${label.replace(/\s+/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                <stop offset="95%" stopColor={color} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fillOpacity={1} fill={`url(#color-${label.replace(/\s+/g, '')})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )}

    {/* Large Background Icon */}
    {!trendData && (
      <div style={{ position: 'absolute', top: '-10px', right: '-10px', opacity: 0.05, transform: 'rotate(-10deg)' }}>
        <Icon size={80} color={color} />
      </div>
    )}

    <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
      <div style={{ padding: '0.4rem', background: `${color}11`, borderRadius: '8px', border: `1px solid ${color}22` }}>
        <Icon size={18} color={color} />
      </div>
      {onClick ? <div style={{ fontSize: '0.55rem', fontWeight: 900, color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>DETAILS &gt;</div> : <Info size={12} color="var(--text-tertiary)" style={{ cursor: 'help' }} />}
    </div>
    <div style={{ position: 'relative', zIndex: 2, marginTop: '1rem' }}>
      <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '0.4rem' }}>{label}</div>
      {subtitle && <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>{subtitle}</div>}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   MAIN DASHBOARD COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function CISODashboard({ tenantId }: CISODashboardProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posture, setPosture] = useState<any>(null);
  const [vulns, setVulns] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [mitre, setMitre] = useState<any[]>([]);
  const [socPerformance, setSocPerformance] = useState<any>(null);
  const [riskyUsers, setRiskyUsers] = useState<any[]>([]);
  const [attackSurface, setAttackSurface] = useState<any[]>([]);
  const [intel, setIntel] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [activeQuery, setActiveQuery] = useState("");
  const [queryResults, setQueryResults] = useState<any[]>([]);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [queryTimeframe, setQueryTimeframe] = useState("24h");
  const [queryLimit, setQueryLimit] = useState(100);
  const [activeTemplate, setActiveTemplate] = useState<any>(null);
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [compliance, setCompliance] = useState<any>(null);
  const [benchmarks, setBenchmarks] = useState<any>(null);
  const [crownJewels, setCrownJewels] = useState<any>(null);
  const [threatTrends, setThreatTrends] = useState<any>(null);
  const [drillDownData, setDrillDownData] = useState<any[]>([]);
  const [drillDownTitle, setDrillDownTitle] = useState("");
  const [activeTab, setActiveTab] = useState("posture");
  const [drillDownType, setDrillDownType] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);
  const [hoveredChartIndex, setHoveredChartIndex] = useState<number | null>(null);
  const [globalTimeframe, setGlobalTimeframe] = useState("15d");
  // New state for spec features
  const [dataExfiltration, setDataExfiltration] = useState<any[]>([]);
  const [alertVolume, setAlertVolume] = useState<any[]>([]);
  const [noticePeriodUsers, setNoticePeriodUsers] = useState<any[]>([]);
  const [cloudExposure, setCloudExposure] = useState<any[]>([]);
  const [intelMatches, setIntelMatches] = useState<any>({ ipMatches: 0, domainMatches: 0, hashMatches: 0 });

  /* ── Inner Helper Components ── */

  const ComplianceGauge = ({ score, label }: { score: number; label: string }) => {
    const radius = 80;
    const circumference = Math.PI * radius;
    const strokeDashoffset = circumference - (score / 100) * circumference;
    const color = score > 85 ? '#3fb950' : score > 70 ? '#d29922' : '#f85149';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', height: '140px' }}>
        <svg width="200" height="120" viewBox="0 0 200 120">
          <path d="M20,100 A80,80 0 0,1 180,100" fill="none" stroke="var(--bg-tertiary)" strokeWidth="12" strokeLinecap="round" />
          <path d="M20,100 A80,80 0 0,1 180,100" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} style={{ transition: 'stroke-dashoffset 1.5s ease-out' }} />
        </svg>
        <div style={{ position: 'absolute', top: '50px', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--text-primary)' }}>{score}%</div>
          <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{label}</div>
        </div>
      </div>
    );
  };

  const DataDrivenHeatmap = () => {
    const grid: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const sevLabels = ['Low', 'Med', 'High', 'Crit'];
    const critLabels = ['Public', 'Internal', 'Confid.', 'Crown'];

    vulns.forEach((v: any) => {
      const score = v.severity_score || 0;
      const sevIdx = score >= 9 ? 3 : score >= 7 ? 2 : score >= 4 ? 1 : 0;
      const devices = v.device_count || 1;
      const critIdx = devices >= 100 ? 3 : devices >= 50 ? 2 : devices >= 10 ? 1 : 0;
      grid[sevIdx][critIdx]++;
    });

    const maxVal = Math.max(...grid.flat(), 1);

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', marginBottom: '4px', paddingLeft: '60px' }}>
          {critLabels.map(l => (
            <div key={l} style={{ flex: 1, fontSize: '0.55rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'center' }}>{l}</div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {sevLabels.map((sevLabel, si) => (
            <div key={sevLabel} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <div style={{ width: '58px', fontSize: '0.55rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'right', paddingRight: '6px' }}>{sevLabel}</div>
              {grid[si].map((val, ci) => {
                const intensity = val / maxVal;
                const color = (si + ci) >= 5 ? '#f85149' : (si + ci) >= 3 ? '#d29922' : '#3fb950';
                return (
                  <div key={ci} style={{
                    flex: 1, height: '36px', borderRadius: '4px',
                    background: val > 0 ? color : 'var(--bg-tertiary)',
                    opacity: val > 0 ? 0.3 + intensity * 0.7 : 0.3,
                    border: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.65rem', fontWeight: 800, color: val > 0 ? 'white' : 'var(--text-tertiary)',
                    transition: 'all 0.3s'
                  }}>
                    {val > 0 ? val : ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '60px', marginTop: '6px' }}>
          <span style={{ fontSize: '0.5rem', color: 'var(--text-tertiary)' }}>← Asset Criticality →</span>
          <span style={{ fontSize: '0.5rem', color: 'var(--text-tertiary)' }}>Vuln Severity ↑</span>
        </div>
      </div>
    );
  };

  const DetailGrid = ({ children }: { children: React.ReactNode }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
      {children}
    </div>
  );

  const ago = (ts: number | string) => {
    if (!ts) return 'Unknown';
    const timestamp = typeof ts === 'string' ? new Date(ts).getTime() : ts;
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const DetailItem = ({ label, value, fullWidth = false }: { label: string; value: any; fullWidth?: boolean }) => (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: '8px',
      padding: '0.75rem 1rem', gridColumn: fullWidth ? '1 / -1' : 'auto'
    }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all', lineHeight: 1.4 }}>{value || '—'}</div>
    </div>
  );

  const formatBytes = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  /* ── Utility Functions ── */

  const handleExportCSV = (data: any[], filename: string) => {
    if (!data || !data.length) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row =>
      Object.values(row).map(val => {
        let str = String(val);
        if (typeof val === 'object') str = JSON.stringify(val);
        return `"${str.replace(/"/g, '""')}"`;
      }).join(',')
    ).join('\n');
    const blob = new Blob([`${headers}\n${rows}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
  };

  const openDrillDown = async (title: string, data: any[], type: string = "generic") => {
    setDrillDownTitle(title);
    setDrillDownData(data);
    setDrillDownType(type);
    setSelectedEntity(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (type === "incident_detail" && data.length === 1) {
      try {
        const detail = await xsiamApi.getIncidentDetail(tenantId, data[0].id);
        setSelectedEntity(detail);
      } catch (err) {
        console.error("Failed to fetch incident extra details", err);
      }
    }
  };

  const closeDrillDown = () => {
    setDrillDownData([]);
    setDrillDownType(null);
    setSelectedEntity(null);
  };

  const openPerformanceDrillDown = (metric: string, label: string, data: any[], color: string, logic: string) => {
    setDrillDownTitle(label);
    setDrillDownData(data); // In this case, trend data
    setDrillDownType("performance_metric");
    setSelectedEntity({ metric, label, color, logic, current: data[data.length - 1]?.value });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openCalculationDrillDown = (title: string, formula: string, logic: string, sources: string[], inputs: any) => {
    setDrillDownTitle(title);
    setDrillDownType("calculation_detail");
    setSelectedEntity({ formula, logic, sources, inputs });
    setDrillDownData([{}]); // Dummy to satisfy visibility condition if I haven't updated it yet
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const updateQueryFilters = (query: string, timeframe: string, limit: number) => {
    let newQuery = query;
    if (!newQuery) return "";
    const limitRegex = /\|\s*limit\s+[^{|\s]+/gi;
    if (limitRegex.test(newQuery)) {
      newQuery = newQuery.replace(limitRegex, `| limit ${limit}`);
    } else {
      newQuery = newQuery.trim();
      if (newQuery) newQuery += ` | limit ${limit}`;
    }
    return newQuery;
  };

  const handleVarChange = (key: string, value: string) => {
    const newVars = { ...templateVars, [key]: value };
    setTemplateVars(newVars);
    if (activeTemplate) {
      let updatedXql = activeTemplate.xql;
      Object.entries(newVars).forEach(([k, v]) => {
        updatedXql = updatedXql.replace(new RegExp(`\\{${k}\\}`, 'g'), v || `{${k}}`);
      });
      setActiveQuery(updateQueryFilters(updatedXql, queryTimeframe, queryLimit));
    }
  };

  /* ── Computed values ── */

  const riskScore = useMemo(() => {
    const critCount = incidents.filter((x: any) => x.severity === 'critical').length || posture?.active_critical || 0;
    const highCount = incidents.filter((x: any) => x.severity === 'high').length;
    const medCount = incidents.filter((x: any) => x.severity === 'medium').length;
    const activeInc = incidents.length || posture?.total_active || 0;
    const exfilCount = dataExfiltration.length;
    
    // Crown Jewel Incidents logic: Any critical path with anomalous access > 0
    const cjIncidents = crownJewels?.critical_paths?.filter((x: any) => x.anomalous_access > 0).length || 0;
    
    // Section 7: Total Assets denominator from backend benchmark
    const totalAssets = benchmarks?.total_asset_count || attackSurface.length || 4850; 
    
    // Spec Formula: (Crit*5 + High*3 + Med*2 + Incid*4 + Exfil*6 + CrownJ*7) / totalAssets
    // Scaling by 1000 for visibility (since 10+ is critical per spec)
    const baseScore = (critCount * 5 + highCount * 3 + medCount * 2 + activeInc * 4 + exfilCount * 6 + cjIncidents * 7);
    return Math.min(15, (baseScore / totalAssets) * 100); 
  }, [incidents, posture, dataExfiltration, crownJewels, attackSurface, benchmarks]);

  const riskLevel = riskScore >= 10 ? 'CRITICAL' : riskScore >= 6 ? 'HIGH' : riskScore >= 3 ? 'MEDIUM' : 'LOW';

  const alertVolumeAvg = useMemo(() => {
    if (alertVolume.length === 0) return 0;
    return alertVolume.reduce((acc: number, b: any) => acc + (b.count || 0), 0) / alertVolume.length;
  }, [alertVolume]);

  const spikeThreshold = alertVolumeAvg * 2;
  const isSpikeDetected = alertVolume.length > 0 && (alertVolume[alertVolume.length - 1]?.count || 0) > spikeThreshold;

  /* ── Effects ── */

  useEffect(() => {
    if (activeQuery) {
      const nextQuery = updateQueryFilters(activeQuery, queryTimeframe, queryLimit);
      if (nextQuery !== activeQuery) setActiveQuery(nextQuery);
    }
  }, [queryTimeframe, queryLimit]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const p = await xsiamApi.getPosture(tenantId, globalTimeframe).catch(err => {
          console.error("Posture fetch failed:", err);
          return { error: err.message || "XSIAM Connectivity Issue" };
        });
        setPosture(p);

        if (p.error && (p.error.includes("Timed out") || p.error.includes("Not Configured"))) {
          setLoading(false);
          return;
        }

        const [v, i, m, perf] = await Promise.all([
          xsiamApi.getVulnerabilities(tenantId, globalTimeframe).catch(err => { console.warn("Vulns failed:", err); return { cves: [] }; }),
          xsiamApi.getIncidents(tenantId, globalTimeframe).catch(err => { console.warn("Incidents failed:", err); return { alerts: [] }; }),
          xsiamApi.getMitre(tenantId, globalTimeframe).catch(err => { console.warn("Mitre failed:", err); return { tactics: [] }; }),
          xsiamApi.getSocPerformance(tenantId, globalTimeframe).catch(err => { console.warn("Perf failed:", err); return {}; }),
        ]);
        setVulns(v?.cves || []);
        setIncidents(i?.alerts || []);
        setMitre(m?.tactics || []);
        setSocPerformance(perf);

        const [u, a, t, tmpl, comp, bench, cj, tr, exfil, vol, notice] = await Promise.all([
          xsiamApi.getRiskyUsers(tenantId, globalTimeframe).catch(err => { console.warn("Risky failed:", err); return { users: [] }; }),
          xsiamApi.getAttackSurface(tenantId, globalTimeframe).catch(err => { console.warn("Surface failed:", err); return { services: [] }; }),
          xsiamApi.getIntel(tenantId, globalTimeframe).catch(err => { console.warn("Intel failed:", err); return { feed: [] }; }),
          xsiamApi.getQueryTemplates(tenantId).catch(err => { console.warn("Templates failed:", err); return { templates: [] }; }),
          xsiamApi.getCompliance(tenantId, globalTimeframe).catch(() => null),
          xsiamApi.getBenchmarks(tenantId, globalTimeframe).catch(() => null),
          xsiamApi.getCrownJewels(tenantId, globalTimeframe).catch(() => null),
          xsiamApi.getThreatTrends(tenantId, globalTimeframe).catch(() => null),
          xsiamApi.getDataExfiltration(tenantId, globalTimeframe).catch(() => ({ events: [] })),
          xsiamApi.getAlertVolume(tenantId, globalTimeframe).catch(() => ({ bins: [] })),
          xsiamApi.getNoticePeriodUsers(tenantId, globalTimeframe).catch(() => ({ users: [] })),
        ]);
        setRiskyUsers(u?.users || []);
        setAttackSurface(a?.services || []);
        setIntel(t?.feed || []);
        setIntelMatches({
          ipMatches: t?.ipMatches || 0,
          domainMatches: t?.domainMatches || 0,
          hashMatches: t?.hashMatches || 0
        });
        setTemplates(tmpl?.templates || []);
        setCompliance(comp);
        setBenchmarks(bench);
        setCrownJewels(cj);
        setThreatTrends(tr);
        setDataExfiltration(exfil?.events || []);
        setAlertVolume(vol?.bins || []);
        setNoticePeriodUsers(notice?.users || []);
        
        // Map cloud exposure from attack surface or vulnerabilities for authenticity
        const cloudIssues = (a?.services || []).filter((s: any) => 
          (s.service_name || '').toLowerCase().includes('cloud') || 
          (s.service_name || '').toLowerCase().includes('bucket') ||
          (s.service_name || '').toLowerCase().includes('storage')
        ).map((s: any) => ({
          platform: s.origin || 'Cloud',
          resource: s.service_name,
          issue: 'Exposed Service / Potential Leak',
          original: s
        }));
        setCloudExposure(cloudIssues);
      } catch (error) {
        console.error('Failed to fetch CISO data', error);
        setPosture({ error: "Failed to communicate with SOC backend" });
      } finally {
        setLoading(false);
      }
    };
    if (tenantId && mounted) fetchAll();
  }, [tenantId, mounted, globalTimeframe]);

  /* ── Early Returns ── */

  if (!mounted) return null;

  if (!tenantId) {
    return (
      <div className="liquid-glass" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', padding: '3rem', textAlign: 'center' }}>
        <div style={{ padding: '1.25rem', background: 'var(--bg-tertiary)', borderRadius: '50%', marginBottom: '1.5rem', border: '1px solid var(--border-color)' }}>
          <Users size={40} color="var(--text-tertiary)" />
        </div>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
          No Tenant Selected
        </h3>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', maxWidth: '400px', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          The CISO Executive Dashboard requires a specific tenant context to pull high-fidelity security posture data from Palo Alto XSIAM.
        </p>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Please select a tenant from the dropdown above to begin.
        </span>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', gap: '1rem', color: 'var(--text-tertiary)' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid var(--accent-primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Syncing Executive Security Intelligence...</p>
          <p style={{ fontSize: '0.65rem', marginTop: '0.25rem' }}>Fetching posture, vulnerabilities, and threat data for {tenantId}. This may take a moment.</p>
        </div>
      </div>
    );
  }

  if (posture?.error) {
    const errorMsg = posture.error === 'Request timed out after 30 seconds'
      ? "The security data sync timed out while communicating with the XSIAM backend. The Palo Alto API may be experiencing high latency."
      : posture.error;

    return (
      <div className="liquid-glass" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '400px', padding: '3rem', textAlign: 'center' }}>
        <div style={{ padding: '1.25rem', background: 'var(--bg-tertiary)', borderRadius: '50%', marginBottom: '1.5rem', border: '1px solid var(--border-color)' }}>
          <Shield size={40} color="var(--status-critical)" />
        </div>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
          {posture.error === 'Request timed out after 30 seconds' ? "Sync Timeout" : "XSIAM Connectivity Issue"}
        </h3>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', maxWidth: '400px', marginBottom: '2rem', lineHeight: 1.6 }}>
          {errorMsg}
        </p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => window.location.href = '/connectors'} style={{ padding: '0.6rem 1.5rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 700, borderRadius: '10px', cursor: 'pointer' }}>
            Verify Config
          </button>
          <button onClick={() => window.location.reload()} style={{ padding: '0.6rem 1.5rem', background: 'var(--accent-primary)', border: 'none', color: 'white', fontSize: '0.8rem', fontWeight: 700, borderRadius: '10px', cursor: 'pointer' }}>
            Retry Sync
          </button>
        </div>
      </div>
    );
  }

  const handleRunQuery = async (queryStr: string) => {
    if (!queryStr) return;
    setQueryLoading(true);
    setQueryError("");
    setQueryResults([]);
    try {
      let finalQuery = queryStr;
      if (!finalQuery.includes('| limit')) finalQuery += ` | limit ${queryLimit}`;
      const res = await xsiamApi.runQuery(tenantId, finalQuery, queryTimeframe);
      if (res.error) setQueryError(res.error);
      else setQueryResults(res.results || []);
    } catch (err: any) {
      setQueryError(err.message || "Query failed");
    } finally {
      setQueryLoading(false);
    }
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '0.5rem' }}>

      {/* ── Global Threat Pulse (Ticker) ── */}
      <div style={{
        background: 'var(--ciso-pulse-red)',
        border: '1px solid var(--ciso-pulse-border)',
        borderRadius: '12px',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center'
      }}>
        <div style={{
          background: '#f85149', color: 'white', fontSize: '0.65rem', fontWeight: 900,
          padding: '0.6rem 1.25rem', zIndex: 10, display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap'
        }}>
          <Zap size={14} /> LIVE INTEL
        </div>
        <div style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', position: 'relative' }}>
          <div className="ticker-scroll" style={{ display: 'flex', gap: '3rem', padding: '0.6rem 2rem' }}>
            {(intel.length ? intel : [
              { source: "CISA", title: "New critical vulnerability in edge VPN appliances (CVE-2026-1029)", severity: "CRITICAL" },
              { source: "REUTERS", title: "Global shipping lanes face increased cyber disruption risk", severity: "HIGH" }
            ]).map((item: any, idx: number) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                <span style={{ color: item.severity === 'CRITICAL' ? '#f85149' : '#d29922' }}>●</span>
                <span style={{ color: 'var(--text-tertiary)', fontWeight: 800 }}>[{item.source}]</span>
                {item.title}
                <ArrowUpRight size={12} color="var(--text-tertiary)" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .ticker-scroll { animation: ticker 40s linear infinite; }
        .ticker-scroll:hover { animation-play-state: paused; }
      `}</style>

      {/* ── 6-Tab Navigation & Controls ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.25rem', overflowX: 'auto', flex: 1, paddingBottom: '2px' }}>
          {[
            { id: "posture", label: "Executive Overview", icon: Shield },
            { id: "threat_intel", label: "Threat Intelligence", icon: Globe },
            { id: "insider", label: "Insider Threat", icon: Fingerprint },
            { id: "data_security", label: "Data Security", icon: Database },
            { id: "risk", label: "Risk & Vulnerability", icon: Target },
            { id: "ops", label: "SOC Operations", icon: Activity },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                background: 'none', border: 'none', padding: '0.6rem 1rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative',
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontWeight: activeTab === tab.id ? 800 : 700, fontSize: '0.78rem',
                whiteSpace: 'nowrap', flexShrink: 0
              }}
            >
              <tab.icon size={15} color={activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-tertiary)'} />
              {tab.label}
              {activeTab === tab.id && (
                <div style={{ position: 'absolute', bottom: '-0.6rem', left: 0, right: 0, height: '3px', background: 'var(--accent-primary)', boxShadow: '0 0 10px var(--accent-primary)' }} />
              )}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingRight: '1rem', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-tertiary)', fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase' }}>
            <Clock size={14} /> Window
          </div>
          <select
            value={globalTimeframe}
            onChange={(e) => setGlobalTimeframe(e.target.value)}
            style={{
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)',
              fontSize: '0.75rem', fontWeight: 700, padding: '0.4rem 0.8rem', borderRadius: '8px', outline: 'none', cursor: 'pointer'
            }}
          >
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="15d">Last 15 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
         TAB 1 — EXECUTIVE OVERVIEW
         ══════════════════════════════════════════════════════════ */}
      {activeTab === "posture" && (
        <>
          {/* Risk Gauge + Posture Bars + KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: '1.5rem' }}>

            {/* Risk Score Gauge */}
            <div className="liquid-glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <h3 style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>ORGANIZATIONAL RISK SCORE</h3>
              <RiskScoreGauge score={riskScore} level={riskLevel} />
              <div style={{ fontSize: '0.55rem', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '0.25rem', lineHeight: 1.4 }}>
                (Crit×5 + High×3 + Med×2 + Incidents×4 + Exfil×6 + CJ×7) / Assets
              </div>
            </div>

            {/* Posture Score + Bars */}
            <div className="liquid-glass" style={{ padding: '1.5rem', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: '-20px', right: '-20px', opacity: 0.03, transform: 'rotate(-5deg)' }}>
                <Shield size={240} color="var(--accent-primary)" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', position: 'relative', zIndex: 2 }}>
                <div>
                  <h3 style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>SECURITY POSTURE INDEX</h3>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <span style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{posture?.posture_score || 0}%</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: (posture?.trend || '+0%').startsWith('-') ? '#f85149' : '#3fb950', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      <TrendingUp size={14} /> {posture?.trend || '+0.0%'}
                    </span>
                  </div>
                </div>
                <div style={{
                  padding: '0.3rem 0.8rem', borderRadius: '20px', fontSize: '0.6rem', fontWeight: 900,
                  background: (posture?.posture_score || 0) > 80 ? 'rgba(63,185,80,0.1)' : 'rgba(210,153,34,0.1)',
                  color: (posture?.posture_score || 0) > 80 ? '#3fb950' : '#d29922',
                  border: `1px solid ${(posture?.posture_score || 0) > 80 ? '#3fb95033' : '#d2992233'}`,
                  textTransform: 'uppercase'
                }}>
                  {(posture?.posture_score || 0) > 80 ? 'RESILIENT' : 'MODERATE RISK'}
                </div>
              </div>
              <div style={{ position: 'relative', zIndex: 2 }}>
                {(posture?.components || [
                  { name: "Incident Response", score: 85, weight: "25%" },
                  { name: "Vulnerability Exposure", score: 72, weight: "20%" },
                  { name: "Detection Coverage", score: 94, weight: "15%" },
                  { name: "Response Speed", score: 82, weight: "15%" },
                  { name: "Current Exposure", score: 78, weight: "10%" },
                  { name: "User Risk", score: 88, weight: "15%" }
                ]).map((comp: any, idx: number) => (
                  <PostureBar
                    key={idx}
                    label={comp.name}
                    score={comp.score}
                    icon={idx === 0 ? Zap : idx === 1 ? AlertTriangle : idx === 2 ? Globe : idx === 3 ? Clock : idx === 4 ? Activity : Fingerprint}
                    color={idx === 0 ? "#d29922" : idx === 1 ? "#f85149" : idx === 2 ? "#3fb950" : idx === 3 ? "#2f81f7" : idx === 4 ? "#db61a2" : "#e3b341"}
                    onClick={() => openDrillDown(`${comp.name} Drill-Down`, [], "posture_component")}
                  />
                ))}
              </div>
            </div>

            {/* KPI Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <KPICard 
                label="Avg MTT-Detection" 
                value={`${socPerformance?.avg_mttd_min || 0}m`} 
                icon={Zap} 
                color="#2f81f7" 
                subtitle={`Sync: Last ${globalTimeframe}`} 
                trendData={socPerformance?.daily_mttd}
                onClick={() => openPerformanceDrillDown("MTTD", "MTT-Detection", socPerformance?.daily_mttd || [], "#2f81f7", "MTT-Detection = Avg time from incident creation to initial security analyst investigation/triage.")}
              />
              <KPICard 
                label="Avg MTT-Resolution" 
                value={`${socPerformance?.avg_mttr_min || 0}m`} 
                icon={Clock} 
                color="#3fb950" 
                subtitle={`Window: Last ${globalTimeframe}`} 
                trendData={socPerformance?.daily_mttr}
                onClick={() => openPerformanceDrillDown("MTTR", "MTT-Resolution", socPerformance?.daily_mttr || [], "#3fb950", "MTT-Resolution = Avg time from incident creation to the 'Resolved' status timestamp.")}
              />
              <KPICard label="SLA Compliance" value={`${socPerformance?.sla_compliance || 0}%`} icon={CheckCircle} color="#db61a2" subtitle="Target: 98%" onClick={() => openDrillDown("SLA Tracked Status", incidents.filter((x: any) => x.severity === 'critical'))} />
              <KPICard label="SLA Breaches" value={posture?.sla_breaches || 0} icon={AlertTriangle} color="#f85149" subtitle="Critical Fix Required" onClick={() => openDrillDown("SLA Breaches Queue", incidents.filter((x: any) => x.severity === 'critical'))} />
            </div>
          </div>

          {/* Secondary Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <div className="liquid-glass widget-hover" style={{ padding: '1rem', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => openDrillDown("Critical Incidents", incidents.filter((x: any) => x.severity === 'critical'))}>
              <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Active Critical</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#f85149', marginTop: '0.4rem' }}>{posture?.active_critical || 0}</div>
            </div>
            <div className="liquid-glass widget-hover" style={{ padding: '1rem', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => openDrillDown("All Active Alerts", incidents)}>
              <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Open Alerts</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '0.4rem' }}>{posture?.total_active || 0}</div>
            </div>
            <div className="liquid-glass widget-hover" style={{ padding: '1rem', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => openDrillDown("Tier-1 Intel Feed", intel.filter((x: any) => x.tier === 1))}>
              <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Threat Intel Tier-1</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#2f81f7', marginTop: '0.4rem' }}>{intel.filter((x: any) => x.tier === 1).length}</div>
            </div>
            <div className="liquid-glass widget-hover" style={{ padding: '1rem', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => openDrillDown("Risky Identities", riskyUsers)}>
              <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Risky Identities</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#d29922', marginTop: '0.4rem' }}>{riskyUsers.length}</div>
            </div>
          </div>

          {/* Threat Trends */}
          {threatTrends && (
            <div className="liquid-glass widget-hover" style={{ padding: '1.5rem', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => openDrillDown("Global Threat Timeseries", threatTrends.trends, "threat_trend")}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Globe size={16} color="var(--status-critical)" /> Global Threat Impact: {threatTrends.event_name}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid rgba(63,185,80,0.3)', background: 'rgba(63,185,80,0.05)', padding: '0.2rem 0.6rem', borderRadius: '12px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3fb950', boxShadow: '0 0 6px #3fb950' }} />
                    <span style={{ fontSize: '0.55rem', fontWeight: 900, color: '#3fb950' }}>LIVE XSIAM SYNC</span>
                  </div>
                </h3>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: '#f85149', fontWeight: 800 }}>GEOPOLITICAL SPIKE DETECTED</span>
                  <Download size={14} color="var(--text-tertiary)" />
                </div>
              </div>
              <div style={{ height: '220px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={threatTrends.trends}>
                    <defs>
                      <linearGradient id="colorSpike" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f85149" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#f85149" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="time" stroke="var(--text-tertiary)" fontSize={10} tickMargin={10} minTickGap={20} />
                    <YAxis stroke="var(--text-tertiary)" fontSize={10} />
                    <Tooltip contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.75rem' }} itemStyle={{ color: 'var(--text-primary)', fontWeight: 800 }} />
                    <Area type="monotone" dataKey="firewall_blocks" stroke="#f85149" strokeWidth={2} fillOpacity={1} fill="url(#colorSpike)" name="Firewall Drops/Spikes" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Compact MITRE + Risky Users side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem' }}>
            {mitre.length > 0 && (
              <div className="liquid-glass widget-hover" style={{ padding: '1.5rem', cursor: 'pointer' }} onClick={() => openDrillDown("MITRE Tactic Coverage", mitre, "mitre")}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <Target size={16} color="var(--accent-primary)" /> MITRE ATT&CK Coverage
                  </h3>
                  <Download size={14} color="var(--text-tertiary)" />
                </div>
                <MitreMatrix mitre={mitre} compact />
              </div>
            )}

            {/* Risky Users */}
            <div className="liquid-glass widget-hover" style={{ overflow: 'hidden', cursor: 'pointer' }} onClick={() => openDrillDown("Risky Users Analysis", riskyUsers, "user_risk")}>
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Users size={16} color="var(--accent-primary)" /> RISKY USERS
                  <span style={{ fontSize: '0.6rem', fontWeight: 900, padding: '0.15rem 0.5rem', borderRadius: '20px', background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
                    {riskyUsers.length} FLAGGED
                  </span>
                </h3>
                <Download size={14} color="var(--text-tertiary)" onClick={(e) => { e.stopPropagation(); handleExportCSV(riskyUsers, 'risky_users'); }} />
              </div>
              <div style={{ padding: '0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 80px', gap: '0', fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.01)' }}>
                  <span>User Identity</span>
                  <span style={{ textAlign: 'center' }}>Tier</span>
                  <span style={{ textAlign: 'center' }}>Last Active</span>
                  <span style={{ textAlign: 'right' }}>Risk Score</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '320px', overflowY: 'auto' }}>
                  {riskyUsers.length > 0 ? riskyUsers.slice(0, 6).map((u: any, idx: number) => {
                    const score = u.score || 0;
                    const tier = u.tier || 'Watch';
                    const tierColor = u.tier_color || '#718096';
                    return (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 80px', gap: '0', alignItems: 'center', padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.12s', cursor: 'pointer' }} className="row-hover" onClick={(e) => { e.stopPropagation(); openDrillDown(`User Risk: ${u.user}`, [u], "user_risk"); setSelectedEntity(u); }}>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {u.leaked && <AlertTriangle size={12} color="#f85149" />}
                            {u.user}
                          </div>
                          <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {(u.drivers || []).join(' • ')}
                          </div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <span style={{ background: `${tierColor}18`, color: tierColor, border: `1px solid ${tierColor}33`, borderRadius: '12px', padding: '0.2rem 0.6rem', fontSize: '0.62rem', fontWeight: 800, whiteSpace: 'nowrap' }}>{tier.toUpperCase()}</span>
                        </div>
                        <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{u.last_seen ? ago(u.last_seen) : '—'}</div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <div style={{ width: '40px', height: '4px', background: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                              <div style={{ width: `${score}%`, height: '100%', background: tierColor, boxShadow: `0 0 6px ${tierColor}44` }} />
                            </div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 900, color: tierColor, minWidth: '22px' }}>{score}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.75rem', padding: '2rem' }}>
                      <Users size={32} style={{ opacity: 0.1, marginBottom: '0.75rem' }} />
                      <div>No identity risk signals detected.</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Executive Row: Compliance, Benchmarks, Crown Jewels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {/* Compliance */}
            <div className="liquid-glass widget-hover" style={{ padding: '1.5rem', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => compliance && openDrillDown("Compliance Drift Raw Log", incidents.filter((x: any) => x.severity === 'high' || x.severity === 'critical'))}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Scale size={16} color="var(--accent-primary)" /> Regulatory Compliance
                </h3>
                <Download size={14} color="var(--text-tertiary)" />
              </div>
              {compliance ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {compliance.frameworks.slice(0, 3).map((f: any, idx: number) => (
                    <div key={idx}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{f.name}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 900, color: f.score >= 90 ? '#3fb950' : '#d29922' }}>{f.score}%</span>
                      </div>
                      <div style={{ height: '4px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${f.score}%`, background: f.score >= 90 ? '#3fb950' : '#d29922' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>Syncing compliance stats...</div>}
            </div>

            {/* Benchmarks */}
            <div className="liquid-glass widget-hover" style={{ padding: '1.5rem', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => benchmarks && openDrillDown("Peer Benchmark Incident Logs", incidents)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Award size={16} color="var(--accent-primary)" /> Industry Benchmark
                </h3>
                <Download size={14} color="var(--text-tertiary)" />
              </div>
              {benchmarks ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>Threat Percentile</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--text-primary)' }}>{benchmarks.industry_comparison.company_percentile}th</div>
                  </div>
                  <div style={{ height: '1px', background: 'var(--border-subtle)' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>Auto-Remediation</div>
                      <div style={{ fontSize: '1rem', fontWeight: 900, color: '#3fb950' }}>{benchmarks.soc_efficiency.auto_remediated_percent}%</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>ROI Hours</div>
                      <div style={{ fontSize: '1rem', fontWeight: 900, color: '#2f81f7' }}>{benchmarks.soc_efficiency.automation_hours_saved_weekly}h</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>Syncing peer data...</div>
              )}
            </div>

            {/* Crown Jewel Readiness */}
            <div className="liquid-glass widget-hover" style={{ padding: '1.5rem', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => openDrillDown("Crown Jewel Asset Health", crownJewels?.critical_paths || [], "crown_jewels")}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Briefcase size={16} color="var(--accent-primary)" /> Crown Jewel Exposure
                </h3>
              </div>
              <CrownJewelAssets assets={crownJewels?.critical_paths || []} />
            </div>
          </div>

          {/* Attack Surface + XQL Console */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem' }}>
            <div className="liquid-glass widget-hover" style={{ padding: '1.5rem', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => openDrillDown("Global Attack Surface Trace", attackSurface)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Globe size={16} color="var(--accent-primary)" /> Global Attack Surface Exposure
                </h3>
                <Download size={14} color="var(--text-tertiary)" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {attackSurface.length > 0 ? attackSurface.slice(0, 5).map((s, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.8rem 1rem', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f85149', boxShadow: '0 0 5px #f85149' }}></div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{s.action_external_hostname || 'Unmapped Asset'}</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{s.action_local_ip || 'Internal Node'}</span>
                      </div>
                    </div>
                    <span style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-secondary)', padding: '0.2rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                      {s.alert_count || s.access_count} HITs
                    </span>
                  </div>
                )) : (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>No anomalous exposure detected</div>
                )}
              </div>
            </div>

            {/* XQL Console */}
            <div className={`liquid-glass ${isFullscreen ? 'fullscreen-console' : ''}`}
              style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--ciso-console-bg)', transition: 'all 0.3s', zIndex: isFullscreen ? 1000 : 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <Database size={16} color="var(--accent-primary)" />
                    <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)' }}>XSIAM Direct Query Engine</h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <select value={activeTemplate?.id || ""} onChange={(e) => {
                      const t = templates.find((x: any) => x.id === e.target.value);
                      if (t) {
                        setActiveTemplate(t);
                        const newVars: Record<string, string> = {};
                        if (t.vars) t.vars.forEach((v: any) => { newVars[v.key] = v.default || ""; });
                        setTemplateVars(newVars);
                        if (!t.vars || t.vars.length === 0) {
                          const filteredQuery = updateQueryFilters(t.xql, queryTimeframe, queryLimit);
                          setActiveQuery(filteredQuery);
                          handleRunQuery(filteredQuery);
                        } else {
                          let queryWithVars = t.xql;
                          Object.entries(newVars).forEach(([k, v]) => { queryWithVars = queryWithVars.replace(new RegExp(`\\{${k}\\}`, 'g'), v || `{${k}}`); });
                          setActiveQuery(updateQueryFilters(queryWithVars, queryTimeframe, queryLimit));
                        }
                      } else { setActiveTemplate(null); setTemplateVars({}); }
                    }} style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.65rem', padding: '0.3rem 0.6rem', fontWeight: 700, outline: 'none', maxWidth: '300px' }}>
                      <option value="">Select Template...</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid var(--border-color)', padding: '0 0.5rem' }}>
                      <Clock size={12} color="var(--text-tertiary)" style={{ marginRight: '0.25rem' }} />
                      <select value={queryTimeframe} onChange={(e) => setQueryTimeframe(e.target.value)} style={{ background: 'none', color: 'var(--text-secondary)', border: 'none', fontSize: '0.65rem', padding: '0.3rem 0', fontWeight: 700, outline: 'none', cursor: 'pointer' }}>
                        <option value="24h">Last 24 Hours</option><option value="7d">Last 7 Days</option><option value="15d">Last 15 Days</option><option value="30d">Last 30 Days</option><option value="90d">Last 90 Days</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-tertiary)', borderRadius: '6px', border: '1px solid var(--border-color)', padding: '0 0.5rem' }}>
                      <select value={queryLimit} onChange={(e) => setQueryLimit(parseInt(e.target.value))} style={{ background: 'none', color: 'var(--text-secondary)', border: 'none', fontSize: '0.65rem', padding: '0.3rem 0', fontWeight: 700, outline: 'none', cursor: 'pointer' }}>
                        <option value="50">Limit 50</option><option value="100">Limit 100</option><option value="200">Limit 200</option><option value="500">Limit 500</option>
                      </select>
                    </div>
                    <button onClick={() => setIsFullscreen(!isFullscreen)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '0.2rem' }} title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Mode"}>
                      {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </div>
                </div>
                {activeTemplate && activeTemplate.vars && activeTemplate.vars.length > 0 && (
                  <div style={{ padding: '0.75rem 0 0 0', display: 'flex', gap: '1rem', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    {activeTemplate.vars.map((v: any) => (
                      <div key={v.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{v.label}:</label>
                        {v.type === 'select' ? (
                          <select value={templateVars[v.key] || ""} onChange={(e) => handleVarChange(v.key, e.target.value)} style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.7rem', padding: '0.3rem 0.5rem', outline: 'none' }}>
                            <option value="">Select...</option>
                            {v.options?.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                          </select>
                        ) : (
                          <input type={v.type === 'number' ? 'number' : 'text'} placeholder={v.placeholder || ""} value={templateVars[v.key] || ""} onChange={(e) => handleVarChange(v.key, e.target.value)} style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.7rem', padding: '0.3rem 0.5rem', outline: 'none', minWidth: '150px' }} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <textarea value={activeQuery} onChange={(e) => setActiveQuery(e.target.value)} placeholder="Enter XQL query here... (e.g. dataset = xdr_data | limit 10)"
                  style={{ width: '100%', minHeight: isFullscreen ? '150px' : '100px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem', color: 'var(--ciso-code-text)', fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical', outline: 'none', transition: 'min-height 0.3s' }} />
                <button onClick={() => handleRunQuery(activeQuery)} disabled={queryLoading}
                  style={{ position: 'absolute', bottom: '15px', right: '15px', padding: '0.5rem 1.25rem', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(47,129,247,0.3)' }}>
                  {queryLoading ? 'EXECUTING...' : <><Zap size={14} fill="currentColor" /> RUN XQL</>}
                </button>
              </div>
              <div className="custom-scrollbar" style={{ flex: 1, minHeight: '200px', maxHeight: isFullscreen ? 'calc(100vh - 350px)' : '300px', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-subtle)', overflow: 'auto', padding: '0.5rem' }}>
                {queryError && <div style={{ color: '#f85149', fontSize: '0.75rem', padding: '1.5rem', background: 'rgba(248,81,73,0.1)', borderRadius: '8px', margin: '0.5rem' }}>Error: {queryError}</div>}
                {!queryResults.length && !queryLoading && !queryError && <div style={{ color: 'var(--text-tertiary)', fontSize: '0.7rem', textAlign: 'center', marginTop: '4rem' }}>Select a template or enter XQL to analyze live telemetry</div>}
                {queryResults.length > 0 && (
                  <div style={{ minWidth: 'max-content' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--ciso-console-bg)', zIndex: 10 }}>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          {Object.keys(queryResults[0]).map(k => (
                            <th key={k} style={{ textAlign: 'left', padding: '1rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {queryResults.map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.1s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'} onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>
                            {Object.values(r).map((v: any, j) => (
                              <td key={j} style={{ padding: '0.8rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'normal', wordBreak: 'break-word', maxWidth: '500px' }}>{String(v)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Active Alerts Table */}
          <div className="liquid-glass widget-hover" style={{ overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => openDrillDown("Full XSIAM Active Alerts", incidents)}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Activity size={16} color="var(--accent-primary)" /> Palo Alto XSIAM Active Alerts
              </h3>
              <Search size={14} color="var(--text-tertiary)" style={{ cursor: 'pointer' }} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
                    {['Severity', 'Incident Name', 'Host / Entity', 'Time'].map(h => (
                      <th key={h} style={{ padding: '1rem 1.5rem', textAlign: h === 'Time' ? 'right' : 'left', fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {incidents.slice(0, 8).map((inc: any, i: number) => (
                    <tr key={i} onClick={(e) => { e.stopPropagation(); openDrillDown(`Incident Investigation: ${inc.id || inc.name}`, [inc], "incident_detail"); }}
                      style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.2s', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <div style={{ display: 'inline-flex', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 900, background: inc.severity === 'critical' ? 'rgba(248,81,73,0.1)' : 'rgba(210,153,34,0.1)', color: inc.severity === 'critical' ? '#f85149' : '#d29922' }}>
                          {inc.severity?.toUpperCase()}
                        </div>
                      </td>
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{inc.name}</div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>{inc.source}</div>
                      </td>
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Globe size={12} color="var(--text-tertiary)" /> {inc.host || 'External Asset'}
                        </div>
                      </td>
                      <td style={{ padding: '1rem 1.5rem', textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {inc.ts ? new Date(inc.ts).toLocaleTimeString() : 'N/A'}
                      </td>
                    </tr>
                  ))}
                  {incidents.length === 0 && <tr><td colSpan={4} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>No active security alerts pending</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
         TAB 2 — THREAT INTELLIGENCE
         ══════════════════════════════════════════════════════════ */}
      {activeTab === "threat_intel" && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1.5rem' }}>
            {/* MITRE ATT&CK Full Matrix */}
            <div className="liquid-glass" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Target size={18} color="#f85149" /> MITRE ATT&CK Tactic Heatmap
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', fontWeight: 700 }}>9 TACTICS TRACKED</span>
                  <Download size={14} color="var(--text-tertiary)" style={{ cursor: 'pointer' }} onClick={() => handleExportCSV(mitre, 'mitre_tactics')} />
                </div>
              </div>
              <MitreMatrix mitre={mitre} />
              {mitre.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                  No MITRE ATT&CK data available in the selected timeframe. Check XSIAM connector.
                </div>
              )}
            </div>

            {/* Threat Geography */}
            <div className="liquid-glass" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Globe size={18} color="#d29922" /> Threat Origin Geography
                </h3>
                <Download size={14} color="var(--text-tertiary)" />
              </div>
              <ThreatGeographyPanel intel={intel} attackSurface={attackSurface} />
            </div>
          </div>

          {/* Top Attack Techniques */}
          {mitre.length > 0 && (
            <div className="liquid-glass widget-hover" style={{ padding: '1.5rem', cursor: 'pointer' }} onClick={() => openDrillDown("Top Attack Techniques", mitre, "mitre")}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Crosshair size={16} color="var(--accent-primary)" /> Top Attack Techniques (Last {globalTimeframe})
                </h3>
                <Download size={14} color="var(--text-tertiary)" />
              </div>
              <div style={{ height: '220px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mitre} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" stroke="var(--text-tertiary)" fontSize={10} width={120} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.75rem' }} />
                    <Bar dataKey="count" fill="var(--accent-primary)" radius={[0, 4, 4, 0]}>
                      {mitre.map((entry, index) => (
                        <Cell key={`cell-${index}`} fillOpacity={0.8} fill={index === 0 ? '#f85149' : index < 3 ? '#d29922' : 'var(--accent-primary)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Threat Actor / Intel Correlation */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="liquid-glass" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Eye size={16} color="var(--accent-primary)" /> Threat Actor Mapping
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {(intel.length > 0 ? intel.slice(0, 6) : []).map((item: any, idx: number) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.7rem 0.8rem', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0 }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)' }}>Source: {item.source} {item.country ? `• ${item.country}` : ''}</span>
                    </div>
                    <span style={{ fontSize: '0.58rem', fontWeight: 900, padding: '0.15rem 0.4rem', borderRadius: '4px', background: item.severity === 'CRITICAL' ? 'rgba(248,81,73,0.1)' : 'rgba(210,153,34,0.1)', color: item.severity === 'CRITICAL' ? '#f85149' : '#d29922', flexShrink: 0 }}>{item.severity}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="liquid-glass" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Search size={16} color="var(--accent-primary)" /> Intel Correlation Summary
                </h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                {[
                  { label: 'IP Matches', value: intelMatches.ipMatches, color: '#f85149', icon: Globe },
                  { label: 'Domain Matches', value: intelMatches.domainMatches, color: '#d29922', icon: ExternalLink },
                  { label: 'Hash Matches', value: intelMatches.hashMatches, color: '#2f81f7', icon: Fingerprint },
                ].map((m, i) => (
                  <div key={i} style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                    <m.icon size={20} color={m.color} style={{ opacity: 0.5, marginBottom: '0.5rem' }} />
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: m.color }}>{m.value}</div>
                    <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginTop: '0.2rem' }}>{m.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(47,129,247,0.05)', border: '1px solid rgba(47,129,247,0.2)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#2f81f7' }}>CORRELATION SOURCES</div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', marginTop: '0.3rem' }}>VirusTotal • AlienVault OTX • AbuseIPDB • MISP • Cortex XSIAM Native</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
         TAB 3 — INSIDER THREAT
         ══════════════════════════════════════════════════════════ */}
      {activeTab === "insider" && (
        <>
          {/* UEBA Risk Leaderboard */}
          <div className="liquid-glass" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Users size={16} color="#f85149" /> UEBA Risk Leaderboard
                <span style={{ fontSize: '0.55rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '12px', background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.2)' }}>
                  User Risk = (Login×2) + (Download×1.5) + (PrivEsc×3) + (Exfil×4) + (Sensitive×2)
                </span>
              </h3>
              <Download size={14} color="var(--text-tertiary)" style={{ cursor: 'pointer' }} onClick={() => handleExportCSV(riskyUsers, 'ueba_leaderboard')} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
                    {['User', 'Risk Score', 'Tier', 'Login Anomaly', 'File Downloads', 'Priv Escalation', 'Exfil Attempts', 'Last Seen'].map(h => (
                      <th key={h} style={{ padding: '0.85rem 1rem', textAlign: h === 'User' ? 'left' : 'center', fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(riskyUsers.length > 0 ? riskyUsers : []).map((u: any, idx: number) => {
                    const tierColor = u.tier_color || '#718096';
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                        onClick={() => { openDrillDown(`User Risk: ${u.user}`, [u], "user_risk"); setSelectedEntity(u); }}>
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.78rem' }}>{u.user}</div>
                          <div style={{ fontSize: '0.58rem', color: 'var(--text-tertiary)', marginTop: '0.1rem' }}>{(u.drivers || []).join(' • ')}</div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ fontSize: '1rem', fontWeight: 900, color: tierColor }}>{u.score}</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{ background: `${tierColor}18`, color: tierColor, border: `1px solid ${tierColor}33`, borderRadius: '12px', padding: '0.2rem 0.6rem', fontSize: '0.6rem', fontWeight: 800 }}>{(u.tier || 'Watch').toUpperCase()}</span>
                        </td>
                        {[u.login_anomaly || 0, u.file_downloads || 0, u.priv_escalation || 0, u.exfil_attempts || 0].map((val, vi) => {
                          const maxVals = [10, 50, 5, 5];
                          const pct = Math.min((val / maxVals[vi]) * 100, 100);
                          const barColor = pct > 70 ? '#f85149' : pct > 40 ? '#d29922' : '#3fb950';
                          return (
                            <td key={vi} style={{ textAlign: 'center', padding: '0.85rem 0.5rem' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: barColor }}>{val}</span>
                                <div style={{ width: '40px', height: '4px', background: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width 0.8s ease' }} />
                                </div>
                              </div>
                            </td>
                          );
                        })}
                        <td style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{u.last_seen ? ago(u.last_seen) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notice Period + Privilege Misuse */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {/* Notice Period Users */}
            <div className="liquid-glass" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <UserX size={16} color="#f85149" /> Notice Period Users
                  <span style={{ fontSize: '0.55rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '12px', background: 'rgba(63,185,80,0.08)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.2)' }}>LIVE XSIAM SYNC</span>
                </h3>
                <Download size={14} color="var(--text-tertiary)" style={{ cursor: 'pointer' }} onClick={() => handleExportCSV(noticePeriodUsers, 'notice_period_users')} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {(noticePeriodUsers.length > 0 ? noticePeriodUsers : []).map((u: any, idx: number) => (
                  <div key={idx} style={{ padding: '0.85rem', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                    onClick={() => openDrillDown(`Notice Period: ${u.user}`, [u], "user_risk")}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>{u.user}</div>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', marginTop: '0.1rem' }}>{u.department} • LWD: {u.last_date}</div>
                      </div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 900, color: u.risk_score > 70 ? '#f85149' : '#d29922' }}>{u.risk_score}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {(u.risk_activities || []).map((act: string, ai: number) => (
                        <span key={ai} style={{ fontSize: '0.55rem', fontWeight: 700, padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(248,81,73,0.08)', color: '#f85149', border: '1px solid rgba(248,81,73,0.15)' }}>
                          {act === 'git_clone' ? <><GitBranch size={10} style={{ verticalAlign: 'middle' }} /> Git Clone</> :
                            act === 'mass_download' ? <><Download size={10} style={{ verticalAlign: 'middle' }} /> Mass DL</> :
                              act === 'usb_copy' ? <><HardDrive size={10} style={{ verticalAlign: 'middle' }} /> USB</> :
                                act === 'db_access' ? <><Database size={10} style={{ verticalAlign: 'middle' }} /> DB Access</> :
                                  act === 'crm_export' ? <><Download size={10} style={{ verticalAlign: 'middle' }} /> CRM Export</> : act}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {noticePeriodUsers.length === 0 && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textAlign: 'center', padding: '2rem', border: '1px dashed var(--border-subtle)', borderRadius: '8px' }}>
                    No notice-period user activity detected via XSIAM log ingestion.
                  </div>
                )}
              </div>
            </div>

            {/* Privilege Misuse Feed */}
            <div className="liquid-glass" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Lock size={16} color="#d29922" /> Privileged Access Misuse
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {(() => {
                  const privUsers = riskyUsers.filter((u: any) =>
                    (u.drivers || []).some((d: string) => d.includes('privilege') || d.includes('lateral') || d.includes('escalation'))
                  );
                  return (
                    <>
                      {privUsers.map((u: any, idx: number) => (
                        <div key={idx} style={{ padding: '0.85rem', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                          onClick={() => { openDrillDown(`Privilege Misuse: ${u.user}`, [u], "user_risk"); setSelectedEntity(u); }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>{u.user}</span>
                            <span style={{ fontSize: '0.6rem', fontWeight: 800, color: u.tier_color || '#d29922' }}>{u.score} RISK</span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                            {(u.drivers || []).map((d: string, di: number) => (
                              <span key={di} style={{ fontSize: '0.55rem', fontWeight: 700, padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(210,153,34,0.1)', color: '#d29922', border: '1px solid rgba(210,153,34,0.2)' }}>{d.replace(/_/g, ' ')}</span>
                            ))}
                          </div>
                          <div style={{ fontSize: '0.58rem', color: 'var(--text-tertiary)' }}>Last activity: {u.last_seen ? ago(u.last_seen) : '—'}</div>
                        </div>
                      ))}
                      {privUsers.length === 0 && (
                        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.65rem', border: '1px dashed var(--border-subtle)', borderRadius: '8px' }}>
                          No privileged access anomalies detected.
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
         TAB 4 — DATA SECURITY
         ══════════════════════════════════════════════════════════ */}
      {activeTab === "data_security" && (
        <>
          {/* Data Exfiltration Bar Chart */}
          <div className="liquid-glass" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Database size={18} color="#f85149" /> Data Exfiltration — Top Transfers by User
              </h3>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.45rem', color: '#f85149', fontWeight: 900, border: '1px solid #f85149', padding: '0.1rem 0.4rem', borderRadius: '4px', letterSpacing: '0.05rem' }}>LIVE XSIAM TELEMETRY</span>
                <span style={{ fontSize: '0.6rem', color: '#f85149', fontWeight: 800 }}>{(dataExfiltration || []).length || '—'} EVENTS DETECTED</span>
                <Download size={14} color="var(--text-tertiary)" style={{ cursor: 'pointer' }} onClick={() => handleExportCSV(dataExfiltration, 'data_exfiltration')} />
              </div>
            </div>
            {(() => {
              const hasData = (dataExfiltration || []).length > 0;
              const chartData = hasData
                ? (() => {
                  const userBytes: Record<string, number> = {};
                  dataExfiltration.forEach((e: any) => { userBytes[e.user || 'unknown'] = (userBytes[e.user || 'unknown'] || 0) + (e.bytes || 0); });
                  return Object.entries(userBytes).sort(([, a], [, b]) => b - a).slice(0, 8).map(([user, bytes]) => ({ user, bytes }));
                })()
                : [];

                  return (
                    <div style={{ height: '250px', width: '100%', position: 'relative' }}>
                      {!hasData && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.1)', borderRadius: '10px', zIndex: 10, color: 'var(--text-tertiary)', fontSize: '0.8rem', fontWeight: 600 }}>
                          No data exfiltration events detected via XSIAM XQL
                        </div>
                      )}
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} layout="vertical">
                          <XAxis type="number" stroke="var(--text-tertiary)" fontSize={10} tickFormatter={(v) => formatBytes(v)} />
                          <YAxis dataKey="user" type="category" stroke="var(--text-tertiary)" fontSize={10} width={120} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.75rem' }}
                        formatter={(value: any) => formatBytes(Number(value))} />
                      <ReferenceLine x={100000000} stroke="#f85149" strokeDasharray="3 3" label={{ value: '100MB threshold', fill: '#f85149', fontSize: 10 }} />
                      <Bar dataKey="bytes" radius={[0, 4, 4, 0]} onClick={(data) => openDrillDown(`Exfiltration Detail: ${data.user}`, [data], "incident_detail")}>
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.bytes > 1e9 ? '#f85149' : entry.bytes > 1e8 ? '#d29922' : '#2f81f7'} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
            {(!dataExfiltration || dataExfiltration.length === 0) && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textAlign: 'center', fontStyle: 'normal', padding: '2rem', border: '1px dashed var(--border-subtle)', borderRadius: '10px', background: 'rgba(255,255,255,0.02)' }}>
                <ShieldCheck size={28} color="#3fb950" style={{ marginBottom: '0.75rem', opacity: 0.6 }} />
                <div style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>ENVIRONMENT SECURE</div>
                <div style={{ fontSize: '0.6rem', marginTop: '0.3rem' }}>No anomalous data exfiltration patterns detected via real-time XSIAM heuristics.</div>
              </div>
            )}
          </div>

          {/* Leakage Events + Cloud Exposure + Timeline */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 0.8fr 1fr', gap: '1.5rem' }}>
            {/* Leakage Events Table */}
            <div className="liquid-glass" style={{ padding: '1.5rem', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <AlertTriangle size={16} color="#f85149" /> Data Leakage Events
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '350px', overflowY: 'auto' }}>
                {(dataExfiltration || []).length > 0 ? (
                  dataExfiltration.slice(0, 10).map((e: any, idx: number) => (
                    <div key={idx} onClick={() => openDrillDown(`Leakage Detail: ${e.user}`, [e], "incident_detail")} style={{ padding: '0.7rem', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-subtle)', cursor: 'pointer' }} className="widget-hover">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)' }}>{e.user}</span>
                        <span style={{ fontSize: '0.65rem', fontWeight: 900, color: (e.bytes || 0) > 1e8 ? '#f85149' : '#d29922' }}>{formatBytes(e.bytes || 0)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: 'var(--text-tertiary)' }}>
                        <span>{e.destination} • {e.country || 'N/A'}</span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span style={{ padding: '0.1rem 0.3rem', borderRadius: '3px', background: 'rgba(47,129,247,0.1)', color: '#2f81f7', fontWeight: 900, fontSize: '0.5rem' }}>AUTHENTIC</span>
                          <span>{e.ts ? ago(e.ts) : '—'}</span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--border-subtle)', borderRadius: '8px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', marginBottom: '0.3rem' }}>NO ACTIVE THREATS</div>
                    <div style={{ fontSize: '0.55rem', color: 'var(--text-tertiary)', opacity: 0.7 }}>0 Anomalous Outbound Events Found</div>
                  </div>
                )}
              </div>
            </div>

            {/* Cloud Exposure */}
            <div className="liquid-glass" style={{ padding: '1.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <Cloud size={16} color="#2f81f7" /> Cloud Exposure
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {cloudExposure.length > 0 ? (
                  cloudExposure.map((item: any, idx: number) => (
                    <div key={idx} onClick={() => openDrillDown(`Cloud Issue: ${item.resource}`, [item], "incident_detail")} style={{ padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-subtle)', cursor: 'pointer' }} className="widget-hover">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)' }}>{item.platform}</span>
                        <span style={{ fontSize: '0.55rem', fontWeight: 900, padding: '0.1rem 0.35rem', borderRadius: '4px', background: 'rgba(248,81,73,0.1)', color: '#f85149' }}>CRITICAL</span>
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>{item.resource}</div>
                      <div style={{ fontSize: '0.55rem', color: 'var(--text-tertiary)' }}>{item.issue}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.65rem', fontStyle: 'italic', border: '1px dashed var(--border-subtle)', borderRadius: '8px' }}>
                    No public cloud buckets or exposed resources detected.
                  </div>
                )}
              </div>
            </div>

            {/* Transfer Timeline */}
            <div className="liquid-glass" style={{ padding: '1.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <TrendingUp size={16} color="#d29922" /> Transfer Timeline
                </h3>
              </div>
              <div style={{ height: '250px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={(() => {
                    if (dataExfiltration.length > 0) {
                      const dailyBytes: Record<string, number> = {};
                      dataExfiltration.forEach((e: any) => {
                        const day = new Date(e.ts || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        dailyBytes[day] = (dailyBytes[day] || 0) + (e.bytes || 0);
                      });
                      return Object.entries(dailyBytes).map(([day, bytes]) => ({ day, bytes }));
                    }
                    return [
                      { day: 'T-6', bytes: 0 }, { day: 'T-5', bytes: 0 }, { day: 'T-4', bytes: 0 },
                      { day: 'T-3', bytes: 0 }, { day: 'T-2', bytes: 0 }, { day: 'T-1', bytes: 0 },
                      { day: 'TODAY', bytes: 0 },
                    ];
                  })()}>
                    <defs>
                      <linearGradient id="colorExfil" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#d29922" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#d29922" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="day" stroke="var(--text-tertiary)" fontSize={9} />
                    <YAxis stroke="var(--text-tertiary)" fontSize={9} tickFormatter={(v) => formatBytes(v)} />
                    <Tooltip contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.75rem' }} formatter={(value: any) => formatBytes(Number(value))} />
                    <Area type="monotone" dataKey="bytes" stroke="#d29922" strokeWidth={2} fillOpacity={1} fill="url(#colorExfil)" name="Bytes Transferred" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
         TAB 5 — RISK & VULNERABILITY (UPGRADED)
         ══════════════════════════════════════════════════════════ */}
      {activeTab === "risk" && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1.5rem' }}>
          <div className="liquid-glass" style={{ padding: '1.5rem', cursor: 'pointer' }} onClick={() => openDrillDown("Prioritized Risk Heatmap", vulns)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}><Target size={18} color="#f85149" /> Risk Heatmap: Severity vs Asset Criticality</h3>
              <Download size={14} color="var(--text-tertiary)" onClick={(e) => { e.stopPropagation(); handleExportCSV(vulns, "Risk_Heatmap"); }} />
            </div>
            <DataDrivenHeatmap />
            <div style={{ marginTop: '2rem' }}>
              <h4 style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '1.25rem', letterSpacing: '0.1em' }}>What needs immediate attention?</h4>
              {(() => {
                const urgentVulns = (vulns || []).filter((v: any) => v.kev || (v.severity_score || 0) > 8).slice(0, 4);
                let displayItems = [];
                
                if (urgentVulns.length > 0) {
                  displayItems = urgentVulns.map((v: any) => ({
                    name: v.description || v.cve_id || 'Critical Vulnerability',
                    level: (v.severity_score || 0) >= 9.5 ? 'CRITICAL' : 'HIGH',
                    color: (v.severity_score || 0) >= 9.5 ? '#f85149' : '#d29922',
                    impact: v.device_count > 1 ? `${v.device_count} Impacted` : 'Single Endpoint',
                    original: v
                  }));
                } else {
                  // Fallback to top 4 non-resolved incidents from main state
                  displayItems = (incidents || []).slice(0, 4).map((inc: any) => ({
                    name: inc.name || 'Unknown Incident',
                    level: (inc.severity || '').toUpperCase(),
                    color: (inc.severity || '').toLowerCase() === 'critical' ? '#f85149' : '#d29922',
                    impact: inc.host || 'System-wide',
                    original: inc
                  }));
                }

                if (displayItems.length === 0) {
                  return <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>No urgent risks detected. XSIAM hygiene is optimal.</div>;
                }

                return displayItems.map((r, i) => (
                  <div key={i} onClick={(e) => { e.stopPropagation(); openDrillDown(r.name, [r.original], "incident_detail"); }} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent', cursor: 'pointer' }} className="widget-hover">
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>{r.name}</span>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>Impact Zone: {r.impact}</span>
                    </div>
                    <span style={{ fontSize: '0.65rem', color: r.color, fontWeight: 900, padding: '0.2rem 0.5rem', background: `${r.color}15`, borderRadius: '4px', border: `1px solid ${r.color}30` }}>{r.level}</span>
                  </div>
                ));
              })()}
            </div>
          </div>

          <div className="liquid-glass" style={{ padding: '1.5rem', cursor: 'pointer' }} onClick={() => openDrillDown("Vulnerability Prioritization", vulns)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.6rem' }}><Activity size={18} color="var(--accent-primary)" /> Weaponized Vulnerabilities</h3>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#f85149', fontWeight: 900 }}>{vulns.length} CRITICAL</span>
                <Download size={14} color="var(--text-tertiary)" onClick={(e) => { e.stopPropagation(); handleExportCSV(vulns, "Weaponized_Vulns"); }} />
              </div>
            </div>
            <div style={{ padding: '0.5rem 0' }}>
              {vulns.slice(0, 8).map((v, i) => (
                <div key={i} style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{v.cve_id}</span>
                    <span style={{ color: (v.severity_score || 0) > 9 ? '#f85149' : '#d29922' }}>{v.severity_score || '—'} / 10</span>
                  </div>
                  <div style={{ height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px' }}>
                    <div style={{ width: `${(v.severity_score || 0) * 10}%`, height: '100%', background: (v.severity_score || 0) > 9 ? 'linear-gradient(90deg, #f85149, #ff7b72)' : '#d29922', borderRadius: '4px', boxShadow: (v.severity_score || 0) > 9 ? '0 0 10px rgba(248,81,73,0.2)' : 'none' }} />
                  </div>
                </div>
              ))}
            </div>
            <button style={{ width: '100%', marginTop: '1.5rem', padding: '0.75rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer' }}>VIEW REMEDIATION PLAN</button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
         TAB 6 — SOC OPERATIONS (UPGRADED)
         ══════════════════════════════════════════════════════════ */}
      {activeTab === "ops" && (
        <>
          {/* Alert Volume Time Series with Spike Detection */}
          <div className="liquid-glass" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Activity size={18} color="var(--accent-primary)" /> Alert Volume Monitoring
              </h3>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                {isSpikeDetected && (
                  <span style={{ fontSize: '0.6rem', fontWeight: 900, padding: '0.2rem 0.6rem', borderRadius: '12px', background: 'rgba(248,81,73,0.15)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)', animation: 'pulse 2s infinite' }}>
                    SPIKE DETECTED
                  </span>
                )}
                <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', fontWeight: 700 }}>Spike threshold: &gt; 7d avg × 2</span>
              </div>
            </div>
            <AlertVolumeChart data={alertVolume} threshold={spikeThreshold} />
          </div>

          {/* SOC KPIs Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
            <KPICard 
              label="Avg MTT-Detection" 
              value={`${socPerformance?.avg_mttd_min || 0}m`} 
              icon={Zap} 
              color="#2f81f7" 
              subtitle="Time to first triage"
              trendData={socPerformance?.daily_mttd}
              onClick={() => openPerformanceDrillDown("MTTD", "MTT-Detection", socPerformance?.daily_mttd || [], "#2f81f7", "MTT-Detection = Avg time from incident creation to initial security analyst investigation/triage.")}
            />
            <KPICard 
              label="Avg MTT-Response" 
              value={`${socPerformance?.avg_mtta_min || 0}m`} 
              icon={Eye} 
              color="#db61a2" 
              subtitle="Analyst pickup time"
              trendData={socPerformance?.daily_mtta}
              onClick={() => openPerformanceDrillDown("MTTA", "MTT-Response", socPerformance?.daily_mtta || [], "#db61a2", "MTT-Response = Avg time from initial detection/assignment to the first logged analyst response/action.")}
            />
            <KPICard 
              label="Avg MTT-Resolution" 
              value={`${socPerformance?.avg_mttr_min || 0}m`} 
              icon={Clock} 
              color="#3fb950" 
              subtitle="Full remediation"
              trendData={socPerformance?.daily_mttr}
              onClick={() => openPerformanceDrillDown("MTTR", "MTT-Resolution", socPerformance?.daily_mttr || [], "#3fb950", "MTT-Resolution = Avg time from incident creation to the 'Resolved' status timestamp.")}
            />
            <KPICard label="Automation Rate" value={`${benchmarks?.soc_efficiency?.auto_remediated_percent || 0}%`} icon={Cpu} color="#e3b341" subtitle="Tier-1 auto-resolved" />
          </div>

          {/* Compliance + Regulatory + Audit */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '1.5rem' }}>
            <div className="liquid-glass" style={{ padding: '2rem', textAlign: 'center' }}>
              <div style={{ cursor: 'pointer', transition: 'transform 0.2s' }} className="widget-hover" onClick={() => openCalculationDrillDown(
                "Executive Index Calculation", 
                "Risk = (Crit*5 + High*3 + Med*2 + Active*4 + Exfil*6 + CrownJ*7) / Assets",
                "The Executive Index measures organizational risk by weighting critical security events against your total infrastructure footprint. A higher index indicates increased exposure needing board-level attention.",
                ["incidents", "alerts", "file_events", "asset_inventory"],
                { 
                  "Critical Alerts": incidents.filter((x:any) => (x.severity || '').toLowerCase() === 'critical').length, 
                  "Active Incidents": incidents.length, 
                  "Exfiltration Detected": (dataExfiltration.length || 0), 
                  "Total Assets (Live)": socPerformance?.total_assets || '—', 
                  "Result": `${compliance?.frameworks?.[0]?.score || 0}%` 
                }
              )}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800, marginBottom: '1.5rem' }}>Are we compliant?</h3>
                <ComplianceGauge score={compliance?.frameworks?.[0]?.score || 0} label="Executive Index" />
                <div style={{ fontSize: '0.55rem', fontWeight: 900, color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>DETAILS (GLOBAL) &gt;</div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1.5rem' }}>
                {[2, 1, 0, 4].map(idx => {
                  const f = compliance?.frameworks?.[idx];
                  if (!f) return null;
                  const isSafe = (f.score || 0) >= 90;
                  const icon = isSafe ? '&#10003;' : '&#9888;';
                  const bg = isSafe ? 'rgba(63,185,80,0.1)' : 'rgba(210,153,34,0.1)';
                  const color = isSafe ? '#3fb950' : '#d29922';
                  
                  return (
                    <div key={f.name} onClick={() => openCalculationDrillDown(
                      `${f.name} Evidence`,
                      f.details?.formula,
                      f.details?.logic,
                      f.details?.sources,
                      f.details?.inputs
                    )} style={{ cursor: 'pointer', padding: '0.5rem', background: bg, color: color, border: `1px solid ${color}33`, borderRadius: '8px', fontSize: '0.7rem', fontWeight: 800 }} 
                       className="widget-hover"
                       dangerouslySetInnerHTML={{ __html: `${icon} ${f.name.split(' ')[0]} ${f.name.split(' ')[1] || ''}` }} />
                  );
                })}
              </div>
              {/* Automation Rate Gauge */}
              <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }} className="widget-hover" onClick={() => openCalculationDrillDown(
                "Automation Efficiency Calculation",
                "Rate = (Auto-Resolved Incidents / Total Resolved) * 100",
                "This metric tracks the percentage of security incidents successfully remediated by automated playbooks without manual analyst intervention.",
                ["automation_logs", "incident_service"],
                { 
                  "Auto-Remediated": (socPerformance?.resolved_incidents || 0), 
                  "Total Resolved": (socPerformance?.resolved_incidents || 0), 
                  "Analyst Hours Saved": `${socPerformance?.hours_saved_total || 0}h`, 
                  "Result": `${socPerformance?.automation_rate || 0}%` 
                }
              )}>
                <ComplianceGauge score={socPerformance?.automation_rate || 0} label="Automation Rate" />
                <div style={{ fontSize: '0.55rem', fontWeight: 900, color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>DETAILS (LIVE) &gt;</div>
              </div>
            </div>

            <div className="liquid-glass" style={{ padding: '1.5rem', cursor: 'pointer' }} onClick={() => openCalculationDrillDown(
              "Regulatory Pulse Calculation",
              "Compliance = (Implemented Controls / Framework Requirements) * 100",
              "Individual framework scores are derived by auditing live XSIAM configurations against control requirements defined by Indian Regulatory bodies (RBI, CERT-In, IRDAI).",
              ["compliance_audit", "posture_telemetry"],
              { 
                "RBI Compliance": `${compliance?.frameworks?.[4]?.score || 0}%`, 
                "CERT-In Alignment": `${compliance?.frameworks?.[5]?.score || 0}%`, 
                "IRDAI Status": `${compliance?.frameworks?.[3]?.score || 0}%`, 
                "Result": `${Math.round(((compliance?.frameworks?.[4]?.score || 0) + (compliance?.frameworks?.[5]?.score || 0) + (compliance?.frameworks?.[3]?.score || 0)) / 3)}%` 
              }
            )}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800 }}>Indian Regulatory Pulse</h3>
                <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                  <div style={{ fontSize: '0.55rem', fontWeight: 900, color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>DETAILS &gt;</div>
                  <Download size={14} color="var(--text-tertiary)" onClick={(e) => { e.stopPropagation(); handleExportCSV(compliance?.frameworks || [], "Regulatory_Status"); }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {(compliance?.frameworks || []).slice(3, 6).map((f: any, i: number) => (
                  <div key={i} className="widget-hover" style={{ cursor: 'pointer', padding: '0.4rem', borderRadius: '8px' }} onClick={(e) => {
                    e.stopPropagation();
                    openCalculationDrillDown(
                      `${f.name} Regulatory Logic`,
                      f.details?.formula,
                      f.details?.logic,
                      f.details?.sources,
                      f.details?.inputs
                    );
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 800, marginBottom: '0.6rem', color: 'var(--text-secondary)' }}>
                      <span>{f.name}</span>
                      <span style={{ color: f.score > 90 ? '#3fb950' : '#d29922' }}>{f.score}%</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px' }}>
                      <div style={{ width: `${f.score}%`, height: '100%', background: f.score > 90 ? '#3fb950' : '#d29922', borderRadius: '3px' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="liquid-glass" style={{ padding: '0', overflow: 'hidden', cursor: 'pointer' }} onClick={() => openCalculationDrillDown(
              "Audit Readiness Methodology",
              "Readiness = (Internal Posture Score / Compliance Standard Baseline) * 100",
              "The audit readiness score evaluates your real-time security posture against the stringent controls of certifications like SOC 2 and NIST, predicting audit success rates.",
              ["internal_audit", "posture_logic"],
              { 
                "Frameworks Tracked": (compliance?.frameworks?.length || 0), 
                "Average Score": `${Math.round((compliance?.frameworks || []).reduce((acc: any, f: any) => acc + (f.score || 0), 0) / (compliance?.frameworks?.length || 1))}%`, 
                "Risk Drift": (compliance?.frameworks[0]?.trend || '—'),
                "Result": "Audit Ready" 
              }
            )}>
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
                <h3 style={{ fontSize: '0.85rem', fontWeight: 800 }}>Audit Timeline & Readiness</h3>
                <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.55rem', fontWeight: 900, color: 'var(--text-tertiary)', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>DETAILS &gt;</div>
                    <Database size={14} color="var(--accent-primary)" />
                </div>
              </div>
              <div style={{ padding: '1.25rem' }}>
                {(compliance?.frameworks || []).map((f: any, i: number) => (
                  <div key={i} className="widget-hover" style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.85rem', padding: '0.75rem', borderRadius: '10px', background: 'rgba(255,255,255,0.01)', border: '1px solid transparent', transition: 'all 0.2s', cursor: 'pointer' }} onClick={(e) => {
                    e.stopPropagation();
                    openCalculationDrillDown(
                      `${f.name} Audit Readiness`,
                      f.details?.formula,
                      f.details?.logic,
                      f.details?.sources,
                      f.details?.inputs
                    );
                  }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: f.score > 90 ? '#3fb950' : f.score > 80 ? '#d29922' : '#f85149', boxShadow: `0 0 10px ${f.score > 90 ? '#3fb95050' : '#d2992250'}` }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-primary)' }}>{f.name}</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: '0.1rem' }}>Overall Drift: {f.trend}</div>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', fontWeight: 800, textTransform: 'uppercase' }}>{f.status}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
         DRILL-DOWN MODAL
         ══════════════════════════════════════════════════════════ */}
      {drillDownType && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', backdropFilter: 'blur(12px)' }} onClick={closeDrillDown}>
          <div className="liquid-glass" style={{ width: '100%', maxWidth: selectedEntity ? '1400px' : '1100px', maxHeight: '90vh', display: 'flex', flexDirection: selectedEntity ? 'row' : 'column', background: 'var(--bg-primary)', borderRadius: '24px', overflow: 'hidden', boxShadow: '0 50px 100px rgba(0,0,0,0.9)', border: '1px solid var(--border-color)', position: 'relative' }} onClick={e => e.stopPropagation()}>

            {/* Left Panel */}
            <div style={{ flex: selectedEntity ? '1.2' : '1', display: 'flex', flexDirection: 'column', height: '100%', borderRight: selectedEntity ? '1px solid var(--border-color)' : 'none' }}>
              <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ padding: '0.6rem', background: 'rgba(47,129,247,0.1)', borderRadius: '12px' }}><Activity size={20} color="var(--accent-primary)" /></div>
                  <div>
                    <h2 style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{drillDownTitle}</h2>
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: '0.1rem' }}>{drillDownType === "performance_metric" ? "Historical Trend Tracking" : `${drillDownData.length} records matched. Data sync: Real-time.`}</p>
                  </div>
                </div>
                {!selectedEntity && (
                  <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <button onClick={() => handleExportCSV(drillDownData, drillDownTitle)} style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', padding: '0.4rem 0.8rem', borderRadius: '8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Download size={14} /> Export
                    </button>
                    <button onClick={closeDrillDown} style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: 'none', padding: '0.4rem', borderRadius: '50%', cursor: 'pointer' }}>
                      <X size={18} />
                    </button>
                  </div>
                )}
              </div>

              <div style={{ padding: '0', overflow: 'auto', flex: 1 }} className="custom-scrollbar">
                {drillDownType === "calculation_detail" ? (
                  <div style={{ padding: '3rem 4rem', display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', alignItems: 'center', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '1.5rem', letterSpacing: '0.2em' }}>Security Intelligence Logic</div>
                    <div style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'serif', padding: '2.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '24px', border: '1px solid var(--border-color)', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', width: '100%', maxWidth: '800px' }}>
                      {selectedEntity?.formula}
                    </div>
                    <div style={{ marginTop: '3rem', maxWidth: '600px' }}>
                      <h4 style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--accent-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}><Globe size={18} /> Telemetric Data Sources</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.75rem' }}>
                        {(selectedEntity?.sources || []).map((s: string, i: number) => (
                          <div key={i} style={{ padding: '0.4rem 0.8rem', background: 'rgba(47,129,247,0.1)', color: '#2f81f7', borderRadius: '8px', fontSize: '0.65rem', fontWeight: 800, border: '1px solid rgba(47,129,247,0.3)' }}>
                            dataset = {s}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : drillDownType === "performance_metric" ? (
                  <div style={{ padding: '2rem' }}>
                    <div style={{ height: '350px', width: '100%', marginBottom: '2rem', background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={drillDownData}>
                          <defs>
                            <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={selectedEntity?.color || 'var(--accent-primary)'} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={selectedEntity?.color || 'var(--accent-primary)'} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                          <XAxis dataKey="date" stroke="var(--text-tertiary)" fontSize={10} />
                          <YAxis stroke="var(--text-tertiary)" fontSize={10} unit="m" />
                          <Tooltip contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
                          <Area type="monotone" dataKey="value" stroke={selectedEntity?.color || 'var(--accent-primary)'} strokeWidth={3} fillOpacity={1} fill="url(#colorMetric)" dot={{ r: 4, fill: selectedEntity?.color }} activeDot={{ r: 6 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '0.05em' }}>Historical Data Points</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                      <thead><tr style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)', textAlign: 'left' }}><th style={{ padding: '1rem' }}>Date</th><th style={{ padding: '1rem' }}>Value</th><th style={{ padding: '1rem' }}>SLA Status</th></tr></thead>
                      <tbody>
                        {drillDownData.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '1rem', color: 'var(--text-primary)', fontWeight: 700 }}>{row.date}</td>
                            <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{row.value}m</td>
                            <td style={{ padding: '1rem' }}><span style={{ fontSize: '0.6rem', fontWeight: 900, color: row.value < 30 ? '#3fb950' : '#d29922' }}>{row.value < 30 ? 'WITHIN SLA' : 'AT RISK'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : drillDownType === "posture_trend" || drillDownType === "soc_performance" ? (
                  <div style={{ padding: '2rem' }}>
                    <div style={{ height: '300px', width: '100%', marginBottom: '2rem' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={drillDownData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                          <XAxis dataKey="date" stroke="var(--text-tertiary)" fontSize={10} />
                          <YAxis stroke="var(--text-tertiary)" fontSize={10} />
                          <Tooltip contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
                          <Line type="monotone" dataKey={drillDownType === "posture_trend" ? "score" : "count"} stroke="var(--accent-primary)" strokeWidth={3} dot={{ r: 4, fill: 'var(--accent-primary)' }} activeDot={{ r: 6 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                      <thead><tr style={{ background: 'var(--bg-secondary)', color: 'var(--text-tertiary)', textAlign: 'left' }}><th style={{ padding: '1rem' }}>Date</th><th style={{ padding: '1rem' }}>{drillDownType === "posture_trend" ? "Posture Score" : "Incident Count"}</th><th style={{ padding: '1rem' }}>Status</th></tr></thead>
                      <tbody>
                        {drillDownData.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '1rem', color: 'var(--text-primary)', fontWeight: 700 }}>{row.date}</td>
                            <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{row.score || row.count}</td>
                            <td style={{ padding: '1rem' }}><span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#3fb950' }}>NORMALIZED</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                    <thead style={{ background: 'var(--bg-tertiary)', position: 'sticky', top: 0, zIndex: 10 }}>
                      <tr>
                        {drillDownData.length > 0 && Object.keys(drillDownData[0]).filter(k => !['last_alerts', 'description', 'nvd_link', 'first_seen', 'drivers'].includes(k)).map(k => (
                          <th key={k} style={{ textAlign: 'left', padding: '1.25rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border-subtle)' }}>{k.replace(/_/g, ' ')}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {drillDownData.map((row, i) => (
                        <tr key={i}
                          onClick={() => setSelectedEntity(row)}
                          style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'background 0.1s', background: selectedEntity === row ? 'rgba(47,129,247,0.1)' : 'transparent' }}
                          onMouseEnter={e => !selectedEntity && (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                          onMouseLeave={e => !selectedEntity && (e.currentTarget.style.background = 'none')}>
                          {Object.entries(row).filter(([k]) => !['last_alerts', 'description', 'nvd_link', 'first_seen', 'drivers'].includes(k)).map(([k, v], j) => (
                            <td key={j} style={{ padding: '1.25rem', color: 'var(--text-secondary)' }}>
                              {k === 'severity' || k === 'tier' ? (
                                <span style={{ fontSize: '0.6rem', fontWeight: 900, padding: '0.2rem 0.5rem', borderRadius: '4px', background: String(v).toLowerCase() === 'critical' ? 'rgba(248,81,73,0.1)' : 'rgba(210,153,34,0.1)', color: String(v).toLowerCase() === 'critical' ? '#f85149' : '#d29922' }}>
                                  {String(v).toUpperCase()}
                                </span>
                              ) : String(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Right Panel: Entity Detail */}
            {selectedEntity && (
              <div style={{ flex: '1', display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-secondary)', animation: 'slideIn 0.3s ease-out' }}>
                <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Fingerprint size={18} color="var(--accent-primary)" />
                    <h3 style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)' }}>Detail Deep-Dive</h3>
                  </div>
                  <button onClick={() => setSelectedEntity(null)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}><X size={18} /></button>
                </div>

                <div style={{ padding: '2rem', flex: 1, overflow: 'auto' }} className="custom-scrollbar">
                  <div style={{ marginBottom: '2rem' }}>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{drillDownType === "performance_metric" ? "Metric Definition" : drillDownType === "calculation_detail" ? "Audit Readiness" : "Entity Context"}</div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '0.5rem' }}>{selectedEntity.name || selectedEntity.label || selectedEntity.user || selectedEntity.cve_id || selectedEntity.id || 'Entity Detail'}</div>
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                      <span style={{ padding: '0.25rem 0.75rem', borderRadius: '6px', background: selectedEntity.color || 'var(--accent-primary)', color: 'white', fontSize: '0.7rem', fontWeight: 800 }}>{drillDownType === "performance_metric" ? `CURRENT: ${selectedEntity.current}m` : (selectedEntity.tier || selectedEntity.severity || 'ACTIVE')}</span>
                      {selectedEntity.score && <span style={{ padding: '0.25rem 0.75rem', borderRadius: '6px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', fontSize: '0.7rem', fontWeight: 800, border: '1px solid var(--border-subtle)' }}>RISK SCORE: {selectedEntity.score}</span>}
                    </div>
                  </div>

                  {drillDownType === "performance_metric" && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div className="liquid-glass" style={{ padding: '1.5rem', borderLeft: `4px solid ${selectedEntity.color}` }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>How it's calculated</div>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.6, marginBottom: '1rem' }}>{selectedEntity.logic}</p>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                          This metric is calculated across the selected <strong>{globalTimeframe}</strong> window. Data is aggregated from all tenant incidents matching the performance criteria. Spikes in this chart usually indicate high-volume incident bursts or analyst bandwidth saturation.
                        </div>
                      </div>
                      
                      <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '1rem' }}>Business Impact</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <div style={{ width: '4px', height: 'auto', background: selectedEntity.color, borderRadius: '2px' }} />
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              Faster <strong>{selectedEntity.label}</strong> directly reduces the window of opportunity for an attacker to escalate privileges or exfiltrate data.
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <div style={{ width: '4px', height: 'auto', background: selectedEntity.color, borderRadius: '2px' }} />
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              Our current performance is <strong>{selectedEntity.current < 20 ? 'OPTIMAL' : 'REQUIRING ATTENTION'}</strong> based on industry benchmarks for {selectedEntity.label}.
                            </div>
                          </div>
                        </div>
                      </div>

                      <button onClick={() => window.alert("Generating full audit report...")} style={{ width: '100%', padding: '1rem', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                        <Download size={16} /> DOWNLOAD HISTORICAL AUDIT REPORT
                      </button>
                    </div>
                  )}

                  {drillDownType === "calculation_detail" && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div className="liquid-glass" style={{ padding: '1.5rem', borderLeft: '4px solid var(--accent-primary)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Methodology Context</div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{selectedEntity.logic}</p>
                      </div>

                      <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid var(--border-subtle)' }}>
                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '1.25rem' }}>Live Audit Evidence</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                          {Object.entries(selectedEntity.inputs || {}).map(([label, val]: [string, any], i: number) => {
                            const isGap = String(label).startsWith('GAP:') || String(val).toLowerCase() === 'warning';
                            const isResult = label === 'Result';
                            
                            // Dynamic coloring for results
                            let statusColor = 'var(--text-primary)';
                            let bgColor = 'rgba(255,255,255,0.01)';
                            let borderColor = 'var(--border-subtle)';
                            let Icon = Info;

                            if (isResult) {
                              const scoreMatch = String(val).match(/\d+/);
                              const score = scoreMatch ? parseInt(scoreMatch[0]) : 0;
                              if (score >= 90) {
                                statusColor = '#3fb950';
                                bgColor = 'rgba(63,185,80,0.05)';
                                borderColor = 'rgba(63,185,80,0.2)';
                                Icon = CheckCircle;
                              } else if (score >= 70) {
                                statusColor = '#d29922';
                                bgColor = 'rgba(210,153,34,0.05)';
                                borderColor = 'rgba(210,153,34,0.2)';
                                Icon = AlertTriangle;
                              } else {
                                statusColor = '#f85149';
                                bgColor = 'rgba(248,81,73,0.05)';
                                borderColor = 'rgba(248,81,73,0.2)';
                                Icon = AlertTriangle;
                              }
                            } else if (isGap) {
                              statusColor = '#f85149';
                              bgColor = 'rgba(248,81,73,0.05)';
                              borderColor = 'rgba(248,81,73,0.2)';
                              Icon = AlertTriangle;
                            }

                            return (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: bgColor, borderRadius: '10px', border: `1px solid ${borderColor}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                  <Icon size={14} color={statusColor} />
                                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: isGap ? '#f85149' : 'var(--text-secondary)' }}>{label}</span>
                                </div>
                                <span style={{ fontSize: '0.85rem', fontWeight: 900, color: statusColor }}>{val}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {selectedEntity.inputs?.['GAP: Encryption'] && (
                        <div style={{ padding: '1rem', background: 'rgba(248,81,73,0.1)', borderRadius: '12px', border: '1px solid rgba(248,81,73,0.2)' }}>
                          <div style={{ fontSize: '0.65rem', fontWeight: 900, color: '#f85149', textTransform: 'uppercase', marginBottom: '0.5rem' }}>REMEDIATION ACTION REQUIRED</div>
                          <p style={{ fontSize: '0.75rem', color: '#f85149', lineHeight: 1.4 }}>
                            Regulatory bodies require all regional databases to enforce AES-256 encryption at rest. Resolve this by updating the storage policy in the Azure/AWS control plane.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedEntity.incident && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div className="liquid-glass" style={{ padding: '1.5rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Description</div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{selectedEntity.incident.description}</p>
                      </div>
                      <DetailGrid>
                        <DetailItem label="Incident Status" value={selectedEntity?.incident?.status} />
                        <DetailItem label="Assigned Analyst" value={selectedEntity?.incident?.assigned} />
                        <DetailItem label="Creation Time" value={selectedEntity?.incident?.created} />
                        <DetailItem label="Last Modified" value={selectedEntity?.incident?.modified} />
                        <DetailItem label="Affected Hosts" value={selectedEntity?.incident?.hosts?.join(', ') || 'None'} fullWidth />
                        <DetailItem label="Affected Users" value={selectedEntity?.incident?.users?.join(', ') || 'None'} fullWidth />
                      </DetailGrid>
                      <div>
                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Activity size={14} /> Linked Alerts ({selectedEntity.alerts?.length || 0})
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {(selectedEntity.alerts || []).map((a: any, i: number) => (
                            <div key={i} style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{a.name}</span>
                                <span style={{ fontSize: '0.65rem', fontWeight: 900, padding: '0.2rem 0.5rem', borderRadius: '4px', background: a.severity === 'critical' ? 'rgba(248,81,73,0.1)' : 'rgba(210,153,34,0.1)', color: a.severity === 'critical' ? '#f85149' : '#d29922' }}>{a.severity?.toUpperCase()}</span>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}><span style={{ fontWeight: 800 }}>HOST:</span> {a.host}</div>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}><span style={{ fontWeight: 800 }}>USER:</span> {a.user}</div>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}><span style={{ fontWeight: 800 }}>ACTION:</span> {a.action}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedEntity?.cve_id && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div className="liquid-glass" style={{ padding: '1.5rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Description</div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{selectedEntity?.description}</p>
                        {selectedEntity.nvd_link && (
                          <a href={selectedEntity.nvd_link} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', color: 'var(--accent-primary)', fontSize: '0.75rem', fontWeight: 700, textDecoration: 'none' }}>
                            View on NVD Database <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                      <DetailGrid>
                        <DetailItem label="Vulnerability ID" value={selectedEntity.cve_id} />
                        <DetailItem label="CVSS Score" value={selectedEntity.severity_score || '9.8'} />
                        <DetailItem label="Affected Assets" value={`${selectedEntity.device_count || 0} Endpoints`} />
                        <DetailItem label="Exploit Status" value={selectedEntity.kev ? 'KNOWN EXPLOITED' : 'NO ACTIVE EXPLOIT'} />
                      </DetailGrid>
                    </div>
                  )}

                  {selectedEntity?.user && !selectedEntity?.incident && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '1rem' }}>Risk Drivers</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                          {(selectedEntity?.drivers || []).map((d: string, i: number) => (
                            <span key={i} style={{ padding: '0.5rem 1rem', background: 'rgba(248,81,73,0.1)', color: '#f85149', borderRadius: '12px', border: '1px solid rgba(248,81,73,0.2)', fontSize: '0.75rem', fontWeight: 700 }}>{d}</span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Activity size={14} /> Recent Behavioral Alerts
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          {(selectedEntity?.last_alerts || []).map((a: any, i: number) => (
                            <div key={i} style={{ padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{a.name}</span>
                                <span style={{ fontSize: '0.65rem', color: a.severity === 'critical' ? '#f85149' : '#d29922', fontWeight: 900 }}>{a.severity?.toUpperCase() || 'UNKNOWN'}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                                <span>Host: {a.host || 'Unknown'}</span>
                                <span>{a.ts ? new Date(a.ts).toLocaleString() : 'Just now'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1rem' }}>
                    {selectedEntity.incident?.xdr_url ? (
                      <a href={selectedEntity.incident.xdr_url} target="_blank" rel="noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
                        <button style={{ width: '100%', padding: '0.8rem', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                          <Shield size={16} /> INVESTIGATE IN XSIAM
                        </button>
                      </a>
                    ) : (
                      <button style={{ flex: 1, padding: '0.8rem', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                        <Shield size={16} /> TRIGGER ISOLATION
                      </button>
                    )}
                    <button style={{ flex: 1, padding: '0.8rem', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                      <Search size={16} /> SIMULATE RECOVERY
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <style jsx global>{`
        @keyframes pulse {
          0% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
          100% { opacity: 0.6; transform: scale(1); }
        }
        .liquid-glass {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        }
        .widget-hover {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .widget-hover:hover {
          background: rgba(255, 255, 255, 0.06) !important;
          border-color: rgba(255, 255, 255, 0.15) !important;
          transform: translateY(-2px);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--border-color);
          border-radius: 10px;
        }
        @keyframes slideIn {
          from { transform: translateX(30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
