import CypherMark from './CypherMark';

export default function CypherWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`cypher-wordmark ${className}`.trim()}>
      <CypherMark className="cypher-wordmark-mark" decorative />
      <span>Cypher</span>
    </span>
  );
}
