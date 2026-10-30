import CypherMark from './cipher/CypherMark';
import {PUBLIC_DOCS,publicStructuredData,SUPPORT_EMAIL} from '../lib/public-docs';

export default function PublicDocument({path,loginHref='/login'}:{path:string;loginHref?:string}) {
  const doc=PUBLIC_DOCS[path];
  const isHome=path==='/';
  return <main className={`google-permissions-page google-privacy-page${isHome?' google-home-page':''}`}>
    <header className="google-privacy-topbar">
      <a className="google-permissions-brand" href="/" aria-label="Cypher home"><CypherMark decorative/><span>Cypher</span></a>
      <a className="google-privacy-top-link" href={loginHref}>Open workspace</a>
    </header>
    {isHome?<>
      <div className="google-home-hero">
        <section className="google-home-intro" aria-labelledby="google-home-title">
          <h1 id="google-home-title">Give Cypher<br/>a task.</h1>
          <p>Research, prepare, write, or review in one workspace with the AI agents and apps you choose.</p>
          <a className="google-home-cta" href={loginHref}>Open workspace
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M10 4l6 6-6 6"/></svg>
          </a>
          <p className="google-home-access">Connect apps one at a time. Review each provider’s permissions before you allow access.</p>
        </section>
        <section className="google-home-preview" aria-labelledby="google-home-preview-title">
          <div className="google-home-preview-top">
            <div className="google-home-preview-brand"><CypherMark decorative/><span>Cypher workspace</span></div>
            <span className="google-home-preview-mode">New task</span>
          </div>
          <div className="google-home-preview-body">
            <h2 id="google-home-preview-title">What would you like to get done?</h2>
            <p className="google-home-preview-copy">Describe a task. Cypher brings the right agents and connected apps together.</p>
            <div className="google-home-composer-preview" aria-hidden="true">
              <span>Ask anything or describe a task…</span>
              <span className="google-home-composer-send"><svg viewBox="0 0 20 20"><path d="M10 16V4m-5 5 5-5 5 5"/></svg></span>
            </div>
            <p className="google-home-examples-title">Start with something like</p>
            <ul className="google-home-examples">
              <li><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.2"/><path d="m12.5 12.5 4 4"/></svg><span>Research a topic</span></li>
              <li><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M6.5 2.8v3.4m7-3.4v3.4M3 8.5h14"/></svg><span>Prepare for a meeting</span></li>
              <li><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.8h7l3 3v11.4H5zM12 2.8v3.4h3M7.5 10h5m-5 3h5"/></svg><span>Draft a document</span></li>
              <li><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.5 1.6 4.6 4.6 1.6-4.6 1.6-1.6 4.6-1.6-4.6-4.6-1.6 4.6-1.6zM15.8 13.8l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/></svg><span>Review information</span></li>
            </ul>
          </div>
          <div className="google-home-preview-foot"><span>Connected apps</span><span>Chosen by you</span></div>
        </section>
      </div>
      <footer className="google-home-footer">
        <nav className="google-home-nav" aria-label="Cypher information">
          <a href="/about">About</a>
          <a href="/docs">Documentation</a>
          <a href="/docs/auth">App permissions</a>
          <a href="/contact">Contact</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </footer>
    </>:<div className="google-privacy-layout">
      <aside className="google-privacy-overview">
        <h1>{doc.title}</h1><p className="google-permissions-intro">{doc.description}</p>
        <nav className="google-privacy-nav" aria-label="Cypher information">
          <a href="/about" aria-current={path==='/about'?'page':undefined}>About</a>
          <a href="/docs" aria-current={path==='/docs'?'page':undefined}>Documentation</a>
          <a href="/contact" aria-current={path==='/contact'?'page':undefined}>Contact</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </aside>
      <article className="google-permissions-content google-privacy">
        {doc.sections.map((section,index)=><section key={section.title} aria-labelledby={`public-section-${index}`}>
          <h2 id={`public-section-${index}`}>{section.title}</h2>
          {section.paragraphs.map(text=><p key={text}>{text}</p>)}
        </section>)}
        {path==='/contact'?<a className="google-privacy-manage" href={`mailto:${SUPPORT_EMAIL}`}>Email Cypher</a>:null}
        {path.startsWith('/docs')?<nav className="google-privacy-nav" aria-label="Developer resources">
          <a href="/docs/api">API documentation</a><a href="/docs/auth">Authentication</a><a href="/docs/mcp">MCP server</a><a href="/openapi.json">OpenAPI</a><a href="/llms.txt">Agent document index</a>
        </nav>:<a className="google-privacy-manage" href={loginHref}>Open workspace</a>}
      </article>
    </div>}
    {path==='/'?<script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(publicStructuredData()).replace(/</g,'\\u003c')}}/>:null}
  </main>;
}
