'use client';

import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { LoadingState } from './LoadingState';

function PanelNotice({ title, onClose, onRetry, failed = false }: { title: string; onClose: () => void; onRetry?: () => void; failed?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="bot-dialog panel-loading-dialog" aria-labelledby="panel-loading-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="panel-loading-header"><h2 id="panel-loading-title">{title}</h2><button type="button" className="btn-secondary" onClick={onClose} autoFocus>Close</button></div>
    {failed ? <div role="alert"><p>This panel couldn’t load. Check your connection and try again. Your saved work is kept.</p><button type="button" className="btn-primary" onClick={onRetry}>Try again</button></div> : <LoadingState label={`Opening ${title.toLowerCase()}…`} rows={4}/>}
  </dialog>;
}

export function InlinePanelNotice({ title, onClose, onRetry, failed = false }: { title: string; onClose: () => void; onRetry?: () => void; failed?: boolean }) {
  return <section className="panel-loading-inline" aria-label={title}>
    <div className="panel-loading-header"><h2>{title}</h2><button type="button" className="btn-secondary" onClick={onClose}>Close</button></div>
    {failed ? <div role="alert"><p>This panel couldn’t load. Check your connection and try again. Your saved work is kept.</p><button type="button" className="btn-primary" onClick={onRetry}>Try again</button></div> : <LoadingState label={`Opening ${title.toLowerCase()}…`} rows={4}/>}
  </section>;
}

export class PanelBoundary extends Component<{ title: string; onClose: () => void; children: ReactNode; inline?: boolean }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  retry = () => { this.setState({ failed: false }); };
  render() {
    const Notice = this.props.inline ? InlinePanelNotice : PanelNotice;
    if (this.state.failed) return <Notice title={this.props.title} onClose={this.props.onClose} onRetry={this.retry} failed/>;
    return <Suspense fallback={<Notice title={this.props.title} onClose={this.props.onClose}/>}>{this.props.children}</Suspense>;
  }
}
