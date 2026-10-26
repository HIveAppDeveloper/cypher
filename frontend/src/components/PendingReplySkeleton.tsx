import styles from './PendingReplySkeleton.module.css';

/** Decorative structure only; the existing task status announces real queue/work state. */
export function PendingReplySkeleton() {
  return <div className={styles.reply} aria-hidden="true" data-pending-reply="true">
    <span className={styles.avatar}/>
    <div className={styles.lines}><span/><span/><span/></div>
  </div>;
}
