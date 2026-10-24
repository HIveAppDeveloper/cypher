'use client';

import { useEffect, useState } from 'react';
import { ApiError, request } from '../../../lib/api';
import CypherMark from '../../../components/cipher/CypherMark';
import styles from './template.module.css';

type SharedTemplate = {
  format: string;
  bot: {
    name: string;
    role: string;
    description?: string;
    system_prompt: string;
    llm_provider: string;
    llm_model: string;
    tools_enabled: string[];
  };
  memories?: { name: string; content: string }[];
  notice?: string;
};

type Props = { params: { id: string } };

function loadError(error: unknown) {
  if (error instanceof ApiError && error.status === 404) {
    return 'This shared template is no longer available. Ask the person who shared it for a new link.';
  }
  return 'Cypher could not load this template. Check your connection and try again.';
}

function importError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return 'Sign in to add this template to your workspace.';
  if (error instanceof ApiError && error.status === 422) return error.message;
  return 'Cypher could not import this template. Try again in a moment.';
}

export default function TemplatePage({ params }: Props) {
  const [template, setTemplate] = useState<SharedTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadMessage, setLoadMessage] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadMessage('');
    setTemplate(null);

    request(`/workspace/templates/shared/${encodeURIComponent(params.id)}`, { signal: controller.signal })
      .then((data: SharedTemplate) => {
        if (!active) return;
        if (!data?.bot || typeof data.bot.name !== 'string') throw new Error('Invalid template');
        setTemplate(data);
      })
      .catch(error => {
        if (active && !controller.signal.aborted) setLoadMessage(loadError(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [params.id, attempt]);

  async function install() {
    if (!template || busy) return;
    setBusy(true);
    setImportMessage('');
    try {
      await request('/workspace/templates/import', { method: 'POST', body: JSON.stringify(template) });
      setImported(true);
    } catch (error) {
      setImportMessage(importError(error));
    } finally {
      setBusy(false);
    }
  }

  const signInHref = `/login?returnTo=${encodeURIComponent(`/templates/${params.id}`)}`;
  const toolCount = template?.bot.tools_enabled?.length ?? 0;

  return (
    <main className={styles.page}>
      <section className={styles.frame} aria-label="Shared Cypher template">
        <div className={styles.windowBar} aria-hidden="true">
          <span /><span /><span />
        </div>

        <header className={styles.header}>
          <a className={styles.brand} href="/" aria-label="Cypher home">
            <CypherMark className={styles.mark} decorative />
            <span>Cypher</span>
          </a>
          <span className={styles.headerLabel}>Shared template</span>
        </header>

        <div className={styles.content}>
          {loading ? (
            <section className={styles.loading} role="status" aria-live="polite" aria-busy="true">
              <span className={styles.eyebrow}>Cypher template</span>
              <span className={styles.skeletonTitle} />
              <span className={styles.skeletonLine} />
              <span className={styles.skeletonLineShort} />
              <span className={styles.loadingLabel}>Loading shared template…</span>
            </section>
          ) : loadMessage ? (
            <section className={styles.errorState} aria-labelledby="template-error-title">
              <span className={styles.eyebrow}>Shared template</span>
              <h1 id="template-error-title">This link needs attention</h1>
              <p role="alert">{loadMessage}</p>
              <div className={styles.actions}>
                <button className={styles.primaryButton} onClick={() => setAttempt(value => value + 1)}>Try again</button>
                <a className={styles.secondaryButton} href="/">Back to Cypher</a>
              </div>
            </section>
          ) : template ? (
            <>
              <div className={styles.intro}>
                <span className={styles.eyebrow}>A reusable Cypher setup</span>
                <h1>{template.bot.name}</h1>
                {template.bot.role ? <p className={styles.role}>{template.bot.role}</p> : null}
                <p className={styles.description}>{template.bot.description || 'A reusable agent configuration for your workspace.'}</p>
              </div>

              <div className={styles.grid}>
                <section className={styles.previewCard} aria-labelledby="about-template-title">
                  <div className={styles.cardHeading}>
                    <div>
                      <span className={styles.eyebrow}>Template preview</span>
                      <h2 id="about-template-title">What you’ll get</h2>
                    </div>
                    {toolCount > 0 ? <span className={styles.count}>{toolCount} {toolCount === 1 ? 'tool' : 'tools'}</span> : null}
                  </div>

                  <p className={styles.notice}>{template.notice || 'This shares the agent setup. Your connected accounts and conversations stay in your workspace.'}</p>

                  <details className={styles.details}>
                    <summary>Review the agent’s instructions</summary>
                    <pre>{template.bot.system_prompt || 'No additional instructions were included.'}</pre>
                  </details>

                  <details className={styles.details}>
                    <summary>Technical details</summary>
                    <dl className={styles.metadata}>
                      <div><dt>Model provider</dt><dd>{template.bot.llm_provider || 'Automatic'}</dd></div>
                      <div><dt>Model</dt><dd>{template.bot.llm_model || 'Selected by Cypher'}</dd></div>
                      {template.memories?.length ? <div><dt>Shared notes</dt><dd>{template.memories.length}</dd></div> : null}
                    </dl>
                  </details>
                </section>

                <aside className={styles.importCard} aria-labelledby="import-title">
                  {imported ? (
                    <div className={styles.successState} role="status" aria-live="polite">
                      <span className={styles.successIcon} aria-hidden="true">✓</span>
                      <h2 id="import-title">Added to your workspace</h2>
                      <p>{template.bot.name} is ready. Connect any accounts it needs before its first task.</p>
                      <a className={styles.primaryButton} href="/">Open workspace</a>
                    </div>
                  ) : (
                    <>
                      <span className={styles.eyebrow}>Ready when you are</span>
                      <h2 id="import-title">Use this setup</h2>
                      <p>Add a copy of this agent to your workspace. You can review its instructions before you run it.</p>
                      <ul className={styles.privacyList}>
                        <li>Your connected accounts remain private.</li>
                        <li>Review any requested actions before starting a task.</li>
                      </ul>
                      {importMessage ? <p className={styles.formError} role="alert">{importMessage}</p> : null}
                      {importMessage.startsWith('Sign in') ? (
                        <a className={styles.primaryButton} href={signInHref}>Sign in to import</a>
                      ) : (
                        <button className={styles.primaryButton} onClick={() => void install()} disabled={busy}>
                          {busy ? 'Adding template…' : 'Add to my workspace'}
                        </button>
                      )}
                    </>
                  )}
                </aside>
              </div>
            </>
          ) : null}

          <footer className={styles.footer}>
            <span>Cypher brings your tools together around the work.</span>
            <a href="/privacy">Privacy</a>
          </footer>
        </div>
      </section>
    </main>
  );
}
