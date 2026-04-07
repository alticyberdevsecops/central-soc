'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import {
    Mail,
    ChevronDown,
    ChevronUp,
    Paperclip,
    Reply,
    User,
    ArrowUpRight,
    ArrowDownLeft,
    Info,
    Send,
    Loader2,
    X,
    RefreshCw,
    TicketCheck,
    MessageSquare,
} from 'lucide-react';
import { incidentApi } from '@/lib/api';
import DOMPurify from 'dompurify';

interface Interaction {
    id: string;
    incident_id: string;
    message_id: string;
    in_reply_to?: string;
    from_email: string;
    to_email?: string;
    cc_email?: string;
    sender_name?: string;
    subject: string;
    body: string;
    created_at: string;
    direction: 'inbound' | 'outbound';
    interaction_source?: string; // 'email' | 'freshservice' | 'freshdesk' | 'servicenow'
    has_attachments: boolean;
    attachment_names?: string;
}

const ITSM_SOURCES = ['freshservice', 'freshdesk', 'servicenow'];

const ITSM_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
    freshservice: { label: 'Freshservice', color: '#22c55e', bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)' },
    freshdesk:    { label: 'Freshdesk',    color: '#06b6d4', bg: 'rgba(6,182,212,0.08)',  border: 'rgba(6,182,212,0.25)' },
    servicenow:   { label: 'ServiceNow',   color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)' },
};

interface Props {
    incidentId: string;
    incidentTicketId: string;
    refreshTrigger?: number;
}

