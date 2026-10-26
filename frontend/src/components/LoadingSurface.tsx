import { LoadingState } from './LoadingState';
import styles from './LoadingSurface.module.css';

type Surface = 'workspace' | 'companies' | 'investors' | 'outreach';
const titles: Record<Surface, string> = {
  workspace: 'Opening your workspace…',
  companies: 'Opening company research…',
  investors: 'Opening VC intelligence…',
  outreach: 'Opening your outreach review…',
};

/** A route fallback only: no requests, invented results, or interactive controls. */
export function LoadingSurface({ surface = 'workspace' }: { surface?: Surface }) {
  const workspace = surface === 'workspace';
  return <div className={styles.shell} data-loading-surface={surface}>
    <span className="visually-hidden" role="status" aria-live="polite">{titles[surface]}</span>
    <div className={styles.preview} aria-hidden="true">
      <aside className={styles.sidebar}>
        <strong className={styles.brand}>Cypher</strong>
        <LoadingState label="" variant="recent" rows={5}/>
        <div className={styles.recent}><LoadingState label="" variant="recent" rows={3}/></div>
        <div className={styles.account}><span/><i/></div>
      </aside>
      <main className={styles.main}>
        <header className={styles.toolbar}><strong>Cypher</strong><span/></header>
        {workspace ? <div className={styles.home}>
          <div className={styles.heading}><span/><span/></div>
          <div className={styles.composer}><span/><div><i/><i/></div></div>
          <div className={styles.shortcuts}><LoadingState label="" variant="services" rows={3}/></div>
          <div className={styles.work}><LoadingState label="" variant="recent" rows={2}/></div>
        </div> : <div className={styles.research}>
          <div className={styles.tabs}><span/><span/></div>
          <div className={styles.heading}><span/><span/></div>
          <div className={styles.search}><LoadingState label="" variant="recent" rows={surface === 'outreach' ? 3 : 2}/><span/></div>
          <div className={styles.results}><LoadingState label="" variant="services" rows={4}/></div>
        </div>}
      </main>
    </div>
  </div>;
}
