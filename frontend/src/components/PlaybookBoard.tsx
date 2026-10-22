'use client';
import { useState } from 'react';
import { PLAYBOOK_LEDE, PLAYBOOK_NAME, PLAYBOOK_STAGES, PLAYBOOK_START_STAGE, PlaybookIdea } from '../lib/playbook';

// A staged playbook for the workspace: each idea carries a written brief, and
// picking one sends it to the team as a real task.
export function PlaybookBoard({ onRun, onClose }: { onRun: (brief: string) => Promise<void>; onClose: () => void }) {
  const [stageId, setStageId] = useState(PLAYBOOK_START_STAGE);
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');
  const stage = PLAYBOOK_STAGES.find(item => item.id === stageId) || PLAYBOOK_STAGES[0];

  async function run(idea: PlaybookIdea) {
    if (running) return;
    setRunning(idea.id);
    setError('');
    try {
      await onRun(idea.brief);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replace(/^Error: /, '') + ' Your place in the playbook is saved.' : 'The task could not start. Your place in the playbook is saved.');
      setRunning('');
    }
  }

  return <main className="main-content playbook-surface">
    <header className="playbook-header">
      <div className="playbook-heading">
        <p className="playbook-eyebrow">Playbook</p>
        <h1>{PLAYBOOK_NAME}</h1>
        <p className="playbook-lede">{PLAYBOOK_LEDE}</p>
      </div>
      <button className="playbook-close" onClick={onClose} aria-label="Close the playbook" title="Close the playbook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
    </header>
    <div className="playbook-body">
      <nav className="playbook-rail" aria-label="Playbook stages">
        {PLAYBOOK_STAGES.map(item => <button key={item.id} className="playbook-step" aria-current={item.id === stage.id ? 'step' : undefined} onClick={() => { setStageId(item.id); setError(''); }}><span className="playbook-step-index">Stage {item.number}</span><span className="playbook-step-name">{item.title}</span><span className="playbook-step-meta">{item.ideas.length} ideas</span></button>)}
      </nav>
      <section className="playbook-card" key={stage.id} aria-labelledby="playbook-stage-title" aria-busy={running ? true : undefined}>
        <p className="playbook-stage-eyebrow">Stage {stage.number}</p>
        <h2 className="playbook-stage-title" id="playbook-stage-title">{stage.title}</h2>
        <p className="playbook-stage-subtitle">{stage.subtitle}</p>
        <div className="playbook-question"><p>The question</p><p>{stage.question}</p></div>
        <p className="playbook-ideas-label">Need inspiration? Ideas to get you started</p>
        <ul className="playbook-ideas">
          {stage.ideas.map(idea => <li key={idea.id}><button className="playbook-idea" data-running={running === idea.id ? 'true' : undefined} aria-disabled={running ? true : undefined} onClick={() => void run(idea)}><span className="playbook-idea-text"><strong>{idea.title}</strong><span>{idea.summary}</span></span><span className="playbook-idea-action">{running === idea.id ? 'Starting…' : 'Start task'}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></span></button></li>)}
        </ul>
        <p className="playbook-card-footer">{stage.footer}</p>
        {error ? <p className="playbook-error" role="alert">{error}</p> : null}
      </section>
    </div>
  </main>;
}
