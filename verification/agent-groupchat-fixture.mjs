// Synthetic UI evidence only. No credentials, database, models or provider calls.
// Build frontend, then run GROKBOT_UI_PORT=4343 node verification/agent-groupchat-fixture.mjs.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const bots = ['Coordinator', 'Researcher', 'Builder', 'Writer'].map((name, index) => ({
  id: `synthetic-${index}`, name, role: name, description: 'Synthetic UI fixture', status: 'idle',
  llm_provider: 'openai', llm_model: 'gpt-6.1-sol', tools_enabled: [], system_prompt: 'Synthetic UI fixture',
}));
const team = { id: 'synthetic-team', title: 'Synthetic group conversation', is_group: true, bot_ids: bots.map(bot => bot.id) };
const rooms = bots.map(bot => ({ id: `chat-${bot.id}`, title: `Bot ${bot.id}`, is_group: false, bot_ids: [bot.id] }));
const saved = (index, sender, content, type = 'text', internal = false) => ({
  id: `fixture-message-${index}`, conversation_id: team.id,
  sender_type: sender === 'user' ? 'user' : sender === null ? 'system' : 'bot',
  sender_bot_id: typeof sender === 'number' ? bots[sender].id : undefined,
  content, message_type: type, metadata_json: { internal },
  created_at: `2026-10-24T20:${String(index).padStart(2, '0')}:00Z`,
});
const messages = [
  saved(1, 'user', 'Synthetic fixture: have Researcher check a source, then ask Writer to summarize it.'),
  saved(2, 0, 'I’ll ask Researcher to check the source first.\nHANDOFF[Researcher: Review fixture source A and report its evidence.]', 'handoff', true),
  saved(3, 1, 'Calling tool: browser_navigate', 'tool_call', true),
  saved(4, null, '{"success":true,"private":"HIDDEN_TOOL_PAYLOAD"}', 'tool_result', true),
  saved(5, 1, 'Fixture source A lists its product and pricing. This is synthetic evidence for the UI test.', 'text', true),
  saved(6, 0, 'HANDOFF[Writer: Summarize Researcher’s recorded findings. Keep the fixture label.]', 'handoff', true),
  saved(7, 3, 'Synthetic summary: the fixture source describes a product and its pricing.', 'text', true),
  saved(8, 0, 'Synthetic fixture complete. The saved specialist replies appear above. No external lookup was run.'),
  saved(9, 0, 'HIDDEN_PROVIDER_REASONING', 'reasoning', true),
];
const json = (res, value) => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  for await (const _chunk of req) { /* Consume requests; never forward them. */ }
  const path = new URL(req.url, 'http://127.0.0.1').pathname.replace(/^\/api/, '');
  if (path === '/bots') return json(res, bots);
  if (path === '/conversations') return json(res, [team, ...rooms]);
  if (path === '/teams/default') return json(res, team);
  if (path.endsWith('/sync')) return json(res, { messages: [...messages].reverse(), tasks: [] });
  if (path.endsWith('/tasks') || path.endsWith('/context')) return json(res, []);
  if (['/workspace/runs', '/workspace/goals', '/workspace/artifacts', '/plugins', '/plugins/catalog', '/plugins/available-connections', '/computer/approvals/pending'].includes(path)) return json(res, []);
  if (path === '/plugins/catalog/sync') return json(res, null);
  return json(res, {});
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const apiPort = server.address().port;
const port = Number(process.env.GROKBOT_UI_PORT || 4343);
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  BACKEND_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
  NODE_OPTIONS: `--require=${repo}/verification/creation-loopback-only.cjs`,
};
const child = spawn(process.execPath, [`${repo}/frontend/node_modules/next/dist/bin/next`, 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: `${repo}/frontend`, env, stdio: ['ignore', 'inherit', 'inherit'] });
console.log(JSON.stringify({ frontend: `http://127.0.0.1:${port}/?conversation=${team.id}`, synthetic: true }));
const stop = () => { child.kill('SIGTERM'); server.close(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
