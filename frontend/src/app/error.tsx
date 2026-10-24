'use client';

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <main className="workspace-recovery"><h1>Let’s reconnect.</h1><p>Cypher couldn’t open this view. Your saved work is kept.</p><button type="button" className="btn-primary" onClick={reset}>Try again</button><a href="/">Back to your workspace</a></main>;
}
