import CypherMark from './cipher/CypherMark';
import {PUBLIC_DOCS,publicStructuredData,SUPPORT_EMAIL} from '../lib/public-docs';

export default function PublicDocument({path,loginHref='/login'}:{path:string;loginHref?:string}) {
  const doc=PUBLIC_DOCS[path];
  return <main className="google-permissions-page google-privacy-page">
    <header className="google-privacy-topbar">
      <a className="google-permissions-brand" href="/" aria-label="Cypher home"><CypherMark decorative/><span>Cypher</span></a>
      <a className="google-privacy-top-link" href={loginHref}>Open workspace</a>
    </header>
    <div className="google-privacy-layout">
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
    </div>
    {path==='/'?<script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(publicStructuredData()).replace(/</g,'\\u003c')}}/>:null}
  </main>;
}
