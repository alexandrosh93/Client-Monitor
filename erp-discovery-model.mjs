const MAX_TEXT = 20000;
const MAX_COLLECTION = 1000;

export const MODULE_STATUSES = ['Needs Training', 'In Progress', 'Completed'];

export function normalizeModuleStatus(value) {
  const status = text(value, 40).trim().toLowerCase();
  if (status === 'completed') return 'Completed';
  if (status === 'in progress') return 'In Progress';
  if (status === 'needs training') return 'Needs Training';
  return 'Needs Training';
}

export function filterModuleItems(items, moduleData, filter = '') {
  const source = Array.isArray(items) ? items : [];
  if (!filter) return source;
  const values = record(moduleData);
  if (filter === 'selected') return source.filter(item => Boolean(values[item?.id]?.checked));
  if (MODULE_STATUSES.includes(filter)) {
    return source.filter(item => Boolean(values[item?.id]?.checked) && normalizeModuleStatus(values[item?.id]?.status) === filter);
  }
  return source;
}

export function collectModuleItemsByStatus(moduleSections, moduleData, filter = '') {
  const values = record(moduleData);
  return (Array.isArray(moduleSections) ? moduleSections : []).flatMap(section =>
    (Array.isArray(section?.items) ? section.items : [])
      .filter(item => {
        const value = values[item?.id];
        if (!value?.checked) return false;
        return !filter || normalizeModuleStatus(value.status) === filter;
      })
      .map(item => ({
        id: item.id,
        text: item.text,
        sectionId: section.id,
        sectionTitle: section.title,
        group: section.group,
        status: normalizeModuleStatus(values[item.id]?.status),
        date: text(values[item.id]?.date, 20),
        note: text(values[item.id]?.note),
        action: text(values[item.id]?.action),
      })),
  );
}

export function filterModuleChangesByDate(changeLog, date) {
  const selectedDate = text(date, 20);
  if (!selectedDate) return [];
  return (Array.isArray(changeLog) ? changeLog : [])
    .filter(item => item?.date === selectedDate && String(item?.section || '').startsWith('module:'))
    .slice()
    .sort((a, b) => String(b?.at || '').localeCompare(String(a?.at || '')));
}

export function buildClientReportSnapshot(document, catalog) {
  const doc = normalizeProjectDocument(document);
  const userNames = new Map(doc.users.map(user => [user.id, user.name || user.id]));
  const moduleSections = (Array.isArray(catalog?.moduleSections) ? catalog.moduleSections : []).map(section => ({
    id: section.id,
    title: text(section.title, 300),
    items: (Array.isArray(section.items) ? section.items : []).filter(item => doc.moduleData[item.id]?.checked).map(item => {
      const value = doc.moduleData[item.id];
      return {
        id: item.id,
        text: text(item.text, 500),
        status: normalizeModuleStatus(value.status),
        date: value.date,
        attendees: value.users.map(id => userNames.get(id) || id).filter(Boolean),
        note: value.note,
        action: value.action,
      };
    }),
  })).filter(section => section.items.length);
  const requirements = doc.requirements.filter(item => item.topic || item.owner).map(item => ({ ...item }));
  const statusCounts = Object.fromEntries(MODULE_STATUSES.map(status => [status, moduleSections.flatMap(section => section.items).filter(item => item.status === status).length]));
  return {
    users: doc.users.filter(user => user.name),
    requirements,
    moduleSections,
    statusCounts,
    selectedModuleCount: moduleSections.reduce((total, section) => total + section.items.length, 0),
  };
}

export function buildClientJobReportItems(document, catalog, selectedIds) {
  const doc = normalizeProjectDocument(document);
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds.map(id => text(id, 80)) : []);
  return (Array.isArray(catalog?.moduleSections) ? catalog.moduleSections : []).map(section => ({
    id: text(section.id, 80),
    title: text(section.title, 300),
    items: (Array.isArray(section.items) ? section.items : [])
      .filter(item => selected.has(item.id) && doc.moduleData[item.id]?.checked)
      .map(item => ({ id: text(item.id, 80), text: text(item.text, 500) })),
  })).filter(section => section.items.length);
}

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
    changeLog: [],
    jobReports: [],
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
      status: normalizeModuleStatus(value.status),
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
    changeLog: list(input.changeLog, 2000).map(item => {
      const value = record(item);
      return {
        date: text(value.date, 20), at: text(value.at, 100), section: text(value.section, 100),
        field: text(value.field, 160), label: text(value.label, 500), value: text(value.value, 2000), user: text(value.user, 300),
      };
    }).filter(item => item.date && item.field),
    jobReports: list(input.jobReports, 500).map(item => {
      const value = record(item);
      return {
        id: text(value.id, 100), date: text(value.date, 20), generalComment: text(value.generalComment),
        clientRepresentative: text(value.clientRepresentative, 300), consultant: text(value.consultant, 300),
        createdAt: text(value.createdAt, 100), createdBy: text(value.createdBy, 300),
        items: list(value.items, 500).map(reportItem => {
          const detail = record(reportItem);
          return { id: text(detail.id, 80), module: text(detail.module, 300), screen: text(detail.screen, 500), comment: text(detail.comment, 2000) };
        }).filter(reportItem => reportItem.id && reportItem.screen),
      };
    }).filter(item => item.id && item.date && item.items.length),
    fieldChanges: cleanFieldChanges(input.fieldChanges),
  };
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
      const value = doc.moduleData[item.id] || {};
      if (!value.checked) continue;
      total += 1;
      if (value.status === 'Completed') complete += 1;
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
