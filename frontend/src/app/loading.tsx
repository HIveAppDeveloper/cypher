import { LoadingState } from '../components/LoadingState';

export default function Loading() {
  return <div className="app-layout workspace-loading-shell" aria-busy="true">
    <aside className="workspace-loading-sidebar" aria-label="Loading navigation"><strong>Cypher</strong><LoadingState label="Loading your agents…" variant="roster"/></aside>
    <main className="workspace-main"><header className="workspace-toolbar"><strong>Cypher</strong></header><LoadingState label="Opening your workspace…" variant="messages"/></main>
  </div>;
}
