'use client';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

type GoogleIdentity = {
  initialize: (options: { client_id: string; login_uri: string; ux_mode: 'redirect'; auto_select: boolean }) => void;
  renderButton: (parent: HTMLElement, options: { type: 'standard'; shape: 'pill'; theme: 'outline'; text: 'continue_with'; size: 'large'; width: string }) => void;
};

export function GoogleLogin({ clientId, loginUri }: { clientId: string; loginUri: string }) {
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const buttonHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready) return;
    const host = buttonHost.current;
    const identity = (window as Window & { google?: { accounts?: { id?: GoogleIdentity } } }).google?.accounts?.id;
    if (!host || !identity) { setError(true); return; }
    try {
      identity.initialize({ client_id: clientId, login_uri: loginUri, ux_mode: 'redirect', auto_select: false });
    } catch { setError(true); return; }
    let active = true;
    let lastWidth = 0;
    const render = () => {
      if (!active) return;
      // Keep room for the personalized Google frame; never squeeze its iframe.
      const width = Math.min(400, Math.floor(host.clientWidth) - 20);
      if (width <= 0 || width === lastWidth) return;
      lastWidth = width;
      host.replaceChildren();
      try {
        identity.renderButton(host, { type: 'standard', shape: 'pill', theme: 'outline', text: 'continue_with', size: 'large', width: String(width) });
        setError(false);
      } catch { setError(true); }
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(render);
    if (observer) observer.observe(host); else window.addEventListener('resize', render);
    render();
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', render);
      host.replaceChildren();
    };
  }, [ready, clientId, loginUri]);
  return <div className="google-login">
    <div className="google-button-host" ref={buttonHost} />
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setError(true)} />
    {error ? <p className="login-error" role="alert">Google sign-in could not load. Use email below or allow accounts.google.com in your browser.</p> : null}
  </div>;
}
