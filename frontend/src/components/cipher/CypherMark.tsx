/** Original uploaded 2000×2000 PNG. The viewport removes transparent padding;
 * source bytes and the mark's proportions stay intact, without an optimizer. */
export default function CypherMark({className='',decorative=false,label='Cypher'}:{className?:string;decorative?:boolean;label?:string}) {
  return <svg className={`cypher-mark ${className}`} viewBox="188 597 1624 806" width="1624" height="806" role={decorative?undefined:'img'} aria-label={decorative?undefined:label} aria-hidden={decorative||undefined} focusable="false">
    <image href="/cipher-logo.png" width="2000" height="2000" />
  </svg>;
}
