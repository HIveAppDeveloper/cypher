import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('legacy accent preferences cannot recolor Cypher while personal layout and motion settings survive', () => {
  const source = readFileSync(new URL('../src/components/PreferencesPanel.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  for (const accent of ['#007aff', '#7054dc']) {
    const styles = new Map([['--accent-blue', accent], ['--focus-color', accent]]);
    const root = { dataset: {}, style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) } };
    const exports = {};
    runInNewContext(compiled, { exports, require: name => { if (name === 'react' || name === './GlassSelect') return {}; throw Error(name); },
      document: { documentElement: root }, localStorage: { getItem: () => JSON.stringify({ accent, fontSize: 20, width: 75, density: 'compact', motion: false }) } });
    exports.restoreAppearance();
    assert.equal(styles.has('--accent-blue'), false);
    assert.equal(styles.has('--focus-color'), false);
    assert.equal(styles.get('--chat-font-size'), '20px');
    assert.equal(styles.get('--message-width'), '75%');
    assert.equal(root.dataset.density, 'compact');
    assert.equal(root.dataset.motion, 'false');
  }
});
