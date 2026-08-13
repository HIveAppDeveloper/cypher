import React, { useState } from 'react';
import { Bot } from '../lib/types';

interface BotCreatorProps {
  onClose: () => void;
  onCreate: (bot: Partial<Bot>) => void;
}

export function BotCreator({ onClose, onCreate }: BotCreatorProps) {
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    description: '',
    systemPrompt: '',
    llmModel: 'gpt-4'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(formData);
    onClose();
  };

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 100
    }}>
      <div className="animate-slide-up" style={{
        backgroundColor: 'var(--bg-panel)',
        padding: 'var(--space-xl)',
        borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: '500px',
        border: '1px solid var(--border-light)'
      }}>
        <h2 className="h2" style={{ marginBottom: 'var(--space-lg)' }}>Create New Bot</h2>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <div>
            <label className="small" style={{ display: 'block', marginBottom: 'var(--space-xs)' }}>Name</label>
            <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
          </div>
          
          <div>
            <label className="small" style={{ display: 'block', marginBottom: 'var(--space-xs)' }}>Role</label>
            <input required value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} />
          </div>
          
          <div>
            <label className="small" style={{ display: 'block', marginBottom: 'var(--space-xs)' }}>Model</label>
            <select value={formData.llmModel} onChange={e => setFormData({...formData, llmModel: e.target.value})}>
              <option value="gpt-4">GPT-4</option>
              <option value="claude-3-opus">Claude 3 Opus</option>
              <option value="llama-3">Llama 3 (Local)</option>
            </select>
          </div>
          
          <div>
            <label className="small" style={{ display: 'block', marginBottom: 'var(--space-xs)' }}>System Prompt</label>
            <textarea 
              rows={4} required
              value={formData.systemPrompt} 
              onChange={e => setFormData({...formData, systemPrompt: e.target.value})} 
            />
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary">Create Bot</button>
          </div>
        </form>
      </div>
    </div>
  );
}
