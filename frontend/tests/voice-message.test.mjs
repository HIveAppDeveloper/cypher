import test from 'node:test';
import assert from 'node:assert/strict';
import {load, renderer, environment, find, textOf} from './support/component-harness.mjs';

const placeholder = 'Voice message attached. Please respond directly to what I said in the recording.';
function renderMessage(attachments, content = placeholder) {
  const env = environment(), view = renderer(env);
  const react = {...view.react, lazy: () => 'markdown', Suspense: 'suspense'};
  const {MessageBubble} = load('../src/components/MessageBubble.tsx', {
    react, './BotAvatar': {BotAvatar: 'avatar'},
  }, {...env.globals, React: react.default});
  const message = {id: 'voice', content, senderType: 'user', createdAt: '2026-10-24T19:28:00Z', attachments};
  view.mount(() => MessageBubble({message}));
  return {view, message};
}

test('saved voice recordings have playback controls and a short label without changing the message', () => {
  const url = '/api/messages/voice/attachments/0';
  const {view, message} = renderMessage([{mime: 'audio/webm', name: 'voice.webm', url}]);
  const audio = find(view.tree, node => node.type === 'audio');
  assert.ok(audio);
  assert.equal(audio.props.src, url);
  assert.equal(audio.props.controls, true);
  assert.equal(audio.props.preload, 'metadata');
  assert.match(audio.props['aria-label'], /voice.webm/);
  assert.match(textOf(view.tree), /Voice message/);
  assert.doesNotMatch(textOf(view.tree), /Please respond directly/);
  assert.equal(message.content, placeholder);
});

test('inline audio bytes and custom captions are preserved', () => {
  const {view} = renderMessage([{mime: 'audio/ogg', name: 'note.ogg', data: 'AAEC'}], 'My actual caption');
  assert.equal(find(view.tree, node => node.type === 'audio').props.src, 'data:audio/ogg;base64,AAEC');
  assert.match(textOf(view.tree), /My actual caption/);
});

test('unsupported or failed playback offers the original audio as a download', () => {
  const {view} = renderMessage([{mime: 'audio/webm', name: 'voice.webm', url: '/recording.webm'}]);
  find(view.tree, node => node.type === 'audio').props.onError();
  view.render();
  assert.equal(find(view.tree, node => node.type === 'audio'), undefined);
  const link = find(view.tree, node => node.type === 'a' && textOf(node) === 'Download audio');
  assert.equal(link.props.href, '/recording.webm');
  assert.equal(link.props.download, 'voice.webm');
  assert.match(textOf(view.tree), /Playback unavailable/);
});

test('video, images and files keep their existing controls and labels', () => {
  const {view} = renderMessage([
    {mime: 'video/webm', name: 'clip.webm', url: '/clip.webm'},
    {mime: 'image/png', name: 'photo.png', url: '/photo.png'},
    {mime: 'application/pdf', name: 'brief.pdf', url: '/brief.pdf'},
  ]);
  assert.equal(find(view.tree, node => node.type === 'video').props.controls, true);
  assert.equal(find(view.tree, node => node.type === 'img').props.src, '/photo.png');
  assert.equal(find(view.tree, node => node.type === 'a' && textOf(node) === 'brief.pdf').props.href, '/brief.pdf');
  assert.match(textOf(view.tree), /Please respond directly/);
});
