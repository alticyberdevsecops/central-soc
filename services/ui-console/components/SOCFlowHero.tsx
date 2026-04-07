'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Shield, ShieldAlert, Activity, Eye, Zap, Building2, Mail, MessageSquare } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   SOC Flow Hero — Animated futuristic pipeline visualization
   Tenants → Data Sources → Incidents Hub → Case Resolution
   ═══════════════════════════════════════════════════════════════ */

interface SOCFlowHeroProps {
    stats: {
        summary: any;
        by_vendor: any[];
    };
    tenants?: any[];
    tenantStats?: Record<string, any>;
}

/* ── Particle system on Canvas ── */
function ParticleCanvas({ width, height }: { width: number; height: number }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = width * 2;
        canvas.height = height * 2;
        ctx.scale(2, 2);

        const particles: { x: number; y: number; vx: number; vy: number; r: number; o: number; color: string; type: 'float' | 'stream' | 'spark' }[] = [];
        const colors = ['#2f81f7', '#3fb950', '#a371f7', '#f85149', '#d29922', '#4493f8'];

        // Floating background particles
        for (let i = 0; i < 50; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                r: Math.random() * 1.8 + 0.5,
                o: Math.random() * 0.4 + 0.1,
                color: colors[Math.floor(Math.random() * colors.length)],
                type: 'float'
            });
        }

        // Digital Data Streams (Falling particles)
        for (let i = 0; i < 30; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: 0,
                vy: Math.random() * 0.8 + 0.4,
                r: 1,
                o: Math.random() * 0.3 + 0.1,
                color: '#2f81f7',
                type: 'stream'
            });
        }

        // Spark particles (horizontal moving)
        for (let i = 0; i < 15; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: Math.random() * 1.5 + 0.5,
                vy: (Math.random() - 0.5) * 0.2,
                r: 0.8,
                o: Math.random() * 0.5 + 0.2,
                color: colors[Math.floor(Math.random() * colors.length)],
                type: 'spark'
            });
        }

        let animId: number;
        let frame = 0;
        const animate = () => {
            ctx.clearRect(0, 0, width, height);
            frame++;

            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;

                if (p.type === 'float') {
                    if (p.x < 0 || p.x > width) p.vx *= -1;
                    if (p.y < 0 || p.y > height) p.vy *= -1;
                } else if (p.type === 'stream') {
                    if (p.y > height) {
                        p.y = -20;
                        p.x = Math.round(Math.random() * (width / 40)) * 40;
                    }
                } else if (p.type === 'spark') {
                    if (p.x > width) {
                        p.x = -10;
                        p.y = Math.random() * height;
                    }
                }

                if (p.type === 'stream') {
                    ctx.beginPath();
                    const grad = ctx.createLinearGradient(p.x, p.y - 15, p.x, p.y);
                    grad.addColorStop(0, 'transparent');
                    grad.addColorStop(1, '#58a6ff60');
                    ctx.strokeStyle = grad;
                    ctx.lineWidth = 1.5;
                    ctx.moveTo(p.x, p.y - 15);
                    ctx.lineTo(p.x, p.y);
                    ctx.stroke();
                } else if (p.type === 'spark') {
                    ctx.beginPath();
                    const grad = ctx.createLinearGradient(p.x - 8, p.y, p.x, p.y);
                    grad.addColorStop(0, 'transparent');
                    grad.addColorStop(1, p.color + '80');
                    ctx.strokeStyle = grad;
                    ctx.lineWidth = 1;
                    ctx.moveTo(p.x - 8, p.y);
                    ctx.lineTo(p.x, p.y);
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    ctx.fillStyle = p.color;
                    ctx.globalAlpha = p.o * (0.7 + 0.3 * Math.sin(frame * 0.02 + p.x));
                    ctx.fill();
                    ctx.globalAlpha = 1;
                }
            });

            // Occasional "Digital Burst" - glowing horizontal lines
            if (Math.random() > 0.97) {
                ctx.beginPath();
                const y = Math.random() * height;
                const grad = ctx.createLinearGradient(0, y, width, y);
                grad.addColorStop(0, 'transparent');
                grad.addColorStop(0.5, 'rgba(88,166,255,0.08)');
                grad.addColorStop(1, 'transparent');
                ctx.strokeStyle = grad;
                ctx.lineWidth = 0.5;
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            animId = requestAnimationFrame(animate);
        };

        animate();
        return () => cancelAnimationFrame(animId);
    }, [width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        />
    );
}

