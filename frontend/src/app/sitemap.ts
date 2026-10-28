import type {MetadataRoute} from 'next';
import {CANONICAL_APP_ORIGIN} from '../lib/canonical-app';
import {PUBLIC_PATHS,PUBLIC_UPDATED} from '../lib/public-docs';
export default function sitemap():MetadataRoute.Sitemap {return PUBLIC_PATHS.map(path=>({url:new URL(path,CANONICAL_APP_ORIGIN).toString(),lastModified:PUBLIC_UPDATED}));}
