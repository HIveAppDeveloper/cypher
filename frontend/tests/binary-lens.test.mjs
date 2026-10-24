import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load } from './support/component-harness.mjs';

function lens(width = 560, height = 210) {
  const env = environment();
  const view = renderer(env);
  const frames = new Map();
  let frameId = 0, draws = 0, active = false, visibility;
  const glyphs = [];
  const media = Object.assign(new EventTarget(), { matches: false });
  env.window.matchMedia = query => query.includes('reduced-motion') ? media : Object.assign(new EventTarget(), { matches: false });
  const canvas = env.element({
    getBoundingClientRect: () => ({ width, height }),
    getContext: () => ({ setTransform() {}, clearRect() { draws++; }, fillText(glyph) { glyphs.push(glyph); } }),
  });
  env.element = () => canvas;
  class Observer { observe() {} disconnect() {} }
  class Intersection extends Observer { constructor(callback) { super(); visibility = callback; } }
  const { default: BinaryLens } = load('../src/components/cipher/BinaryLens.tsx', { react: view.react, './digitField': load('../src/components/cipher/digitField.ts', {}) }, {
    ...env.globals, React: view.react.default,
    ResizeObserver: Observer, MutationObserver: Observer, IntersectionObserver: Intersection,
    getComputedStyle: () => ({ color: '#242423' }),
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  view.mount(() => BinaryLens({ active }));
  return {
    env, view, media, frames, glyphs, get draws() { return draws; },
    async activate(value) { active = value; view.rerender(); await view.flush(); },
    visible(value) { visibility([{ isIntersecting: value }]); },
    tick(time) { const pending = [...frames.values()]; frames.clear(); for (const frame of pending) frame(time); },
  };
}

test('a mounted static lens starts and stops as voice activity changes', async () => {
  const l = lens();
  assert.equal(l.frames.size, 0);
  await l.activate(true);
  assert.equal(l.frames.size, 1);
  const before = l.draws;
  l.tick(100);
  assert.ok(l.draws > before);
  await l.activate(false);
  assert.equal(l.frames.size, 0);
  l.view.unmount();
});

test('lens animation pauses offscreen and for reduced motion, then resumes', async () => {
  const l = lens();
  await l.activate(true);
  l.visible(false);
  assert.equal(l.frames.size, 0);
  l.visible(true);
  assert.equal(l.frames.size, 1);
  l.media.matches = true;
  l.media.dispatchEvent(new Event('change'));
  assert.equal(l.frames.size, 0);
  l.media.matches = false;
  l.media.dispatchEvent(new Event('change'));
  assert.equal(l.frames.size, 1);
  l.view.unmount();
  assert.equal(l.frames.size, 0);
});

test('compact and large marks draw actual binary digits', () => {
  for (const [width,height] of [[42,22],[560,210]]) {
    const l = lens(width,height);
    assert.ok(l.glyphs.length > 0);
    assert.ok(l.glyphs.every(glyph => glyph === '0' || glyph === '1'));
    assert.ok(l.glyphs.includes('0') && l.glyphs.includes('1'));
    l.view.unmount();
  }
});
