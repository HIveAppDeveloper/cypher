/** The uploaded mark includes a wordmark below the binary art. Crop it here
 * so the page places its single text wordmark beside the original symbol. */
export default function CypherMark({className='',decorative=false,label='Cypher',level=0}:{className?:string;decorative?:boolean;label?:string;level?:number}) {
  const voice = Math.max(0, Math.min(1, level));
  const style = voice > 0.01 ? { transform: `scale(${1 + voice * .06}, ${1 + voice * .28})` } : undefined;
  return <svg className={`cypher-mark ${className}`} style={style} viewBox="200 609 1600 632" width="1600" height="632" role={decorative?undefined:'img'} aria-label={decorative?undefined:label} aria-hidden={decorative||undefined} focusable="false">
    <image href="/cipher-logo.png" width="2000" height="2000" />
  </svg>;
}
