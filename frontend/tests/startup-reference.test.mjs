import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { environment, renderer, load, find, textOf, storage } from './support/component-harness.mjs';

function intro({ session = storage(), reduced = false, motion = true } = {}) {
  const env = environment(session), view = renderer(env), frames = new Map();
  let id = 0;
  env.window.matchMedia = () => ({ matches: reduced });
  env.document.documentElement.dataset.motion = String(motion);
  Object.assign(env.window, { setTimeout: env.time.setTimeout, clearTimeout: env.time.clearTimeout, innerWidth: 1280, innerHeight: 900 });
  env.element = () => ({ getContext: () => ({ setTransform() {}, clearRect() {}, fillText() {} }) });
  const { default: Intro } = load('../src/components/cipher/CipherIntro.tsx', {
    react: view.react, './digitField': load('../src/components/cipher/digitField.ts', {}),
  }, { ...env.globals, React: view.react.default, performance: { now: () => 0 },
    getComputedStyle: () => ({ color: '#242423' }),
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: frame => frames.delete(frame),
  });
  view.mount(() => Intro());
  return { env, view, frames, session };
}

test('reference intro shows its wordmark before lifting and then releases the workspace', async () => {
  const i = intro();
  assert.equal(i.view.tree.props.className, 'cx-intro is-play');
  assert.match(textOf(i.view.tree), /Cypher/);
  i.env.time.advance(1800); await i.view.flush();
  assert.equal(i.view.tree.props.className, 'cx-intro is-word');
  i.env.time.advance(600); await i.view.flush();
  assert.equal(i.view.tree.props.className, 'cx-intro is-lift');
  i.env.time.advance(500); await i.view.flush();
  assert.equal(i.view.tree, null);
  i.view.unmount();
  assert.equal(i.env.time.pending, 0);
  assert.equal(i.frames.size, 0);
});

test('Skip ends rendering immediately and the sequence does not replay in the same tab', async () => {
  const i = intro();
  find(i.view.tree, node => node.type === 'button').props.onClick();
  await i.view.flush();
  assert.equal(i.frames.size, 0);
  i.env.time.advance(400); await i.view.flush();
  assert.equal(i.view.tree, null);
  i.view.unmount();
  const again = intro({ session: i.session });
  assert.equal(again.view.tree, null);
  assert.equal(again.frames.size, 0);
  again.view.unmount();
});

test('reduced motion and saved motion-off skip the canvas and overlay', () => {
  for (const settings of [{ reduced: true }, { motion: false }]) {
    const i = intro(settings);
    assert.equal(i.view.tree, null);
    assert.equal(i.frames.size, 0);
    assert.equal(i.env.time.pending, 0);
    i.view.unmount();
  }
});

test('keyboard input dismisses the signature without preventing the original key action', async () => {
  const i = intro();
  const key = new Event('keydown', { cancelable: true });
  i.env.window.dispatchEvent(key); await i.view.flush();
  assert.equal(key.defaultPrevented, false);
  assert.equal(i.frames.size, 0);
  i.env.time.advance(400); await i.view.flush();
  assert.equal(i.view.tree, null);
  i.view.unmount();
  assert.equal(getEventListeners(i.env.window, 'keydown').length, 0);
});

test('hiding the tab stops the canvas and cleanup removes all scheduled work', async () => {
  const i = intro();
  i.env.document.hidden = true;
  i.env.document.dispatchEvent(new Event('visibilitychange')); await i.view.flush();
  assert.equal(i.frames.size, 0);
  i.view.unmount();
  assert.equal(i.env.time.pending, 0);
  assert.equal(getEventListeners(i.env.document, 'visibilitychange').length, 0);
});
