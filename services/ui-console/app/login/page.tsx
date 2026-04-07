'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import { authApi } from '@/lib/api';
import {
    Shield, Mail, Lock, Loader2, ArrowRight, Eye, EyeOff,
    ShieldCheck, Activity, Globe, Zap, MonitorCheck, Fingerprint,
} from 'lucide-react';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [mounted, setMounted] = useState(false);
    const router = useRouter();

    useEffect(() => setMounted(true), []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const data = await authApi.login({ email, password });
            Cookies.set('soc_token', data.access_token, { expires: 1 });
            Cookies.set('user_role', data.user.role);
            if (data.user.tenant_id) Cookies.set('tenant_id', data.user.tenant_id);
            // Store multi-tenant assignments
            if (data.user.tenant_ids && data.user.tenant_ids.length > 0) {
                Cookies.set('tenant_ids', JSON.stringify(data.user.tenant_ids), { expires: 1 });
            }
            router.push('/dashboard');
        } catch (err: any) {
            setError(err.message || 'Invalid credentials. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-split">
            {/* ═══ Left Panel — Hero / Branding ═══ */}
            <div className="login-hero">
                {/* Animated background layers */}
                <div className="login-hero-grid" />
                <div className="login-hero-glow login-hero-glow-1" />
                <div className="login-hero-glow login-hero-glow-2" />
                <div className="login-hero-glow login-hero-glow-3" />

                {/* Floating orbit rings */}
                <div className="login-orbit login-orbit-1" />
                <div className="login-orbit login-orbit-2" />
                <div className="login-orbit login-orbit-3" />

                {/* Content */}
                <div className={`login-hero-content ${mounted ? 'login-animate-in' : ''}`}>
                    <div className="login-hero-logo">
                        <div className="login-hero-logo-ring" />
                        <Shield size={44} color="#fff" strokeWidth={1.8} />
                    </div>

                    <h1 className="login-hero-title">Central SOC</h1>
                    <p className="login-hero-subtitle">Enterprise Security Operations Center</p>

                    <div className="login-hero-divider" />

                    {/* Feature highlights */}
                    <div className="login-hero-features">
                        <FeatureItem icon={<MonitorCheck size={18} />} text="Real-time Threat Monitoring" delay={0} mounted={mounted} />
                        <FeatureItem icon={<Zap size={18} />} text="AI-Powered Incident Analysis" delay={1} mounted={mounted} />
                        <FeatureItem icon={<Globe size={18} />} text="Multi-Tenant Architecture" delay={2} mounted={mounted} />
                        <FeatureItem icon={<Fingerprint size={18} />} text="MITRE ATT&CK Mapping" delay={3} mounted={mounted} />
                    </div>

                    {/* Live stats strip */}
                    <div className="login-hero-stats">
                        <div className="login-hero-stat">
                            <Activity size={13} />
                            <span className="login-hero-stat-dot" />
                            <span>System Operational</span>
                        </div>
                        <span className="login-hero-stat-sep">|</span>
                        <div className="login-hero-stat">
                            <ShieldCheck size={13} />
                            <span>256-bit Encrypted</span>
                        </div>
                    </div>
                </div>

                {/* Bottom attribution */}
                <div className="login-hero-footer">
                    <span>Powered by</span>
                    <span className="login-hero-footer-brand">AltiSec Technologies</span>
                </div>
            </div>

            {/* ═══ Right Panel — Login Form ═══ */}
            <div className="login-form-panel">
                <div className={`login-form-container ${mounted ? 'login-animate-in-right' : ''}`}>
                    {/* Header */}
                    <div className="login-form-header">
                        <h2 className="login-form-title">Welcome back</h2>
                        <p className="login-form-desc">Enter your credentials to access the platform</p>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="login-error-modern">
                            <div className="login-error-icon">!</div>
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleLogin} className="login-form-fields">
                        <div className="login-field-modern">
                            <label className="login-label-modern">Email</label>
                            <div className="login-input-modern-group">
                                <Mail size={17} className="login-input-modern-icon" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                                    required
                                    className="login-input-modern"
                                    placeholder="you@company.com"
                                    autoComplete="email"
                                />
                            </div>
                        </div>

                        <div className="login-field-modern">
                            <label className="login-label-modern">Password</label>
                            <div className="login-input-modern-group">
                                <Lock size={17} className="login-input-modern-icon" />
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                                    required
                                    className="login-input-modern"
                                    placeholder="Enter your password"
                                    autoComplete="current-password"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="login-input-modern-toggle"
                                >
                                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                                </button>
                            </div>
                        </div>

                        <button type="submit" disabled={loading} className="login-submit-modern">
                            {loading ? (
                                <span className="login-btn-inner">
                                    <Loader2 size={19} className="animate-spin" />
                                    Authenticating...
                                </span>
                            ) : (
                                <span className="login-btn-inner">
                                    Secure Sign In
                                    <ArrowRight size={18} />
                                </span>
                            )}
                        </button>
                    </form>

                    {/* Footer */}
                    <div className="login-form-footer">
                        <div className="login-form-footer-lock">
                            <ShieldCheck size={14} />
                            <span>Protected by enterprise-grade security</span>
                        </div>
                        <p className="login-form-footer-note">All sessions are monitored and logged for compliance</p>
                    </div>
                </div>
            </div>
        </div>
    );
}


function FeatureItem({ icon, text, delay, mounted }: { icon: React.ReactNode; text: string; delay: number; mounted: boolean }) {
    return (
        <div
            className={`login-hero-feature ${mounted ? 'login-feature-visible' : ''}`}
            style={{ transitionDelay: `${0.3 + delay * 0.1}s` }}
        >
            <div className="login-hero-feature-icon">{icon}</div>
            <span>{text}</span>
        </div>
    );
}
