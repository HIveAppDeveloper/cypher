import styles from './LoadingState.module.css';

type LoadingVariant = 'messages' | 'roster' | 'services' | 'recent';

/** Placeholders describe structure, never fabricated content or progress. */
export function LoadingState({ label, variant = 'services', rows = 3 }: {
  label: string; variant?: LoadingVariant; rows?: number;
}) {
  return <div className={styles.loading} data-loading-variant={variant} role="status" aria-live="polite" aria-label={label}>
    <span className="visually-hidden">{label}</span>
    <div className={styles.shapes} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => <div className={styles.row} key={index}>
        {variant === 'roster' || variant === 'services' ? <span className={styles.avatar}/> : null}
        <div className={styles.lines}><span className={styles.line}/><span className={styles.line}/></div>
      </div>)}
    </div>
  </div>;
}
