'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import CISODashboard from '@/components/CISODashboard';
import Cookies from 'js-cookie';
import { tenantApi } from '@/lib/api';
import { Shield, ChevronDown } from 'lucide-react';

export default function CisoDashboardPage() {
    const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
    const [tenants, setTenants] = useState<{ id: string, name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    
    const userRole = Cookies.get('user_role');
    const userTenantId = Cookies.get('tenant_id');
    const isSuperAdmin = userRole === 'super_admin';

    useEffect(() => {
        const fetchTenants = async () => {
            if (isSuperAdmin) {
                try {
                    const data = await tenantApi.list();
                    setTenants(data);
                    // Default to first tenant or stored context
                    if (data.length > 0) setSelectedTenant(userTenantId || data[0].id);
                } catch (e) {
                    console.error("Failed to load tenants", e);
                }
            } else {
                setSelectedTenant(userTenantId || null);
            }
            setLoading(false);
        };
        fetchTenants();
    }, [isSuperAdmin, userTenantId]);

    if (loading) return null;

    if (!isSuperAdmin && !userTenantId) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <Shield size={48} className="text-red-500 mb-4" />
                <h1 className="text-2xl font-bold mb-2">No Tenant Linked</h1>
                <p className="text-gray-400 max-w-md">Your account is not linked to any active tenant. Please contact support.</p>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-[#0d1117] text-[#e6edf3]">
            <Sidebar />
            <main className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 lg:p-8">
                    {/* Header with Tenant Selector */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                        <div>
                            <h2 className="text-2xl font-extrabold text-white">Security Posture</h2>
                            <p className="text-[#8b949e] text-sm">Cross-tenant live security overview from Palo Alto XSIAM</p>
                        </div>
                        
                        {isSuperAdmin && (
                            <div className="relative inline-block text-left">
                                <div className="flex items-center gap-3 bg-[#161b22] border border-[#30363d] rounded-lg px-4 py-2 hover:border-[#8b949e] transition-colors cursor-pointer group">
                                    <span className="text-[#8b949e] text-xs font-bold uppercase tracking-wider">Tenant:</span>
                                    <select 
                                        value={selectedTenant || ''} 
                                        onChange={(e) => setSelectedTenant(e.target.value)}
                                        className="bg-transparent border-none focus:ring-0 text-sm font-semibold text-white appearance-none pr-6 cursor-pointer"
                                    >
                                        {tenants.map(t => (
                                            <option key={t.id} value={t.id} className="bg-[#161b22]">{t.name}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={14} className="text-[#8b949e] absolute right-3 pointer-events-none group-hover:text-white" />
                                </div>
                            </div>
                        )}
                    </div>

                    {selectedTenant ? (
                        <CISODashboard tenantId={selectedTenant} />
                    ) : (
                        <div className="text-center py-20">
                            <p className="text-[#8b949e]">Select a tenant to view dashboard</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
