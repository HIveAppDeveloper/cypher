'use client';

import { useState } from 'react';
import BinaryLens from './BinaryLens';

export default function CypherWordmark({ className = '' }: { className?: string }) {
  const [active, setActive] = useState(false);
  return (
    <span className={`cypher-wordmark ${className}`.trim()} onPointerEnter={() => setActive(true)} onPointerLeave={() => setActive(false)} onFocusCapture={() => setActive(true)} onBlurCapture={() => setActive(false)}>
      <BinaryLens className="cypher-wordmark-mark" cols={15} rows={7} active={active} label="Cypher binary lens" />
      <span>Cypher</span>
    </span>
  );
}
