'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { authApi } from '@/lib/api';
import RichTextEditor from './RichTextEditor';
import { 
    Plus, Trash2, Save, ChevronDown, Check, AlertCircle, 
    Mail, Reply, Info, Settings2
} from 'lucide-react';

interface Signature {
    id: string;
    name: string;
    content: string;
    is_default_new: boolean;
    is_default_reply: boolean;
}

export default function SignatureManagement() {
    const [signatures, setSignatures] = useState<Signature[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Editing state
    const [editingSig, setEditingSig] = useState<Signature | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const fetchSignatures = useCallback(async () => {
        try {
            setLoading(true);
            const data = await authApi.listSignatures();
            setSignatures(data);
            if (data.length > 0) {
                setEditingSig(prev => prev || data[0]);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to fetch signatures');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSignatures();
    }, [fetchSignatures]);

    const handleAddSignature = () => {
        const newSig: any = {
            id: 'temp-' + Date.now(),
            name: '',
            content: '',
            is_default_new: false,
            is_default_reply: false,
        };
        setSignatures([...signatures, newSig]);
        setEditingSig(newSig);
    };

    const handleSave = async () => {
        if (!editingSig) return;
        if (!editingSig.name.trim()) {
            setError('Please enter a signature name');
            return;
        }

        setIsSaving(true);
        setError(null);
        setSuccess(null);
        try {
            if (editingSig.id.startsWith('temp-')) {
                const { id, ...data } = editingSig;
                const saved = await authApi.createSignature(data);
                setSuccess('Signature created successfully');
                await fetchSignatures();
                setEditingSig(saved);
            } else {
                const { id, ...data } = editingSig;
                await authApi.updateSignature(id, data);
                setSuccess('Signature updated successfully');
                await fetchSignatures();
            }
        } catch (err: any) {
            setError(err.message || 'Failed to save signature');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (id.startsWith('temp-')) {
            setSignatures(signatures.filter(s => s.id !== id));
            setEditingSig(signatures[0] || null);
            return;
        }

        if (!confirm('Are you sure you want to delete this signature?')) return;

        try {
            await authApi.deleteSignature(id);
            setSuccess('Signature deleted successfully');
            await fetchSignatures();
            if (editingSig?.id === id) {
                setEditingSig(signatures.find(s => s.id !== id) || null);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to delete signature');
        }
    };

    const updateEditingSig = (updates: Partial<Signature>) => {
        if (editingSig) {
            setEditingSig({ ...editingSig, ...updates });
        }
    };

    const handleEditorChange = useCallback((content: string) => {
        setEditingSig(prev => prev ? { ...prev, content } : null);
    }, []);

    const handleDefaultChange = async (type: 'new' | 'reply', sigId: string) => {
        // Find the signature to update
        const sig = signatures.find(s => s.id === sigId);
        if (!sig || sig.id.startsWith('temp-')) return;

        try {
            await authApi.updateSignature(sig.id, {
                [type === 'new' ? 'is_default_new' : 'is_default_reply']: true
            });
            await fetchSignatures();
            setSuccess(`Default signature for ${type} messages updated`);
        } catch (err: any) {
            setError(err.message || 'Failed to update default');
        }
    };

    if (loading && signatures.length === 0) return <div style={{ padding: '2rem', color: 'var(--text-tertiary)' }}>Loading signatures...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ padding: '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
                     <div style={{ width: '42px', height: '42px', background: 'var(--accent-soft)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Settings2 size={20} color="var(--accent-primary)" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Email Signatures</h3>
                        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginTop: '0.2rem' }}>Create and manage multiple rich text signatures for your emails</p>
                    </div>
                    <button 
                        onClick={handleAddSignature}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.6rem 1.2rem', background: 'var(--accent-primary)', color: '#fff',
                            border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                            cursor: 'pointer', transition: 'all 0.2s'
                        }}
                    >
                        <Plus size={16} /> New Signature
                    </button>
                </div>

                {error && (
                    <div style={{ padding: '1rem', background: 'rgba(248, 81, 73, 0.08)', border: '1px solid rgba(248, 81, 73, 0.25)', borderRadius: '8px', color: 'var(--status-critical)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
                        <AlertCircle size={18} /> {error}
                    </div>
                )}
                {success && (
                    <div style={{ padding: '1rem', background: 'rgba(63, 185, 80, 0.08)', border: '1px solid rgba(63, 185, 80, 0.25)', borderRadius: '8px', color: 'var(--status-low)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.9rem' }}>
                        <Check size={18} /> {success}
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 0.8fr) 2fr', gap: '2rem' }}>
                    {/* ── Signature List ── */}
                    <div style={{ borderRight: '1px solid var(--border-subtle)', paddingRight: '1.5rem' }}>
                        <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-secondary)' }}>Your Signatures</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {signatures.length === 0 ? (
                                <div style={{ padding: '1.5rem', textAlign: 'center', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>No signatures created yet</p>
                                </div>
                            ) : signatures.map(sig => (
                                <div 
                                    key={sig.id}
                                    onClick={() => setEditingSig(sig)}
                                    style={{
                                        padding: '0.85rem 1rem',
                                        background: editingSig?.id === sig.id ? 'var(--accent-soft)' : 'var(--bg-tertiary)',
                                        border: `1px solid ${editingSig?.id === sig.id ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: editingSig?.id === sig.id ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                                            {sig.name || (sig.id.startsWith('temp-') ? 'New Signature *' : 'Untitled')}
                                        </span>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            {sig.is_default_new && <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'var(--accent-primary)', color: '#fff', borderRadius: '4px' }}>New</span>}
                                            {sig.is_default_reply && <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: 'var(--accent-secondary)', color: '#fff', borderRadius: '4px' }}>Reply</span>}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleDelete(sig.id); }}
                                        style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                                        onMouseOver={(e) => e.currentTarget.style.color = 'var(--status-critical)'}
                                        onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-tertiary)'}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ── Editor ── */}
                    <div>
                        {editingSig ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>Signature Name</label>
                                    <input 
                                        type="text" 
                                        value={editingSig.name}
                                        onChange={(e) => updateEditingSig({ name: e.target.value })}
                                        placeholder="e.g. Professional Reply, Brief Signature"
                                        style={{
                                            width: '100%', padding: '0.75rem 1rem', 
                                            background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                                            borderRadius: '8px', color: 'var(--text-primary)', outline: 'none'
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>Edit Content</label>
                                    <RichTextEditor 
                                        key={editingSig.id}
                                        initialValue={editingSig.content}
                                        onChange={handleEditorChange}
                                        minHeight="400px"
                                    />
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <button 
                                        onClick={handleSave}
                                        disabled={isSaving}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            padding: '0.75rem 2rem', background: 'var(--accent-primary)', color: '#fff',
                                            border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                                            cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.7 : 1
                                        }}
                                    >
                                        <Save size={16} /> {isSaving ? 'Saving...' : 'Save Signature'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ height: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px dashed var(--border-color)' }}>
                                <Mail size={48} style={{ opacity: 0.1, marginBottom: '1rem' }} />
                                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>Select a signature to edit or create a new one</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Defaults Section ── */}
            <div style={{ padding: '2rem', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-subtle)', marginTop: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ width: '36px', height: '36px', background: 'var(--accent-soft)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={18} color="var(--accent-primary)" />
                    </div>
                    <div>
                        <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>Default Signatures</h4>
                        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>Choose which signature to use by default</p>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                    <div style={{ padding: '1.25rem', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                            <Mail size={16} color="var(--accent-primary)" />
                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>For New Messages</span>
                        </div>
                        <select 
                            value={signatures.find(s => s.is_default_new)?.id || ''}
                            onChange={(e) => handleDefaultChange('new', e.target.value)}
                            style={{
                                width: '100%', padding: '0.65rem 1rem', 
                                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                                borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer'
                            }}
                        >
                            <option value="">None</option>
                            {signatures.filter(s => !s.id.startsWith('temp-')).map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ padding: '1.25rem', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                            <Reply size={16} color="var(--accent-secondary)" />
                            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>For Replies and Forwards</span>
                        </div>
                        <select 
                            value={signatures.find(s => s.is_default_reply)?.id || ''}
                            onChange={(e) => handleDefaultChange('reply', e.target.value)}
                            style={{
                                width: '100%', padding: '0.65rem 1rem', 
                                background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                                borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer'
                            }}
                        >
                            <option value="">None</option>
                            {signatures.filter(s => !s.id.startsWith('temp-')).map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(47, 129, 247, 0.05)', borderRadius: '8px', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <Info size={16} color="var(--accent-primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        Default signatures will be automatically appended when you compose a new incident email or reply to a thread in the timeline. You can still manually change or remove them before sending.
                    </p>
                </div>
            </div>
        </div>
    );
}
