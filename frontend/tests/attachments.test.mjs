import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAttachment } from '../src/lib/attachments.ts';

const file = { name: 'screenshot.png' };
function reader(action) {
  globalThis.FileReader = class {
    readAsDataURL() { queueMicrotask(() => action(this)); }
    abort() { this.onabort?.(); }
  };
}
test('image bytes survive file reading', async () => {
  reader(r => { r.result = 'data:image/png;base64,cGl4ZWxz'; r.onload(); });
  assert.deepEqual(await readAttachment(file, 'image/png'), { name: file.name, mime: 'image/png', data: 'cGl4ZWxz' });
});
test('aborted file reading rejects with recovery instead of hanging', async () => {
  reader(r => r.abort());
  await assert.rejects(readAttachment(file, 'image/png'), /interrupted.*Select it again/);
});
test('a stalled file read times out', async () => {
  reader(() => {});
  await assert.rejects(readAttachment(file, 'image/png', 5), /timed out/);
});
test('empty or failed reads reject', async () => {
  reader(r => { r.result = 'data:image/png;base64,'; r.onload(); });
  await assert.rejects(readAttachment(file, 'image/png'), /empty or unreadable/);
  reader(r => r.onerror());
  await assert.rejects(readAttachment(file, 'image/png'), /could not be read/);
});
