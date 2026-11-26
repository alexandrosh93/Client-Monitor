import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the Content Security Policy allows the current main application script', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const hash = createHash('sha256').update(scripts[0][1]).digest('base64');
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(policy, 'Missing Content Security Policy');
  assert.ok(policy[1].includes(`'sha256-${hash}'`), `Set the CSP script hash to sha256-${hash}`);
});
