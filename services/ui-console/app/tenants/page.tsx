'use client';

import React, { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { Layers, Globe, CheckCircle, AlertCircle, Shield, MoreVertical } from 'lucide-react';
import Cookies from 'js-cookie';
import { tenantApi, apiRequest } from '@/lib/api';

export default function Tenants() {
    const [tenants, setTenants] = useState<any[]>([]);
    const [userRole, setUserRole] = useState(Cookies.get('user_role') || '');
    const [loading, setLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);

    const fetchTenants = async () => {
        try {
            if (userRole === 'super_admin') {
                const data = await tenantApi.list();
                setTenants(data.tenants);
            } else {
                setTenants([]);
            }
        } catch (err) {
            console.error('Failed to fetch tenants', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTenants();
    }, [userRole]);

    const handleDeleteTenant = async (tenantId: string) => {
        if (!confirm('Are you absolutely sure you want to delete this tenant? This will permanently wipe all associated incidents, users, and data connectors. Action cannot be undone.')) return;

        setIsDeleting(tenantId);
        try {
            await tenantApi.delete(tenantId);
            // Hot reload connectors so the pollers stop immediately
            await apiRequest('/connectors/reload', { method: 'POST' }).catch(() => null);
            await fetchTenants();
        } catch (err) {
            console.error('Failed to delete tenant', err);
            alert('Failed to delete tenant. Check console for details.');
        } finally {
            setIsDeleting(null);
        }
    };

    if (loading) return <div className="h-full flex items-center justify-center bg-[#0a0c10] text-[#848d97]">Authenticating tenant access...</div>;

    if (userRole !== 'super_admin') {
        return (
            <div className="app-container">
                <Sidebar />
                <div className="main-layout flex items-center justify-center">
                    <div className="detail-card text-center p-8 max-w-md">
                        <AlertCircle size={48} className="text-[#f85149] mx-auto mb-4" />
                        <h3 className="text-xl font-bold mb-2">Access Restricted</h3>
                        <p className="text-[#848d97]">Tenant management is reserved for Global SOC Administrators.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            <Sidebar />
            <div className="main-layout">
                <header className="header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Tenant Infrastructure</h2>
                        <div className="status-badge" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                            {tenants.length} TOTAL NODES
                        </div>
                    </div>
                </header>

                <main className="content-area">
                    <div className="stat-card-grid">
                        <div className="stat-card success">
                            <span className="info-label">Network Health</span>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0.25rem 0' }}>100%</div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--status-low)' }}>All systems operational</span>
                        </div>
                        <div className="stat-card">
                            <span className="info-label">Active Integrations</span>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0.25rem 0' }}>{tenants.length}</div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Data connectors running</span>
                        </div>
                    </div>

                    <div className="table-container">
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center' }}>
                            <Layers size={18} style={{ color: 'var(--accent-primary)', marginRight: '0.75rem' }} />
                            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Provisioned Customer Tenants</h3>
                        </div>
                        <table className="incident-table">
                            <thead>
                                <tr>
                                    <th>Tenant Name</th>
                                    <th>Status</th>
                                    <th>Last Sync</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tenants.map((tenant) => (
                                    <tr key={tenant.id}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-md)', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <Globe size={18} className="text-[#2f81f7]" />
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontWeight: 600 }}>{tenant.name}</span>
                                                    <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{tenant.id}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--status-low)' }}>
                                                <CheckCircle size={14} />
                                                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Active</span>
                                            </div>
                                        </td>
                                        <td><span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>Connected</span></td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button
                                                    onClick={() => {
                                                        Cookies.set('tenant_id', tenant.id, { expires: 7 });
                                                        window.location.reload(); // Reload to update all contexts
                                                    }}
                                                    style={{
                                                        background: Cookies.get('tenant_id') === tenant.id ? 'var(--accent-primary)' : 'transparent',
                                                        border: '1px solid var(--accent-primary)',
                                                        color: Cookies.get('tenant_id') === tenant.id ? '#fff' : 'var(--accent-primary)',
                                                        padding: '0.25rem 0.75rem',
                                                        borderRadius: 'var(--radius-sm)',
                                                        fontSize: '0.75rem',
                                                        cursor: 'pointer',
                                                        fontWeight: 600
                                                    }}
                                                >
                                                    {Cookies.get('tenant_id') === tenant.id ? 'Active Context' : 'Manage Tenant'}
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteTenant(tenant.id)}
                                                    disabled={isDeleting === tenant.id}
                                                    style={{
                                                        background: 'transparent',
                                                        border: '1px solid var(--status-critical)',
                                                        color: 'var(--status-critical)',
                                                        padding: '0.25rem 0.75rem',
                                                        borderRadius: 'var(--radius-sm)',
                                                        fontSize: '0.75rem',
                                                        cursor: isDeleting === tenant.id ? 'wait' : 'pointer',
                                                        opacity: isDeleting === tenant.id ? 0.5 : 1
                                                    }}
                                                >
                                                    {isDeleting === tenant.id ? 'Removing...' : 'Remove'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </main>
            </div>
        </div>
    );
}
