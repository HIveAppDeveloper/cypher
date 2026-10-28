import test from 'node:test';
import assert from 'node:assert/strict';
import {load, renderer, environment, find, textOf, deferred} from './support/component-harness.mjs';

function fixture(getTranscript) {
  const env = environment(), view = renderer(env), copied = [], blobs = [], downloads = [], revoked = [];
  let messageId = 'recording-1';
  env.document.createElement = () => ({click() { downloads.push({href: this.href, name: this.download}); }});
  const {VoiceTranscript} = load('../src/components/VoiceTranscript.tsx', {
    react: view.react, '../lib/api': {api: {getTranscript}}, './VoiceTranscript.module.css': {__esModule: true, default: {}},
  }, {...env.globals, React: view.react.default, Blob,
    navigator: {clipboard: {writeText: async text => { copied.push(text); }}},
    URL: {createObjectURL: blob => { blobs.push(blob); return 'blob:transcript-' + blobs.length; }, revokeObjectURL: url => revoked.push(url)},
  });
  view.mount(() => VoiceTranscript({conversationId: 'conversation', messageId}));
  const click = text => find(view.tree, node => node.type === 'button' && textOf(node) === text).props.onClick();
  return {env, view, click, copied, blobs, downloads, revoked, changeMessage(id) { messageId = id; view.rerender(); }};
}

test('transcripts load on demand, poll only while pending, and copy/download the actual Unicode text', async () => {
  const text = 'Thursday at 10 — bring the résumé.\nSecond sentence.';
  let calls = 0;
  const f = fixture(async () => ++calls === 1 ? {status: 'pending', text: ''} : {status: 'ready', text});
  assert.equal(calls, 0);
  f.click('Show transcript'); await f.view.flush();
  assert.match(textOf(f.view.tree), /Transcribing the recording/);
  f.env.time.advance(1500); await f.view.flush();
  assert.match(textOf(f.view.tree), /bring the résumé/);
  f.click('Copy transcript'); await f.view.flush(); assert.deepEqual(f.copied, [text]);
  assert.match(textOf(f.view.tree), /Copied/);
  f.click('Download transcript');
  assert.equal(await f.blobs[0].text(), text);
  assert.deepEqual(f.downloads, [{href: 'blob:transcript-1', name: 'transcript.txt'}]);
  f.env.time.advance(3000); await f.view.flush(); assert.equal(calls, 2);
  assert.deepEqual(f.revoked, ['blob:transcript-1']); f.view.unmount();
});

test('a failed transcript request offers retry and closing aborts pending work without late updates', async () => {
  let calls = 0, signal;
  const waiting = deferred();
  const f = fixture(async (_cid, _mid, value) => {
    calls++; signal = value;
    if (calls === 1) throw Error('Connection lost.');
    return waiting.promise;
  });
  f.click('Show transcript'); await f.view.flush(); assert.match(textOf(f.view.tree), /Connection lost/);
  f.click('Retry transcript'); await f.view.flush(); assert.equal(calls, 2);
  f.click('Hide transcript'); f.view.render(); assert.equal(signal.aborted, true);
  waiting.resolve({status: 'ready', text: 'Late text'}); await f.view.flush();
  assert.doesNotMatch(textOf(f.view.tree), /Late text/); f.view.unmount();
  assert.equal(f.view.updatesAfterUnmount, 0);
});

test('changing recordings rejects stale transcript results and unavailable state never polls indefinitely', async () => {
  const old = deferred(); let calls = 0;
  const f = fixture(async (_cid, mid) => { calls++; return mid === 'recording-1' ? old.promise : {status: 'unavailable', text: ''}; });
  f.click('Show transcript'); await f.view.flush(); f.changeMessage('recording-2'); await f.view.flush();
  old.resolve({status: 'ready', text: 'Wrong recording'}); await f.view.flush();
  assert.doesNotMatch(textOf(f.view.tree), /Wrong recording/);
  assert.match(textOf(f.view.tree), /No transcript is available.*original recording is saved/);
  f.env.time.advance(10000); await f.view.flush(); assert.equal(calls, 2); f.view.unmount();
});
