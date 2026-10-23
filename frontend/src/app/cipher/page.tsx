import type { Metadata } from 'next';
import CipherApp from '../../components/cipher/CipherApp';
import './cipher.css';

export const metadata: Metadata = {
  title: 'Cypher',
  description: 'Find the right buyer and act first: one-button prospecting and outbound.',
  icons: { icon: '/cipher-logo.png', apple: '/cipher-logo.png' },
};

export default function CipherPage() {
  return <CipherApp />;
}
