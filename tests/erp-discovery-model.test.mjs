import test from 'node:test';
import assert from 'node:assert/strict';
import { computeProjectProgress, computeTrainingProgress, normalizeProjectDocument, validateErpDiscoveryImport } from '../erp-discovery-model.mjs';

const catalog = {
  sections: [
    { id: 'company', checklist: false, questions: [{ id: 'company.1' }, { id: 'company.2' }] },
    { id: 'training', checklist: true, questions: [{ id: 'training.1' }, { id: 'training.2' }] },
  ],
  moduleSections: [{ id: 'stock', items: [{ id: 'stock.1' }, { id: 'stock.2' }] }],
};

test('normalizes legacy ERP Discovery data and keeps special training notes', () => {
  const document = normalizeProjectDocument({
    answers: { 'company.1': 'Retail' },
    checks: { 'training.1': true },
    notes: { 'training.1': 'Repeat month-end example' },
    moduleData: { 'stock.1': { checked: true, note: 'Configured', action: 'Verify', users: ['user-1', 'user-2'] } },
    changeLog: [{ date: '2026-10-13', at: '2026-10-13T10:00:00Z', section: 'module:stock', field: 'module.stock.1.users', label: 'Training attendees', value: 'Anna, George', user: 'tester' }],
  });
  assert.equal(document.answers['company.1'], 'Retail');
  assert.equal(document.moduleData['stock.1'].checked, true);
  assert.deepEqual(document.moduleData['stock.1'].users, ['user-1', 'user-2']);
  assert.equal(document.changeLog[0].label, 'Training attendees');
  assert.equal(document.trainingStages['training.1'], undefined);
  assert.equal(document.notes['training.1'], 'Repeat month-end example');
});

test('calculates discovery and training separately', () => {
  const document = normalizeProjectDocument({
    answers: { 'company.1': 'Retail' },
    checks: { 'training.1': true },
    moduleData: { 'stock.1': { status: 'Completed' } },
    trainingStages: { 'training.1': { status: 'Completed' }, 'training.2': { status: 'Scheduled' } },
  });
  assert.deepEqual(computeProjectProgress(document, catalog), { total: 6, complete: 3, percent: 50 });
  assert.deepEqual(computeTrainingProgress(document, catalog), { total: 2, complete: 1, percent: 50 });
});

test('imports known .erpdisc schema without trusting arbitrary fields', () => {
  const result = validateErpDiscoveryImport({
    projectId: 'legacy-1',
    meta: { company: 'Example Ltd', project: 'ERP', consultant: 'AK', phase: 'During Implementation', version: '2' },
    answers: { 'company.1': 'Services' },
    requirements: [{ id: 'R01', topic: 'Training', type: 'Training', priority: 'High', status: 'Open' }],
    dangerous: '<script>alert(1)</script>',
  });
  assert.equal(result.sourceProjectId, 'legacy-1');
  assert.equal(result.companyName, 'Example Ltd');
  assert.equal(result.document.requirements.length, 1);
  assert.equal('dangerous' in result.document, false);
});

test('rejects unrelated JSON files', () => {
  assert.throws(() => validateErpDiscoveryImport({ hello: 'world' }), /not a valid ERP Discovery/i);
});
