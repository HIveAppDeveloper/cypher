'use client';
import BinaryLens from './BinaryLens';

/** Live 0/1 symbol, with the wordmark rendered as text by each surface. */
export default function CypherMark({className='',decorative=false,label='Cypher',level=0}:{className?:string;decorative?:boolean;label?:string;level?:number}) {
  return <span className={`cypher-mark ${className}`} role={decorative?undefined:'img'} aria-label={decorative?undefined:label} aria-hidden={decorative||undefined}>
    <BinaryLens className="cypher-digit-mark" active level={level} decorative/>
  </span>;
}
