'use client';

import { useCallback, useEffect, useState } from 'react';
import { request } from '../../lib/api';
import { dateFromApi } from '../../lib/dates';
import { LoadingState } from '../LoadingState';
import styles from './RecentWork.module.css';

interface RecentRun {
  id: string;
  title: string;
  status: string;
  conversation_id: string;
  created_at: string;
}

function relativeDate(value: string) {
  const parsed = dateFromApi(value);
  if (!parsed) return '';
  const timestamp = parsed.getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(timestamp).toLocaleDateString();
}

export function statusKind(status: string) {
  const value = status.trim().toLowerCase();
  if (['pending', 'running', 'cancel_requested'].includes(value)) return 'active';
  if (value === 'completed') return 'complete';
  if (['failed', 'cancelled', 'canceled', 'interrupted'].includes(value)) return 'error';
  return 'neutral';
}

function StatusMark({ status }: { status: string }) {
  const kind = statusKind(status);
  return <span className={styles.statusMark} data-state={kind} aria-hidden="true">
    {kind === 'complete' ? <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5"/><path d="m6.5 10 2.2 2.2 4.8-5"/></svg> :
      kind === 'error' ? <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5"/><path d="m7.5 7.5 5 5m0-5-5 5"/></svg> :
        kind === 'active' ? <svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.5 12.5 4 4"/></svg> :
          <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="5.5"/></svg>}
  </span>;
}

export function RecentWork({ onOpen }: { onOpen: (conversationId: string) => void }) {
  const [runs, setRuns] = useState<RecentRun[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await request('/workspace/runs') as RecentRun[];
      setRuns(data.slice(0, 3));
    } catch {
      setError('Recent work could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className={styles.recentWork} aria-labelledby="recent-work-heading" aria-busy={loading}>
      <div className={styles.headingRow}>
        <h2 id="recent-work-heading">Recent work</h2>
        <a className={styles.viewAll} href="?view=work" aria-label="View all recent work">
          <span className="visually-hidden">View all</span>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" /></svg>
        </a>
      </div>
      {loading ? <LoadingState label="Loading recent work…" variant="recent"/> : error ? (
        <div className={styles.errorRow} role="status">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} disabled={loading}>Retry</button>
        </div>
      ) : !runs.length ? <p className={styles.empty}>Your recent tasks will appear here.</p> : (
        <div className={styles.runList}>
          {runs.map(run => (
            <button
              key={run.id}
              type="button"
              className={styles.run}
              onClick={() => onOpen(run.conversation_id)}
            >
              <StatusMark status={run.status}/>
              <span className={styles.runCopy}>
                <span className={styles.runTitle}>{run.title || 'Untitled task'}</span>
                <span className={styles.runMeta}>{run.status.replaceAll('_', ' ')} · {relativeDate(run.created_at)}</span>
              </span>
              <svg className={styles.arrow} viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10m-4-4 4 4-4 4" /></svg>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
