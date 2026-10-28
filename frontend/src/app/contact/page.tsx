import PublicDocument from '../../components/PublicDocument';
import {publicMetadata} from '../../lib/public-metadata';
export const metadata=publicMetadata('/contact');
export default function Page(){return <PublicDocument path="/contact"/>;}
