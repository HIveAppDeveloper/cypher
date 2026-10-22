import type { Metadata } from 'next';
import CipherApp from '../../components/cipher/CipherApp';
import './cipher.css';

export const metadata: Metadata = {
  title: 'Cipher — Territory Pulse',
  description: 'Find the right buyer and act first: one-button prospecting and outbound.',
};

export default function CipherPage() {
  return <CipherApp />;
}
