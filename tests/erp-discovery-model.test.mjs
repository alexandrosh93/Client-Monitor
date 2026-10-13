import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_STATUSES, computeProjectProgress, computeTrainingProgress, filterModuleItems, normalizeModuleStatus, normalizeProjectDocument, validateErpDiscoveryImport } from '../erp-discovery-model.mjs';

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
  assert.equal(document.moduleData['stock.1'].status, 'Needs Training');
  assert.deepEqual(document.moduleData['stock.1'].users, ['user-1', 'user-2']);
  assert.equal(document.changeLog[0].label, 'Training attendees');
  assert.equal(document.trainingStages['training.1'], undefined);
  assert.equal(document.notes['training.1'], 'Repeat month-end example');
});

test('module selection and training status have separate meanings', () => {
  assert.deepEqual(MODULE_STATUSES, ['Needs Training', 'In Progress', 'Completed']);
  assert.equal(normalizeModuleStatus('Needs training'), 'Needs Training');
  assert.equal(normalizeModuleStatus('In progress'), 'In Progress');
  assert.equal(normalizeModuleStatus('Not started'), 'Needs Training');

  const selectedNeedsTraining = normalizeProjectDocument({
    answers: { 'company.1': 'Retail' },
    checks: { 'training.1': true },
    moduleData: {
      'stock.1': { checked: true, status: 'Not started' },
      'stock.2': { checked: false, status: 'Completed' },
    },
  });
  assert.deepEqual(computeProjectProgress(selectedNeedsTraining, catalog), { total: 5, complete: 2, percent: 40 });

  selectedNeedsTraining.moduleData['stock.1'].status = 'Completed';
  assert.deepEqual(computeProjectProgress(selectedNeedsTraining, catalog), { total: 5, complete: 3, percent: 60 });
});

test('filters module screens by project selection and training status', () => {
  const items = [{ id: 'screen.1' }, { id: 'screen.2' }, { id: 'screen.3' }, { id: 'screen.4' }];
  const moduleData = {
    'screen.1': { checked: true, status: 'Needs Training' },
    'screen.2': { checked: true, status: 'In Progress' },
    'screen.3': { checked: true, status: 'Completed' },
    'screen.4': { checked: false, status: 'Completed' },
  };

  assert.deepEqual(filterModuleItems(items, moduleData, '').map(item => item.id), ['screen.1', 'screen.2', 'screen.3', 'screen.4']);
  assert.deepEqual(filterModuleItems(items, moduleData, 'selected').map(item => item.id), ['screen.1', 'screen.2', 'screen.3']);
  assert.deepEqual(filterModuleItems(items, moduleData, 'Needs Training').map(item => item.id), ['screen.1']);
  assert.deepEqual(filterModuleItems(items, moduleData, 'In Progress').map(item => item.id), ['screen.2']);
  assert.deepEqual(filterModuleItems(items, moduleData, 'Completed').map(item => item.id), ['screen.3']);
});

test('calculates discovery and training separately', () => {
  const document = normalizeProjectDocument({
    answers: { 'company.1': 'Retail' },
    checks: { 'training.1': true },
    moduleData: { 'stock.1': { checked: true, status: 'Completed' } },
    trainingStages: { 'training.1': { status: 'Completed' }, 'training.2': { status: 'Scheduled' } },
  });
  assert.deepEqual(computeProjectProgress(document, catalog), { total: 5, complete: 3, percent: 60 });
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
