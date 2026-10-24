import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { environment, renderer, load } from './support/component-harness.mjs';

function entrance({ motion = true, hidden = false, reduced = false } = {}) {
  const env = environment(), view = renderer(env);
  env.document.hidden = hidden;
  env.window.matchMedia = () => ({ matches: reduced });
  const { default: Entrance } = load('../src/components/cipher/CypherEntrance.tsx', {
    react: view.react,
    '../PreferencesPanel': { restoreAppearance() { env.document.documentElement.dataset.motion = String(motion); } },
    './CipherIntro': { __esModule: true, default: 'original-intro' },
  }, { ...env.globals, React: view.react.default });
  view.mount(() => Entrance());
  return { env, view };
}

test('saved disabled motion prevents the original intro from mounting on first entry', () => {
  const { view } = entrance({ motion: false });
  assert.equal(view.tree, null);
  view.unmount();
});

test('OS reduced motion prevents the intro from mounting', () => {
  const { view } = entrance({ reduced: true });
  assert.equal(view.tree, null);
  view.unmount();
});

test('an initially hidden document waits until visible, then mounts the original intro once', async () => {
  const { env, view } = entrance({ hidden: true });
  assert.equal(view.tree, null);
  env.document.hidden = false;
  env.document.dispatchEvent(new Event('visibilitychange'));
  await view.flush();
  assert.equal(view.tree.type, 'original-intro');
  assert.equal(getEventListeners(env.document, 'visibilitychange').length, 0);
  view.unmount();
});

test('an unmounted hidden entry removes its visibility listener', () => {
  const { env, view } = entrance({ hidden: true });
  view.unmount();
  assert.equal(getEventListeners(env.document, 'visibilitychange').length, 0);
});
