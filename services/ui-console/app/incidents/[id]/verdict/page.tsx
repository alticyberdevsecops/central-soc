"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { incidentApi } from "@/lib/api";
import { Brain, ArrowLeft, ShieldCheck, AlertTriangle, FileText, Shield } from "lucide-react";
import DOMPurify from 'dompurify';
import { useTheme } from '@/components/ThemeProvider';

export default function VerdictPage() {
    const { id } = useParams() as { id: string };
    const router = useRouter();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { theme } = useTheme();

    // 1. All Hooks at the absolute Top
    const [verdict, setVerdict] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [iframeHeight, setIframeHeight] = useState(1200);

    // 2. Message Listener for Height Sync
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data && event.data.type === 'verdict-height' && event.data.height) {
                const newHeight = Math.max(1000, event.data.height + 40);
                setIframeHeight(newHeight);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // 3. Theme Synchronization to Iframe
    useEffect(() => {
        if (iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.postMessage({ type: 'theme-change', theme }, '*');
        }
    }, [theme]);

    // 4. Data Fetching
    useEffect(() => {
        const fetchVerdict = async () => {
            setLoading(true);
            try {
                const data = await incidentApi.getVerdict(id);

                // Redirect if landing on UUID
                if (data.ticket_id && id !== data.ticket_id) {
                    router.replace(`/incidents/${data.ticket_id}/verdict`);
                    return;
                }

                setVerdict(data);
                setError(null);
            } catch (err: any) {
                setError(err.message || "Failed to load verdict");
            } finally {
                setLoading(false);
            }
        };
        if (id) fetchVerdict();
    }, [id]);

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)', color: '#fff' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid rgba(47, 129, 247, 0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                <p style={{ marginTop: '1.5rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Retrieving AI Analysis Verdict...</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    if (error || (verdict && verdict.ai_status !== 'completed')) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary)', color: '#fff', padding: '2rem', textAlign: 'center' }}>
                <AlertTriangle size={64} color="var(--status-medium)" style={{ marginBottom: '1.5rem' }} />
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1rem' }}>Analysis Not Ready</h1>
                <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', marginBottom: '2rem', lineHeight: 1.6 }}>
                    {error || "The AI analysis report for this incident is still in progress or has not been initiated."}
                </p>
                <button
                    onClick={() => router.back()}
                    style={{ padding: '0.75rem 1.5rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <ArrowLeft size={18} /> Back to Incident
                </button>
            </div>
        );
    }

    const reportContent = verdict?.ai_verdict || "No report content available.";
    const isTruePositive = reportContent?.includes("TRUE_POSITIVE") || false;

    // Inject ResizeObserver into the report content
    DOMPurify.addHook('afterSanitizeAttributes', function (node) {
        if ('target' in node) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }
    });

    const sanitizedHTML = DOMPurify.sanitize(reportContent, {
        ADD_TAGS: ['html', 'head', 'body', 'style', 'meta', 'link', 'title', 'script'],
        ADD_ATTR: ['style', 'content', 'name', 'charset', 'href', 'rel', 'class', 'target'],
        WHOLE_DOCUMENT: true
    });

    const finalReportDoc = `${sanitizedHTML}
        <script>
            function sendHeight() {
                try {
                    const height = Math.max(
                        document.body ? document.body.scrollHeight : 0,
                        document.documentElement ? document.documentElement.scrollHeight : 0,
                        document.body ? document.body.offsetHeight : 0,
                        600
                    );
                    window.parent.postMessage({ type: 'verdict-height', height: height }, '*');
                } catch(e) {}
            }
            window.addEventListener('load', sendHeight);
            window.addEventListener('resize', sendHeight);
            setInterval(sendHeight, 1000);
            setTimeout(sendHeight, 100);
            setTimeout(sendHeight, 500);
        </script>`;

    return (
        <div style={{ background: 'var(--bg-primary)', minHeight: '100vh', color: 'var(--text-primary)', overflowX: 'hidden' }}>
            {/* Header */}
            <header className="verdict-header-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 2rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, zIndex: 100 }}>
                <button
                    onClick={() => router.back()}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <ArrowLeft size={18} />
                    <span>Return to Incident</span>
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ padding: '0.5rem', background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)' }}>
                        <Brain size={24} color="var(--accent-primary)" />
                    </div>
                    <h1 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: '#fff' }}>
                        Autonomous SOC Verdict
                    </h1>
                </div>
                <div className={`verdict-status-badge ${isTruePositive ? 'verdict-status-critical' : 'verdict-status-success'}`}>
                    {isTruePositive ? 'Critical Threat' : 'System Cleared'}
                </div>
            </header>

            {/* Content Area */}
            <main className="verdict-page-container" style={{ maxWidth: '1400px', margin: '0 auto', width: '100%', padding: '2.5rem 2rem', display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
                {/* Main Report Container */}
                <div className="verdict-report-card" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '1.5rem', display: 'flex', flexDirection: 'column', width: '100%' }}>
                    {/* Report Header Bar */}
                    <div className="verdict-report-header" style={{ padding: '1.25rem 2rem', background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <FileText size={20} color="var(--accent-primary)" />
                            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#fff' }}>Detailed Analysis Report</h2>
                        </div>
                    </div>

                    {/* Iframe Viewport */}
                    <div className="verdict-iframe-viewport" style={{
                        background: '#ffffff',
                        minHeight: '800px',
                        height: `${iframeHeight}px`,
                        width: '100%',
                        position: 'relative'
                    }}>
                        <iframe
                            ref={iframeRef}
                            title="AI Analysis Report"
                            srcDoc={finalReportDoc}
                            style={{
                                width: '100%',
                                height: '100%',
                                border: 'none',
                                position: 'absolute',
                                top: 0,
                                left: 0
                            }}
                            sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
                            scrolling="yes"
                            onLoad={() => {
                                if (iframeRef.current && iframeRef.current.contentWindow) {
                                    iframeRef.current.contentWindow.postMessage({ type: 'theme-change', theme }, '*');
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Additional Info Cards */}
                <div className="verdict-meta-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem', paddingBottom: '4rem' }}>
                    <div className="verdict-meta-card" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '1.5rem', padding: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                            <div style={{ padding: '0.75rem', background: isTruePositive ? 'rgba(248, 81, 73, 0.15)' : 'rgba(63, 185, 80, 0.15)', borderRadius: '1rem' }}>
                                {isTruePositive ? <AlertTriangle size={24} color="var(--status-critical)" /> : <ShieldCheck size={24} color="var(--status-low)" />}
                            </div>
                            <h3 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: '#fff' }}>{isTruePositive ? 'Analyst Verdict' : 'Security Clearance'}</h3>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: '1rem' }}>
                            {isTruePositive
                                ? "The AI agent has confirmed a valid threat based on forensic indicators. Recommended for immediate isolation."
                                : "The AI agent has verified this activity as benign. No further security actions required for this incident."}
                        </p>
                    </div>

                    <div className="verdict-meta-card" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '1.5rem', padding: '2rem' }}>
                        <h3 style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '1.5rem', fontWeight: 800 }}>Next Steps</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ fontWeight: 700, color: isTruePositive ? 'var(--status-critical)' : 'var(--status-low)', fontSize: '1.1rem' }}>
                                {isTruePositive ? "Initiate Host Isolation Protocol" : "Archive Incident Record"}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
