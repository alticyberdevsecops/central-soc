'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, usePathname } from 'next/navigation';
import {
    Shield, LayoutDashboard, Activity, Layers, Settings, LogOut, UserPlus,
    User, Sun, Moon, ArrowLeft, TicketPlus, PanelLeftClose, PanelLeftOpen, Mail, Globe, Workflow, Store
} from 'lucide-react';
import Cookies from 'js-cookie';
import { useTheme } from '@/components/ThemeProvider';

const W_COLLAPSED = 64;
const W_EXPANDED = 256;
const DURATION = '0.3s';
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const STORAGE_KEY = 'soc_sidebar_collapsed';

export default function Sidebar({ contextNav }: { contextNav?: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const { theme, toggleTheme } = useTheme();

    const [collapsed, setCollapsed] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'true') setCollapsed(true);
        setReady(true);
    }, []);

    useEffect(() => {
        if (!ready) return;
        localStorage.setItem(STORAGE_KEY, String(collapsed));
        document.documentElement.style.setProperty('--sidebar-actual-width', `${collapsed ? W_COLLAPSED : W_EXPANDED}px`);
    }, [collapsed, ready]);

    const handleLogout = () => {
        Cookies.remove('soc_token');
        Cookies.remove('user_role');
        Cookies.remove('tenant_id');
        window.location.href = '/login';
    };

    const userRole = Cookies.get('user_role') || 'analyst';
    const isAdmin = userRole === 'super_admin' || userRole === 'customer_admin';

    const navItems = [
        { icon: <LayoutDashboard size={20} />, label: 'Dashboard', path: '/dashboard' },
        ...(userRole !== 'dashboard_manager' ? [
            { icon: <Activity size={20} />, label: 'Live Monitoring', path: '/monitoring' },
            { icon: <TicketPlus size={20} />, label: 'Create Ticket', path: '/tickets/create' },
        ] : []),
        ...(isAdmin ? [
            { icon: <Workflow size={20} />, label: 'Automations', path: '/automations' },
            { icon: <Mail size={20} />, label: 'Mail Server', path: '/mail-server' },
            { icon: <Store size={20} />, label: 'Marketplace', path: '/marketplace' },
        ] : []),
        ...(userRole === 'super_admin' ? [
            ...(Cookies.get('tenant_id') ? [{
                icon: <Globe size={18} />,
                label: 'Global View',
                path: '#clear-context',
                onClick: () => {
                    Cookies.remove('tenant_id');
                    window.location.reload();
                }
            }] : []),
            { icon: <Layers size={18} />, label: 'Tenants', path: '/tenants' },
            { icon: <Settings size={18} />, label: 'Connectors', path: '/connectors' },
            { icon: <UserPlus size={18} />, label: 'Onboarding', path: '/onboarding' },
        ] : []),
    ];

    const isActive = (p: string) => {
        if (p === '/dashboard') return pathname === '/dashboard' || pathname.startsWith('/incidents');
        if (p === '/tickets/create') return pathname.startsWith('/tickets');
        if (p === '/automations') return pathname.startsWith('/automations');
        if (p === '/mail-server') return pathname.startsWith('/mail-server');
        if (p === '/marketplace') return pathname.startsWith('/marketplace');
        return pathname === p;
    };

    const w = collapsed ? W_COLLAPSED : W_EXPANDED;
    const tr = `${DURATION} ${EASING}`;

    return (
        <aside
            className="sidebar"
            style={{ width: w, minWidth: w, transition: `width ${tr}, min-width ${tr}` }}
        >
            {/* ── Header ── */}
            <div
                onClick={() => router.push('/dashboard')}
                style={{
                    height: 60, display: 'flex', alignItems: 'center',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    padding: collapsed ? '0' : '0 0.75rem', gap: '0.75rem',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer', overflow: 'hidden',
                    transition: `padding ${tr}, justify-content ${tr}`,
                }}
            >
                <Shield className="text-[#2f81f7]" size={26} style={{ flexShrink: 0 }} />
                <span style={{
                    fontSize: '1rem', fontWeight: 800, letterSpacing: '0.05em',
                    color: 'var(--text-primary)', whiteSpace: 'nowrap',
                    opacity: collapsed ? 0 : 1,
                    transition: `opacity ${tr}`,
                }}>CENTRAL SOC</span>
            </div>

            {/* ── Context nav for detail pages ── */}
            {contextNav && !collapsed ? (
                <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto' }}>
                    <button
                        onClick={() => router.back()}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                            padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-md)',
                            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                            color: 'var(--text-secondary)', cursor: 'pointer',
                            fontSize: '0.78rem', fontWeight: 600, width: '100%', textAlign: 'left',
                            transition: 'all 0.15s',
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                    >
                        <ArrowLeft size={14} /> Back to Incidents
                    </button>
                    {contextNav}
                </div>
            ) : (
                /* ── Main nav ── */
                <nav style={{ flex: 1, padding: '0.75rem 0', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {navItems.map((item: any) => (
                        <SidebarItem
                            key={item.path}
                            icon={item.icon}
                            label={item.label}
                            active={isActive(item.path)}
                            collapsed={collapsed}
                            onClick={item.onClick ? item.onClick : () => router.push(item.path)}
                        />
                    ))}
                </nav>
            )}

            {/* ── Footer ── */}
            <div style={{ padding: '0.5rem 0', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <SidebarItem icon={<User size={20} />} label="Settings" active={isActive('/settings')} collapsed={collapsed} onClick={() => router.push('/settings')} />
                <SidebarItem icon={theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />} label={theme === 'dark' ? 'Light Mode' : 'Dark Mode'} collapsed={collapsed} onClick={toggleTheme} />
                <SidebarItem icon={<LogOut size={20} />} label="Sign Out" collapsed={collapsed} onClick={handleLogout} danger />

                {/* Collapse toggle */}
                <div style={{ marginTop: '4px', paddingTop: '6px', borderTop: '1px solid var(--border-color)' }}>
                    <SidebarItem
                        icon={collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
                        label={collapsed ? 'Expand' : 'Collapse'}
                        collapsed={collapsed}
                        onClick={() => setCollapsed(c => !c)}
                        muted
                    />
                </div>
            </div>
        </aside>
    );
}

/* ─────────────────────────────────────────────
   SidebarItem — icon + animated label + tooltip
   ───────────────────────────────────────────── */
function SidebarItem({
    icon, label, active = false, collapsed = false, onClick, danger = false, muted = false,
}: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    collapsed?: boolean;
    onClick: () => void;
    danger?: boolean;
    muted?: boolean;
}) {
    const [hovered, setHovered] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const [tooltipY, setTooltipY] = useState(0);
    const [portalReady, setPortalReady] = useState(false);

    useEffect(() => { setPortalReady(true); }, []);

    // Compute tooltip Y from the item's bounding rect
    useEffect(() => {
        if (hovered && collapsed && ref.current) {
            const r = ref.current.getBoundingClientRect();
            setTooltipY(r.top + r.height / 2);
        }
    }, [hovered, collapsed]);

    const tr = `${DURATION} ${EASING}`;

    // Colors
    let color = 'var(--text-secondary)';
    let bg = 'transparent';
    if (active) { color = 'var(--accent-primary)'; bg = 'var(--accent-soft)'; }
    else if (danger && hovered) { color = 'var(--status-critical)'; bg = 'rgba(248,81,73,0.08)'; }
    else if (muted && hovered) { color = 'var(--accent-primary)'; bg = 'rgba(47,129,247,0.06)'; }
    else if (hovered) { color = 'var(--text-primary)'; bg = 'var(--bg-elevated)'; }
    else if (muted) { color = 'var(--text-tertiary)'; }

    return (
        <>
            <div
                ref={ref}
                onClick={onClick}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    height: 40, padding: collapsed ? '0' : '0 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: bg, color,
                    fontWeight: active ? 600 : 500,
                    overflow: 'hidden', whiteSpace: 'nowrap',
                    transition: `background 0.15s, color 0.15s`,
                }}
            >
                <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', width: 20, justifyContent: 'center' }}>
                    {icon}
                </span>
                <span style={{
                    fontSize: '0.85rem',
                    maxWidth: collapsed ? 0 : 180,
                    opacity: collapsed ? 0 : 1,
                    overflow: 'hidden',
                    transition: `max-width ${tr}, opacity ${tr}`,
                }}>
                    {label}
                </span>
                {active && !collapsed && (
                    <div style={{
                        marginLeft: 'auto', width: 5, height: 5,
                        borderRadius: '50%', background: 'var(--accent-primary)', flexShrink: 0,
                    }} />
                )}
            </div>

            {/* Tooltip via portal */}
            {portalReady && collapsed && hovered && createPortal(
                <div style={{
                    position: 'fixed',
                    left: W_COLLAPSED + 10,
                    top: tooltipY,
                    transform: 'translateY(-50%)',
                    zIndex: 99999,
                    padding: '5px 12px',
                    borderRadius: 6,
                    background: 'var(--bg-elevated, #1c2128)',
                    border: '1px solid var(--border-color, #373e47)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                    fontSize: '0.78rem', fontWeight: 600,
                    color: active ? 'var(--accent-primary)' : 'var(--text-primary, #e6edf3)',
                    whiteSpace: 'nowrap', pointerEvents: 'none',
                }}>
                    {label}
                </div>,
                document.body
            )}
        </>
    );
}
