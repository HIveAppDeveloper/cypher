'use client';

import { Component, Suspense, createContext, lazy, useContext, useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { LoadingState } from './LoadingState';

type PanelLoader = () => Promise<{ default: ComponentType<any> }>;
type PanelRetryContextValue = { getLazyPanel: (loader: PanelLoader) => ComponentType<any> };
const PanelRetryContext = createContext<PanelRetryContextValue | null>(null);
const fallbackLazyPanels = new WeakMap<PanelLoader, ComponentType<any>>();

function getFallbackLazyPanel(loader: PanelLoader) {
  let panel = fallbackLazyPanels.get(loader);
  if (!panel) {
    panel = lazy(loader);
    fallbackLazyPanels.set(loader, panel);
  }
  return panel;
}

export function RetryablePanel<P extends object>({ loader, componentProps }: {
  loader: () => Promise<{ default: ComponentType<P> }>;
  componentProps: P;
}) {
  const retryContext = useContext(PanelRetryContext);
  const LazyPanel = (retryContext?.getLazyPanel(loader) ?? getFallbackLazyPanel(loader)) as ComponentType<P>;
  return <LazyPanel {...componentProps}/>;
}

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

export class PanelBoundary extends Component<{ title: string; onClose: () => void; children: ReactNode; inline?: boolean }, { failed: boolean; retryVersion: number }> {
  state = { failed: false, retryVersion: 0 };
  private lazyPanelCache = new Map<PanelLoader, { retryVersion: number; component: ComponentType<any> }>();

  private getLazyPanel = (loader: PanelLoader) => {
    const cached = this.lazyPanelCache.get(loader);
    if (cached?.retryVersion === this.state.retryVersion) return cached.component;
    const component = lazy(loader);
    this.lazyPanelCache.set(loader, { retryVersion: this.state.retryVersion, component });
    return component;
  };

  static getDerivedStateFromError() { return { failed: true }; }
  retry = () => {
    this.lazyPanelCache.clear();
    this.setState(state => ({ failed: false, retryVersion: state.retryVersion + 1 }));
  };
  render() {
    const Notice = this.props.inline ? InlinePanelNotice : PanelNotice;
    if (this.state.failed) return <Notice title={this.props.title} onClose={this.props.onClose} onRetry={this.retry} failed/>;
    return <PanelRetryContext.Provider value={{ getLazyPanel: this.getLazyPanel }}><Suspense fallback={<Notice title={this.props.title} onClose={this.props.onClose}/>}>{this.props.children}</Suspense></PanelRetryContext.Provider>;
  }
}