/* ── Animated number counter ── */
function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
    const [display, setDisplay] = useState(0);
    useEffect(() => {
        if (value === 0) { setDisplay(0); return; }
        let start = 0;
        const step = value / (duration / 16);
        const timer = setInterval(() => {
            start += step;
            if (start >= value) { setDisplay(value); clearInterval(timer); }
            else setDisplay(Math.floor(start));
        }, 16);
        return () => clearInterval(timer);
    }, [value, duration]);

    const formatted = display >= 1000 ? `${(display / 1000).toFixed(1)}K` : String(display);
    return <>{formatted}</>;
}

/* ── Ribbon Path (SVG) ── */
function DataRibbon({ d, color, delay, id }: { d: string; color: string; delay: number; id: string }) {
    return (
        <g>
            <defs>
                <linearGradient id={`grad-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={color} stopOpacity="0.05" />
                    <stop offset="50%" stopColor={color} stopOpacity="0.18" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.05" />
                </linearGradient>
                <filter id={`glow-${id}`}>
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
            </defs>

            {/* Outer glow ribbon */}
            <path d={d} fill="none" stroke={color} strokeWidth="20" strokeLinecap="round" opacity="0.04" filter={`url(#glow-${id})`} />

            {/* Main Thick Ribbon */}
            <path d={d} fill="none" stroke={`url(#grad-${id})`} strokeWidth="14" strokeLinecap="round" />

            {/* Inner Core Line */}
            <path d={d} fill="none" stroke={color} strokeWidth="1.5" opacity="0.35" strokeLinecap="round" />

            {/* High-speed Signal Pulse */}
            <path d={d} fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="40 1000" opacity="0.8" filter="blur(1px)">
                <animate attributeName="stroke-dashoffset" from="1040" to="0" dur="2.5s" repeatCount="indefinite" begin={`${delay}s`} />
            </path>

            {/* Secondary slower pulse */}
            <path d={d} fill="none" stroke={color} strokeWidth="3" strokeDasharray="20 800" opacity="0.4">
                <animate attributeName="stroke-dashoffset" from="820" to="0" dur="4s" repeatCount="indefinite" begin={`${delay + 0.8}s`} />
            </path>

            {/* Glowing Glint */}
            <circle r="3" fill="#fff" filter="blur(2px)">
                <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${delay}s`}>
                    <mpath href={`#path-${id}`} />
                </animateMotion>
            </circle>

            {/* Colored trailing orb */}
            <circle r="5" fill={color} opacity="0.3" filter="blur(3px)">
                <animateMotion dur="3.5s" repeatCount="indefinite" begin={`${delay + 1}s`}>
                    <mpath href={`#path-${id}`} />
                </animateMotion>
            </circle>

            <path id={`path-${id}`} d={d} fill="none" stroke="none" />
        </g>
    );
}

/* ── SVG Node with count badge ── */
function SVGNode({ x, y, label, icon, color, count, fontSize = '0.65rem', align = 'left', theme = 'dark', delay = 0 }: {
    x: number; y: number; label: string; icon: React.ReactNode; color: string; count?: number;
    fontSize?: string; align?: 'left' | 'right'; theme?: 'dark' | 'light'; delay?: number;
}) {
    const isLeft = align === 'left';
    const isLight = theme === 'light';
    const hasCount = count !== undefined && count !== null;
    const countText = hasCount ? (count >= 1000 ? `${(count / 1000).toFixed(1)}K` : String(count)) : '';

    const countBadge = hasCount ? (
        <span style={{
            background: isLight ? color + '15' : color + '20',
            color: color,
            border: `1px solid ${isLight ? color + '30' : color + '40'}`,
            padding: '1px 6px',
            borderRadius: '10px',
            fontSize: '0.55rem',
            fontWeight: 800,
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
            lineHeight: '1.4',
        }}>
            {countText}
        </span>
    ) : null;

    return (
        <g transform={`translate(${x}, ${y})`}>
            {/* Pulsing glow ring */}
            <circle r="8" fill="none" stroke={color} strokeWidth="1" opacity="0.3">
                <animate attributeName="r" values="6;12;6" dur="3s" repeatCount="indefinite" begin={`${delay}s`} />
                <animate attributeName="opacity" values="0.4;0.1;0.4" dur="3s" repeatCount="indefinite" begin={`${delay}s`} />
            </circle>

            {/* Connection Dot */}
            <circle r="4" fill={color} filter="blur(1px)" />
            <circle r="2" fill="#fff" />

            <foreignObject
                x={isLeft ? -210 : 12}
                y={-15}
                width="200"
                height="30"
                style={{ overflow: 'visible' }}
            >
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isLeft ? 'flex-end' : 'flex-start',
                    gap: '5px',
                    color: isLight ? '#24292f' : '#c9d1d9',
                    fontSize,
                    fontWeight: 700,
                    fontFamily: 'Inter, system-ui, sans-serif',
                }}>
                    {isLeft ? (
                        <>
                            <span style={{
                                whiteSpace: 'nowrap',
                                opacity: isLight ? 1 : 0.85,
                            }}>{label}</span>
                            {countBadge}
                            <div style={{ color, display: 'flex', flexShrink: 0 }}>{icon}</div>
                        </>
                    ) : (
                        <>
                            <div style={{ color, display: 'flex', flexShrink: 0 }}>{icon}</div>
                            <span style={{
                                whiteSpace: 'nowrap',
                                opacity: isLight ? 1 : 0.85,
                            }}>{label}</span>
                            {countBadge}
                        </>
                    )}
                </div>
            </foreignObject>
        </g>
    );
}

