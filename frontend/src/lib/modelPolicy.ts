import { RunOptions } from './types';
export function modelPolicy(options: Partial<RunOptions>): Partial<RunOptions> {
  const clean = { ...options };
  if (clean.model && !['gpt-6.1-sol', 'gpt-6-luna'].includes(clean.model)) clean.model = 'gpt-6.1-sol';
  if (clean.provider) clean.provider = 'openai';
  if (clean.reasoning_effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(clean.reasoning_effort)) clean.reasoning_effort = 'medium';
  if (clean.output && clean.output !== 'text') clean.output = 'text';
  return clean;
}
