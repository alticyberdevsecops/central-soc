'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import { apiRequest, authApi, userApi, tenantApi, slaApi } from '@/lib/api';
import Cookies from 'js-cookie';
import {
    Shield, Lock, Save, AlertCircle, CheckCircle, Users, UserPlus,
    Search, Filter, MoreVertical, Mail, Calendar, Clock,
    ChevronDown, X, Eye, EyeOff, UserCheck, UserX, Trash2,
    Building2, BadgeCheck, Activity, UsersRound, Globe, Pencil, Settings, ShieldAlert,
    ChevronRight, Bell, Edit2, LogOut, LayoutDashboard
} from 'lucide-react';
import SignatureManagement from '@/components/SignatureManagement';

// ── Types ──────────────────────────────────────────────────────
interface UserItem {
    id: string;
    email: string;
    full_name: string;
    role: string;
    tenant_id: string | null;
    tenant_ids: string[];
    dashboards: string[];
    is_active: boolean;
    signature: string | null;
    last_login: string | null;
    created_at: string | null;
}

interface Tenant {
    id: string;
    name: string;
    slug: string;
}

// ── Constants ──────────────────────────────────────────────────
const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    super_admin: { label: 'Super Admin', color: '#f85149', bg: 'rgba(248, 81, 73, 0.12)' },
    customer_admin: { label: 'Tenant Admin', color: '#a371f7', bg: 'rgba(163, 113, 247, 0.12)' },
    analyst: { label: 'Analyst', color: '#2f81f7', bg: 'rgba(47, 129, 247, 0.12)' },
    dashboard_manager: { label: 'Dashboard Manager', color: '#3fb950', bg: 'rgba(63, 185, 80, 0.12)' },
};

const STATUS_CONFIG = {
    active: { label: 'Active', color: '#3fb950', bg: 'rgba(63, 185, 80, 0.12)' },
    inactive: { label: 'Inactive', color: '#7d8590', bg: 'rgba(125, 133, 144, 0.12)' },
};

type SettingsTab = 'account' | 'security' | 'users' | 'teams' | 'email_templates' | 'sla_targets';

