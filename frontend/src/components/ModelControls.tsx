import { GlassSelect } from './GlassSelect';
import { useId } from 'react';
import { MODEL_CHOICES } from '../lib/presets';
export interface ModelValue { provider?: string; model?: string; reasoning_effort?: string; service_tier?: string; }
export function ModelControls({ value, onChange }: { value: ModelValue; onChange: (next: ModelValue) => void }) {
  const id = useId();
  const provider = value.provider || 'openai';
  const models = MODEL_CHOICES.filter(m => m.provider === provider);
  const selected = models.find(m => m.model === value.model) || models[0];
  const openaiModels = ['gpt-6-luna', 'gpt-6.1-sol'].map(model => MODEL_CHOICES.find(m => m.model === model)!);
  const power = Math.max(0, openaiModels.findIndex(m => m.model === (value.model || selected?.model)));
  const newest = value.model?.startsWith('gpt-6');
  const efforts = newest ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['none', 'low', 'medium', 'high', 'xhigh'];
  const reasoning = provider === 'openai' && (value.model?.startsWith('gpt-5') || newest);
  function changeProvider(next: string) { const first = MODEL_CHOICES.find(m => m.provider === next)!; onChange({ provider: next, model: first.model, reasoning_effort: next === 'openai' ? 'medium' : undefined, service_tier: undefined }); }
  return <div className="model-controls">
    <label htmlFor={`${id}-provider`}>Provider</label><GlassSelect id={`${id}-provider`} value={provider} onChange={e => changeProvider(e.target.value)}><option value="openai">OpenAI</option></GlassSelect>
    <label htmlFor={`${id}-model`}>Model</label><GlassSelect id={`${id}-model`} value={value.model || selected?.model} onChange={e => onChange({ ...value, model: e.target.value, reasoning_effort: e.target.value.startsWith('gpt-6') ? 'medium' : undefined })}>{models.map(m => <option key={m.id} value={m.model}>{m.label}</option>)}</GlassSelect>
    <p className="field-help">{selected?.detail}. Model access depends on your connection.</p>
    {provider === 'openai' ? <>
      <label htmlFor={`${id}-power`}>Model power <output>{['Luna · efficient', 'Sol · most capable'][power]}</output></label><input id={`${id}-power`} aria-label="Model power" type="range" min="0" max="1" step="1" value={power} onChange={e => onChange({ ...value, model: openaiModels[+e.target.value].model, reasoning_effort: +e.target.value ? 'medium' : undefined })}/><div className="range-labels"><span>Lower cost</span><span>More capable</span></div>
      {reasoning ? <><label htmlFor={`${id}-reasoning`}>Thinking effort <output>{value.reasoning_effort || (newest ? 'medium' : 'none')}</output></label><input id={`${id}-reasoning`} aria-label="Thinking effort" type="range" min="0" max="4" step="1" value={Math.max(0, efforts.indexOf(value.reasoning_effort || (newest ? 'medium' : 'none')))} onChange={e => onChange({ ...value, reasoning_effort: efforts[+e.target.value] })}/><div className="range-labels"><span>Less thinking</span><span>Think longer</span></div></> : null}
      <label htmlFor={`${id}-speed`}>Processing speed</label><GlassSelect id={`${id}-speed`} value={value.service_tier || 'default'} onChange={e => onChange({ ...value, service_tier: e.target.value })}><option value="flex">Economy</option><option value="default">Standard</option><option value="priority">Fast · priority processing</option></GlassSelect><p className="field-help">Fast requests priority processing and can cost more. Speed depends on provider availability.</p>
    </> : null}
  </div>;
}
