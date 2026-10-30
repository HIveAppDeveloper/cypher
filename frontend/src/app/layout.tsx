import { AppearanceSync } from '../components/AppearanceSync';
import { THEME_BOOTSTRAP } from '../lib/appearance';
import '@fontsource-variable/inter';
import './globals.css';
import './workspace-ux.css';
import './grok-workspace.css';
import './apple-native.css';
import './cypher-refined.css';
import './cipher/cipher.css';
import './cypher-brand.css';
import './cypher-conversation.css';
import './cypher-motion.css';
import './google-permissions.css';
import './cypher-store.css';
import './cypher-loading.css';
import './cypher-reference.css';
import './cypher-simple.css';
import './agent-identity.css';
import './cypher-purposeful.css';
import './cypher-home.css';
import type { Metadata } from 'next';
import {CANONICAL_APP_ORIGIN} from '../lib/canonical-app';

export const metadata: Metadata = {
  metadataBase:new URL(CANONICAL_APP_ORIGIN),
  title: 'Cypher',
  description: 'Your workspace for conversations, agents, and connected tools.',
  icons: { icon: '/cypher-mark.svg', apple: '/cypher-mark.svg' },
  robots:{index:false,follow:false},
  other:{'is-agentic-site-type':'app'},
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:THEME_BOOTSTRAP}}/><link rel="describedby" href="/llms.txt" type="text/plain"/></head>
      <body>
        <AppearanceSync/>{children}</body>
    </html>
  );
}
