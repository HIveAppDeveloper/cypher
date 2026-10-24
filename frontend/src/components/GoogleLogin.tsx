'use client';
import Script from 'next/script';
import { useState } from 'react';

export function GoogleLogin({ clientId, loginUri }: { clientId: string; loginUri: string }) {
  const [error, setError] = useState(false);
  return <div className="google-login">
    <div id="g_id_onload" data-client_id={clientId} data-login_uri={loginUri} data-ux_mode="redirect" data-auto_prompt="false" />
    <div className="g_id_signin" data-type="standard" data-shape="pill" data-theme="outline" data-text="continue_with" data-size="large" data-width="340" />
    <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onError={() => setError(true)} />
    {error ? <p className="login-error" role="alert">Google sign-in could not load. Use email below or allow accounts.google.com in your browser.</p> : null}
  </div>;
}
