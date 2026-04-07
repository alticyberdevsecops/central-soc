'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import {
    Users,
    Shield,
    Zap,
    CheckCircle,
    AlertCircle,
    ArrowRight,
    ArrowLeft,
    Globe,
    Lock,
    Server,
    RefreshCw
} from 'lucide-react';
import { apiRequest, tenantApi } from '@/lib/api';
import Cookies from 'js-cookie';

type OnboardingStep = 'tenant' | 'connector' | 'deploy' | 'success';

export default function OnboardingPage() {
    const [step, setStep] = useState<OnboardingStep>('tenant');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userRole, setUserRole] = useState<string | null>(null);

    // Tenant State
    const [tenantData, setTenantData] = useState({
        name: '',
        slug: '',
        description: '',
        contact_email: ''
    });

    // Connector State
    const [connectorData, setConnectorData] = useState({
        vendor: 'xsiam',
        label: '',
        api_key: '',
        api_key_id: '',
        base_url: '',
        poll_interval: 300
    });

    const [createdTenantId, setCreatedTenantId] = useState<string | null>(null);
    const [generatedPassword, setGeneratedPassword] = useState<string>('');
    const [skippedConnector, setSkippedConnector] = useState(false);

    useEffect(() => {
        const role = Cookies.get('user_role');
        setUserRole(role || 'analyst');
    }, []);

    const handleTenantSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);
        try {
            const res = await apiRequest('/tenants', {
                method: 'POST',
                body: JSON.stringify(tenantData)
            });

            // Assign static password per user request
            const newPassword = 'customer';
            setGeneratedPassword(newPassword);

            // Auto-provision Customer Admin user
            try {
                await apiRequest('/auth/register', {
                    method: 'POST',
                    body: JSON.stringify({
                        email: tenantData.contact_email,
                        full_name: `${tenantData.name} Admin`,
                        password: newPassword,
                        role: 'customer_admin',
                        tenant_id: res.id
                    })
                });
            } catch (authErr) {
                const aErr = authErr as Error;
                // Rollback tenant creation if user provisioning fails
                await apiRequest(`/tenants/${res.id}`, { method: 'DELETE' }).catch(() => { });
                throw new Error(`User provisioning failed. Tenant creation rolled back: ${aErr.message}`);
            }

            setCreatedTenantId(res.id);
            setStep('connector');
        } catch (err) {
            const error = err as Error;
            setError(error.message || 'Failed to create tenant');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleConnectorSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!createdTenantId) return;
        setIsSubmitting(true);
        setError(null);
        try {
            // Find the auto-created connector
            const connectorsRes = await tenantApi.listConnectors(createdTenantId);
            const defaultConnector = connectorsRes.connectors.find((c: { vendor: string, id: string }) => c.vendor === connectorData.vendor);

            if (!defaultConnector) {
                throw new Error("Default connector not found. Backend provisioning may have failed.");
            }

            const credentials = {
                api_key: connectorData.api_key,
                api_key_id: connectorData.api_key_id,
                base_url: connectorData.base_url
            };

            // Update the existing auto-created connector instead of POSTing a new one
            await tenantApi.updateConnector(createdTenantId, defaultConnector.id, {
                label: connectorData.label || `${tenantData.name} ${connectorData.vendor.toUpperCase()}`,
                credentials: credentials,
                poll_interval_sec: connectorData.poll_interval,
                is_enabled: true
            });

            setStep('deploy');
        } catch (err) {
            const error = err as Error;
            setError(error.message || 'Failed to configure connector');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeploy = async () => {
        setIsSubmitting(true);
        setError(null);
        try {
            await apiRequest('/connectors/reload', { method: 'POST' });
            setStep('success');
        } catch (err) {
            const error = err as Error;
            setError(error.message || 'Failed to trigger synchronization');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (userRole !== 'super_admin') {
        return (
            <div className="app-container">
                <Sidebar />
                <div className="main-layout">
                    <main className="content-area" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="detail-card" style={{ maxWidth: '400px', textAlign: 'center', padding: '3rem' }}>
                            <Lock size={48} style={{ color: 'var(--status-critical)', marginBottom: '1rem' }} />
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>Restricted Access</h2>
                            <p style={{ color: 'var(--text-secondary)' }}>Only Super Administrators can access the Enterprise Customer Onboarding module.</p>
                        </div>
                    </main>
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
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Customer Onboarding</h2>
                        <div className="status-badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)' }}>
                            ENTERPRISE WIZARD
                        </div>
                    </div>
                </header>

                <main className="content-area">
                    {/* Stepper Header */}
                    {step !== 'success' && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '3rem', paddingTop: '2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{
                                        width: '40px', height: '40px', borderRadius: '50%',
                                        background: step === 'tenant' ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem',
                                        border: step !== 'tenant' && createdTenantId ? '2px solid var(--status-low)' : 'none'
                                    }}>
                                        <Users size={18} color={step === 'tenant' ? 'white' : 'var(--text-secondary)'} />
                                    </div>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: step === 'tenant' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>Tenant Info</span>
                                </div>
                                <div style={{ width: '80px', height: '2px', background: createdTenantId ? 'var(--status-low)' : 'var(--border-color)', marginTop: '-1.5rem' }}></div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{
                                        width: '40px', height: '40px', borderRadius: '50%',
                                        background: step === 'connector' ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem',
                                        border: step === 'deploy' ? '2px solid var(--status-low)' : 'none'
                                    }}>
                                        <Shield size={18} color={step === 'connector' ? 'white' : 'var(--text-secondary)'} />
                                    </div>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: step === 'connector' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>Connector</span>
                                </div>
                                <div style={{ width: '80px', height: '2px', background: step === 'deploy' ? 'var(--status-low)' : 'var(--border-color)', marginTop: '-1.5rem' }}></div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{
                                        width: '40px', height: '40px', borderRadius: '50%',
                                        background: step === 'deploy' ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem',
                                        border: 'none'
                                    }}>
                                        <Zap size={18} color={step === 'deploy' ? 'white' : 'var(--text-secondary)'} />
                                    </div>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: step === 'deploy' ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>Activate</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div style={{ maxWidth: '800px', margin: '0 auto', paddingTop: step === 'success' ? '2rem' : '0' }}>
                        {error && (
                            <div style={{ padding: '1rem', background: 'rgba(248, 81, 73, 0.1)', border: '1px solid var(--status-critical)', borderRadius: 'var(--radius-md)', color: 'var(--status-critical)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <AlertCircle size={18} />
                                {error}
                            </div>
                        )}

                        {step === 'success' ? (
                            <div className="detail-card" style={{ textAlign: 'center', padding: '3rem' }}>
                                <div style={{ width: '80px', height: '80px', background: 'rgba(63, 185, 80, 0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                                    <CheckCircle size={40} color="var(--status-low)" />
                                </div>
                                <h3 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>Success! Customer Onboarded</h3>
                                <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                                    {skippedConnector
                                        ? `${tenantData.name} has been set up for manual ticket creation only. You can configure a connector later from the Connectors page.`
                                        : `Technician access and initial setup are complete for ${tenantData.name}.`
                                    }
                                </p>
                                <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: 'var(--radius-md)', marginBottom: '2rem', textAlign: 'left', display: 'inline-block' }}>
                                    <div style={{ marginBottom: '0.5rem', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Login Credentials</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', gap: '2rem', marginBottom: '0.5rem' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Email:</span>
                                        <strong style={{ color: 'var(--text-primary)' }}>{tenantData.contact_email}</strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2rem' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>Password:</span>
                                        <strong style={{ color: 'var(--text-primary)' }}>{generatedPassword}</strong>
                                    </div>
                                    <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                        Please share this default password with the customer so they can securely log in. They can change it later.
                                    </div>
                                </div>
                                <button className="login-button" onClick={() => window.location.href = '/dashboard'}>
                                    Go to Dashboard
                                </button>
                            </div>
                        ) : (
                            <div className="detail-card" style={{ padding: '2rem' }}>
                                {step === 'tenant' && (
                                    <form onSubmit={handleTenantSubmit}>
                                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.5rem' }}>Step 1: Tenant Foundation</h3>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                            <div className="input-group">
                                                <label className="input-label">Company Name</label>
                                                <input
                                                    type="text" className="login-input" placeholder="e.g. Tata Play" required
                                                    value={tenantData.name} onChange={(e) => setTenantData({ ...tenantData, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                                                />
                                            </div>
                                            <div className="input-group">
                                                <label className="input-label">URL Slug</label>
                                                <input
                                                    type="text" className="login-input" placeholder="tata-play" required
                                                    value={tenantData.slug} onChange={(e) => setTenantData({ ...tenantData, slug: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                                            <label className="input-label">Primary Contact Email</label>
                                            <input
                                                type="email" className="login-input" placeholder="admin@customer.com" required
                                                value={tenantData.contact_email} onChange={(e) => setTenantData({ ...tenantData, contact_email: e.target.value })}
                                            />
                                        </div>
                                        <div className="input-group" style={{ marginBottom: '2rem' }}>
                                            <label className="input-label">Description</label>
                                            <textarea
                                                className="login-input" style={{ height: '100px', resize: 'none', padding: '0.75rem' }}
                                                placeholder="Enter tenant background or industry context..."
                                                value={tenantData.description} onChange={(e) => setTenantData({ ...tenantData, description: e.target.value })}
                                            ></textarea>
                                        </div>
                                        <button type="submit" className="login-button" style={{ width: 'auto', padding: '0.75rem 2rem' }} disabled={isSubmitting}>
                                            {isSubmitting ? 'Creating...' : 'Next: Configure Connector'} <ArrowRight size={18} style={{ marginLeft: '0.5rem' }} />
                                        </button>
                                    </form>
                                )}

                                {step === 'connector' && (
                                    <form onSubmit={handleConnectorSubmit}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Step 2: Security Integration</h3>
                                            <button type="button" onClick={() => setStep('tenant')} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <ArrowLeft size={16} /> Edit Tenant
                                            </button>
                                        </div>

                                        <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                                            <label className="input-label">Vendor Solution</label>
                                            <select
                                                className="login-input" style={{ background: 'var(--bg-secondary)' }}
                                                value={connectorData.vendor} onChange={(e) => setConnectorData({ ...connectorData, vendor: e.target.value })}
                                            >
                                                <option value="xsiam">Palo Alto Cortex XDR / XSIAM</option>
                                            </select>
                                        </div>

                                        <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                                            <label className="input-label">API Base URL</label>
                                            <input
                                                type="url" className="login-input" placeholder="https://api-tata.xdr.paloaltonetworks.com" required
                                                value={connectorData.base_url} onChange={(e) => setConnectorData({ ...connectorData, base_url: e.target.value })}
                                            />
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                            <div className="input-group">
                                                <label className="input-label">API Key ID</label>
                                                <input
                                                    type="text" className="login-input" placeholder="XDR-AUTH-ID" required
                                                    value={connectorData.api_key_id} onChange={(e) => setConnectorData({ ...connectorData, api_key_id: e.target.value })}
                                                />
                                            </div>
                                            <div className="input-group">
                                                <label className="input-label">API Secret Key</label>
                                                <input
                                                    type="password" className="login-input" placeholder="••••••••••••••••" required
                                                    value={connectorData.api_key} onChange={(e) => setConnectorData({ ...connectorData, api_key: e.target.value })}
                                                />
                                            </div>
                                        </div>

                                        <div className="input-group" style={{ marginBottom: '2rem' }}>
                                            <label className="input-label">Polling Interval (Seconds)</label>
                                            <input
                                                type="number" className="login-input" min="60" max="3600"
                                                value={connectorData.poll_interval} onChange={(e) => setConnectorData({ ...connectorData, poll_interval: parseInt(e.target.value) })}
                                            />
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '0.4rem' }}>Recommended: 300s (5 minutes) for stability</span>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <button type="submit" className="login-button" style={{ width: 'auto', padding: '0.75rem 2rem' }} disabled={isSubmitting}>
                                                {isSubmitting ? 'Configuring...' : 'Verify & Next'} <ArrowRight size={18} style={{ marginLeft: '0.5rem' }} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { setSkippedConnector(true); setStep('success'); }}
                                                style={{
                                                    padding: '0.75rem 1.5rem',
                                                    background: 'transparent',
                                                    border: '1px solid var(--border-color)',
                                                    borderRadius: 'var(--radius-md)',
                                                    color: 'var(--text-secondary)',
                                                    cursor: 'pointer',
                                                    fontSize: '0.85rem',
                                                    fontWeight: 600,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    transition: 'all 0.2s',
                                                }}
                                                onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.color = 'var(--accent-primary)'; }}
                                                onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                                            >
                                                Skip — Manual Tickets Only
                                            </button>
                                        </div>
                                    </form>
                                )}

                                {step === 'deploy' && (
                                    <div style={{ textAlign: 'center', padding: '1rem' }}>
                                        <div style={{ width: '60px', height: '60px', background: 'rgba(56, 139, 253, 0.1)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
                                            <Server size={30} color="var(--accent-primary)" />
                                        </div>
                                        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>Final Step: Global Synchronization</h3>
                                        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', maxWidth: '500px', margin: '0 auto 2rem' }}>
                                            The tenant is created and credentials are encrypted. Now we need to signal the Ingestion Service to hot-reload and start the polling worker for {connectorData.vendor.toUpperCase()}.
                                        </p>

                                        <div style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '2.5rem', textAlign: 'left', fontSize: '0.85rem' }}>
                                            <div style={{ marginBottom: '0.5rem', color: 'var(--text-tertiary)' }}>Deployment Checklist:</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--status-low)' }}><CheckCircle size={14} /> Created Tenant `{tenantData.slug}`</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--status-low)' }}><CheckCircle size={14} /> Encrypted `{connectorData.vendor}` credentials</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--status-low)' }}><CheckCircle size={14} /> Initialized dedup store</div>
                                        </div>

                                        <button className="login-button" onClick={() => setStep('success')} disabled={isSubmitting} style={{ backgroundColor: 'var(--status-low)' }}>
                                            {isSubmitting ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} />}
                                            <span style={{ marginLeft: '0.5rem' }}>{isSubmitting ? 'Synchronizing Service...' : 'Activate Real-time Fetching'}</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}
