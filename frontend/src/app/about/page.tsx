import PublicDocument from '../../components/PublicDocument';
import {publicMetadata} from '../../lib/public-metadata';
export const metadata=publicMetadata('/about');
export default function Page(){return <PublicDocument path="/about"/>;}
