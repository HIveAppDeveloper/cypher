import BinaryLens from './BinaryLens';

export default function CypherMark({className='',decorative=false,label='Cypher'}:{className?:string;decorative?:boolean;label?:string}) {
  return <BinaryLens cols={41} rows={21} className={`cypher-mark ${className}`} decorative={decorative} label={label} />;
}
