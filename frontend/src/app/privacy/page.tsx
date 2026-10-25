import type { Metadata } from 'next';
import CypherMark from '../../components/cipher/CypherMark';

export const metadata: Metadata = {
  title: 'Privacy and data use | Cypher',
  description: 'How Cypher uses account and connected service data to carry out the tasks you request.',
};

const sections = [
  { href: '#google-connections', label: 'Google connections' },
  { href: '#task-data', label: 'How task data is used' },
  { href: '#storage', label: 'Storage and access' },
  { href: '#disconnecting', label: 'Disconnecting' },
  { href: '#contact', label: 'Contact' },
];

export default function PrivacyPage() {
  return (
    <main className="google-permissions-page google-privacy-page">
      <header className="google-privacy-topbar">
        <a className="google-permissions-brand" href="/" aria-label="Cypher home">
          <CypherMark decorative />
          <span>Cypher</span>
        </a>
        <a className="google-privacy-top-link" href="/connect/google">
          Manage Google permissions
        </a>
      </header>

      <div className="google-privacy-layout">
        <aside className="google-privacy-overview">
          <h1>Privacy and data use</h1>
          <p className="google-permissions-intro">
            The app uses your account and connected services to carry out the tasks you request.
          </p>
          <nav className="google-privacy-nav" aria-label="On this page">
            {sections.map(({ href, label }) => (
              <a href={href} key={href}>{label}</a>
            ))}
          </nav>
        </aside>

        <article className="google-permissions-content google-privacy">
          <section id="google-connections" aria-labelledby="google-connections-title">
            <h2 id="google-connections-title">Google connections</h2>
            <p>
              You choose whether to connect Gmail, Calendar, Drive, Docs, Sheets, Slides, Contacts or Tasks.
              Google shows the requested permissions before you allow access. Only granted services become
              available to your agents. You can continue without connecting Google.
            </p>
          </section>

          <section id="task-data" aria-labelledby="task-data-title">
            <h2 id="task-data-title">How task data is used</h2>
            <p>
              Google data is accessed to provide the features you choose: finding and reading information,
              preparing drafts, creating or editing files, and managing calendar entries, contacts and tasks.
              Relevant information can appear in your saved conversations and can be sent to your configured
              AI model provider or another connected service when needed for your request. Your model provider
              handles task data under its own terms.
            </p>
            <div className="google-privacy-assurance">
              <p>We do not sell Google account data or use it to serve advertising. We do not train AI models on it.</p>
            </div>
          </section>

          <section id="storage" aria-labelledby="storage-title">
            <h2 id="storage-title">Storage and access</h2>
            <p>
              Google access and refresh tokens are encrypted on the server and scoped to your authenticated
              workspace. Tokens are not exposed to the agent’s sandbox or included in tool arguments. Saved
              access lets authorized cloud tasks continue while the app is closed.
            </p>
          </section>

          <section id="disconnecting" aria-labelledby="disconnecting-title">
            <h2 id="disconnecting-title">Disconnecting</h2>
            <p>
              Use Disconnect Google in Google permissions to revoke access and remove the saved connection.
              You can also revoke access from your Google Account. Disconnecting stops future access; it does
              not erase results already saved in conversations.
            </p>
          </section>

          <section id="contact" aria-labelledby="contact-title">
            <h2 id="contact-title">Questions about your data?</h2>
            <p>
              For questions or requests concerning stored account data, contact{' '}
              <a href="mailto:boazrnovik@gmail.com">boazrnovik@gmail.com</a>.
            </p>
          </section>

          <a className="google-privacy-manage" href="/connect/google">
            <span>Manage Google permissions</span>
            <svg aria-hidden="true" viewBox="0 0 20 20" focusable="false">
              <path d="M4 10h11M10 5l5 5-5 5" />
            </svg>
          </a>
        </article>
      </div>
    </main>
  );
}
