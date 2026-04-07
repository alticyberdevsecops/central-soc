'use client';

import React from 'react';
import { Plus, Trash2, List } from 'lucide-react';

interface DynamicListProps {
    items: string[];
    setItems: (items: string[]) => void;
    placeholder: string;
    label?: string; // Optional label for vertical layout (MailPreview style)
    icon?: React.ReactNode;
    type?: 'input' | 'textarea';
    style?: React.CSSProperties;
    containerStyle?: React.CSSProperties;
    disabled?: boolean;
}

const tableStyles: Record<string, React.CSSProperties> = {
    addBtn: {
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.5rem 0.85rem', background: 'transparent',
        border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)',
        color: 'var(--accent-primary)', fontSize: '0.8rem', fontWeight: 600,
        cursor: 'pointer', marginTop: '0.5rem', width: '100%', justifyContent: 'center',
    },
    delBtn: {
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'var(--text-tertiary)', padding: '0.25rem', borderRadius: '4px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
};

const DynamicList: React.FC<DynamicListProps> = ({ 
    items, setItems, placeholder, label, icon, type = 'textarea', style, containerStyle, disabled 
}) => {
    const handleBulletAdd = (index: number) => {
        if (disabled) return;
        const newItems = [...items];
        const val = newItems[index] || '';
        if (!val.trim()) {
            newItems[index] = '      • ';
        } else if (val.endsWith('\n')) {
            newItems[index] = val + '      • ';
        } else {
            newItems[index] = val + '\n      • ';
        }
        setItems(newItems);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>, index: number) => {
        if (disabled) return;
        if (e.key === 'Enter') {
            const textarea = e.currentTarget;
            const start = textarea.selectionStart || 0;
            const text = textarea.value;
            const lines = text.substring(0, start).split('\n');
            const lineBefore = lines[lines.length - 1] || '';
            
            if (lineBefore.trim().startsWith('•')) {
                e.preventDefault();
                
                // If it's an empty bullet line, remove it (like standard editors)
                if (lineBefore.trim() === '•') {
                    const startOfLine = start - lineBefore.length;
                    const newText = text.substring(0, startOfLine) + text.substring(start);
                    const newItems = [...items];
                    newItems[index] = newText;
                    setItems(newItems);
                    return;
                }

                const newText = text.substring(0, start) + '\n      • ' + text.substring(start);
                const newItems = [...items];
                newItems[index] = newText;
                setItems(newItems);
                
                setTimeout(() => {
                    const newPos = start + 9; // \n + 6 spaces + • + space
                    textarea.selectionStart = textarea.selectionEnd = newPos;
                }, 0);
            }
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', ...containerStyle }}>
            {label && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                    {icon} {label}
                </div>
            )}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {items.map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                        {!label && (
                            <span style={{
                                minWidth: '24px', height: '24px', borderRadius: '50%', display: 'flex',
                                alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700,
                                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', marginTop: '0.45rem',
                            }}>{i + 1}</span>
                        )}
                        
                        {type === 'textarea' ? (
                            <textarea className="login-input" 
                                style={{ 
                                    flex: 1, minHeight: '38px', height: 'auto', resize: 'vertical', 
                                    padding: '0.5rem 0.65rem', fontSize: '0.84rem', lineHeight: '1.5',
                                    whiteSpace: 'pre-wrap', ...style 
                                }}
                                disabled={disabled}
                                placeholder={placeholder} value={item}
                                onKeyDown={e => handleKeyDown(e, i)}
                                onChange={e => { const n = [...items]; n[i] = e.target.value; setItems(n); }}
                            />
                        ) : (
                            <input className="login-input" 
                                style={{ flex: 1, height: '38px', padding: '0.5rem 0.65rem', fontSize: '0.84rem', ...style }}
                                disabled={disabled}
                                placeholder={placeholder} value={item}
                                onKeyDown={e => handleKeyDown(e, i)}
                                onChange={e => { const n = [...items]; n[i] = e.target.value; setItems(n); }}
                            />
                        )}

                        {!disabled && (
                            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.45rem' }}>
                                <button type="button" style={{ ...tableStyles.delBtn, color: 'var(--accent-primary)' }} 
                                    title="Add Bullet Point"
                                    onClick={() => handleBulletAdd(i)}>
                                    <List size={14} />
                                </button>
                                <button type="button" style={tableStyles.delBtn} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {!disabled && (
                <button type="button" style={tableStyles.addBtn} onClick={() => setItems([...items, ''])}>
                    <Plus size={14} /> Add {label ? label.replace(/s$/, '') : 'Item'}
                </button>
            )}
        </div>
    );
};

export default DynamicList;
