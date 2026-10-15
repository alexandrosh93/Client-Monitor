import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_STATUSES, buildClientReportSnapshot, collectModuleItemsByStatus, computeProjectProgress, computeTrainingProgress, filterModuleChangesByDate, filterModuleItems, normalizeModuleStatus, normalizeProjectDocument, validateErpDiscoveryImport } from '../erp-discovery-model.mjs';

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

test('workspace module filters combine every module section and keep section context', () => {
  const sections = [
    { id: 'accounting', title: 'Accounting', group: 'accounting', items: [{ id: 'a1', text: 'Accounts' }] },
    { id: 'stock', title: 'Stock', group: 'stock', items: [{ id: 's1', text: 'Items' }, { id: 's2', text: 'Warehouses' }] },
  ];
  const values = {
    a1: { checked: true, status: 'In Progress', note: 'Review' },
    s1: { checked: true, status: 'Needs Training' },
    s2: { checked: false, status: 'Completed' },
  };
  assert.deepEqual(collectModuleItemsByStatus(sections, values).map(item => item.id), ['a1', 's1']);
  assert.deepEqual(collectModuleItemsByStatus(sections, values, 'In Progress').map(item => [item.id, item.sectionId, item.group]), [['a1', 'accounting', 'accounting']]);
  assert.deepEqual(collectModuleItemsByStatus(sections, values, 'Completed'), []);
});

test('workspace activity filter returns module changes for the chosen date newest first', () => {
  const changes = [
    { date: '2026-10-14', at: '2026-10-14T08:00:00Z', section: 'module:accounting', field: 'module.a1.note' },
    { date: '2026-10-14', at: '2026-10-14T10:00:00Z', section: 'module:stock', field: 'module.s1.status' },
    { date: '2026-10-14', at: '2026-10-14T11:00:00Z', section: 'overview', field: 'project.version' },
    { date: '2026-10-13', at: '2026-10-13T12:00:00Z', section: 'module:stock', field: 'module.s2.note' },
  ];
  assert.deepEqual(filterModuleChangesByDate(changes, '2026-10-14').map(item => item.field), ['module.s1.status', 'module.a1.note']);
  assert.deepEqual(filterModuleChangesByDate(changes, ''), []);
});

test('client report keeps useful completed data and removes empty or out-of-scope content', () => {
  const reportCatalog = {
    sections: [{ id: 'company', title: 'Company', checklist: false, questions: [{ id: 'company.1', text: 'Business?' }, { id: 'company.2', text: 'Empty?' }] }],
    moduleSections: [{ id: 'stock', title: 'Stock', items: [{ id: 'stock.1', text: 'Items' }, { id: 'stock.2', text: 'Unused' }] }],
  };
  const report = buildClientReportSnapshot({
    answers: { 'company.1': 'Retail', 'company.2': '' },
    users: [{ id: 'u1', name: 'Maria', position: 'Accounts' }],
    requirements: [{ id: 'R01', topic: 'Approve setup', owner: 'Client', status: 'Open' }, { id: 'R02', topic: '', owner: '', status: 'Open' }],
    moduleData: {
      'stock.1': { checked: true, status: 'In Progress', users: ['u1'], note: 'Configured', action: 'Approve' },
      'stock.2': { checked: false, status: 'Completed', note: 'Internal' },
    },
  }, reportCatalog);
  assert.equal(report.selectedModuleCount, 1);
  assert.deepEqual(report.statusCounts, { 'Needs Training': 0, 'In Progress': 1, Completed: 0 });
  assert.equal(report.moduleSections[0].items[0].attendees[0], 'Maria');
  assert.equal(report.moduleSections[0].items.some(item => item.id === 'stock.2'), false);
  assert.equal(report.discoverySections[0].items.length, 1);
  assert.equal(report.requirements.length, 1);
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
