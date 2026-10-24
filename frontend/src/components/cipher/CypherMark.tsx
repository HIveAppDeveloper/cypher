/** Original uploaded 2000×2000 PNG. This crop keeps only the binary symbol;
 * the Cypher wordmark is rendered as live text beside it where needed. */
export default function CypherMark({className='',decorative=false,label='Cypher',level=0}:{className?:string;decorative?:boolean;label?:string;level?:number}) {
  const voice = Math.max(0, Math.min(1, level));
  const style = voice > 0.01 ? { transform: `scale(${1 + voice * .06}, ${1 + voice * .28})` } : undefined;
  return <svg className={`cypher-mark ${className}`} style={style} viewBox="188 597 1624 630" width="1624" height="630" role={decorative?undefined:'img'} aria-label={decorative?undefined:label} aria-hidden={decorative||undefined} focusable="false">
    <image href="/cipher-logo.png" width="2000" height="2000" />
  </svg>;
}
