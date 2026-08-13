import React from 'react';
import { Bot, BotStatus } from '../lib/types';

interface BotRosterProps {
  bots: Bot[];
  selectedBot: Bot | null;
  onSelectBot: (bot: Bot) => void;
  onCreateNew: () => void;
}

export function BotRoster({ bots, selectedBot, onSelectBot, onCreateNew }: BotRosterProps) {
  const getStatusColor = (status: BotStatus) => {
    switch (status) {
      case BotStatus.ONLINE: return 'var(--status-green)';
      case BotStatus.WORKING: return 'var(--status-amber)';
      case BotStatus.ERROR: return 'var(--status-red)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div className="sidebar">
      <div style={{ padding: 'var(--space-md)' }}>
        <input type="text" placeholder="Search bots..." />
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <h3 className="small" style={{ padding: '0 var(--space-md)', margin: 'var(--space-sm) 0' }}>TEAM</h3>
        
        {bots.map(bot => (
          <div 
            key={bot.id}
            onClick={() => onSelectBot(bot)}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: 'var(--space-sm) var(--space-md)',
              cursor: 'pointer',
              backgroundColor: selectedBot?.id === bot.id ? 'var(--bg-card-hover)' : 'transparent',
              transition: 'background-color 0.2s',
              gap: 'var(--space-sm)'
            }}
          >
            <div style={{
              width: '32px', height: '32px', borderRadius: 'var(--radius-full)',
              backgroundColor: 'var(--accent-blue)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 'bold', position: 'relative'
            }}>
              {bot.avatar || bot.name.charAt(0)}
              <div 
                className={bot.status === BotStatus.WORKING ? 'animate-pulse' : ''}
                style={{
                  position: 'absolute', bottom: -2, right: -2,
                  width: '10px', height: '10px', borderRadius: 'var(--radius-full)',
                  backgroundColor: getStatusColor(bot.status),
                  border: '2px solid var(--bg-panel)'
                }}
              />
            </div>
            
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="p" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bot.name}</div>
              <div className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bot.role}</div>
            </div>
          </div>
        ))}
      </div>
      
      <div style={{ padding: 'var(--space-md)' }}>
        <button className="btn-secondary" style={{ width: '100%' }} onClick={onCreateNew}>
          + New Bot
        </button>
      </div>
    </div>
  );
}
