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
          <h1 id="google-home-title">Put your apps<br/>to work.</h1>
          <p>Research, prepare, write, and review with AI agents in one workspace.</p>
          <a className="google-home-cta" href={loginHref}>Open workspace
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M10 4l6 6-6 6"/></svg>
          </a>
          <p className="google-home-access">Connect only the apps you choose. Review each provider’s access before you allow it.</p>
        </section>
        <section className="google-home-preview" aria-label="Cypher workspace overview">
          <div className="google-home-preview-top">
            <div className="google-home-preview-brand"><CypherMark decorative/><span>Workspace</span></div>
            <span className="google-home-preview-dot" aria-hidden="true"/>
          </div>
          <div className="google-home-preview-body">
            <p className="google-home-preview-title">Keep the whole task together.</p>
            <div className="google-home-thread">
              <div className="google-home-thread-mark"><CypherMark decorative/></div>
              <div>
                <strong>One place to work</strong>
                <p>Conversations, files, and task results stay together, so it’s easy to pick up where you left off.</p>
              </div>
            </div>
            <div className="google-home-preview-links" aria-label="Things you can do with Cypher">
              <span>Research</span><span>Prepare</span><span>Write</span><span>Review</span>
            </div>
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
