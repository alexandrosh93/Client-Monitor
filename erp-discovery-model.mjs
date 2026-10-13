const MAX_TEXT = 20000;
const MAX_COLLECTION = 1000;

function text(value, max = MAX_TEXT) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value, max = MAX_COLLECTION) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function cleanTextMap(value) {
  const output = {};
  for (const [key, item] of Object.entries(record(value)).slice(0, MAX_COLLECTION)) {
    if (!/^[a-z0-9_.-]{1,80}$/i.test(key)) continue;
    output[key] = text(item);
  }
  return output;
}

function cleanFieldChanges(value) {
  const output = {};
  for (const [key, item] of Object.entries(record(value)).slice(0, MAX_COLLECTION)) {
    if (!/^[a-z0-9_.-]{1,80}$/i.test(key)) continue;
    if (typeof item === 'boolean' || typeof item === 'number') output[key] = item;
    else output[key] = text(item, 2000);
  }
  return output;
}

export function blankProjectDocument() {
  return {
    clientEmail: '',
    answers: {},
    checks: {},
    notes: {},
    users: [],
    trainingRoles: [],
    requirements: [],
    migrationExtra: { history: '', source: '', freeze: '' },
    moduleData: {},
    trainingStages: {},
    changeHistory: [],
    fieldChanges: {},
  };
}

export function normalizeProjectDocument(raw) {
  const input = record(raw);
  const base = blankProjectDocument();
  const moduleData = {};
  for (const [key, item] of Object.entries(record(input.moduleData)).slice(0, MAX_COLLECTION)) {
    if (!/^[a-z0-9_.-]{1,80}$/i.test(key)) continue;
    const value = record(item);
    moduleData[key] = {
      checked: Boolean(value.checked),
      status: text(value.status, 40),
      note: text(value.note),
      action: text(value.action),
      date: text(value.date, 20),
      phase: text(value.phase, 80),
      users: list(value.users, 100).map(v => text(v, 100)).filter(Boolean),
    };
  }

  const trainingStages = {};
  for (const [key, item] of Object.entries(record(input.trainingStages)).slice(0, MAX_COLLECTION)) {
    if (!/^[a-z0-9_.-]{1,80}$/i.test(key)) continue;
    const value = record(item);
    trainingStages[key] = {
      status: text(value.status, 40) || (input.checks?.[key] ? 'Completed' : 'Not started'),
      plannedDate: text(value.plannedDate, 20),
      completedDate: text(value.completedDate, 20),
      trainer: text(value.trainer, 160),
      participants: text(value.participants, 1000),
      notes: text(value.notes ?? input.notes?.[key]),
      nextAction: text(value.nextAction),
    };
  }

  return {
    ...base,
    clientEmail: text(input.clientEmail, 320).trim(),
    answers: cleanTextMap(input.answers),
    checks: Object.fromEntries(Object.entries(record(input.checks)).slice(0, MAX_COLLECTION).filter(([key]) => /^[a-z0-9_.-]{1,80}$/i.test(key)).map(([key, value]) => [key, Boolean(value)])),
    notes: cleanTextMap(input.notes),
    users: list(input.users, 250).map((item, index) => {
      const value = record(item);
      return { id: text(value.id, 100) || `user-${index + 1}`, name: text(value.name, 300), position: text(value.position, 300) };
    }),
    trainingRoles: list(input.trainingRoles, 250).map(item => {
      const value = record(item);
      return { role: text(value.role, 300), tasks: text(value.tasks), level: text(value.level, 100), training: text(value.training), superUser: text(value.superUser, 20) || 'No' };
    }),
    requirements: list(input.requirements, 500).map((item, index) => {
      const value = record(item);
      return {
        id: text(value.id, 80) || `R${String(index + 1).padStart(2, '0')}`,
        topic: text(value.topic), type: text(value.type, 80) || 'Process', priority: text(value.priority, 40) || 'Medium',
        owner: text(value.owner, 300), status: text(value.status, 80) || 'Open', date: text(value.date, 20), phase: text(value.phase, 80) || 'During Implementation',
      };
    }),
    migrationExtra: {
      history: text(input.migrationExtra?.history, 500),
      source: text(input.migrationExtra?.source),
      freeze: text(input.migrationExtra?.freeze, 20),
    },
    moduleData,
    trainingStages,
    changeHistory: list(input.changeHistory, 500).map(item => {
      const value = record(item);
      return {
        date: text(value.date, 20),
        savedAt: text(value.savedAt, 100),
        phase: text(value.phase, 80),
        consultant: text(value.consultant, 300),
        progress: Number.isFinite(Number(value.progress)) ? Math.max(0, Math.min(100, Number(value.progress))) : undefined,
        trainingProgress: Number.isFinite(Number(value.trainingProgress)) ? Math.max(0, Math.min(100, Number(value.trainingProgress))) : undefined,
        user: text(value.user, 300),
      };
    }),
    fieldChanges: cleanFieldChanges(input.fieldChanges),
  };
}

export function normalizeClientEmail(value) {
  const email = text(value, 320).trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email) ? email : '';
}

export function validateErpDiscoveryImport(raw) {
  const input = record(raw);
  const meta = record(input.meta);
  const hasKnownData = ['answers', 'checks', 'notes', 'moduleData', 'trainingRoles', 'requirements'].some(key => key in input);
  if (!hasKnownData) throw new Error('This is not a valid ERP Discovery project.');
  return {
    sourceProjectId: text(input.projectId, 160),
    projectName: text(meta.project, 200) || 'ERP Implementation',
    companyName: text(meta.company, 300),
    consultant: text(meta.consultant, 300),
    phase: text(meta.phase, 80) || 'During Implementation',
    version: text(meta.version, 40) || '1.0',
    lastSaved: text(meta.lastSaved, 100),
    document: normalizeProjectDocument(input),
  };
}

export function computeProjectProgress(document, catalog) {
  const doc = normalizeProjectDocument(document);
  let total = 0;
  let complete = 0;
  for (const section of catalog.sections || []) {
    for (const item of section.questions || []) {
      total += 1;
      if (section.checklist ? doc.checks[item.id] : Boolean(doc.answers[item.id]?.trim())) complete += 1;
    }
  }
  for (const section of catalog.moduleSections || []) {
    for (const item of section.items || []) {
      total += 1;
      const value = doc.moduleData[item.id] || {};
      if (value.checked || value.status === 'Completed' || value.note?.trim() || value.action?.trim()) complete += 1;
    }
  }
  return { total, complete, percent: total ? Math.round((complete / total) * 100) : 0 };
}

export function computeTrainingProgress(document, catalog) {
  const doc = normalizeProjectDocument(document);
  const section = (catalog.sections || []).find(item => item.id === 'training');
  const items = section?.questions || [];
  const completed = items.filter(item => doc.trainingStages[item.id]?.status === 'Completed' || doc.checks[item.id]).length;
  return { total: items.length, complete: completed, percent: items.length ? Math.round((completed / items.length) * 100) : 0 };
}
