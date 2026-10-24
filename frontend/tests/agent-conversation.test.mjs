import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, find, textOf } from './support/component-harness.mjs';

const bots = [{ id: 'coordinator', name: 'Coordinator', llmModel: 'shared-model' }, { id: 'researcher', name: 'Researcher', llmModel: 'shared-model' }];
const { agentActivity, conversationMessages } = load('../src/lib/agent-conversation.ts');
const message = (id, values = {}) => ({ id, conversationId: 'fixture-room', senderType: 'bot', senderBotId: 'coordinator', messageType: 'text', content: 'A recorded reply.', createdAt: '2026-10-24T20:00:00Z', ...values });

function component(row) {
  const env = environment(), view = renderer(env);
  const Component = load('../src/components/AgentConversationActivity.tsx', {
    '../lib/agent-conversation': { agentActivity }, './BotAvatar': { BotAvatar: 'bot-avatar' },
    './MessageBubble': { MessageBubble: 'message-bubble' }, './agent-conversation-activity.css': {},
  }, { ...env.globals, React: view.react.default }).AgentConversationActivity;
  view.mount(() => Component({ message: row, bots }));
  return view;
}

test('real handoffs and specialist replies stay interleaved with the original conversation', () => {
  const rows = [message('user', { senderType: 'user', senderBotId: undefined, content: 'Research this.' }),
    message('handoff', { internal: true, messageType: 'handoff', content: 'I will check public sources. HANDOFF[Researcher: Check the company website.]' }),
    message('tool', { internal: true, senderBotId: 'researcher', messageType: 'tool_call', content: 'Calling tool: browser_navigate' }),
    message('result', { internal: true, senderType: 'system', senderBotId: undefined, messageType: 'tool_result', content: '{"success":true,"private":"not for display"}' }),
    message('reply', { internal: true, senderBotId: 'researcher', content: 'The company website lists its current product.' }), message('final')];
  assert.equal(conversationMessages(rows, bots, true).map(row => row.id).join(','), 'user,handoff,tool,result,reply,final');
  assert.equal(conversationMessages(rows, bots, false).map(row => row.id).join(','), 'user,final');
});

test('a coordinator-only answer or empty conversation gains no invented agent activity', () => {
  const rows = [message('final')];
  assert.equal(conversationMessages(rows, bots, true).length, 1);
  assert.equal(conversationMessages([], bots, true).length, 0);
  assert.equal(agentActivity(rows[0], bots), null);
});

test('unknown private event types are excluded instead of being shown as thinking', () => {
  for (const messageType of ['reasoning', 'thinking', 'analysis', 'debug', 'status_update']) {
    const row = message(messageType, { internal: true, messageType, content: 'Private provider data' });
    assert.equal(conversationMessages([row], bots, true).length, 0, messageType);
  }
});

test('saved handoff syntax retains real target names and tasks without claiming execution', () => {
  const row = message('handoff', { internal: true, messageType: 'handoff', content: 'I will compare sources.\nHANDOFF[Researcher: Check the public website.]\nHANDOFF[Writer: Draft a summary after research.]' });
  const parsed = agentActivity(row, bots);
  assert.equal(parsed.assignments[0].name, 'Researcher');
  assert.equal(parsed.assignments[1].task, 'Draft a summary after research.');
  const view = component(row), text = textOf(view.tree);
  assert.ok(text.includes('Requested help from Researcher'));
  assert.ok(text.includes('Requested help from Writer'));
  assert.ok(!/Working|Done|Completed|parallel/.test(text));
  const time = find(view.tree, node => node.type === 'time');
  assert.equal(time.props.dateTime, row.createdAt);
});

test('tool messages expose only safe names and reported outcome flags', () => {
  const call = message('tool', { internal: true, senderBotId: 'researcher', messageType: 'tool_call', content: 'Calling tool: gmail_users_messages_list' });
  assert.ok(textOf(component(call).tree).includes('Researcher'));
  assert.ok(textOf(component(call).tree).includes('gmail_users_messages_list'));
  for (const content of ['{"error":"private credential abc123","recipient":"private@example.test"}', 'provider raw payload abc123']) {
    const row = message('result', { internal: true, senderType: 'system', senderBotId: undefined, messageType: 'tool_result', content });
    const text = textOf(component(row).tree);
    assert.ok(!text.includes('abc123'));
    assert.ok(!text.includes('private@example.test'));
    assert.equal(conversationMessages([row], bots, true, 'abc123').length, 0);
    assert.equal(conversationMessages([row], bots, true, 'private@example.test').length, 0);
  }
  const malformed = message('bad-tool', { internal: true, messageType: 'tool_call', content: 'Calling tool: unsafe-name secret=abc123' });
  assert.ok(!textOf(component(malformed).tree).includes('abc123'));
});

test('reply identity comes from the recorded agent ID and never a model alias', () => {
  const row = message('reply', { internal: true, senderBotId: 'researcher', modelRoutes: [{ model: 'shared-model', specialty: 'writer' }] });
  const bubble = find(component(row).tree, node => node.type === 'message-bubble');
  assert.equal(bubble.props.bot.name, 'Researcher');
  assert.equal(bubble.props.message, row);
  assert.equal(bubble.props.showTimestamp, true);
  assert.equal(conversationMessages([row], bots, true, 'shared-model').length, 0);
  assert.equal(conversationMessages([row], bots, true, 'Researcher').length, 1);
});

test('an unavailable roster name stays explicitly unattributed', () => {
  const row = message('old-reply', { internal: true, senderBotId: 'missing-agent' });
  const text = textOf(component(row).tree);
  assert.ok(text.includes('Agent name unavailable'));
  assert.ok(text.includes(row.content));
  assert.ok(!text.includes('Coordinator'));
});

test('malformed or oversized handoff text is not displayed as an accepted task', () => {
  for (const content of ['HANDOFF[Researcher]', 'HANDOFF[Researcher: ]', 'HANDOFF[Researcher: ' + 'x'.repeat(4001) + ']']) {
    assert.equal(conversationMessages([message('bad', { internal: true, messageType: 'handoff', content })], bots, true).length, 0);
  }
});
