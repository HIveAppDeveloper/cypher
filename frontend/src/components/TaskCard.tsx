import React from 'react';
import { Task, TaskStatus } from '../lib/types';

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const getStatusColor = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.COMPLETED: return 'var(--status-green)';
      case TaskStatus.FAILED: return 'var(--status-red)';
      case TaskStatus.RUNNING: return 'var(--status-amber)';
      default: return 'var(--text-muted)';
    }
  };

  const completedSteps = task.steps.filter(s => s.completed).length;
  const progress = task.steps.length ? (completedSteps / task.steps.length) * 100 : 0;

  return (
    <div style={{
      backgroundColor: 'var(--bg-card)',
      padding: 'var(--space-md)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-light)',
      marginBottom: 'var(--space-md)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-sm)' }}>
        <h3 className="h3">{task.title}</h3>
        <span style={{
          fontSize: '0.75rem', padding: '2px 6px', borderRadius: 'var(--radius-sm)',
          backgroundColor: `${getStatusColor(task.status)}33`, color: getStatusColor(task.status),
          textTransform: 'uppercase', fontWeight: 'bold'
        }}>
          {task.status}
        </span>
      </div>
      
      <p className="small" style={{ marginBottom: 'var(--space-md)' }}>{task.description}</p>
      
      <div style={{ height: '4px', backgroundColor: 'var(--bg-main)', borderRadius: 'var(--radius-full)', marginBottom: 'var(--space-sm)', overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%', backgroundColor: getStatusColor(task.status), transition: 'width 0.3s ease' }} />
      </div>
      
      <div className="small" style={{ marginBottom: 'var(--space-md)' }}>
        {completedSteps} / {task.steps.length} steps completed
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
        {task.steps.map(step => (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', opacity: step.completed ? 0.7 : 1 }}>
            <div style={{ color: step.completed ? 'var(--status-green)' : 'var(--text-muted)' }}>
              {step.completed ? '✓' : '○'}
            </div>
            <span className="small" style={{ textDecoration: step.completed ? 'line-through' : 'none' }}>{step.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
