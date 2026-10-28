import type {MetadataRoute} from 'next';
import {CANONICAL_APP_ORIGIN} from '../lib/canonical-app';
export default function robots():MetadataRoute.Robots {return {rules:{userAgent:'*',allow:['/'],disallow:['/api/','/login','/workspace','/gateway','/connect/','/prospecting','/sourcing/','/templates/']},sitemap:`${CANONICAL_APP_ORIGIN}/sitemap.xml`};}