/* ── Optimized Hub ── */
function CentralHub({ totalIncidents, summary, theme = 'dark' }: { totalIncidents: number, summary: any, theme?: 'dark' | 'light' }) {
    const isLight = theme === 'light';
    return (
        <g transform="translate(600, 275)">
            {/* Pulsing Core Glow */}
            <circle r="40" fill={isLight ? "rgba(47,129,247,0.1)" : "rgba(47,129,247,0.15)"} filter="blur(15px)">
                <animate attributeName="r" values="35;50;35" dur="3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;0.7;0.3" dur="3s" repeatCount="indefinite" />
            </circle>

            {/* Secondary pulsing ring */}
            <circle r="90" fill="none" stroke="#2f81f7" strokeWidth="0.8" opacity="0.15">
                <animate attributeName="r" values="85;100;85" dur="4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.15;0.05;0.15" dur="4s" repeatCount="indefinite" />
            </circle>

            {/* Radar Sweep Effect */}
            <g>
                <path d="M 0 0 L 0 -130 A 130 130 0 0 1 65 -113 Z" fill="url(#sweepGrad)" opacity={isLight ? 0.2 : 0.4}>
                    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite" />
                </path>
                <defs>
                    <linearGradient id="sweepGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#2f81f7" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#2f81f7" stopOpacity="0" />
                    </linearGradient>
                </defs>
            </g>

            {/* Second radar sweep (opposite direction) */}
            <g opacity="0.2">
                <path d="M 0 0 L 0 -100 A 100 100 0 0 0 -50 -87 Z" fill="url(#sweepGrad2)">
                    <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="6s" repeatCount="indefinite" />
                </path>
                <defs>
                    <linearGradient id="sweepGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#3fb950" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#3fb950" stopOpacity="0" />
                    </linearGradient>
                </defs>
            </g>

            {/* Rotating Outer Ring */}
            <circle r="120" fill="none" stroke="#2f81f7" strokeWidth="0.5" strokeDasharray="4 8" opacity={isLight ? 0.3 : 0.2}>
                <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="40s" repeatCount="indefinite" />
            </circle>

            {/* Inner rotating ring (opposite) */}
            <circle r="95" fill="none" stroke="#a371f7" strokeWidth="0.4" strokeDasharray="2 12" opacity="0.15">
                <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="25s" repeatCount="indefinite" />
            </circle>

            {/* Orbiting dots */}
            {[0, 1, 2, 3].map(i => (
                <g key={`orbit-${i}`}>
                    <circle r="2.5" fill={['#2f81f7', '#3fb950', '#a371f7', '#f85149'][i]} opacity="0.6">
                        <animateMotion
                            dur={`${8 + i * 2}s`}
                            repeatCount="indefinite"
                            begin={`${i * 2}s`}
                            path={`M ${110 * Math.cos(0)} ${110 * Math.sin(0)} A 110 110 0 1 1 ${110 * Math.cos(0.01)} ${110 * Math.sin(0.01)} Z`}
                        />
                        <animate attributeName="opacity" values="0.8;0.3;0.8" dur={`${3 + i}s`} repeatCount="indefinite" />
                    </circle>
                </g>
            ))}

            {/* Dot Grid Hub */}
            {[...Array(6)].map((_, ring) => (
                <g key={ring}>
                    {[...Array(12 + ring * 6)].map((_, i) => {
                        const angle = (i / (12 + ring * 6)) * Math.PI * 2;
                        const r = 40 + ring * 8;
                        const x = Math.cos(angle) * r;
                        const y = Math.sin(angle) * r;
                        return (
                            <circle
                                key={i}
                                cx={x} cy={y}
                                r={1}
                                fill={ring % 2 === 0 ? '#2f81f7' : (isLight ? '#2ea44f' : '#3fb950')}
                                opacity={isLight ? 0.5 : 0.3 + (Math.sin(i + ring) * 0.2)}
                            >
                                {ring < 3 && (
                                    <animate
                                        attributeName="opacity"
                                        values={`${0.2 + ring * 0.1};${0.5 + ring * 0.1};${0.2 + ring * 0.1}`}
                                        dur={`${2 + ring}s`}
                                        repeatCount="indefinite"
                                        begin={`${i * 0.1}s`}
                                    />
                                )}
                            </circle>
                        );
                    })}
                </g>
            ))}

            {/* Energy pulse rings expanding outward */}
            {[0, 1, 2].map(i => (
                <circle key={`pulse-${i}`} r="30" fill="none" stroke={isLight ? "#0969da" : "#2f81f7"} strokeWidth="1">
                    <animate attributeName="r" values="30;130" dur="4s" repeatCount="indefinite" begin={`${i * 1.3}s`} />
                    <animate attributeName="opacity" values={isLight ? "0.15;0" : "0.3;0"} dur="4s" repeatCount="indefinite" begin={`${i * 1.3}s`} />
                </circle>
            ))}

            {/* Hub Metrics */}
            <foreignObject x="-60" y="-40" width="120" height="80">
                <div style={{ textAlign: 'center', color: isLight ? '#1f2328' : '#e6edf3', fontFamily: 'monospace' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, textShadow: isLight ? 'none' : '0 0 20px rgba(47,129,247,0.5)' }}>
                        <AnimatedNumber value={totalIncidents} />
                    </div>
                    <div style={{ fontSize: '0.5rem', opacity: 0.5, letterSpacing: '2px', marginTop: -4 }}>INCIDENTS</div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: 8 }}>
                        <div style={{ color: isLight ? '#cf222e' : '#f85149', fontSize: '0.6rem', fontWeight: 800 }}>● {summary.critical_count}</div>
                        <div style={{ color: isLight ? '#9a6700' : '#d29922', fontSize: '0.6rem', fontWeight: 800 }}>● {summary.high_count}</div>
                    </div>
                </div>
            </foreignObject>
        </g>
    );
}

