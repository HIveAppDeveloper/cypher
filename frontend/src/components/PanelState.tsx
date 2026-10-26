import type { ReactNode } from 'react';
import styles from './PanelState.module.css';

export const panelClassName = styles.panel;

type Kind = 'goals' | 'channels' | 'files' | 'devices' | 'error';
const paths: Record<Kind, string> = {
  goals: 'M20 12a8 8 0 1 1-8-8m0 4a4 4 0 1 0 4 4m-4 0 8-8m-5 0h5v5',
  channels: 'M8 8H6a4 4 0 0 0 0 8h2m8-8h2a4 4 0 0 1 0 8h-2M8 12h8',
  files: 'M14 3H6v18h12V7zm0 0v5h4M9 13h6m-6 4h4',
  devices: 'M4 4h16v12H4zm4 16h8m-4-4v4',
  error: 'M12 8v5m0 3h.01M12 3 2 21h20z',
};

export function PanelState({ kind, title, children, action }: {
  kind: Kind; title: string; children: ReactNode; action?: ReactNode;
}) {
  return <div className={styles.state} role={kind === 'error' ? 'alert' : undefined}>
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]}/></svg>
    <div><strong>{title}</strong><div className={styles.description}>{children}</div>{action ? <div className={styles.actions}>{action}</div> : null}</div>
  </div>;
}

/** The label names the actual pending operation. No estimated progress. */
export function ActionStatus({ children }: { children: ReactNode }) {
  return <div className={styles.progress} role="status" aria-atomic="true"><span className={styles.dot} aria-hidden="true"/><span>{children}</span></div>;
}
