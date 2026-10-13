import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const aiSource = readFileSync(new URL('../ai-suggestions.js', import.meta.url), 'utf8');

test('opening AI Suggestions closes an active client workspace first', () => {
  const openStart = aiSource.indexOf('function openWorkspace()');
  const closeWorkspace = aiSource.indexOf('window.closeClientWorkspaceView()', openStart);
  const showSuggestions = aiSource.indexOf("document.getElementById(PANEL_ID).classList.add('active')", openStart);

  assert.notEqual(openStart, -1);
  assert.notEqual(closeWorkspace, -1);
  assert.notEqual(showSuggestions, -1);
  assert.ok(closeWorkspace < showSuggestions);
});
