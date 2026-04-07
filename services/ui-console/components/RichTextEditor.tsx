'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
    Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight,
    List, ListOrdered, Link, Image, Table, Type, Highlighter,
    Undo, Redo, Eraser, Minus, Upload, Eye, EyeOff, FileText,
    Maximize2, Minimize2, X, Move
} from 'lucide-react';

interface RichTextEditorProps {
    initialValue?: string;
    value?: string;
    onChange: (value: string) => void;
    minHeight?: string;
}

const FONTS = ['Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Calibri'];
const SIZES = [
    { label: '8pt', val: '1' }, { label: '10pt', val: '2' }, { label: '12pt', val: '3' },
    { label: '14pt', val: '4' }, { label: '18pt', val: '5' }, { label: '24pt', val: '6' }, { label: '36pt', val: '7' },
];

const TEMPLATES = [
    {
        label: 'Professional',
        html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#333;">
<p style="margin:0 0 12px 0;">Thanks and regards,</p>
<table cellpadding="0" cellspacing="0" style="border-left:4px solid #2f81f7;padding-left:14px;">
  <tr><td>
    <p style="margin:0;font-size:16px;font-weight:700;color:#111;letter-spacing:0.02em;">Your Name</p>
    <p style="margin:2px 0 6px 0;font-size:13px;color:#2f81f7;font-weight:600;">Job Title | Company Name</p>
    <p style="margin:0;font-size:12px;color:#666;">📞 +1 (555) 000-0000 &nbsp;|&nbsp; ✉ you@company.com</p>
    <p style="margin:2px 0 0 0;font-size:12px;color:#666;">🌐 www.company.com</p>
  </td></tr>
</table></div>`,
    },
    {
        label: 'Minimal',
        html: `<div style="font-family:Arial,sans-serif;font-size:13px;color:#444;">
<p style="margin:0 0 8px 0;color:#888;">—</p>
<p style="margin:0;font-weight:700;color:#222;font-size:14px;">Your Name</p>
<p style="margin:2px 0;color:#666;">Job Title &middot; Company</p>
<p style="margin:2px 0;color:#888;font-size:12px;">you@company.com &middot; +1 555 000 0000</p>
</div>`,
    },
    {
        label: 'Bold Header',
        html: `<div style="font-family:Segoe UI,sans-serif;">
<table cellpadding="0" cellspacing="0" style="width:100%;background:linear-gradient(135deg,#1a1f35,#0d1528);border-radius:8px;padding:16px 20px;margin-bottom:8px;">
  <tr><td>
    <p style="margin:0;font-size:18px;font-weight:800;color:#fff;letter-spacing:0.04em;">YOUR NAME</p>
    <p style="margin:4px 0 0 0;font-size:12px;color:#2f81f7;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;">Cyber Security Consultant</p>
  </td></tr>
</table>
<p style="margin:0;font-size:12px;color:#555;">📞 +1 (555) 000-0000 &nbsp; ✉ you@company.com &nbsp; 🌐 company.com</p>
</div>`,
    },
    {
        label: 'With Logo Placeholder',
        html: `<div style="font-family:Segoe UI,Arial,sans-serif;">
<table cellpadding="0" cellspacing="0"><tr>
  <td style="vertical-align:top;padding-right:16px;">
    <div style="width:60px;height:60px;background:#e8f0fe;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px;line-height:60px;text-align:center;">🛡</div>
  </td>
  <td style="vertical-align:top;">
    <p style="margin:0;font-size:16px;font-weight:700;color:#1a1a2e;">Your Name</p>
    <p style="margin:2px 0 8px 0;font-size:13px;color:#2f81f7;">Security Analyst</p>
    <p style="margin:0;font-size:12px;color:#666;">📞 +1 555 000 0000</p>
    <p style="margin:2px 0 0 0;font-size:12px;color:#666;">✉ you@company.com</p>
  </td>
</tr></table>
</div>`,
    },
];

/* ── Image resize overlay ── */
interface ImgOverlay { visible: boolean; top: number; left: number; width: number; height: number; }

/* ── Main Component ── */
const RichTextEditor = ({ initialValue, value, onChange, minHeight = '300px' }: RichTextEditorProps) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const editorWrapRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [activeTab, setActiveTab] = useState<'format' | 'insert' | 'templates'>('format');
    const [previewMode, setPreviewMode] = useState(false);
    const [previewHtml, setPreviewHtml] = useState('');
    const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
    const [imgOverlay, setImgOverlay] = useState<ImgOverlay>({ visible: false, top: 0, left: 0, width: 0, height: 0 });
    const [showTemplates, setShowTemplates] = useState(false);
    const [fontColor, setFontColor] = useState('#000000');
    const [highlightColor, setHighlightColor] = useState('#ffff00');

    useEffect(() => {
        if (editorRef.current) {
            editorRef.current.innerHTML = initialValue || value || '';
        }
    }, []); // eslint-disable-line

    const handleInput = useCallback(() => {
        if (editorRef.current) onChange(editorRef.current.innerHTML);
    }, [onChange]);

    const exec = useCallback((cmd: string, val: string = '') => {
        editorRef.current?.focus();
        document.execCommand(cmd, false, val);
        handleInput();
    }, [handleInput]);

    /* ── Image click → show resize toolbar ── */
    const handleEditorClick = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'IMG') {
            const img = target as HTMLImageElement;
            setSelectedImg(img);
            const wrapRect = editorWrapRef.current!.getBoundingClientRect();
            const imgRect = img.getBoundingClientRect();
            setImgOverlay({
                visible: true,
                top: imgRect.top - wrapRect.top - 44,
                left: imgRect.left - wrapRect.left,
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
            });
        } else if (!(target as HTMLElement).closest?.('[data-img-toolbar]')) {
            setSelectedImg(null);
            setImgOverlay(o => ({ ...o, visible: false }));
        }
    }, []);

    const applyImgSize = useCallback((w: number | string, h?: number | string) => {
        if (!selectedImg) return;
        if (w === 'auto') {
            selectedImg.style.width = '100%';
            selectedImg.style.height = 'auto';
            selectedImg.removeAttribute('width');
            selectedImg.removeAttribute('height');
        } else {
            selectedImg.style.width = `${w}px`;
            selectedImg.style.height = h ? `${h}px` : 'auto';
        }
        handleInput();
        // Update overlay position
        const wrapRect = editorWrapRef.current!.getBoundingClientRect();
        const imgRect = selectedImg.getBoundingClientRect();
        setImgOverlay(o => ({ ...o, top: imgRect.top - wrapRect.top - 44, left: imgRect.left - wrapRect.left }));
    }, [selectedImg, handleInput]);

    /* ── Upload image as base64 ── */
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const base64 = ev.target?.result as string;
            editorRef.current?.focus();
            document.execCommand('insertImage', false, base64);
            handleInput();
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    /* ── Insert template ── */
    const insertTemplate = (html: string) => {
        editorRef.current?.focus();
        document.execCommand('insertHTML', false, html);
        handleInput();
        setShowTemplates(false);
        setActiveTab('format');
    };

    /* ── Preview ── */
    const togglePreview = () => {
        if (!previewMode && editorRef.current) {
            setPreviewHtml(editorRef.current.innerHTML);
        }
        setPreviewMode(p => !p);
    };

    /* ── Color pickers ── */
    const applyFontColor = (col: string) => {
        setFontColor(col);
        exec('foreColor', col);
    };
    const applyHighlight = (col: string) => {
        setHighlightColor(col);
        exec('backColor', col);
    };

    const btnBase: React.CSSProperties = {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0.35rem', borderRadius: '4px', border: 'none',
        background: 'transparent', color: 'var(--text-secondary)',
        cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
    };

    const Btn = ({ icon: Icon, onClick, label, active = false }: any) => (
        <button type="button" title={label} onClick={onClick}
            style={{ ...btnBase, background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
            onMouseOver={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'; }}
            onMouseOut={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
            <Icon size={15} />
        </button>
    );

    const Sep = () => <div style={{ width: 1, height: 18, background: 'var(--border-color)', margin: '0 3px', flexShrink: 0 }} />;

    const Group = ({ label, children }: { label: string; children: React.ReactNode }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingRight: '0.6rem', borderRight: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexWrap: 'nowrap' }}>{children}</div>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        </div>
    );

    return (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>

            {/* ── Tab bar ── */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', alignItems: 'center', padding: '0 0.5rem' }}>
                {(['format', 'insert', 'templates'] as const).map(tab => (
                    <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                        style={{
                            padding: '0.55rem 1rem', fontSize: '0.75rem', fontWeight: 600, border: 'none',
                            borderBottom: activeTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent',
                            background: 'transparent',
                            color: activeTab === tab ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                            cursor: 'pointer', marginBottom: '-1px', textTransform: 'capitalize',
                        }}>
                        {tab === 'templates' ? '📋 Templates' : tab === 'insert' ? 'Insert' : 'Format text'}
                    </button>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', padding: '0 4px' }}>
                    <button type="button" onClick={togglePreview} title={previewMode ? 'Edit' : 'Preview'}
                        style={{ ...btnBase, padding: '0.3rem 0.7rem', gap: '0.3rem', fontSize: '0.75rem', fontWeight: 600, background: previewMode ? 'var(--accent-soft)' : 'transparent', color: previewMode ? 'var(--accent-primary)' : 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                        {previewMode ? <EyeOff size={13} /> : <Eye size={13} />}
                        {previewMode ? 'Edit' : 'Preview'}
                    </button>
                </div>
            </div>

            {/* ── Toolbar ── */}
            {!previewMode && (
                <div style={{ padding: '0.6rem 0.75rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    {activeTab === 'format' && <>
                        <Group label="Clipboard">
                            <Btn icon={Undo} onClick={() => exec('undo')} label="Undo" />
                            <Btn icon={Redo} onClick={() => exec('redo')} label="Redo" />
                        </Group>

                        <Group label="Font">
                            <select onChange={e => exec('fontName', e.target.value)} style={{ padding: '0.2rem 0.35rem', fontSize: '0.72rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', outline: 'none', maxWidth: '110px' }}>
                                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                            <select onChange={e => exec('fontSize', e.target.value)} style={{ padding: '0.2rem 0.35rem', fontSize: '0.72rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-primary)', outline: 'none', width: '58px' }}>
                                {SIZES.map(s => <option key={s.val} value={s.val}>{s.label}</option>)}
                            </select>
                        </Group>

                        <Group label="Style">
                            <Btn icon={Bold} onClick={() => exec('bold')} label="Bold" />
                            <Btn icon={Italic} onClick={() => exec('italic')} label="Italic" />
                            <Btn icon={Underline} onClick={() => exec('underline')} label="Underline" />
                            <Btn icon={Strikethrough} onClick={() => exec('strikeThrough')} label="Strikethrough" />
                        </Group>

                        <Group label="Paragraph">
                            <Btn icon={AlignLeft} onClick={() => exec('justifyLeft')} label="Left" />
                            <Btn icon={AlignCenter} onClick={() => exec('justifyCenter')} label="Center" />
                            <Btn icon={AlignRight} onClick={() => exec('justifyRight')} label="Right" />
                            <Sep />
                            <Btn icon={List} onClick={() => exec('insertUnorderedList')} label="Bullets" />
                            <Btn icon={ListOrdered} onClick={() => exec('insertOrderedList')} label="Numbering" />
                        </Group>

                        <Group label="Color">
                            <label title="Font Color" style={{ ...btnBase, cursor: 'pointer', position: 'relative' }}>
                                <Type size={15} />
                                <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 14, height: 3, background: fontColor, borderRadius: 1 }} />
                                <input type="color" value={fontColor} onChange={e => applyFontColor(e.target.value)} style={{ opacity: 0, position: 'absolute', width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
                            </label>
                            <label title="Highlight" style={{ ...btnBase, cursor: 'pointer', position: 'relative' }}>
                                <Highlighter size={15} />
                                <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 14, height: 3, background: highlightColor, borderRadius: 1 }} />
                                <input type="color" value={highlightColor} onChange={e => applyHighlight(e.target.value)} style={{ opacity: 0, position: 'absolute', width: '100%', height: '100%', cursor: 'pointer', border: 'none', padding: 0 }} />
                            </label>
                            <Btn icon={Eraser} onClick={() => exec('removeFormat')} label="Clear Formatting" />
                        </Group>
                    </>}

                    {activeTab === 'insert' && <>
                        <Group label="Media">
                            <Btn icon={Link} label="Insert Link" onClick={() => {
                                const url = window.prompt('Enter URL:');
                                if (url) exec('createLink', url.startsWith('http') ? url : 'https://' + url);
                            }} />
                            <Btn icon={Image} label="Image from URL" onClick={() => {
                                const url = window.prompt('Enter image URL:');
                                if (url) exec('insertImage', url);
                            }} />
                            <label title="Upload Image" style={{ ...btnBase, cursor: 'pointer' }}>
                                <Upload size={15} />
                                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                            </label>
                        </Group>

                        <Group label="Elements">
                            <Btn icon={Minus} label="Horizontal Rule" onClick={() => exec('insertHTML', '<hr style="border:none;border-top:2px solid #e1e4e8;margin:12px 0;">')} />
                            <Btn icon={Table} label="Insert Table" onClick={() => exec('insertHTML', '<table style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0"><tr style="background:#f6f8fa"><td style="border:1px solid #d0d7de;padding:8px 12px;font-weight:600">Header 1</td><td style="border:1px solid #d0d7de;padding:8px 12px;font-weight:600">Header 2</td><td style="border:1px solid #d0d7de;padding:8px 12px;font-weight:600">Header 3</td></tr><tr><td style="border:1px solid #d0d7de;padding:8px 12px">Cell</td><td style="border:1px solid #d0d7de;padding:8px 12px">Cell</td><td style="border:1px solid #d0d7de;padding:8px 12px">Cell</td></tr></table>')} />
                        </Group>

                        <Group label="Social">
                            <button type="button" title="LinkedIn" onClick={() => exec('insertHTML', '<a href="https://linkedin.com/in/yourprofile" style="display:inline-block;margin-right:6px;padding:3px 10px;background:#0077b5;color:#fff;border-radius:4px;text-decoration:none;font-size:11px;font-weight:600;font-family:Arial,sans-serif;">LinkedIn</a>')}
                                style={{ ...btnBase, fontSize: '10px', fontWeight: 700, padding: '3px 7px', color: '#0077b5', border: '1px solid #0077b5', borderRadius: '4px' }}>in</button>
                            <button type="button" title="Twitter/X" onClick={() => exec('insertHTML', '<a href="https://twitter.com/yourhandle" style="display:inline-block;margin-right:6px;padding:3px 10px;background:#000;color:#fff;border-radius:4px;text-decoration:none;font-size:11px;font-weight:600;font-family:Arial,sans-serif;">𝕏</a>')}
                                style={{ ...btnBase, fontSize: '11px', fontWeight: 700, padding: '3px 7px', color: '#000', border: '1px solid #666', borderRadius: '4px' }}>𝕏</button>
                        </Group>
                    </>}

                    {activeTab === 'templates' && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Insert template:</span>
                            {TEMPLATES.map(t => (
                                <button key={t.label} type="button" onClick={() => insertTemplate(t.html)}
                                    style={{ padding: '0.35rem 0.8rem', fontSize: '0.78rem', fontWeight: 600, background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', transition: 'all 0.15s' }}
                                    onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-primary)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent-primary)'; }}
                                    onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-color)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}>
                                    {t.label}
                                </button>
                            ))}
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Templates insert at cursor position — customize name, title, contact details after inserting</span>
                        </div>
                    )}
                </div>
            )}

            {/* ── Editor / Preview ── */}
            <div ref={editorWrapRef} style={{ flex: 1, position: 'relative', overflow: 'auto', background: '#ffffff', color: '#000' }}>

                {/* Image resize toolbar */}
                {imgOverlay.visible && selectedImg && (
                    <div data-img-toolbar="true" style={{
                        position: 'absolute', top: Math.max(4, imgOverlay.top), left: imgOverlay.left,
                        zIndex: 200, background: '#1c2128', border: '1px solid #373e47',
                        borderRadius: '8px', padding: '5px 10px', display: 'flex', gap: '6px',
                        alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                        whiteSpace: 'nowrap',
                    }}>
                        <span style={{ fontSize: '11px', color: '#8b949e', fontWeight: 600 }}>Resize:</span>
                        <input type="number" placeholder="W"
                            defaultValue={selectedImg.offsetWidth}
                            onKeyDown={e => { if (e.key === 'Enter') { applyImgSize(parseInt((e.target as HTMLInputElement).value)); } }}
                            onBlur={e => applyImgSize(parseInt(e.target.value))}
                            style={{ width: 54, padding: '2px 5px', fontSize: '11px', background: '#2d333b', border: '1px solid #444c56', borderRadius: '4px', color: '#e6edf3', outline: 'none' }} />
                        <span style={{ fontSize: '11px', color: '#555' }}>×</span>
                        <input type="number" placeholder="H"
                            defaultValue={selectedImg.offsetHeight}
                            onKeyDown={e => { if (e.key === 'Enter') { applyImgSize(selectedImg!.offsetWidth, parseInt((e.target as HTMLInputElement).value)); } }}
                            onBlur={e => applyImgSize(selectedImg!.offsetWidth, parseInt(e.target.value))}
                            style={{ width: 54, padding: '2px 5px', fontSize: '11px', background: '#2d333b', border: '1px solid #444c56', borderRadius: '4px', color: '#e6edf3', outline: 'none' }} />
                        {[['XS', 80], ['S', 120], ['M', 200], ['L', 320], ['Full', 'auto']].map(([lbl, sz]) => (
                            <button key={lbl} type="button" onClick={() => applyImgSize(sz as any)}
                                style={{ padding: '2px 7px', fontSize: '10px', fontWeight: 700, background: '#2d333b', border: '1px solid #444c56', borderRadius: '4px', color: '#8b949e', cursor: 'pointer' }}
                                onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2f81f7'; (e.currentTarget as HTMLElement).style.color = '#2f81f7'; }}
                                onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = '#444c56'; (e.currentTarget as HTMLElement).style.color = '#8b949e'; }}>
                                {lbl}
                            </button>
                        ))}
                        <button type="button" onClick={() => { selectedImg?.remove(); handleInput(); setImgOverlay(o => ({ ...o, visible: false })); setSelectedImg(null); }}
                            style={{ padding: '2px 6px', fontSize: '10px', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: '4px', color: '#f85149', cursor: 'pointer' }}>
                            <X size={11} />
                        </button>
                    </div>
                )}

                {previewMode ? (
                    <div style={{ padding: '1.5rem', minHeight: minHeight, fontFamily: '"Segoe UI",Roboto,Arial,sans-serif', fontSize: '14px', lineHeight: '1.6' }}
                        dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : (
                    <div
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        onInput={handleInput}
                        onClick={handleEditorClick}
                        style={{ padding: '1.5rem', minHeight, outline: 'none', lineHeight: '1.6', fontSize: '14px', fontFamily: '"Segoe UI",Roboto,Helvetica,Arial,sans-serif' }}
                    />
                )}
            </div>

            {/* ── Status bar ── */}
            <div style={{ padding: '4px 12px', background: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                    {selectedImg ? '🖼 Image selected — use toolbar above to resize' : 'Click any image to resize it'}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                    {previewMode ? 'Preview mode — click Edit to make changes' : 'Rich text editor'}
                </span>
            </div>
        </div>
    );
};

export default React.memo(RichTextEditor, () => true);
