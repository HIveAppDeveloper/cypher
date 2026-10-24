import { RunOptions } from './types';
import { MODEL_CHOICES } from './presets';
import { validNicrronModelId } from './nicrronCatalog';
export function modelPolicy(options: Partial<RunOptions>): Partial<RunOptions> {
 const clean={...options};
 if((clean as {output?:string}).output==='video')clean.output='text';
 const savedNicrronModel=clean.provider==='nicrron' && validNicrronModelId(clean.model);
 if(clean.model && !savedNicrronModel && !MODEL_CHOICES.some(m=>m.model===clean.model && (!clean.provider || m.provider===clean.provider))){clean.model='gpt-6.1-sol';clean.provider='openai';}
 clean.routing=clean.routing==='manual'?'manual':'auto';
 return clean;
}