/* ── Bottom Stats Bar Item ── */
function BottomStat({ label, value, color, icon, isLight }: {
    label: string; value: number; color: string; icon: React.ReactNode; isLight?: boolean;
}) {
    return (
        <div style={{
            flex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '0.7rem',
            padding: '0.8rem 0.5rem',
            borderRight: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(47,129,247,0.08)'}`,
            transition: 'all 0.3s ease',
            cursor: 'default',
        }}
            onMouseEnter={(e) => {
                e.currentTarget.style.background = isLight ? 'rgba(47,129,247,0.05)' : 'rgba(47,129,247,0.05)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
            }}
        >
            <div style={{
                color,
                display: 'flex',
                filter: `drop-shadow(0 0 5px ${color}60)`,
                opacity: 0.9
            }}>{icon}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{
                    fontSize: '1.1rem', fontWeight: 900,
                    color: isLight ? '#1f2328' : '#e6edf3',
                    letterSpacing: '-0.02em', lineHeight: 1,
                    textShadow: isLight ? 'none' : '0 0 15px rgba(255,255,255,0.1)',
                }}>
                    <AnimatedNumber value={value} />
                </span>
                <span style={{
                    fontSize: '0.48rem',
                    color: isLight ? '#656d76' : '#8b949e',
                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 1
                }}>
                    {label}
                </span>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════ */
export default function SOCFlowHero({ stats, tenants = [], tenantStats = {} }: SOCFlowHeroProps) {
    const { summary } = stats;
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');

    useEffect(() => {
        const checkTheme = () => {
            const dt = document.documentElement.getAttribute('data-theme');
            setTheme(dt === 'light' ? 'light' : 'dark');
        };
        checkTheme();
        const observer = new MutationObserver(checkTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        return () => observer.disconnect();
    }, []);

    const isLight = theme === 'light';
    const totalIncidents = summary.total_incidents || (summary.critical_count + summary.high_count + summary.medium_count + summary.low_count + (summary.informational_count || 0));
    const resolvedCases = summary.resolved_count || 0;
    const escalated = summary.escalated_count || 0;

    const displayTenants = (tenants || []).slice(0, 16);
    const tenantColors = ['#58a6ff', '#56d364', '#bc8cff', '#ff7b72', '#e3b341', '#79c0ff', '#d2a8ff', '#3fb950', '#a371f7', '#2f81f7'];

    const tenantCount = displayTenants.length;
    const dynamicFontSize = tenantCount <= 2 ? '1.1rem' :
        tenantCount <= 4 ? '0.9rem' :
            tenantCount <= 8 ? '0.75rem' : '0.6rem';

    const dynamicMaxSpread = tenantCount <= 3 ? 180 :
        tenantCount <= 6 ? 300 : 420;

    const dynamicIconSize = tenantCount <= 3 ? 16 : 12;

    const step = tenantCount > 1 ? Math.min(60, dynamicMaxSpread / (tenantCount - 1)) : 0;
    const totalHeight = (tenantCount - 1) * step;
    const tenantYStart = 275 - totalHeight / 2;
    const tenantYStep = step;

    const resolutions = [
        { label: "Resolved", value: resolvedCases, color: isLight ? "#2ea44f" : "#3fb950", icon: <ShieldAlert size={12} />, y: 45 },
        { label: "In Progress", value: summary.in_progress_count || 0, color: isLight ? "#8250df" : "#a371f7", icon: <Activity size={12} />, y: 130 },
        { label: "Sent to Customer", value: summary.sent_to_customer_count || 0, color: isLight ? "#1a7ab5" : "#38a6e5", icon: <Mail size={12} />, y: 215 },
        { label: "Response Received", value: summary.customer_response_count || 0, color: isLight ? "#b86e30" : "#e28743", icon: <MessageSquare size={12} />, y: 300 },
        { label: "AI Triaging", value: summary.triaging_count || 0, color: isLight ? "#9a6700" : "#d29922", icon: <Eye size={12} />, y: 385 },
        { label: "Escalated", value: escalated, color: isLight ? "#cf222e" : "#f85149", icon: <Zap size={12} />, y: 470 },
    ];

    return (
        <section style={{
            height: 550,
            background: isLight
                ? 'radial-gradient(circle at 50% 50%, #fff 0%, #f6f8fa 100%)'
                : 'radial-gradient(circle at 50% 50%, #0d1117 0%, #000 100%)',
            borderRadius: '16px',
            position: 'relative',
            overflow: 'hidden',
            border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(47,129,247,0.1)'}`,
            boxShadow: isLight ? '0 4px 30px rgba(0,0,0,0.05)' : '0 4px 60px rgba(0,0,0,0.5)',
            userSelect: 'none',
            transition: 'all 0.5s ease',
        }}>
            {/* Background Grid & Shimmer */}
            <div style={{
                position: 'absolute', inset: 0,
                backgroundImage: `radial-gradient(${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(47,129,247,0.1)'} 1px, transparent 1px)`,
                backgroundSize: '40px 40px',
                opacity: isLight ? 0.4 : 0.2,
                animation: 'soc-pulse-grid 8s ease-in-out infinite',
            }} />

            {/* Ambient Data Waves */}
            {[...Array(5)].map((_, i) => (
                <div key={i} style={{
                    position: 'absolute',
                    top: `${10 + i * 20}%`,
                    left: '-100%',
                    width: '100%',
                    height: '1px',
                    background: `linear-gradient(90deg, transparent, ${isLight ? 'rgba(47,129,247,0.06)' : 'rgba(88,166,255,0.05)'}, transparent)`,
                    animation: `soc-data-wave ${8 + i * 2}s linear infinite`,
                    animationDelay: `${i * 1.5}s`,
                }} />
            ))}

            {/* Vertical scan line */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: '-2px',
                width: '2px',
                height: '100%',
                background: `linear-gradient(180deg, transparent, ${isLight ? 'rgba(47,129,247,0.15)' : 'rgba(88,166,255,0.1)'}, transparent)`,
                animation: 'soc-scan-line 6s ease-in-out infinite',
            }} />

            <ParticleCanvas width={1200} height={550} />

            <svg
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                viewBox="-40 0 1280 550"
                preserveAspectRatio="xMidYMid meet"
            >
                <CentralHub totalIncidents={totalIncidents} summary={summary} theme={theme} />

                {/* Left Side: Tenants & Their Ribbons */}
                {displayTenants.map((t: any, i: number) => {
                    const ty = tenantYStart + i * tenantYStep;
                    const midY = 275 + (i - displayTenants.length / 2) * 5;
                    const d = `M 170 ${ty} C 300 ${ty}, 450 ${midY}, 540 ${midY}`;
                    const tStats = tenantStats[t.id];
                    const incidentCount = tStats?.total_incidents ?? undefined;
                    return (
                        <React.Fragment key={t.id || i}>
                            <DataRibbon d={d} color={tenantColors[i % tenantColors.length]} delay={i * 0.15} id={`t-${i}`} />
                            <SVGNode
                                x={170}
                                y={ty}
                                label={t.name || t.slug}
                                icon={<Building2 size={dynamicIconSize} />}
                                color={tenantColors[i % tenantColors.length]}
                                count={incidentCount}
                                align="left"
                                fontSize={dynamicFontSize}
                                theme={theme}
                                delay={i * 0.1}
                            />
                        </React.Fragment>
                    );
                })}

                {/* Right Side: Resolutions & Their Ribbons */}
                {resolutions.map((res, i) => {
                    const midY = 275 + (i - 1.5) * 15;
                    const d = `M 660 ${midY} C 850 ${midY}, 950 ${res.y}, 1030 ${res.y}`;
                    return (
                        <React.Fragment key={i}>
                            <DataRibbon d={d} color={res.color} delay={1.5 + i * 0.2} id={`r-${i}`} />
                            <SVGNode
                                x={1030}
                                y={res.y}
                                label={res.label}
                                icon={res.icon}
                                color={res.color}
                                count={res.value}
                                align="right"
                                fontSize="0.75rem"
                                theme={theme}
                                delay={1.5 + i * 0.15}
                            />
                        </React.Fragment>
                    );
                })}
            </svg>

            {/* Global Stats Bar */}
            <div style={{
                position: 'absolute',
                bottom: 0, left: 0, right: 0,
                display: 'flex',
                background: isLight ? 'rgba(255,255,255,0.95)' : 'rgba(13,17,23,0.9)',
                borderTop: `1px solid ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(47,129,247,0.1)'}`,
                backdropFilter: 'blur(12px)',
                transition: 'all 0.5s ease',
            }}>
                <BottomStat label="Last 24h" value={summary.last_24h} color={isLight ? "#0969da" : "#2f81f7"} icon={<Zap size={14} />} isLight={isLight} />
                <BottomStat label="Cases" value={totalIncidents} color={isLight ? "#6f42c1" : "#a371f7"} icon={<Activity size={14} />} isLight={isLight} />
                <BottomStat label="Critical" value={summary.critical_count} color={isLight ? "#d73a49" : "#f85149"} icon={<ShieldAlert size={14} />} isLight={isLight} />
                <BottomStat label="Resolved" value={resolvedCases} color={isLight ? "#22863a" : "#3fb950"} icon={<Shield size={14} />} isLight={isLight} />
            </div>

            <style>{`
                @keyframes soc-pulse-glow {
                    0%, 100% { opacity: 0.5; filter: drop-shadow(0 0 2px currentColor); }
                    50% { opacity: 1; filter: drop-shadow(0 0 8px currentColor); }
                }
                @keyframes soc-pulse-grid {
                    0%, 100% { opacity: 0.15; }
                    50% { opacity: 0.3; }
                }
                @keyframes soc-data-wave {
                    from { transform: translateX(0); }
                    to { transform: translateX(200%); }
                }
                @keyframes soc-scan-line {
                    0% { left: -2px; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { left: 100%; opacity: 0; }
                }
            `}</style>
        </section>
    );
}