export default function CommunicationTimeline({ incidentId, incidentTicketId, refreshTrigger }: Props) {
    const [interactions, setInteractions] = useState<Interaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [replyingTo, setReplyingTo] = useState<Interaction | null>(null);
    const [replyBody, setReplyBody] = useState('');
    const [replyFiles, setReplyFiles] = useState<File[]>([]);
    const [replyCc, setReplyCc] = useState('');
    const [submittingReply, setSubmittingReply] = useState(false);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [itsmReplyingTo, setItsmReplyingTo] = useState<Interaction | null>(null);
    const [itsmReplyBody, setItsmReplyBody] = useState('');
    const [itsmReplyFiles, setItsmReplyFiles] = useState<File[]>([]);
    const [submittingItsmReply, setSubmittingItsmReply] = useState(false);

    const fetchInteractions = async () => {
        try {
            const data = await incidentApi.getInteractions(incidentId);
            setInteractions(data);
            // Default expand the latest one if any
            if (data.length > 0 && expandedIds.size === 0) {
                setExpandedIds(new Set([data[data.length - 1].id]));
            }
        } catch (error) {
            console.error('Failed to fetch interactions:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInteractions();
        
        // Auto-refresh every 30 seconds to catch inbound replies (fallback)
        const intervalId = setInterval(() => {
            fetchInteractions();
        }, 30000);
        
        return () => clearInterval(intervalId);
    }, [incidentId, refreshTrigger]);

    const toggleExpand = (id: string) => {
        const next = new Set(expandedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedIds(next);
    };

    const handleSendReply = async () => {
        if (!replyBody.trim() && replyFiles.length === 0) return;
        setSubmittingReply(true);
        try {
            const formData = new FormData();
            formData.append('body', replyBody);
            if (replyCc.trim()) formData.append('cc', replyCc.trim());
            replyFiles.forEach(file => formData.append('files', file));
            
            await incidentApi.sendReply(incidentTicketId, formData);
            
            setReplyBody('');
            setReplyCc('');
            setReplyFiles([]);
            setReplyingTo(null);
            await fetchInteractions();
        } catch (error) {
            console.error('Failed to send reply:', error);
            alert('Failed to send reply');
        } finally {
            setSubmittingReply(false);
        }
    };

    const handleSendItsmComment = async () => {
        if (!itsmReplyBody.trim() && itsmReplyFiles.length === 0) return;
        setSubmittingItsmReply(true);
        try {
            const formData = new FormData();
            formData.append('body', itsmReplyBody);
            itsmReplyFiles.forEach(file => formData.append('files', file));
            await incidentApi.itsmComment(incidentId, formData);
            setItsmReplyBody('');
            setItsmReplyFiles([]);
            setItsmReplyingTo(null);
            await fetchInteractions();
        } catch (error) {
            console.error('Failed to post ITSM comment:', error);
            alert('Failed to post comment to ITSM');
        } finally {
            setSubmittingItsmReply(false);
        }
    };

    const removeFile = (index: number) => {
        setReplyFiles(prev => prev.filter((_, i) => i !== index));
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
                <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
            </div>
        );
    }

    if (interactions.length === 0) {
        return (
            <div style={{ 
                padding: '2rem', 
                textAlign: 'center', 
                background: 'var(--bg-secondary)', 
                borderRadius: 'var(--radius-lg)',
                border: '1px dashed var(--border-color)',
                color: 'var(--text-tertiary)',
                marginBottom: '1.5rem'
            }}>
                <Mail size={32} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
                <p style={{ fontSize: '0.85rem' }}>No communication history yet.</p>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                <div style={{ 
                    padding: '0.4rem', 
                    background: 'linear-gradient(135deg, var(--accent-primary), #6e40c9)', 
                    borderRadius: '0.4rem',
                    color: 'white'
                }}>
                    <Mail size={16} />
                </div>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Communication Timeline
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
                    <button 
                        onClick={() => fetchInteractions()}
                        disabled={loading}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0.2rem',
                            borderRadius: '0.2rem',
                        }}
                        title="Refresh Timeline"
                    >
                        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    </button>
                    <span style={{ 
                        fontSize: '0.7rem', 
                        background: 'var(--bg-tertiary)', 
                        padding: '0.2rem 0.5rem', 
                        borderRadius: '1rem',
                        color: 'var(--text-secondary)',
                        fontWeight: 600
                    }}>
                        {interactions.length} Interactions
                    </span>
                </div>
            </div>

            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Vertical Line */}
                <div style={{ 
                    position: 'absolute', 
                    left: '1.5rem', 
                    top: '0', 
                    bottom: '0', 
                    width: '2px', 
                    background: 'linear-gradient(180deg, var(--border-color) 0%, transparent 100%)',
                    zIndex: 0
                }} />

                {[...interactions].reverse().map((interaction, idx) => {
                    const src = interaction.interaction_source || 'email';
                    const isITSM = ITSM_SOURCES.includes(src);
                    const itsmMeta = isITSM ? ITSM_META[src] : null;
                    return (
                    <div key={interaction.id} style={{
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem',
                        zIndex: 1
                    }}>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                        {/* Direction Icon Wrapper */}
                        <div style={{
                            flexShrink: 0,
                            width: '3rem',
                            display: 'flex',
                            justifyContent: 'center'
                        }}>
                            <div style={{
                                width: '2rem',
                                height: '2rem',
                                borderRadius: '50%',
                                background: isITSM
                                    ? itsmMeta!.bg
                                    : interaction.direction === 'outbound' ? 'rgba(71, 191, 237, 0.1)' : 'rgba(63, 185, 80, 0.1)',
                                border: `2px solid ${isITSM
                                    ? itsmMeta!.border
                                    : interaction.direction === 'outbound' ? 'rgba(71, 191, 237, 0.3)' : 'rgba(63, 185, 80, 0.3)'}`,
                                color: isITSM
                                    ? itsmMeta!.color
                                    : interaction.direction === 'outbound' ? '#47bfed' : '#3fb950',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 0 15px rgba(0,0,0,0.1)'
                            }}>
                                {isITSM
                                    ? (interaction.direction === 'outbound' ? <TicketCheck size={13} /> : <MessageSquare size={13} />)
                                    : (interaction.direction === 'outbound' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />)
                                }
                            </div>
                        </div>

                        {/* Card */}
                        <div style={{
                            flex: 1,
                            background: isITSM ? itsmMeta!.bg : 'var(--bg-secondary)',
                            borderRadius: 'var(--radius-lg)',
                            border: `1px solid ${isITSM ? itsmMeta!.border : 'var(--border-color)'}`,
                            overflow: 'hidden',
                            boxShadow: 'var(--shadow-sm)',
                            transition: 'all 0.2s ease',
                            ...(expandedIds.has(interaction.id) ? { borderColor: isITSM ? itsmMeta!.color : 'var(--border-subtle)' } : {})
                        }}>
                            {/* Card Header */}
                            <div
                                onClick={() => toggleExpand(interaction.id)}
                                style={{
                                    padding: '1rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.4rem',
                                    background: expandedIds.has(interaction.id) ? 'rgba(255,255,255,0.02)' : 'transparent'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                            {interaction.sender_name || interaction.from_email}
                                        </span>
                                        {/* ITSM source badge — or direction badge for email */}
                                        {isITSM ? (
                                            <span style={{
                                                fontSize: '0.62rem', fontWeight: 800,
                                                padding: '0.15rem 0.5rem', borderRadius: '0.2rem',
                                                background: itsmMeta!.bg, color: itsmMeta!.color,
                                                border: `1px solid ${itsmMeta!.border}`,
                                                textTransform: 'uppercase', letterSpacing: '0.05em',
                                            }}>
                                                {itsmMeta!.label}
                                            </span>
                                        ) : (
                                        <span style={{
                                            fontSize: '0.65rem',
                                            color: 'var(--text-tertiary)',
                                            background: 'var(--bg-tertiary)',
                                            padding: '0.1rem 0.4rem',
                                            borderRadius: '0.2rem',
                                            textTransform: 'uppercase',
                                            fontWeight: 800
                                        }}>
                                            {interaction.direction}
                                        </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>
                                            {format(new Date(interaction.created_at), 'MMM d, HH:mm')}
                                        </span>
                                        {expandedIds.has(interaction.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    </div>
                                </div>
                                <div style={{ 
                                    fontSize: '0.78rem', 
                                    color: interaction.direction === 'outbound' ? 'var(--text-secondary)' : 'var(--text-primary)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    maxWidth: '80%',
                                    fontWeight: interaction.direction === 'inbound' ? 600 : 400
                                }}>
                                    {interaction.subject}
                                </div>
                                {interaction.has_attachments && interaction.attachment_names && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-primary)', fontSize: '0.65rem', fontWeight: 600, flexWrap: 'wrap' }}>
                                        <Paperclip size={10} />
                                        {interaction.attachment_names.split(',').map((name, idx, arr) => (
                                            <React.Fragment key={idx}>
                                                <span 
                                                    style={{ cursor: 'pointer', textDecoration: 'underline' }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        incidentApi.downloadAttachment(incidentId, interaction.id, name.trim()).catch(err => alert("Failed to download attachment: " + err.message));
                                                    }}
                                                >
                                                    {name.trim()}
                                                </span>
                                                {idx < arr.length - 1 && <span style={{ color: 'var(--text-tertiary)' }}>,</span>}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Card Content (Body) */}
                            {expandedIds.has(interaction.id) && (
                                <div style={{
                                    padding: '1rem 1.25rem 1.25rem',
                                    background: 'var(--bg-tertiary)',
                                    borderTop: '1px solid var(--border-color)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1rem',
                                }} className="interaction-body">
                                    {/* Detailed Metadata */}
                                    <div style={{ 
                                        display: 'flex', 
                                        flexDirection: 'column', 
                                        gap: '0.5rem', 
                                        marginBottom: '1rem',
                                        fontSize: '0.7rem',
                                        color: 'var(--text-tertiary)',
                                        padding: '0.75rem',
                                        background: 'rgba(0,0,0,0.2)',
                                        borderRadius: 'var(--radius-md)'
                                    }}>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <span style={{ fontWeight: 700, minWidth: '3rem' }}>FROM:</span>
                                            <span style={{ color: 'var(--text-secondary)' }}>{interaction.from_email}</span>
                                        </div>
                                        {interaction.to_email && (
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <span style={{ fontWeight: 700, minWidth: '3rem' }}>TO:</span>
                                                <span style={{ color: 'var(--text-secondary)' }}>{interaction.to_email}</span>
                                            </div>
                                        )}
                                        {interaction.cc_email && (
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <span style={{ fontWeight: 700, minWidth: '3rem' }}>CC:</span>
                                                <span style={{ color: 'var(--text-secondary)' }}>{interaction.cc_email}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Email Body */}
                                    {(() => {
                                        const rawBody = interaction.body?.trim() || '';

                                        // Determine body type
                                        const htmlTagIdx = rawBody.search(/<(?:div|table|html|!doctype|body)/i);
                                        const isFullHtml = htmlTagIdx === 0;          // starts with HTML tag
                                        const isMixed   = !isFullHtml && htmlTagIdx > 0; // plain text prefix + HTML quote

                                        const renderIframe = (html: string) => (
                                            <div style={{ background: '#f6f8fa', borderRadius: '10px', padding: '1rem', overflow: 'auto' }}>
                                                <iframe
                                                    srcDoc={DOMPurify.sanitize(html, {
                                                        FORCE_BODY: true,
                                                        ADD_TAGS: ['style'],
                                                        ADD_ATTR: ['target', 'style', 'bgcolor', 'cellpadding', 'cellspacing', 'border', 'align', 'valign', 'width', 'height'],
                                                    })}
                                                    style={{ width: '100%', maxWidth: '680px', border: 'none', borderRadius: '8px', minHeight: '120px', background: '#ffffff', display: 'block', margin: '0 auto' }}
                                                    sandbox="allow-same-origin"
                                                    onLoad={(e) => {
                                                        try {
                                                            const doc = e.currentTarget.contentDocument || e.currentTarget.contentWindow?.document;
                                                            if (doc) e.currentTarget.style.height = (doc.documentElement.scrollHeight + 20) + 'px';
                                                        } catch {}
                                                    }}
                                                />
                                            </div>
                                        );

                                        if (isFullHtml) {
                                            // Pure HTML email template (initial send) — render isolated
                                            return renderIframe(rawBody);
                                        }

                                        if (isMixed) {
                                            // Reply email: plain-text new content + HTML-quoted original
                                            const newContent = rawBody.substring(0, htmlTagIdx).trim();
                                            const quotedHtml = rawBody.substring(htmlTagIdx);
                                            return (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                    {/* New reply content */}
                                                    {newContent && (
                                                        <div style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', fontFamily: 'Inter, sans-serif' }}>
                                                            {newContent}
                                                        </div>
                                                    )}
                                                    {/* Collapsible quoted original */}
                                                    <details style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
                                                        <summary style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', cursor: 'pointer', userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                            <span style={{ fontSize: '0.65rem' }}>▶</span> Show original email
                                                        </summary>
                                                        <div style={{ marginTop: '0.5rem' }}>
                                                            {renderIframe(quotedHtml)}
                                                        </div>
                                                    </details>
                                                </div>
                                            );
                                        }

                                        // Pure plain text — strip reply quotes
                                        let cleanBody = rawBody;
                                        const replyRegexes = [
                                            /(\r?\n)On\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[\s\S]*?wrote:/i,
                                            /(\r?\n)From:\s+[\s\S]*?Sent:\s+[\s\S]*?Subject:\s+/i,
                                            /(\r?\n)-----Original Message-----/i,
                                            /(\r?\n)---+\s*Forwarded message\s*---+/i,
                                            /(\r?\n)_{10,}/i,
                                        ];
                                        for (const regex of replyRegexes) {
                                            const match = cleanBody.match(regex);
                                            if (match && match.index !== undefined && match.index > 0) {
                                                cleanBody = cleanBody.substring(0, match.index).trim();
                                            }
                                        }
                                        const lines = cleanBody.split('\n');
                                        const trailIdx = lines.findIndex(l => /^From:\s+/i.test(l) || /^On\s+.*wrote:/i.test(l));
                                        if (trailIdx > 0) cleanBody = lines.slice(0, trailIdx).join('\n').trim();
                                        cleanBody = cleanBody.replace(/^>.*$/gm, '').trim();
                                        // Collapse 3+ consecutive newlines → max 2 (one blank line)
                                        cleanBody = cleanBody.replace(/\n{3,}/g, '\n\n');
                                        // Convert newlines to <br> but double-newline → paragraph break
                                        const htmlContent = cleanBody
                                            .split('\n\n')
                                            .map(para => `<p style="margin:0 0 0.6em 0">${para.replace(/\n/g, '<br/>')}</p>`)
                                            .join('');
                                        return (
                                            <div style={{ fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--text-secondary)', wordBreak: 'break-word', fontFamily: 'Inter, sans-serif' }}
                                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlContent) }}
                                            />
                                        );
                                    })()}

                                    {/* Action Footer */}
                                    <div style={{
                                        marginTop: '0.75rem',
                                        display: 'flex',
                                        justifyContent: 'flex-end',
                                        paddingTop: '0.75rem',
                                        borderTop: '1px solid var(--border-color)'
                                    }}>
                                        {isITSM ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setItsmReplyingTo(interaction);
                                                    setItsmReplyBody('');
                                                    setItsmReplyFiles([]);
                                                }}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.4rem',
                                                    padding: '0.4rem 0.8rem',
                                                    borderRadius: 'var(--radius-md)',
                                                    background: itsmMeta ? `${itsmMeta.bg}` : 'rgba(34,197,94,0.1)',
                                                    border: `1px solid ${itsmMeta ? itsmMeta.border : 'rgba(34,197,94,0.3)'}`,
                                                    color: itsmMeta ? itsmMeta.color : '#22c55e',
                                                    fontSize: '0.73rem',
                                                    fontWeight: 700,
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                <MessageSquare size={14} />
                                                ADD COMMENT
                                            </button>
                                        ) : (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setReplyingTo(interaction);
                                                    setReplyBody('');
                                                    setReplyCc('');
                                                }}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.4rem',
                                                    padding: '0.4rem 0.8rem',
                                                    borderRadius: 'var(--radius-md)',
                                                    background: 'rgba(47,129,247,0.1)',
                                                    border: '1px solid rgba(47,129,247,0.3)',
                                                    color: '#4493f8',
                                                    fontSize: '0.73rem',
                                                    fontWeight: 700,
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                <Reply size={14} />
                                                REPLY TO THREAD
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        </div>

                        {/* Inline Reply Form explicitly underneath the specific interaction map */}
                        {replyingTo?.id === interaction.id && (
                            <div style={{ 
                                marginLeft: '4rem',
                                background: 'var(--bg-secondary)',
                                border: '1px solid var(--accent-primary)',
                                borderRadius: 'var(--radius-lg)',
                                padding: '1.25rem',
                                boxShadow: '0 0 20px rgba(163,113,247,0.1)'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                        <Reply size={16} style={{ color: 'var(--accent-primary)' }} />
                                        <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase' }}>
                                            Reply to: <span style={{ color: 'var(--text-secondary)' }}>{replyingTo.subject || 'Thread'}</span>
                                        </span>
                                    </div>
                                    <button onClick={() => setReplyingTo(null)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                                        <X size={18} />
                                    </button>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Cc:</span>
                                    <input 
                                        type="text" 
                                        value={replyCc}
                                        onChange={(e) => setReplyCc(e.target.value)}
                                        placeholder="Optional comma-separated emails"
                                        style={{
                                            flex: 1, background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.6rem', color: 'var(--text-primary)', fontSize: '0.75rem', outline: 'none'
                                        }}
                                    />
                                </div>

                                <textarea
                                    value={replyBody}
                                    onChange={(e) => setReplyBody(e.target.value)}
                                    placeholder="Type your response to the customer..."
                                    style={{
                                        width: '100%',
                                        minHeight: '120px',
                                        background: 'var(--bg-tertiary)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: '1rem',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.85rem',
                                        resize: 'vertical',
                                        outline: 'none',
                                        marginBottom: '1rem',
                                        fontFamily: 'inherit'
                                    }}
                                />

                                {/* File Upload List */}
                                {replyFiles.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                                        {replyFiles.map((file, i) => (
                                            <div key={i} style={{
                                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                                padding: '0.3rem 0.6rem', background: 'rgba(255,255,255,0.05)',
                                                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)',
                                                fontSize: '0.7rem'
                                            }}>
                                                <Paperclip size={12} />
                                                <span>{file.name}</span>
                                                <button onClick={() => setReplyFiles(prev => prev.filter((_, index) => index !== i))} style={{ border: 'none', background: 'none', color: '#f85149', cursor: 'pointer', padding: 0 }}>
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label style={{ cursor: 'pointer' }}>
                                        <input
                                            type="file"
                                            multiple
                                            style={{ display: 'none' }}
                                            onChange={(e) => {
                                                if (e.target.files) {
                                                    setReplyFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                                                }
                                            }}
                                        />
                                        <div style={{ 
                                            display: 'flex', alignItems: 'center', gap: '0.4rem', 
                                            fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
                                            padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
                                            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)'
                                        }}>
                                            <Paperclip size={14} />
                                            ATTACH DOCUMENTS
                                        </div>
                                    </label>

                                    <button
                                        onClick={handleSendReply}
                                        disabled={submittingReply || (!replyBody.trim() && replyFiles.length === 0)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                                            padding: '0.6rem 1.25rem',
                                            background: 'linear-gradient(135deg, #a371f7, #6e40c9)',
                                            border: 'none', borderRadius: 'var(--radius-md)',
                                            color: 'white', fontWeight: 700, fontSize: '0.75rem',
                                            cursor: submittingReply ? 'not-allowed' : 'pointer',
                                            opacity: submittingReply ? 0.7 : 1,
                                            boxShadow: '0 4px 15px rgba(163,113,247,0.3)'
                                        }}
                                    >
                                        {submittingReply ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                        {submittingReply ? 'SENDING REPLY...' : 'SEND REPLY'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ITSM Inline Comment Form */}
                        {itsmReplyingTo?.id === interaction.id && (
                            <div style={{
                                marginLeft: '4rem',
                                background: 'var(--bg-secondary)',
                                border: `1px solid ${itsmMeta ? itsmMeta.color : '#22c55e'}`,
                                borderRadius: 'var(--radius-lg)',
                                padding: '1.25rem',
                                boxShadow: `0 0 20px ${itsmMeta ? itsmMeta.bg : 'rgba(34,197,94,0.1)'}`
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                        <MessageSquare size={16} style={{ color: itsmMeta ? itsmMeta.color : '#22c55e' }} />
                                        <span style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase' }}>
                                            Comment on: <span style={{ color: 'var(--text-secondary)' }}>{itsmMeta ? itsmMeta.label : 'ITSM'} Ticket</span>
                                        </span>
                                    </div>
                                    <button onClick={() => setItsmReplyingTo(null)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
                                        <X size={18} />
                                    </button>
                                </div>

                                <textarea
                                    value={itsmReplyBody}
                                    onChange={(e) => setItsmReplyBody(e.target.value)}
                                    placeholder={`Type your comment for ${itsmMeta ? itsmMeta.label : 'the ITSM ticket'}...`}
                                    style={{
                                        width: '100%',
                                        minHeight: '120px',
                                        background: 'var(--bg-tertiary)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        padding: '1rem',
                                        color: 'var(--text-primary)',
                                        fontSize: '0.85rem',
                                        resize: 'vertical',
                                        outline: 'none',
                                        marginBottom: '1rem',
                                        fontFamily: 'inherit'
                                    }}
                                />

                                {itsmReplyFiles.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                                        {itsmReplyFiles.map((file, i) => (
                                            <div key={i} style={{
                                                display: 'flex', alignItems: 'center', gap: '0.4rem',
                                                padding: '0.3rem 0.6rem', background: 'rgba(255,255,255,0.05)',
                                                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)',
                                                fontSize: '0.7rem'
                                            }}>
                                                <Paperclip size={12} />
                                                <span>{file.name}</span>
                                                <button onClick={() => setItsmReplyFiles(prev => prev.filter((_, idx) => idx !== i))} style={{ border: 'none', background: 'none', color: '#f85149', cursor: 'pointer', padding: 0 }}>
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label style={{ cursor: 'pointer' }}>
                                        <input
                                            type="file"
                                            multiple
                                            style={{ display: 'none' }}
                                            onChange={(e) => {
                                                if (e.target.files) {
                                                    setItsmReplyFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                                                }
                                            }}
                                        />
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                                            fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
                                            padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
                                            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)'
                                        }}>
                                            <Paperclip size={14} />
                                            ATTACH FILES
                                        </div>
                                    </label>

                                    <button
                                        onClick={handleSendItsmComment}
                                        disabled={submittingItsmReply || (!itsmReplyBody.trim() && itsmReplyFiles.length === 0)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                                            padding: '0.6rem 1.25rem',
                                            background: itsmMeta ? `linear-gradient(135deg, ${itsmMeta.color}, ${itsmMeta.color}dd)` : 'linear-gradient(135deg, #22c55e, #16a34a)',
                                            border: 'none', borderRadius: 'var(--radius-md)',
                                            color: 'white', fontWeight: 700, fontSize: '0.75rem',
                                            cursor: submittingItsmReply ? 'not-allowed' : 'pointer',
                                            opacity: submittingItsmReply ? 0.7 : 1,
                                        }}
                                    >
                                        {submittingItsmReply ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                        {submittingItsmReply ? 'POSTING...' : 'POST COMMENT'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    );
                })}
            </div>
        </div>
    );
}