export default function SettingsPage() {
    const userRole = Cookies.get('user_role') || 'analyst';
    const isAdmin = userRole === 'super_admin' || userRole === 'customer_admin';
    const [activeTab, setActiveTab] = useState<SettingsTab>('account');

    const tabs: { id: SettingsTab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
        { id: 'account', label: 'Account Settings', icon: <Settings size={18} /> },
        { id: 'security', label: 'Security Settings', icon: <Shield size={18} /> },
        ...(isAdmin ? [
            { id: 'users' as SettingsTab, label: 'User Management', icon: <Users size={18} />, adminOnly: true },
            { id: 'teams' as SettingsTab, label: 'Teams & Levels', icon: <UsersRound size={18} />, adminOnly: true },
            { id: 'email_templates' as SettingsTab, label: 'Email Templates', icon: <Mail size={18} />, adminOnly: true },
            { id: 'sla_targets' as SettingsTab, label: 'SLA Targets', icon: <Clock size={18} />, adminOnly: true },
        ] : []),
    ];

    return (
        <div className="app-container">
            <Sidebar />
            <div className="main-layout">
                <header className="header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Settings</h2>
                    </div>
                </header>

                <main className="content-area" style={{ padding: '1.5rem 2rem', gap: '1.5rem' }}>
                    {/* ── Tab Navigation ── */}
                    <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0' }}>
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    padding: '0.75rem 1.25rem',
                                    fontSize: '0.85rem', fontWeight: activeTab === tab.id ? 700 : 500,
                                    color: activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                    background: 'transparent',
                                    border: 'none',
                                    borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    marginBottom: '-1px',
                                }}
                            >
                                {tab.icon} {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* ── Tab Content ── */}
                    {activeTab === 'account' && <AccountTab />}
                    {activeTab === 'security' && <SecurityTab />}
                    {isAdmin && (
                        <>
                            {activeTab === 'users' && <UserManagementTab userRole={userRole} />}
                            {activeTab === 'teams' && <TeamsTab />}
                            {activeTab === 'email_templates' && <EmailTemplatesTab />}
                            {activeTab === 'sla_targets' && <SLATargetsTab />}
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════
// SECURITY TAB
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// ACCOUNT SETTINGS TAB
// ═══════════════════════════════════════════════════════════════
function AccountTab() {
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const fetchMe = useCallback(async () => {
        try {
            setLoading(true);
            const data = await authApi.me();
            setFullName(data.full_name || '');
            setEmail(data.email || '');
        } catch (err: any) {
            setError(err.message || 'Failed to fetch profile');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchMe(); }, [fetchMe]);

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setIsSubmitting(true);
        try {
            await authApi.updateMe({ full_name: fullName });
            setSuccess('Profile updated successfully');
        } catch (err: any) {
            setError(err.message || 'Failed to update profile');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (loading) return <div style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem', padding: '2rem' }}>Loading profile...</div>;

    return (
        <div className="detail-card" style={{ width: '100%', padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ width: '42px', height: '42px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Settings size={20} color="var(--accent-primary)" />
                </div>
                <div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Account Profile</h3>
                    <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginTop: '0.15rem' }}>Manage your personal details and email signature</p>
                </div>
            </div>

            {error && (
                <div style={{ padding: '0.85rem 1rem', background: 'rgba(248, 81, 73, 0.08)', border: '1px solid rgba(248, 81, 73, 0.25)', borderRadius: 'var(--radius-md)', color: 'var(--status-critical)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}
            {success && (
                <div style={{ padding: '0.85rem 1rem', background: 'rgba(63, 185, 80, 0.08)', border: '1px solid rgba(63, 185, 80, 0.25)', borderRadius: 'var(--radius-md)', color: 'var(--status-low)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                    <CheckCircle size={16} /> {success}
                </div>
            )}

            <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '1.5rem' }}>
                    <div style={{ flex: 1 }}>
                        <FormField label="Full Name" required>
                            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} />
                        </FormField>
                    </div>
                    <div style={{ flex: 1 }}>
                        <FormField label="Email (Read-only)">
                            <input type="text" value={email} disabled style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }} />
                        </FormField>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                    <button type="submit" disabled={isSubmitting} style={{
                        padding: '0.7rem 2rem', background: 'var(--accent-primary)', color: '#fff',
                        border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                        cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1,
                        display: 'flex', alignItems: 'center', gap: '0.5rem'
                    }}>
                        <Save size={16} /> {isSubmitting ? 'Saving...' : 'Update Profile'}
                    </button>
                </div>
            </form>

            <div style={{ marginTop: '3rem' }}>
                <SignatureManagement />
            </div>
        </div>
    );
}


function SecurityTab() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        if (newPassword !== confirmPassword) { setError('New passwords do not match'); return; }
        if (newPassword.length < 8) { setError('Password must be at least 8 characters long'); return; }

        setIsSubmitting(true);
        try {
            await apiRequest('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
            });
            setSuccess('Password updated successfully');
            setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
        } catch (err: any) {
            setError(err.message || 'Failed to change password');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="detail-card" style={{ width: '100%', maxWidth: '800px', padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ width: '42px', height: '42px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Lock size={20} color="var(--accent-primary)" />
                </div>
                <div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Change Password</h3>
                    <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginTop: '0.15rem' }}>Update your authentication credentials</p>
                </div>
            </div>

            {error && (
                <div style={{ padding: '0.85rem 1rem', background: 'rgba(248, 81, 73, 0.08)', border: '1px solid rgba(248, 81, 73, 0.25)', borderRadius: 'var(--radius-md)', color: 'var(--status-critical)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}
            {success && (
                <div style={{ padding: '0.85rem 1rem', background: 'rgba(63, 185, 80, 0.08)', border: '1px solid rgba(63, 185, 80, 0.25)', borderRadius: 'var(--radius-md)', color: 'var(--status-low)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                    <CheckCircle size={16} /> {success}
                </div>
            )}

            <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <PasswordField label="Current Password" value={currentPassword} onChange={setCurrentPassword} show={showCurrent} onToggle={() => setShowCurrent(!showCurrent)} />
                <PasswordField label="New Password" value={newPassword} onChange={setNewPassword} show={showNew} onToggle={() => setShowNew(!showNew)} />
                <PasswordField label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword} show={showNew} onToggle={() => setShowNew(!showNew)} />

                <button type="submit" className="login-button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: 'auto', padding: '0.7rem 2rem', borderRadius: 'var(--radius-md)', color: '#fff', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', marginTop: '0.5rem' }} disabled={isSubmitting}>
                    <Save size={16} /> {isSubmitting ? 'Updating...' : 'Update Password'}
                </button>
            </form>
        </div>
    );
}

function PasswordField({ label, value, onChange, show, onToggle }: { label: string; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.02em' }}>{label}</label>
            <div style={{ position: 'relative' }}>
                <input
                    type={show ? 'text' : 'password'}
                    value={value}
                    onChange={(e: any) => onChange(e.target.value)}
                    required
                    minLength={8}
                    style={{
                        width: '100%', padding: '0.7rem 2.5rem 0.7rem 0.85rem',
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                        fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.2s',
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                />
                <button type="button" onClick={onToggle} style={{
                    position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: '0.25rem',
                }}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
            </div>
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════
// USER MANAGEMENT TAB
// ═══════════════════════════════════════════════════════════════
function UserManagementTab({ userRole }: { userRole: string }) {
    const [users, setUsers] = useState<UserItem[]>([]);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterRole, setFilterRole] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingUser, setEditingUser] = useState<UserItem | null>(null);
    const [resettingUser, setResettingUser] = useState<UserItem | null>(null);
    const [actionMenu, setActionMenu] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const fetchUsers = useCallback(async () => {
        try {
            setLoading(true);
            const params: any = {};
            if (search) params.search = search;
            if (filterRole) params.role = filterRole;
            if (filterStatus) params.is_active = filterStatus === 'active';
            const data = await userApi.list(params);
            setUsers(data.users);
            setTotal(data.total);
        } catch (err) {
            console.error('Failed to fetch users', err);
        } finally {
            setLoading(false);
        }
    }, [search, filterRole, filterStatus]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    useEffect(() => {
        if (userRole === 'super_admin') {
            tenantApi.list().then((data: any) => setTenants(Array.isArray(data) ? data : data.tenants || [])).catch(() => { });
        }
    }, [userRole]);

    useEffect(() => {
        if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }
    }, [toast]);

    const showToast = (message: string, type: 'success' | 'error') => setToast({ message, type });

    const handleToggleStatus = async (user: UserItem) => {
        try {
            await userApi.toggleStatus(user.id);
            showToast(`${user.full_name} ${user.is_active ? 'deactivated' : 'activated'} successfully`, 'success');
            fetchUsers();
        } catch (err: any) {
            showToast(err.message || 'Failed to toggle user status', 'error');
        }
        setActionMenu(null);
    };

    const handleDeleteUser = async (user: UserItem) => {
        try {
            await userApi.delete(user.id);
            showToast(`${user.full_name} removed successfully`, 'success');
            fetchUsers();
        } catch (err: any) {
            showToast(err.message || 'Failed to delete user', 'error');
        }
        setActionMenu(null);
    };

    const activeCount = users.filter(u => u.is_active).length;
    const inactiveCount = users.filter(u => !u.is_active).length;
    const analystCount = users.filter(u => u.role === 'analyst').length;

    const getTenantName = (tid: string | null) => {
        if (!tid) return null;
        const t = tenants.find(t => t.id === tid);
        return t ? t.name : tid.slice(0, 8) + '...';
    };

    const getUserTenantNames = (user: UserItem) => {
        const tids = user.tenant_ids?.length ? user.tenant_ids : (user.tenant_id ? [user.tenant_id] : []);
        if (tids.length === 0) return user.role === 'super_admin' ? ['Platform'] : ['All Tenants'];
        return tids.map(t => getTenantName(t) || t.slice(0, 8));
    };

    const formatDate = (d: string | null) => {
        if (!d) return 'Never';
        return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const formatTime = (d: string | null) => {
        if (!d) return '';
        return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    const timeAgo = (d: string | null) => {
        if (!d) return 'Never';
        const diff = Date.now() - new Date(d).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        if (days < 30) return `${days}d ago`;
        return formatDate(d);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* ── Stats Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                <StatMini icon={<Users size={18} />} label="Total Users" value={total} color="var(--accent-primary)" />
                <StatMini icon={<UserCheck size={18} />} label="Active" value={activeCount} color="#3fb950" />
                <StatMini icon={<UserX size={18} />} label="Inactive" value={inactiveCount} color="#7d8590" />
                <StatMini icon={<Activity size={18} />} label="Analysts" value={analystCount} color="#a371f7" />
            </div>

            {/* ── Toolbar ── */}
            <div className="liquid-glass" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1 }}>
                    {/* Search */}
                    <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
                        <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                        <input
                            type="text"
                            placeholder="Search by name or email..."
                            value={search}
                            onChange={(e: any) => setSearch(e.target.value)}
                            style={{
                                width: '100%', padding: '0.5rem 0.75rem 0.5rem 2.2rem',
                                background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                borderRadius: '8px', color: 'var(--text-primary)',
                                fontSize: '0.8rem', outline: 'none', transition: 'border-color 0.2s',
                            }}
                            onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                            onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                        />
                    </div>

                    {/* Role Filter */}
                    <select
                        value={filterRole}
                        onChange={(e: any) => setFilterRole(e.target.value)}
                        style={{
                            padding: '0.5rem 0.75rem', background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-color)', borderRadius: '8px',
                            color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none', cursor: 'pointer',
                        }}
                    >
                        <option value="">All Roles</option>
                        <option value="super_admin">Super Admin</option>
                        <option value="customer_admin">Tenant Admin</option>
                        <option value="analyst">Analyst</option>
                    </select>

                    {/* Status Filter */}
                    <select
                        value={filterStatus}
                        onChange={(e: any) => setFilterStatus(e.target.value)}
                        style={{
                            padding: '0.5rem 0.75rem', background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-color)', borderRadius: '8px',
                            color: 'var(--text-primary)', fontSize: '0.8rem', outline: 'none', cursor: 'pointer',
                        }}
                    >
                        <option value="">All Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </select>

                    {(search || filterRole || filterStatus) && (
                        <button
                            onClick={() => { setSearch(''); setFilterRole(''); setFilterStatus(''); }}
                            style={{
                                padding: '0.45rem 0.7rem', background: 'rgba(248, 81, 73, 0.1)',
                                border: '1px solid rgba(248, 81, 73, 0.25)', borderRadius: '8px',
                                color: 'var(--status-critical)', fontSize: '0.75rem', fontWeight: 600,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
                            }}
                        >
                            <X size={13} /> Clear
                        </button>
                    )}
                </div>

                {/* Add User Button */}
                <button
                    onClick={() => setShowAddModal(true)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.55rem 1.15rem',
                        background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
                        border: 'none', borderRadius: '8px',
                        color: '#fff', fontSize: '0.82rem', fontWeight: 600,
                        cursor: 'pointer', transition: 'all 0.2s',
                        boxShadow: '0 2px 10px rgba(47, 129, 247, 0.3)',
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(47, 129, 247, 0.45)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(47, 129, 247, 0.3)'; }}
                >
                    <UserPlus size={16} /> Add User
                </button>
            </div>

            {/* ── Users Table ── */}
            <div className="table-container">
                <table className="incident-table" style={{ minWidth: '100%' }}>
                    <thead>
                        <tr>
                            <th style={{ width: '30%' }}>User</th>
                            <th>Role</th>
                            {userRole === 'super_admin' && <th>Tenant</th>}
                            <th>Status</th>
                            <th>Last Login</th>
                            <th>Joined</th>
                            <th style={{ width: '60px', textAlign: 'center' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={userRole === 'super_admin' ? 7 : 6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-tertiary)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                    <div className="animate-spin" style={{ width: '18px', height: '18px', border: '2px solid var(--border-color)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%' }} />
                                    Loading users...
                                </div>
                            </td></tr>
                        ) : users.length === 0 ? (
                            <tr><td colSpan={userRole === 'super_admin' ? 7 : 6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-tertiary)' }}>
                                <Users size={32} style={{ opacity: 0.3, marginBottom: '0.5rem' }} /><br />
                                No users found
                            </td></tr>
                        ) : users.map(user => {
                            const rc = ROLE_CONFIG[user.role] || ROLE_CONFIG.analyst;
                            const sc = user.is_active ? STATUS_CONFIG.active : STATUS_CONFIG.inactive;
                            return (
                                <tr key={user.id} style={{ transition: 'background 0.15s' }}>
                                    {/* User Info */}
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                                            <div style={{
                                                width: '36px', height: '36px', borderRadius: '10px',
                                                background: `linear-gradient(135deg, ${rc.bg}, transparent)`,
                                                border: `1px solid ${rc.color}30`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.8rem', fontWeight: 700, color: rc.color,
                                                flexShrink: 0,
                                            }}>
                                                {user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{user.full_name}</div>
                                                <div style={{ fontSize: '0.73rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.1rem' }}>
                                                    <Mail size={11} /> {user.email}
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    {/* Role */}
                                    <td>
                                        <span style={{
                                            padding: '0.25rem 0.65rem', borderRadius: '6px',
                                            fontSize: '0.72rem', fontWeight: 700,
                                            background: rc.bg, color: rc.color,
                                            border: `1px solid ${rc.color}25`,
                                        }}>
                                            {rc.label}
                                        </span>
                                    </td>

                                    {/* Tenant */}
                                    {userRole === 'super_admin' && (
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                                                {getUserTenantNames(user).map((name, i) => (
                                                    <span key={i} style={{
                                                        fontSize: '0.68rem', fontWeight: 600,
                                                        padding: '0.15rem 0.5rem', borderRadius: '5px',
                                                        background: (user.tenant_ids?.length || 0) === 0 && user.role !== 'super_admin'
                                                            ? 'rgba(163,113,247,0.1)' : 'rgba(47,129,247,0.1)',
                                                        color: (user.tenant_ids?.length || 0) === 0 && user.role !== 'super_admin'
                                                            ? '#a371f7' : 'var(--accent-primary)',
                                                        border: `1px solid ${(user.tenant_ids?.length || 0) === 0 && user.role !== 'super_admin' ? 'rgba(163,113,247,0.2)' : 'rgba(47,129,247,0.2)'}`,
                                                        display: 'flex', alignItems: 'center', gap: '0.25rem',
                                                    }}>
                                                        {(user.tenant_ids?.length || 0) === 0 && user.role !== 'super_admin'
                                                            ? <Globe size={10} /> : <Building2 size={10} />}
                                                        {name}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                    )}

                                    {/* Status */}
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <div style={{
                                                width: '7px', height: '7px', borderRadius: '50%',
                                                background: sc.color,
                                                boxShadow: user.is_active ? `0 0 6px ${sc.color}` : 'none',
                                            }} />
                                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: sc.color }}>{sc.label}</span>
                                        </div>
                                    </td>

                                    {/* Last Login */}
                                    <td>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            {user.last_login ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                    <Clock size={12} /> {timeAgo(user.last_login)}
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', fontSize: '0.75rem' }}>Never</span>
                                            )}
                                        </div>
                                    </td>

                                    {/* Joined */}
                                    <td>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                                            {formatDate(user.created_at)}
                                        </div>
                                    </td>

                                    {/* Actions */}
                                    <td style={{ textAlign: 'center', position: 'relative' }}>
                                        <button
                                            onClick={() => setActionMenu(actionMenu === user.id ? null : user.id)}
                                            style={{
                                                background: actionMenu === user.id ? 'var(--bg-elevated)' : 'transparent',
                                                border: '1px solid transparent',
                                                borderRadius: '6px', padding: '0.35rem',
                                                color: 'var(--text-secondary)', cursor: 'pointer',
                                                transition: 'all 0.15s',
                                            }}
                                            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                                            onMouseOut={(e) => { if (actionMenu !== user.id) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; } }}
                                        >
                                            <MoreVertical size={16} />
                                        </button>

                                        {/* Action Dropdown */}
                                        {actionMenu === user.id && (
                                            <>
                                                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setActionMenu(null)} />
                                                <div style={{
                                                    position: 'absolute', right: 0, top: '100%', zIndex: 100,
                                                    background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                                                    borderRadius: '10px', boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
                                                    minWidth: '180px', overflow: 'hidden',
                                                    animation: 'fadeIn 0.15s ease',
                                                }}>
                                                    <ActionItem
                                                        icon={<Pencil size={14} />}
                                                        label="Edit User"
                                                        color="var(--accent-primary)"
                                                        onClick={() => { setEditingUser(user); setActionMenu(null); }}
                                                    />
                                                    <ActionItem
                                                        icon={user.is_active ? <UserX size={14} /> : <UserCheck size={14} />}
                                                        label={user.is_active ? 'Deactivate' : 'Activate'}
                                                        color={user.is_active ? 'var(--status-medium)' : 'var(--status-low)'}
                                                        onClick={() => handleToggleStatus(user)}
                                                    />
                                                    {userRole === 'super_admin' && (
                                                        <ActionItem
                                                            icon={<Lock size={14} />}
                                                            label="Reset Password"
                                                            color="var(--accent-secondary)"
                                                            onClick={() => { setResettingUser(user); setActionMenu(null); }}
                                                        />
                                                    )}
                                                    {userRole === 'super_admin' && (
                                                        <ActionItem
                                                            icon={<Trash2 size={14} />}
                                                            label="Remove User"
                                                            color="var(--status-critical)"
                                                            onClick={() => handleDeleteUser(user)}
                                                        />
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* ── Add User Modal ── */}
            {showAddModal && (
                <AddUserModal
                    userRole={userRole}
                    tenants={tenants}
                    onClose={() => setShowAddModal(false)}
                    onSuccess={(msg) => { showToast(msg, 'success'); fetchUsers(); }}
                    onError={(msg) => showToast(msg, 'error')}
                />
            )}

            {/* ── Edit User Modal ── */}
            {editingUser && (
                <EditUserModal
                    userRole={userRole}
                    tenants={tenants}
                    user={editingUser}
                    onClose={() => setEditingUser(null)}
                    onSuccess={(msg) => { showToast(msg, 'success'); fetchUsers(); setEditingUser(null); }}
                    onError={(msg) => showToast(msg, 'error')}
                />
            )}

            {/* ── Reset Password Modal ── */}
            {resettingUser && (
                <ResetPasswordModal
                    user={resettingUser}
                    onClose={() => setResettingUser(null)}
                    onSuccess={(msg) => showToast(msg, 'success')}
                    onError={(msg) => showToast(msg, 'error')}
                />
            )}

            {/* ── Toast ── */}
            {toast && (
                <div style={{
                    position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 9999,
                    padding: '0.85rem 1.25rem', borderRadius: '10px',
                    background: toast.type === 'success' ? 'rgba(63, 185, 80, 0.12)' : 'rgba(248, 81, 73, 0.12)',
                    border: `1px solid ${toast.type === 'success' ? 'rgba(63, 185, 80, 0.3)' : 'rgba(248, 81, 73, 0.3)'}`,
                    color: toast.type === 'success' ? '#3fb950' : '#f85149',
                    fontSize: '0.85rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    backdropFilter: 'blur(16px)', boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
                    animation: 'slideUp 0.3s ease',
                }}>
                    {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {toast.message}
                </div>
            )}

            <style>{`
                @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}


// ── Stat Mini Card ─────────────────────────────────────────────
function StatMini({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
    return (
        <div className="liquid-glass" style={{ padding: '1rem 1.15rem', display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{
                width: '38px', height: '38px', borderRadius: '10px',
                background: `${color}15`, border: `1px solid ${color}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: color, flexShrink: 0,
            }}>
                {icon}
            </div>
            <div>
                <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-tertiary)', marginTop: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            </div>
        </div>
    );
}


// ── Action Menu Item ───────────────────────────────────────────
function ActionItem({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%',
                padding: '0.65rem 1rem', background: 'transparent', border: 'none',
                color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 500,
                cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = `${color}12`; e.currentTarget.style.color = color; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
            {icon} {label}
        </button>
    );
}


// ═══════════════════════════════════════════════════════════════
// MULTI-SELECT TENANT CHECKBOXES (shared between Add & Edit modals)
// ═══════════════════════════════════════════════════════════════
function TenantMultiSelect({ tenants, selectedIds, onChange }: {
    tenants: Tenant[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
}) {
    const toggle = (tid: string) => {
        if (selectedIds.includes(tid)) onChange(selectedIds.filter(t => t !== tid));
        else onChange([...selectedIds, tid]);
    };
    const selectAll = () => onChange(tenants.map(t => t.id));
    const selectNone = () => onChange([]);

    return (
        <div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button type="button" onClick={selectAll} style={{
                    fontSize: '0.68rem', fontWeight: 600, color: 'var(--accent-primary)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline',
                }}>Select All</button>
                <button type="button" onClick={selectNone} style={{
                    fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline',
                }}>Clear</button>
            </div>
            <div style={{
                maxHeight: '180px', overflowY: 'auto',
                border: '1px solid var(--border-color)', borderRadius: '8px',
                background: 'var(--bg-tertiary)',
            }}>
                {tenants.map(t => {
                    const checked = selectedIds.includes(t.id);
                    return (
                        <label
                            key={t.id}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.6rem',
                                padding: '0.5rem 0.85rem', cursor: 'pointer',
                                background: checked ? 'rgba(47,129,247,0.06)' : 'transparent',
                                borderBottom: '1px solid var(--border-subtle)',
                                transition: 'background 0.15s',
                            }}
                            onMouseOver={(e) => e.currentTarget.style.background = checked ? 'rgba(47,129,247,0.1)' : 'rgba(255,255,255,0.02)'}
                            onMouseOut={(e) => e.currentTarget.style.background = checked ? 'rgba(47,129,247,0.06)' : 'transparent'}
                        >
                            <input
                                type="checkbox" checked={checked}
                                onChange={() => toggle(t.id)}
                                style={{ accentColor: 'var(--accent-primary)', width: '15px', height: '15px', cursor: 'pointer' }}
                            />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <Building2 size={13} style={{ color: checked ? 'var(--accent-primary)' : 'var(--text-tertiary)' }} />
                                <span style={{
                                    fontSize: '0.82rem', fontWeight: checked ? 600 : 500,
                                    color: checked ? 'var(--text-primary)' : 'var(--text-secondary)',
                                }}>{t.name}</span>
                            </div>
                        </label>
                    );
                })}
            </div>
            {selectedIds.length > 0 && (
                <div style={{ marginTop: '0.4rem', fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                    {selectedIds.length} tenant{selectedIds.length > 1 ? 's' : ''} selected
                </div>
            )}
        </div>
    );
}
// ═══════════════════════════════════════════════════════════════
// MULTI-SELECT DASHBOARD CHECKBOXES
// ═══════════════════════════════════════════════════════════════
const AVAILABLE_DASHBOARDS = [
    { id: 'overview', label: 'Overview Dashboard' },
    { id: 'sla', label: 'SLA Dashboard' },
    { id: 'ciso', label: 'CISO Dashboard' },
];

function DashboardMultiSelect({ selectedIds, onChange }: {
    selectedIds: string[];
    onChange: (ids: string[]) => void;
}) {
    const toggle = (id: string) => {
        if (selectedIds.includes(id)) onChange(selectedIds.filter(t => t !== id));
        else onChange([...selectedIds, id]);
    };
    const selectAll = () => onChange(AVAILABLE_DASHBOARDS.map(d => d.id));
    const selectNone = () => onChange([]);

    return (
        <div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button type="button" onClick={selectAll} style={{
                    fontSize: '0.68rem', fontWeight: 600, color: 'var(--accent-primary)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline',
                }}>Select All</button>
                <button type="button" onClick={selectNone} style={{
                    fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-tertiary)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline',
                }}>Clear</button>
            </div>
            <div style={{
                maxHeight: '180px', overflowY: 'auto',
                border: '1px solid var(--border-color)', borderRadius: '8px',
                background: 'var(--bg-tertiary)',
            }}>
                {AVAILABLE_DASHBOARDS.map(d => {
                    const checked = selectedIds.includes(d.id);
                    return (
                        <label
                            key={d.id}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.6rem',
                                padding: '0.5rem 0.85rem', cursor: 'pointer',
                                background: checked ? 'rgba(63, 185, 80, 0.06)' : 'transparent',
                                borderBottom: '1px solid var(--border-subtle)',
                                transition: 'background 0.15s',
                            }}
                            onMouseOver={(e) => e.currentTarget.style.background = checked ? 'rgba(63, 185, 80, 0.1)' : 'rgba(255,255,255,0.02)'}
                            onMouseOut={(e) => e.currentTarget.style.background = checked ? 'rgba(63, 185, 80, 0.06)' : 'transparent'}
                        >
                            <input
                                type="checkbox" checked={checked}
                                onChange={() => toggle(d.id)}
                                style={{ accentColor: '#3fb950', width: '15px', height: '15px', cursor: 'pointer' }}
                            />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <LayoutDashboard size={13} style={{ color: checked ? '#3fb950' : 'var(--text-tertiary)' }} />
                                <span style={{
                                    fontSize: '0.82rem', fontWeight: checked ? 600 : 500,
                                    color: checked ? 'var(--text-primary)' : 'var(--text-secondary)',
                                }}>{d.label}</span>
                            </div>
                        </label>
                    );
                })}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// ADD USER MODAL
// ═══════════════════════════════════════════════════════════════
function AddUserModal({ userRole, tenants, onClose, onSuccess, onError }: {
    userRole: string;
    tenants: Tenant[];
    onClose: () => void;
    onSuccess: (msg: string) => void;
    onError: (msg: string) => void;
}) {
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('analyst');
    const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>([]);
    const [selectedDashboards, setSelectedDashboards] = useState<string[]>([]);
    const [signature, setSignature] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const currentTenantId = Cookies.get('tenant_id') || '';

    const generatePassword = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
        let pw = '';
        for (let i = 0; i < 14; i++) pw += chars[Math.floor(Math.random() * chars.length)];
        setPassword(pw);
        setShowPassword(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!fullName || !email || !password) return;
        if (password.length < 8) { onError('Password must be at least 8 characters'); return; }

        setIsSubmitting(true);
        try {
            const payload: any = { full_name: fullName, email, password, role, signature, dashboards: selectedDashboards };
            if (userRole === 'super_admin' && selectedTenantIds.length > 0) {
                payload.tenant_ids = selectedTenantIds;
            } else if (userRole === 'customer_admin' && currentTenantId) {
                payload.tenant_ids = [currentTenantId];
            }
            await userApi.create(payload);
            onSuccess(`${fullName} has been added as ${ROLE_CONFIG[role]?.label || role}`);
            onClose();
        } catch (err: any) {
            onError(err.message || 'Failed to create user');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
            animation: 'fadeIn 0.2s ease',
        }} onClick={onClose}>
            <div
                style={{
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                    borderRadius: '16px', width: '100%', maxWidth: '480px',
                    maxHeight: '90vh', overflowY: 'auto',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                    animation: 'slideUp 0.25s ease',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '10px',
                            background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <UserPlus size={20} color="var(--accent-primary)" />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Add New User</h3>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.1rem' }}>
                                User will be able to login with these credentials
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                        borderRadius: '8px', padding: '0.35rem', cursor: 'pointer', color: 'var(--text-secondary)',
                    }}>
                        <X size={16} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
                    {/* Full Name */}
                    <FormField label="Full Name" required>
                        <input
                            type="text" value={fullName} onChange={(e: any) => setFullName(e.target.value)} required
                            placeholder="e.g. John Doe"
                            style={inputStyle}
                            onFocus={inputFocus} onBlur={inputBlur}
                        />
                    </FormField>

                    {/* Email */}
                    <FormField label="Email Address" required>
                        <input
                            type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} required
                            placeholder="e.g. john@company.com"
                            style={inputStyle}
                            onFocus={inputFocus} onBlur={inputBlur}
                        />
                    </FormField>

                    {/* Signature */}
                    <FormField label="Email Signature (Optional)">
                        <textarea
                            value={signature} onChange={(e: any) => setSignature(e.target.value)}
                            placeholder="User's email signature..."
                            style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                            onFocus={inputFocus} onBlur={inputBlur}
                        />
                    </FormField>

                    {/* Password */}
                    <FormField label="Password" required>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                                <input
                                    type={showPassword ? 'text' : 'password'} value={password}
                                    onChange={(e: any) => setPassword(e.target.value)} required minLength={8}
                                    placeholder="Min 8 characters"
                                    style={inputStyle}
                                    onFocus={inputFocus} onBlur={inputBlur}
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{
                                    position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                                }}>
                                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                            <button type="button" onClick={generatePassword} style={{
                                padding: '0 0.85rem', background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-color)', borderRadius: '8px',
                                color: 'var(--accent-primary)', fontSize: '0.75rem', fontWeight: 600,
                                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
                            }}
                                onMouseOver={(e) => { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
                                onMouseOut={(e) => { e.currentTarget.style.background = 'var(--bg-tertiary)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                            >
                                Generate
                            </button>
                        </div>
                    </FormField>

                    {/* Role */}
                    <FormField label="Role">
                        <select value={role} onChange={(e: any) => setRole(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            {userRole === 'super_admin' && <option value="super_admin">Super Admin</option>}
                            {userRole === 'super_admin' && <option value="customer_admin">Tenant Admin</option>}
                            <option value="analyst">Analyst</option>
                            <option value="dashboard_manager">Dashboard Manager</option>
                        </select>
                    </FormField>

                    {/* Dashboard Multi-select (only for dashboard manager) */}
                    {role === 'dashboard_manager' && (
                        <FormField label="Dashboard Permissions">
                            <DashboardMultiSelect
                                selectedIds={selectedDashboards}
                                onChange={setSelectedDashboards}
                            />
                            <div style={{
                                marginTop: '0.4rem', padding: '0.55rem 0.75rem',
                                background: 'rgba(63, 185, 80, 0.08)', borderRadius: '8px',
                                border: '1px solid rgba(63, 185, 80, 0.15)',
                                fontSize: '0.73rem', color: '#3fb950', lineHeight: 1.5,
                                display: 'flex', alignItems: 'flex-start', gap: '0.4rem',
                            }}>
                                <LayoutDashboard size={14} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                                <span>Select which dashboards this user can access.</span>
                            </div>
                        </FormField>
                    )}

                    {/* Tenant Multi-select (super admin only, not for super_admin role) */}
                    {userRole === 'super_admin' && role !== 'super_admin' && tenants.length > 0 && (
                        <FormField label="Assign to Tenants">
                            <TenantMultiSelect
                                tenants={tenants}
                                selectedIds={selectedTenantIds}
                                onChange={setSelectedTenantIds}
                            />
                            {selectedTenantIds.length === 0 && (
                                <div style={{
                                    marginTop: '0.4rem', padding: '0.55rem 0.75rem',
                                    background: 'rgba(163, 113, 247, 0.08)', borderRadius: '8px',
                                    border: '1px solid rgba(163, 113, 247, 0.15)',
                                    fontSize: '0.73rem', color: '#a371f7', lineHeight: 1.5,
                                    display: 'flex', alignItems: 'flex-start', gap: '0.4rem',
                                }}>
                                    <Globe size={14} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                                    <span>No tenants selected — user will have cross-tenant access to all.</span>
                                </div>
                            )}
                        </FormField>
                    )}

                    {/* Info Note */}
                    <div style={{
                        padding: '0.75rem 1rem', background: 'var(--accent-soft)',
                        borderRadius: '8px', border: '1px solid rgba(47, 129, 247, 0.15)',
                        fontSize: '0.76rem', color: 'var(--accent-primary)',
                        display: 'flex', alignItems: 'flex-start', gap: '0.5rem', lineHeight: 1.5,
                    }}>
                        <BadgeCheck size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                        <span>Share the credentials securely with the user. They can change their password after first login from Settings.</span>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                        <button type="button" onClick={onClose} style={{
                            padding: '0.6rem 1.25rem', background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-color)', borderRadius: '8px',
                            color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600,
                            cursor: 'pointer', transition: 'all 0.15s',
                        }}
                            onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; }}
                            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                        >
                            Cancel
                        </button>
                        <button type="submit" disabled={isSubmitting} style={{
                            padding: '0.6rem 1.5rem',
                            background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
                            border: 'none', borderRadius: '8px',
                            color: '#fff', fontSize: '0.82rem', fontWeight: 600,
                            cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1,
                            transition: 'all 0.15s',
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            boxShadow: '0 2px 10px rgba(47, 129, 247, 0.3)',
                        }}>
                            {isSubmitting ? (
                                <><div className="animate-spin" style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%' }} /> Creating...</>
                            ) : (
                                <><UserPlus size={15} /> Create User</>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════
// EDIT USER MODAL
// ═══════════════════════════════════════════════════════════════
function EditUserModal({ userRole, tenants, user, onClose, onSuccess, onError }: {
    userRole: string;
    tenants: Tenant[];
    user: UserItem;
    onClose: () => void;
    onSuccess: (msg: string) => void;
    onError: (msg: string) => void;
}) {
    const [fullName, setFullName] = useState(user.full_name);
    const [role, setRole] = useState(user.role);
    const [selectedTenantIds, setSelectedTenantIds] = useState<string[]>(
        user.tenant_ids?.length ? user.tenant_ids : (user.tenant_id ? [user.tenant_id] : [])
    );
    const [selectedDashboards, setSelectedDashboards] = useState<string[]>(user.dashboards || []);
    const [signature, setSignature] = useState(user.signature || '');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const payload: any = {};
            if (fullName !== user.full_name) payload.full_name = fullName;
            if (role !== user.role) payload.role = role;
            if (signature !== user.signature) payload.signature = signature;
            // Always send tenant_ids and dashboards so admin can update assignments
            payload.tenant_ids = selectedTenantIds;
            payload.dashboards = selectedDashboards;
            await userApi.update(user.id, payload);
            onSuccess(`${fullName} updated successfully`);
        } catch (err: any) {
            onError(err.message || 'Failed to update user');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
            animation: 'fadeIn 0.2s ease',
        }} onClick={onClose}>
            <div
                style={{
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                    borderRadius: '16px', width: '100%', maxWidth: '480px',
                    maxHeight: '90vh', overflowY: 'auto',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                    animation: 'slideUp 0.25s ease',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '10px',
                            background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <Pencil size={20} color="var(--accent-primary)" />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Edit User</h3>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.1rem' }}>
                                {user.email}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                        borderRadius: '8px', padding: '0.35rem', cursor: 'pointer', color: 'var(--text-secondary)',
                    }}>
                        <X size={16} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
                    {/* Full Name */}
                    <FormField label="Full Name">
                        <input
                            type="text" value={fullName} onChange={(e: any) => setFullName(e.target.value)}
                            style={inputStyle}
                            onFocus={inputFocus} onBlur={inputBlur}
                        />
                    </FormField>

                    {/* Signature */}
                    <FormField label="Email Signature">
                        <textarea
                            value={signature} onChange={(e: any) => setSignature(e.target.value)}
                            style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                            onFocus={inputFocus} onBlur={inputBlur}
                        />
                    </FormField>

                    {/* Role */}
                    <FormField label="Role">
                        <select value={role} onChange={(e: any) => setRole(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            {userRole === 'super_admin' && <option value="super_admin">Super Admin</option>}
                            {userRole === 'super_admin' && <option value="customer_admin">Tenant Admin</option>}
                            <option value="analyst">Analyst</option>
                            <option value="dashboard_manager">Dashboard Manager</option>
                        </select>
                    </FormField>

                    {/* Dashboard Multi-select */}
                    {role === 'dashboard_manager' && (
                        <FormField label="Dashboard Permissions">
                            <DashboardMultiSelect
                                selectedIds={selectedDashboards}
                                onChange={setSelectedDashboards}
                            />
                        </FormField>
                    )}

                    {/* Tenant Multi-select */}
                    {role !== 'super_admin' && tenants.length > 0 && (
                        <FormField label="Assigned Tenants">
                            <TenantMultiSelect
                                tenants={tenants}
                                selectedIds={selectedTenantIds}
                                onChange={setSelectedTenantIds}
                            />
                            {selectedTenantIds.length === 0 && (
                                <div style={{
                                    marginTop: '0.4rem', padding: '0.55rem 0.75rem',
                                    background: 'rgba(163, 113, 247, 0.08)', borderRadius: '8px',
                                    border: '1px solid rgba(163, 113, 247, 0.15)',
                                    fontSize: '0.73rem', color: '#a371f7', lineHeight: 1.5,
                                    display: 'flex', alignItems: 'flex-start', gap: '0.4rem',
                                }}>
                                    <Globe size={14} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                                    <span>No tenants selected — user will have cross-tenant access to all.</span>
                                </div>
                            )}
                        </FormField>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                        <button type="button" onClick={onClose} style={{
                            padding: '0.6rem 1.25rem', background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border-color)', borderRadius: '8px',
                            color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600,
                            cursor: 'pointer', transition: 'all 0.15s',
                        }}
                            onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; }}
                            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                        >
                            Cancel
                        </button>
                        <button type="submit" disabled={isSubmitting} style={{
                            padding: '0.6rem 1.5rem',
                            background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
                            border: 'none', borderRadius: '8px',
                            color: '#fff', fontSize: '0.82rem', fontWeight: 600,
                            cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1,
                            transition: 'all 0.15s',
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            boxShadow: '0 2px 10px rgba(47, 129, 247, 0.3)',
                        }}>
                            {isSubmitting ? (
                                <><div className="animate-spin" style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%' }} /> Saving...</>
                            ) : (
                                <><Save size={15} /> Save Changes</>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════
// RESET PASSWORD MODAL
// ═══════════════════════════════════════════════════════════════
function ResetPasswordModal({ user, onClose, onSuccess, onError }: {
    user: UserItem;
    onClose: () => void;
    onSuccess: (msg: string) => void;
    onError: (msg: string) => void;
}) {
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const generatePassword = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
        let pw = '';
        for (let i = 0; i < 14; i++) pw += chars[Math.floor(Math.random() * chars.length)];
        setPassword(pw);
        setShowPassword(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password) return;
        if (password.length < 8) { onError('Password must be at least 8 characters'); return; }

        setIsSubmitting(true);
        try {
            await userApi.resetPassword(user.id, password);
            onSuccess(`Password for ${user.full_name} has been reset successfully.`);
            onClose();
        } catch (err: any) {
            onError(err.message || 'Failed to reset password');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
            animation: 'fadeIn 0.2s ease',
        }} onClick={onClose}>
            <div
                style={{
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                    borderRadius: '16px', width: '100%', maxWidth: '440px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                    animation: 'slideUp 0.25s ease',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(210, 153, 34, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Lock size={18} color="#d29922" />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Reset Password</h3>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{user.email}</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}><X size={18} /></button>
                </div>

                <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <FormField label="New Password" required>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <div style={{ position: 'relative', flex: 1 }}>
                                <input
                                    type={showPassword ? 'text' : 'password'} value={password}
                                    onChange={(e: any) => setPassword(e.target.value)} required minLength={8}
                                    placeholder="Enter new password"
                                    style={inputStyle}
                                    onFocus={inputFocus} onBlur={inputBlur}
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{
                                    position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)',
                                    background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer',
                                }}>
                                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                            </div>
                            <button type="button" onClick={generatePassword} style={{
                                padding: '0 0.75rem', background: 'var(--bg-tertiary)',
                                border: '1px solid var(--border-color)', borderRadius: '8px',
                                color: 'var(--accent-primary)', fontSize: '0.75rem', fontWeight: 600,
                                cursor: 'pointer',
                            }}>Generate</button>
                        </div>
                    </FormField>

                    <div style={{
                        padding: '0.75rem 0.85rem', background: 'rgba(210, 153, 34, 0.08)',
                        borderRadius: '8px', border: '1px solid rgba(210, 153, 34, 0.15)',
                        fontSize: '0.72rem', color: '#d29922', display: 'flex', gap: '0.5rem', lineHeight: 1.4
                    }}>
                        <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span>The user will be able to log in immediately with this new password. Ensure you communicate it securely.</span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                        <button type="button" onClick={onClose} style={{
                            padding: '0.55rem 1rem', background: 'transparent',
                            border: '1px solid var(--border-color)', borderRadius: '8px',
                            color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
                        }}>Cancel</button>
                        <button type="submit" disabled={isSubmitting || !password} style={{
                            padding: '0.55rem 1.25rem', background: '#d29922', color: '#fff',
                            border: 'none', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
                            cursor: (isSubmitting || !password) ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1,
                        }}>
                            {isSubmitting ? 'Resetting...' : 'Reset Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}


// ── Form Field Wrapper ─────────────────────────────────────────
function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {label} {required && <span style={{ color: 'var(--status-critical)' }}>*</span>}
            </label>
            {children}
        </div>
    );
}

// ── Shared Input Styles ────────────────────────────────────────
const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.65rem 0.85rem',
    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
    borderRadius: '8px', color: 'var(--text-primary)',
    fontSize: '0.875rem', outline: 'none', transition: 'border-color 0.2s',
};

const inputFocus = (e: any) => e.currentTarget.style.borderColor = 'var(--accent-primary)';
const inputBlur = (e: any) => e.currentTarget.style.borderColor = 'var(--border-color)';


// ═══════════════════════════════════════════════════════════════
// TEAMS & LEVELS TAB
// ═══════════════════════════════════════════════════════════════
function TeamsTab() {
    const [teams, setTeams] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTeam, setSelectedTeam] = useState<any>(null);
    const [levels, setLevels] = useState<any[]>([]);
    const [showAddTeam, setShowAddTeam] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');
    const [newTeamDesc, setNewTeamDesc] = useState('');

    const tenantId = Cookies.get('tenant_id') || '';

    const fetchTeams = useCallback(async () => {
        if (!tenantId) return;
        try {
            setLoading(true);
            const data = await tenantApi.listTeams(tenantId);
            setTeams(data.teams || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => { fetchTeams(); }, [fetchTeams]);

    const fetchLevels = async (teamId: string) => {
        try {
            const data = await tenantApi.listLevels(teamId);
            setLevels(data.levels || []);
        } catch (err) {
            console.error(err);
        }
    };

    const handleAddTeam = async () => {
        if (!newTeamName) return;
        if (!tenantId) {
            alert("No tenant selected. Please select a tenant from the 'Tenants' page first.");
            return;
        }
        try {
            await tenantApi.createTeam(tenantId, { name: newTeamName, description: newTeamDesc });
            setNewTeamName(''); setNewTeamDesc(''); setShowAddTeam(false);
            fetchTeams();
        } catch (err: any) {
            console.error(err);
            alert(`Failed to create team: ${err.message}`);
        }
    };

    const handleDeleteTeam = async (id: string) => {
        if (!confirm('Are you sure you want to delete this team?')) return;
        try {
            await tenantApi.deleteTeam(tenantId, id);
            if (selectedTeam?.id === id) { setSelectedTeam(null); setLevels([]); }
            fetchTeams();
        } catch (err: any) {
            console.error(err);
            alert(`Failed to delete team: ${err.message}`);
        }
    };

    const handleAddLevel = async (teamId: string) => {
        const nextNum = levels.length + 1;
        try {
            await tenantApi.createLevel(teamId, { level_number: nextNum, escalation_time_min: 30 });
            fetchLevels(teamId);
        } catch (err: any) {
            console.error(err);
            alert(`Failed to add level: ${err.message}`);
        }
    };

    const handleDeleteLevel = async (levelId: string) => {
        try {
            await tenantApi.deleteLevel(levelId);
            fetchLevels(selectedTeam.id);
        } catch (err: any) {
            console.error(err);
            alert(`Failed to delete level: ${err.message}`);
        }
    };

    const handleUpdateLevelDelay = async (levelId: string, time: number) => {
        try {
            await tenantApi.updateLevel(levelId, { escalation_time_min: time });
            fetchLevels(selectedTeam.id);
        } catch (err: any) {
            console.error(err);
            alert(`Failed to update delay: ${err.message}`);
        }
    };

    const handleAddEmail = async (levelId: string) => {
        const email = prompt("Enter email address:");
        if (!email) return;
        try {
            await tenantApi.addEmail(levelId, { email });
            fetchLevels(selectedTeam.id);
        } catch (err: any) {
            console.error(err);
            alert(`Failed to add email: ${err.message}`);
        }
    };

    const handleRemoveEmail = async (levelId: string, emailId: string) => {
        try {
            await tenantApi.removeEmail(levelId, emailId);
            fetchLevels(selectedTeam.id);
        } catch (err: any) {
            console.error(err);
            alert(`Failed to remove email: ${err.message}`);
        }
    };

    if (!tenantId) {
        return (
            <div className="liquid-glass" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', padding: '2rem' }}>
                <div style={{ padding: '1rem', background: 'rgba(248,81,73,0.1)', border: '1px solid var(--status-critical)', borderRadius: '12px', textAlign: 'center', maxWidth: '400px' }}>
                    <h3 style={{ color: 'var(--status-critical)', marginBottom: '0.5rem' }}>No Tenant Context</h3>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        You must select a tenant to manage their teams and escalation levels.
                        Go to the <strong>Tenants</strong> page and click <strong>Manage Tenant</strong>.
                    </p>
                </div>
                <button
                    onClick={() => window.location.href = '/tenants'}
                    style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.6rem 1.2rem', fontWeight: 600, cursor: 'pointer' }}
                >
                    Go to Tenants
                </button>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Team Quick-Select Dropdown */}
            <div className="liquid-glass" style={{ padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Select Team:</label>
                <select
                    value={selectedTeam?.id || ''}
                    onChange={e => {
                        const t = teams.find(t => t.id === e.target.value) || null;
                        setSelectedTeam(t);
                        if (t) fetchLevels(t.id);
                        else setLevels([]);
                    }}
                    style={{
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                        borderRadius: '8px', padding: '0.45rem 0.85rem', color: 'var(--text-primary)',
                        fontSize: '0.875rem', cursor: 'pointer', minWidth: '220px', outline: 'none'
                    }}
                >
                    <option value="">— Choose a team —</option>
                    {teams.map(t => (
                        <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                    ))}
                </select>
                {selectedTeam && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                        {levels.length} level{levels.length !== 1 ? 's' : ''} configured
                    </span>
                )}
            </div>

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem', height: 'calc(100vh - 310px)' }}>
            {/* Teams Sidebar */}
            <div className="liquid-glass" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Teams</h3>
                    <button onClick={() => setShowAddTeam(true)} style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.3rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer' }}>
                        + Add
                    </button>
                </div>

                {showAddTeam && (
                    <div style={{ background: 'var(--bg-tertiary)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <input placeholder="Team Name" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.4rem', color: 'var(--text-primary)', fontSize: '0.8rem' }} />
                        <input placeholder="Description" value={newTeamDesc} onChange={e => setNewTeamDesc(e.target.value)} style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '0.4rem', color: 'var(--text-primary)', fontSize: '0.8rem' }} />
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button onClick={handleAddTeam} style={{ flex: 1, padding: '0.4rem', background: 'var(--accent-primary)', border: 'none', color: '#fff', borderRadius: '4px', fontSize: '0.75rem' }}>Save</button>
                            <button onClick={() => setShowAddTeam(false)} style={{ flex: 1, padding: '0.4rem', background: 'var(--bg-elevated)', border: 'none', color: 'var(--text-secondary)', borderRadius: '4px', fontSize: '0.75rem' }}>Cancel</button>
                        </div>
                    </div>
                )}

                <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {loading ? <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Loading teams...</p> :
                        teams.length === 0 ? <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>No teams configured</p> :
                            teams.map(t => (
                                <div
                                    key={t.id}
                                    onClick={() => { setSelectedTeam(t); fetchLevels(t.id); }}
                                    style={{
                                        padding: '0.75rem', borderRadius: '8px', cursor: 'pointer',
                                        background: selectedTeam?.id === t.id ? 'var(--accent-soft)' : 'transparent',
                                        border: '1px solid',
                                        borderColor: selectedTeam?.id === t.id ? 'var(--accent-primary)' : 'var(--border-color)',
                                        transition: 'all 0.2s',
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t.name}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{t.description || 'No description'}</div>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteTeam(t.id); }} style={{ color: 'var(--status-critical)', background: 'none', border: 'none', padding: '0.2rem', cursor: 'pointer', opacity: 0.6 }}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                </div>
            </div>

            {/* Levels Content */}
            <div className="liquid-glass" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto' }}>
                {!selectedTeam ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                        Select a team to manage escalation levels
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                            <div>
                                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{selectedTeam.name} Escalation Flow</h3>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Set up multiple levels and emails for automatic escalation</p>
                            </div>
                            <button onClick={() => handleAddLevel(selectedTeam.id)} style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                                + Add Level
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
                            {levels.length === 0 ? <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No levels configured for this team. Add Level 1 to start.</p> :
                                levels.map((lvl) => (
                                    <div key={lvl.id} style={{ width: '320px', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                                        <div style={{ background: 'var(--bg-elevated)', padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <div style={{ background: 'var(--accent-primary)', color: '#fff', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>{lvl.level_number}</div>
                                                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>Level {lvl.level_number}</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    type="number"
                                                    value={lvl.escalation_time_min}
                                                    onChange={(e) => handleUpdateLevelDelay(lvl.id, parseInt(e.target.value) || 0)}
                                                    style={{
                                                        width: '50px', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
                                                        borderRadius: '4px', padding: '0.1rem 0.3rem', fontSize: '0.7rem', color: 'var(--text-primary)',
                                                        textAlign: 'center'
                                                    }}
                                                />
                                                <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>m delay</span>
                                                <button onClick={() => handleDeleteLevel(lvl.id)} style={{ color: 'var(--status-critical)', background: 'none', border: 'none', cursor: 'pointer' }}><Trash2 size={14} /></button>
                                            </div>
                                        </div>
                                        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                {lvl.emails.length === 0 ? <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No emails added</p> :
                                                    lvl.emails.map((e: any) => (
                                                        <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '0.8rem' }}>
                                                            <span>{e.email}</span>
                                                            <button onClick={() => handleRemoveEmail(lvl.id, e.id)} style={{ color: 'var(--status-critical)', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}><X size={12} /></button>
                                                        </div>
                                                    ))}
                                            </div>
                                            <button onClick={() => handleAddEmail(lvl.id)} style={{ padding: '0.4rem', border: '1px dashed var(--border-color)', borderRadius: '6px', background: 'transparent', color: 'var(--accent-primary)', fontSize: '0.75rem', cursor: 'pointer', marginTop: '0.25rem' }}>
                                                + Add Email
                                            </button>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </>
                )}
            </div>
        </div>
        </div>
    );
}


function EmailTemplatesTab() {
    const [configs, setConfigs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedConfig, setSelectedConfig] = useState<any>(null);
    const [subject, setSubject] = useState('');
    const [html, setHtml] = useState('');
    const [saving, setSaving] = useState(false);
    const [tenants, setTenants] = useState<any[]>([]);

    const userRole = Cookies.get('user_role') || '';
    const isSuperAdmin = userRole === 'super_admin';
    const cookieTenantId = Cookies.get('tenant_id') || '';
    const [tenantId, setTenantId] = useState(cookieTenantId);

    // Load tenant list for super_admin so they can pick a tenant
    useEffect(() => {
        if (!isSuperAdmin) return;
        tenantApi.list().then((data: any) => {
            const list = data.tenants || data || [];
            setTenants(list);
            if (!tenantId && list.length > 0) setTenantId(list[0].id);
        }).catch(console.error);
    }, [isSuperAdmin]); // eslint-disable-line

    // fetchConfigs ONLY depends on tenantId — no selectedConfig in deps (avoids infinite loop)
    const fetchConfigs = useCallback(async () => {
        if (!tenantId) return;
        try {
            setLoading(true);
            const data = await tenantApi.listMailingConfigs(tenantId);
            const list = data.configs || [];
            setConfigs(list);
            // Use functional setState so we don't need selectedConfig as a dep
            setSelectedConfig((prev: any) => {
                if (prev) {
                    // Refresh the existing selection
                    return list.find((c: any) => c.id === prev.id) || prev;
                }
                return list.length > 0 ? list[0] : null;
            });
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [tenantId]); // ← only tenantId, never selectedConfig

    useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

    // Sync subject/html ONLY when a DIFFERENT config is selected (not on every render)
    const selectedConfigId = selectedConfig?.id;
    useEffect(() => {
        if (selectedConfig) {
            setSubject(selectedConfig.template_subject || '');
            setHtml(selectedConfig.template_html || '');
        }
    }, [selectedConfigId]); // eslint-disable-line

    const handleSave = async () => {
        if (!selectedConfig || !tenantId) return;
        try {
            setSaving(true);
            await tenantApi.updateMailingConfig(tenantId, selectedConfig.id, {
                ...selectedConfig,
                template_subject: subject,
                template_html: html,
                level_number: selectedConfig.level_number // Already in the object if modified via UI
            });
            alert("Template saved successfully!");
            fetchConfigs();
        } catch (err: any) {
            console.error(err);
            alert(`Failed to save template: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleCreateNew = async () => {
        if (!tenantId) return;
        const label = prompt("Enter a label for the new configuration:", "Template " + (configs.length + 1));
        if (!label) return;
        
        try {
            setSaving(true);
            // We use the first config as a baseline for SMTP settings if available
            const baseline = configs[0] || {
                smtp_host: 'smtp.example.com',
                smtp_port: 587,
                from_email: 'alerts@example.com'
            };
            
            const res = await tenantApi.createMailingConfig(tenantId, {
                ...baseline,
                label,
                id: undefined,
                template_subject: 'New Incident: {{ticket_id}}',
                template_html: '<h1>New Incident</h1><p>{{description}}</p>',
                level_number: null
            });
            alert("New configuration created!");
            
            // Re-fetch and select the new one
            const data = await tenantApi.listMailingConfigs(tenantId);
            const newList = data.configs || [];
            setConfigs(newList);
            const created = newList.find((c: any) => c.id === res.id);
            if (created) {
                setSelectedConfig(created);
                setSubject(created.template_subject || '');
                setHtml(created.template_html || '');
            }
        } catch (err: any) {
            console.error(err);
            alert(`Failed to create: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this configuration?")) return;
        try {
            await tenantApi.deleteMailingConfig(tenantId, id);
            if (selectedConfig?.id === id) setSelectedConfig(null);
            fetchConfigs();
        } catch (err: any) {
            console.error(err);
            alert(`Failed to delete: ${err.message}`);
        }
    };

    if (!tenantId && !isSuperAdmin) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>Please select a tenant context first.</div>;
    if (!tenantId && isSuperAdmin && tenants.length === 0) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading tenants...</div>;
    if (loading && configs.length === 0) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading email configurations...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Tenant selector — visible to super_admin only */}
        {isSuperAdmin && tenants.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Viewing tenant:</span>
                <select
                    value={tenantId}
                    onChange={e => { setTenantId(e.target.value); setSelectedConfig(null); }}
                    style={{ padding: '0.4rem 0.75rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none', cursor: 'pointer' }}
                >
                    {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
            </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.5rem', height: 'calc(100vh - 300px)' }}>
            {/* Sidebar list of configs */}
            <div className="liquid-glass" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem', overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Configurations</h3>
                    <button onClick={handleCreateNew} style={{ background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.3rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}>
                        + Add
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {configs.length === 0 ? <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>No email configurations found.</p> :
                        configs.map(c => (
                            <div
                                key={c.id}
                                onClick={() => {
                                    setSelectedConfig(c);
                                    setSubject(c.template_subject || '');
                                    setHtml(c.template_html || '');
                                }}
                                style={{
                                    padding: '0.75rem', borderRadius: '10px', cursor: 'pointer',
                                    background: selectedConfig?.id === c.id ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
                                    border: '1px solid',
                                    borderColor: selectedConfig?.id === c.id ? 'var(--accent-primary)' : 'var(--border-color)',
                                    transition: 'all 0.2s',
                                    position: 'relative'
                                }}
                            >
                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{c.label}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                                        {c.level_number === null ? 'Default Template' : `Level ${c.level_number} Template`}
                                    </div>
                                    {c.is_active && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3fb950' }} title="Active" />}
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                                    style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', color: 'var(--status-critical)', background: 'none', border: 'none', padding: '0.2rem', cursor: 'pointer', opacity: 0.6 }}
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        ))}
                </div>
            </div>

            {/* Editor Area */}
            {!selectedConfig ? (
                <div className="liquid-glass" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                    Select or create a configuration to begin editing
                </div>
            ) : (
                <div className="liquid-glass" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Edit Template: {selectedConfig.label}</h3>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Configure SMTP settings and design the email template.</p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                style={{
                                    background: 'var(--accent-primary)', color: '#fff', border: 'none',
                                    borderRadius: '8px', padding: '0.6rem 1.25rem', fontWeight: 600,
                                    cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    opacity: saving ? 0.7 : 1, boxShadow: '0 4px 12px rgba(47, 129, 247, 0.2)'
                                }}
                            >
                                <Save size={18} /> {saving ? 'Saving...' : 'Save Configuration'}
                            </button>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 350px) 1fr', gap: '2rem' }}>
                        {/* Settings Column */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <div style={{ padding: '1.25rem', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Settings size={16} color="var(--accent-primary)" /> Assignment
                                </h4>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Applicable Incident Level</label>
                                    <select
                                        value={selectedConfig.level_number === null ? "" : selectedConfig.level_number}
                                        onChange={e => {
                                            const val = e.target.value === "" ? null : parseInt(e.target.value);
                                            setSelectedConfig({ ...selectedConfig, level_number: val });
                                        }}
                                        style={{
                                            padding: '0.7rem 0.85rem', background: 'var(--bg-tertiary)',
                                            border: '1px solid var(--border-color)', borderRadius: '8px',
                                            color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', cursor: 'pointer'
                                        }}
                                    >
                                        <option value="">Default (Fallback)</option>
                                        <option value="1">Level 1</option>
                                        <option value="2">Level 2</option>
                                        <option value="3">Level 3</option>
                                        <option value="4">Level 4</option>
                                        <option value="5">Level 5</option>
                                    </select>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', margin: '0.2rem 0 0 0' }}>
                                        Templates assigned to specific levels will be sent during that escalation stage.
                                    </p>
                                </div>

                                <ConfigField label="Config Label" value={selectedConfig.label} onChange={v => setSelectedConfig({ ...selectedConfig, label: v })} />
                                
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedConfig.is_active}
                                        onChange={e => setSelectedConfig({ ...selectedConfig, is_active: e.target.checked })}
                                        id="cfg-active"
                                    />
                                    <label htmlFor="cfg-active" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>Active Configuration</label>
                                </div>
                            </div>

                            <div style={{ padding: '1.25rem', background: 'var(--bg-secondary)', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Globe size={16} color="var(--accent-primary)" /> Mail Server
                                </h4>
                                <ConfigField label="SMTP Host" value={selectedConfig.smtp_host} onChange={v => setSelectedConfig({ ...selectedConfig, smtp_host: v })} />
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '1rem' }}>
                                    <ConfigField label="Port" value={String(selectedConfig.smtp_port)} onChange={v => setSelectedConfig({ ...selectedConfig, smtp_port: parseInt(v) || 0 })} type="number" />
                                    <ConfigField label="From Email" value={selectedConfig.from_email} onChange={v => setSelectedConfig({ ...selectedConfig, from_email: v })} />
                                </div>
                                <ConfigField label="Username" value={selectedConfig.smtp_user} onChange={v => setSelectedConfig({ ...selectedConfig, smtp_user: v })} />
                                <ConfigField label="Password" value={selectedConfig.smtp_pass} onChange={v => setSelectedConfig({ ...selectedConfig, smtp_pass: v })} type="password" />
                            </div>

                            <div style={{ background: 'rgba(47, 129, 247, 0.05)', padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--accent-soft)' }}>
                                <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '0.75rem' }}>Variable Guide</h4>
                                <ul style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', paddingLeft: '1.2rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    <li><code>{"{{ticket_id}}"}</code> - Incident ID</li>
                                    <li><code>{"{{title}}"}</code> - Incident Title</li>
                                    <li><code>{"{{severity}}"}</code> - Severity Level</li>
                                    <li><code>{"{{level_number}}"}</code> - Current Escalation Level</li>
                                    <li><code>{"{{description}}"}</code> - Incident Description</li>
                                </ul>
                            </div>
                        </div>

                        {/* Design Column */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Email Subject</label>
                                <input
                                    value={subject}
                                    onChange={e => setSubject(e.target.value)}
                                    placeholder="e.g. Critical Incident Alert: {{ticket_id}}"
                                    style={{
                                        width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                        borderRadius: '8px', padding: '0.75rem', color: 'var(--text-primary)', outline: 'none',
                                        fontSize: '0.95rem'
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', height: '100%' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>HTML Content</label>
                                <textarea
                                    value={html}
                                    onChange={e => setHtml(e.target.value)}
                                    placeholder="<h1>Incident {{ticket_id}}</h1><p>{{description}}</p>"
                                    style={{
                                        width: '100%', height: '500px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                        borderRadius: '8px', padding: '1rem', color: 'var(--text-primary)', outline: 'none',
                                        fontFamily: 'monospace', fontSize: '0.85rem', resize: 'none'
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
        </div>
    );
}


function ConfigField({ label, value, onChange, type = 'text' }: { label: string, value: string, onChange: (v: string) => void, type?: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: 0 }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</label>
            <input
                type={type}
                value={value}
                onChange={e => onChange(e.target.value)}
                style={{
                    width: '100%', minWidth: 0, boxSizing: 'border-box',
                    padding: '0.7rem 0.85rem', background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)', borderRadius: '8px',
                    color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none',
                    transition: 'border-color 0.2s'
                }}
                onFocus={inputFocus}
                onBlur={inputBlur}
            />
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════
// SLA TARGETS TAB
// ═══════════════════════════════════════════════════════════════
function SLATargetsTab() {
    const userRole = Cookies.get('user_role') || '';
    const cookieTenant = Cookies.get('tenant_id') || '';
    const isSuperAdmin = userRole === 'super_admin';

    const [tenants, setTenants] = useState<any[]>([]);
    const [selectedTenantId, setSelectedTenantId] = useState(cookieTenant);
    const [config, setConfig] = useState({
        first_response_min: 60,
        resolution_min: 480,
        customer_reply_min: 120,
        escalation_response_min: 30,
    });
    const [severityTargets, setSeverityTargets] = useState<Record<string, { first_response_min: number; resolution_min: number }>>({
        critical:      { first_response_min: 15,   resolution_min: 240 },
        high:          { first_response_min: 30,   resolution_min: 480 },
        medium:        { first_response_min: 120,  resolution_min: 1440 },
        low:           { first_response_min: 480,  resolution_min: 2880 },
        informational: { first_response_min: 1440, resolution_min: 4320 },
    });
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [loading, setLoading] = useState(true);

    const severities = ['critical', 'high', 'medium', 'low', 'informational'];
    const sevColors: Record<string, string> = {
        critical: '#f85149', high: '#f0883e', medium: '#d29922', low: '#3fb950', informational: '#768390',
    };
    const fmtTime = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;

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

    // Load SLA config
    useEffect(() => {
        if (!selectedTenantId) { setLoading(false); return; }
        setLoading(true);
        slaApi.getConfig(selectedTenantId).then((data: any) => {
            setConfig({
                first_response_min: data.first_response_min ?? 60,
                resolution_min: data.resolution_min ?? 480,
                customer_reply_min: data.customer_reply_min ?? 120,
                escalation_response_min: data.escalation_response_min ?? 30,
            });
            if (data.severity_targets && typeof data.severity_targets === 'object' && Object.keys(data.severity_targets).length > 0) {
                setSeverityTargets(prev => ({ ...prev, ...data.severity_targets }));
            }
        }).catch(() => {}).finally(() => setLoading(false));
    }, [selectedTenantId]);

    const handleSave = async () => {
        if (!selectedTenantId) return;
        setSaving(true);
        setMsg(null);
        try {
            await slaApi.saveConfig(selectedTenantId, { ...config, severity_targets: severityTargets });
            setMsg({ type: 'success', text: 'SLA targets saved successfully' });
        } catch (e: any) {
            setMsg({ type: 'error', text: e.message || 'Failed to save' });
        } finally {
            setSaving(false);
        }
    };

    const updateSevTarget = (sev: string, field: string, value: number) => {
        setSeverityTargets(prev => ({
            ...prev,
            [sev]: { ...prev[sev], [field]: value },
        }));
    };

    const fields = [
        { key: 'customer_reply_min', label: 'Customer Reply', desc: 'Max minutes to reply after customer response' },
        { key: 'escalation_response_min', label: 'Escalation Response', desc: 'Max minutes to respond after escalation' },
    ];

    const cardStyle: React.CSSProperties = {
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: '12px', padding: '1.5rem',
    };

    const inputStyle: React.CSSProperties = {
        width: '90px', padding: '6px 10px', borderRadius: '6px', textAlign: 'center' as const,
        background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
        color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                        SLA Targets
                    </h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        Configure per-severity SLA thresholds for first response and resolution time
                    </p>
                </div>
                {isSuperAdmin && tenants.length > 0 && (
                    <select
                        value={selectedTenantId}
                        onChange={e => setSelectedTenantId(e.target.value)}
                        style={{
                            padding: '8px 12px', borderRadius: '8px',
                            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                            color: 'var(--text-primary)', fontSize: '0.85rem',
                        }}
                    >
                        {tenants.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                )}
            </div>

            {msg && (
                <div style={{
                    padding: '12px 16px', borderRadius: '8px',
                    background: msg.type === 'success' ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)',
                    border: `1px solid ${msg.type === 'success' ? '#3fb950' : '#f85149'}`,
                    color: msg.type === 'success' ? '#3fb950' : '#f85149',
                    fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                    {msg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {msg.text}
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-tertiary)' }}>Loading...</div>
            ) : !selectedTenantId ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-tertiary)' }}>No tenant selected</div>
            ) : (
                <>
                    {/* Per-Severity Targets Table */}
                    <div style={cardStyle}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>
                            Per-Severity SLA Targets
                        </h3>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', margin: '0 0 1rem 0' }}>
                            Set different first response and resolution targets based on incident severity
                        </p>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' }}>
                                            Severity
                                        </th>
                                        <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' }}>
                                            First Response (min)
                                        </th>
                                        <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' }}>
                                            Formatted
                                        </th>
                                        <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' }}>
                                            Resolution (min)
                                        </th>
                                        <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', borderBottom: '1px solid var(--border-color)' }}>
                                            Formatted
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {severities.map(sev => (
                                        <tr key={sev} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={{ padding: '10px 12px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{
                                                        width: '8px', height: '8px', borderRadius: '50%',
                                                        background: sevColors[sev], flexShrink: 0,
                                                    }} />
                                                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                                                        {sev}
                                                    </span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={severityTargets[sev]?.first_response_min ?? 60}
                                                    onChange={e => updateSevTarget(sev, 'first_response_min', parseInt(e.target.value) || 1)}
                                                    style={inputStyle}
                                                />
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                                                {fmtTime(severityTargets[sev]?.first_response_min ?? 60)}
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={severityTargets[sev]?.resolution_min ?? 480}
                                                    onChange={e => updateSevTarget(sev, 'resolution_min', parseInt(e.target.value) || 1)}
                                                    style={inputStyle}
                                                />
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                                                {fmtTime(severityTargets[sev]?.resolution_min ?? 480)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Other SLA Targets */}
                    <div style={cardStyle}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>
                            Other SLA Targets
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                            {fields.map(f => (
                                <div key={f.key}>
                                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                                        {f.label}
                                    </label>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', margin: '0 0 8px 0' }}>
                                        {f.desc}
                                    </p>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input
                                            type="number"
                                            min={1}
                                            value={(config as any)[f.key]}
                                            onChange={e => setConfig(prev => ({ ...prev, [f.key]: parseInt(e.target.value) || 0 }))}
                                            style={{
                                                width: '120px', padding: '8px 12px', borderRadius: '8px',
                                                background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                                                color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none',
                                            }}
                                        />
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>minutes</span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                                            ({fmtTime((config as any)[f.key])})
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Notification Info */}
                    <div style={{
                        ...cardStyle,
                        background: 'rgba(47,129,247,0.04)',
                        border: '1px solid rgba(47,129,247,0.2)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                            <AlertCircle size={18} color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <div>
                                <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>
                                    SLA Breach Notifications
                                </h4>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                                    Analysts will automatically receive email notifications when their assigned incidents are approaching SLA breach (75% elapsed)
                                    and when the SLA is breached. Make sure analysts have valid email addresses configured in their profiles.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Save Button */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '10px 24px', borderRadius: '8px',
                                background: saving ? 'var(--bg-tertiary)' : 'var(--accent-primary)',
                                color: '#fff', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                                fontWeight: 600, fontSize: '0.85rem',
                            }}
                        >
                            <Save size={16} />
                            {saving ? 'Saving...' : 'Save SLA Targets'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
