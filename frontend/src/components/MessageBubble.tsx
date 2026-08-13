import React from 'react';
import { Message, Bot, MessageType } from '../lib/types';

interface MessageBubbleProps {
  message: Message;
  bot?: Bot;
}

export function MessageBubble({ message, bot }: MessageBubbleProps) {
  const isUser = message.senderType === 'user';
  const isSystem = message.messageType === MessageType.SYSTEM;
  
  if (isSystem) {
    return (
      <div style={{ textAlign: 'center', margin: 'var(--space-sm) 0' }}>
        <span className="small">{message.content}</span>
      </div>
    );
  }

  return (
    <div className="animate-slide-up" style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 'var(--space-sm)',
      maxWidth: '80%',
      alignSelf: isUser ? 'flex-end' : 'flex-start'
    }}>
      {!isUser && (
        <div style={{
          width: '28px', height: '28px', borderRadius: 'var(--radius-full)',
          backgroundColor: 'var(--accent-blue)', color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px', fontWeight: 'bold', flexShrink: 0
        }}>
          {bot?.avatar || 'B'}
        </div>
      )}
      
      <div style={{
        backgroundColor: isUser ? 'var(--accent-blue)' : 'var(--bg-card)',
        padding: 'var(--space-sm) var(--space-md)',
        borderRadius: 'var(--radius-lg)',
        borderTopRightRadius: isUser ? '0' : 'var(--radius-lg)',
        borderTopLeftRadius: !isUser ? '0' : 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        {message.messageType === MessageType.TOOL_CALL ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem' }}>
            <span style={{ color: 'var(--status-amber)' }}>&gt; Tool Call: </span>
            {message.content}
          </div>
        ) : (
          <div className="p" style={{ whiteSpace: 'pre-wrap' }}>
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
}
