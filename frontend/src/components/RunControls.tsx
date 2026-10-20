import { ModelControls } from './ModelControls';
import { RunOptions } from '../lib/types';
export const DEFAULT_OPTIONS: RunOptions = { temperature: 0.5, max_tokens: 2048, max_iterations: 10, team_rounds: 1 };
export function RunControls({ options, onChange, font, onFont, group, model }: { options: RunOptions; onChange: (options: RunOptions) => void; font: string; onFont: (font: string) => void; group: boolean; model?: { provider: string; model: string } }) {
  return <details className="run-controls"><summary>Controls</summary><div className="controls-popover">
    <h3>Make it your own</h3>{model && !group ? <ModelControls value={{ provider: model.provider, model: model.model, ...options }} onChange={next => onChange({ ...options, ...next })}/> : null}
    <label>Response style<select value={options.temperature < .3 ? 'precise' : options.temperature > .8 ? 'creative' : 'balanced'} onChange={e => onChange({ ...options, temperature: {precise:.1,balanced:.5,creative:1.1}[e.target.value] || .5 })}><option value="precise">Precise</option><option value="balanced">Balanced</option><option value="creative">Exploratory</option></select></label>
    <label>Creativity <output>{options.temperature.toFixed(1)}</output><input aria-label="Creativity" type="range" min="0" max="1.5" step=".1" value={options.temperature} onChange={e => onChange({ ...options, temperature: +e.target.value })}/></label>
    <label>Response length <output>{options.max_tokens.toLocaleString()} tokens</output><input aria-label="Response length" type="range" min="256" max="8192" step="256" value={options.max_tokens} onChange={e => onChange({ ...options, max_tokens: +e.target.value })}/></label>
    <label>Tool steps <output>{options.max_iterations}</output><input aria-label="Tool steps" type="range" min="1" max="25" value={options.max_iterations} onChange={e => onChange({ ...options, max_iterations: +e.target.value })}/></label>
    {group ? <label>Team rounds <output>{options.team_rounds}</output><input aria-label="Team rounds" type="range" min="1" max="4" value={options.team_rounds} onChange={e => onChange({ ...options, team_rounds: +e.target.value })}/></label> : null}
    <label>Typeface<select value={font} onChange={e => onFont(e.target.value)}><option value="inter">Inter</option><option value="system">System</option><option value="serif">Georgia</option></select></label>
    <p>Applies to your next message. More rounds and steps use more model calls.</p>
  </div></details>;
}
