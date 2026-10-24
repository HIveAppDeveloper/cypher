import React, { useState } from 'react';
import { Bot, Task, TaskStatus } from '../lib/types';
import { TaskCard } from './TaskCard';

interface SettingsPanelProps {
  bot: Bot | null;
}

export function SettingsPanel({ bot }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<'info'|'tasks'|'browser'>('info');

  if (!bot) {
    return <div className="details-panel" style={{ padding: 'var(--space-md)' }} />;
  }


  return (
    <div className="details-panel">
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-light)' }}>
        <button 
          style={{ flex: 1, padding: 'var(--space-sm)', borderBottom: activeTab === 'info' ? '2px solid var(--accent-blue)' : '2px solid transparent' }}
          onClick={() => setActiveTab('info')}
        >Info</button>
        <button 
          style={{ flex: 1, padding: 'var(--space-sm)', borderBottom: activeTab === 'tasks' ? '2px solid var(--accent-blue)' : '2px solid transparent' }}
          onClick={() => setActiveTab('tasks')}
        >Tasks</button>
        <button 
          style={{ flex: 1, padding: 'var(--space-sm)', borderBottom: activeTab === 'browser' ? '2px solid var(--accent-blue)' : '2px solid transparent' }}
          onClick={() => setActiveTab('browser')}
        >Browser</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-md)' }}>
        {activeTab === 'info' && (
          <div className="animate-fade-in">
            <h3 className="h3" style={{ marginBottom: 'var(--space-sm)' }}>{bot.name}</h3>
            <p className="small" style={{ marginBottom: 'var(--space-md)' }}>{bot.description}</p>
            
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <span className="small">Model: </span>
              <span className="p">{bot.llmModel}</span>
            </div>
            
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <span className="small">Status: </span>
              <span style={{ color: 'var(--status-green)', textTransform: 'capitalize' }}>{bot.status}</span>
            </div>
            
            <button disabled title="Use the API to delete bots" className="btn-secondary" style={{ width: '100%', color: 'var(--status-red)', borderColor: 'var(--status-red)' }}>
              Delete Bot
            </button>
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="animate-fade-in">
            <h3 className="h3" style={{ marginBottom: 'var(--space-md)' }}>Active Tasks</h3>
            <p className="small">Task monitoring is not implemented in this version.</p>
          </div>
        )}

        {activeTab === 'browser' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-md)', paddingTop: 'var(--space-xl)' }}>
            <div style={{ width: '100%', aspectRatio: '16/9', backgroundColor: '#000', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="small">No active browser session</span>
            </div>
            <p className="small">Start a bot sandbox and enable browser tools to use the browser.</p>
          </div>
        )}
      </div>
    </div>
  );
}
