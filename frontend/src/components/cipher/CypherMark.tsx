/** Original uploaded 2000×2000 PNG. This crop keeps only the binary symbol;
 * the Cypher wordmark is rendered as live text beside it where needed. */
export default function CypherMark({className='',decorative=false,label='Cypher'}:{className?:string;decorative?:boolean;label?:string}) {
  return <svg className={`cypher-mark ${className}`} viewBox="188 597 1624 630" width="1624" height="630" role={decorative?undefined:'img'} aria-label={decorative?undefined:label} aria-hidden={decorative||undefined} focusable="false">
    <image href="/cipher-logo.png" width="2000" height="2000" />
  </svg>;
}
