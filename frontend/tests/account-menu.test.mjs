import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment, renderer, load, find, textOf} from './support/component-harness.mjs';

function fixture(accountEmail, placement = 'top') {
  const env = environment(), view = renderer(env);
  env.window.innerWidth = 1536;
  env.window.innerHeight = 800;
  let setupCalls = 0;
  const {AccountMenu} = load('../src/components/AccountMenu.tsx', {'./AccountMenu.module.css': {}}, {React: view.react.default, window: env.window});
  view.mount(() => AccountMenu({accountEmail, onSetup: () => setupCalls++, placement}));
  return {view, env, get setupCalls() {return setupCalls;}};
}
test('guest has a direct sign-in link and retains workspace settings', () => {
  const app = fixture();
  const signIn = find(app.view.tree, node => node.type === 'a' && textOf(node).includes('Sign in'));
  assert.equal(signIn.props.href, '/login');
  assert.equal(find(app.view.tree, node => node.props?.href === '/api/auth/logout'), undefined);
  find(app.view.tree, node => node.type === 'button').props.onClick();
  assert.equal(app.setupCalls, 1);
});
test('signed-in account can switch accounts through logout and open settings without changing session', () => {
  const app = fixture('person@example.test');
  const action = label => find(app.view.tree, node => node.type === 'a' && textOf(node) === label);
  assert.equal(action('Switch account').props.href, '/api/auth/logout');
  assert.equal(action('Sign out').props.href, '/api/auth/logout');
  assert.ok(textOf(app.view.tree).includes('person@example.test'));
  let closed = false;
  find(app.view.tree, node => node.type === 'button').props.onClick({currentTarget: {closest: () => ({removeAttribute: name => {assert.equal(name, 'open'); closed = true;}})}});
  assert.equal(app.setupCalls, 1);
  assert.equal(closed, true);
});
test('Escape closes account disclosure and restores keyboard focus', () => {
  const app = fixture('person@example.test');
  let focused = false, prevented = false;
  const details = {open: true, querySelector: selector => {assert.equal(selector, 'summary'); return {focus: () => focused = true};}};
  app.view.tree.props.onKeyDown({key: 'Escape', preventDefault: () => prevented = true, currentTarget: details});
  assert.equal(details.open, false);
  assert.equal(prevented, true);
  assert.equal(focused, true);
});

test('signed-in header menu opens below its avatar and clamps its position', () => {
  const app = fixture('person@example.test', 'bottom');
  const details = app.view.tree;
  const values = new Map();
  let shown = false;
  const menu = {showPopover: () => { shown = true; }, hidePopover() {}};
  const currentTarget = {
    open: true,
    getBoundingClientRect: () => ({left: 1278, right: 1306, top: 24, bottom: 52}),
    querySelector: selector => { assert.equal(selector, 'nav'); return menu; },
    style: {setProperty: (name, value) => values.set(name, value), removeProperty: name => values.delete(name)},
  };
  details.props.onToggle({target: currentTarget, currentTarget});
  assert.equal(details.props['data-menu-placement'], 'bottom');
  assert.equal(values.get('--account-menu-top'), '60px');
  assert.equal(values.get('--account-menu-left'), '1026px');
  assert.equal(values.has('--account-menu-bottom'), false);
  assert.equal(shown, true);
});
