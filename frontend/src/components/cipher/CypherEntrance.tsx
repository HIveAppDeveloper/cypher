'use client';
import { useEffect, useState } from 'react';
import { restoreAppearance } from '../PreferencesPanel';
import CipherIntro from './CipherIntro';

// Read the saved motion preference before mounting the original intro.
export default function CypherEntrance() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    restoreAppearance();
    const begin = () => {
      if (!document.hidden && document.documentElement.dataset.motion !== 'false'
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setReady(true);
        document.removeEventListener('visibilitychange', begin);
      }
    };
    document.addEventListener('visibilitychange', begin);
    begin();
    return () => document.removeEventListener('visibilitychange', begin);
  }, []);
  return ready ? <CipherIntro /> : null;
}
