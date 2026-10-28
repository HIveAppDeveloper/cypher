import type {Metadata} from 'next';
import {CANONICAL_APP_ORIGIN} from './canonical-app';
import {PUBLIC_DOCS,markdownPath} from './public-docs';

export function publicMetadata(path:string):Metadata {
  const doc=PUBLIC_DOCS[path];
  return {
    title:doc.title,description:doc.description,
    alternates:{canonical:path,types:{'text/markdown':markdownPath(path)}},
    robots:{index:true,follow:true},
    openGraph:{title:doc.title,description:doc.description,url:new URL(path,CANONICAL_APP_ORIGIN),siteName:'Cypher',type:'website',images:[{url:'/cipher-logo.png',width:2000,height:2000,alt:'Cypher original logo'}]},
  };
}
