import PublicDocument from '../../../components/PublicDocument';
import {publicMetadata} from '../../../lib/public-metadata';
export const metadata=publicMetadata('/docs/api');
export default function Page(){return <PublicDocument path="/docs/api"/>;}
