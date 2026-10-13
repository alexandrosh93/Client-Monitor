import { ERP_DISCOVERY_CATALOG as catalog } from './erp-discovery-catalog.mjs';
import { blankProjectDocument, computeProjectProgress, computeTrainingProgress, normalizeProjectDocument, validateErpDiscoveryImport } from './erp-discovery-model.mjs';

const TRAINING_STATUSES = ['Not started', 'Scheduled', 'In progress', 'Waiting for client', 'Completed'];
const MODULE_STATUSES = ['Not started', 'Needs setup', 'Needs training', 'In progress', 'Completed', 'Not applicable'];
const PHASES = ['During Implementation', 'During Support'];
const root = document.getElementById('client-workspace');

let client = null;
let projects = [];
let project = null;
let documentState = blankProjectDocument();
let activeSection = 'overview';
let dirty = false;
let databaseReady = true;
let databaseError = '';

const api = () => window.clientMonitorApi;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const attr = esc;
const options = (items, selected) => items.map(item => `<option${item === selected ? ' selected' : ''}>${esc(item)}</option>`).join('');

function setDirty(value = true) {
  dirty = value;
  const label = root.querySelector('.erp-save-state');
  if (label) label.innerHTML = value ? '<span class="erp-dirty-dot"></span>Unsaved changes' : `Saved${project?.updated_at ? ` · ${esc(new Date(project.updated_at).toLocaleString('en-GB'))}` : ''}`;
}

function hideStandardViews() {
  document.getElementById('home-view')?.classList.remove('active');
  const controls = document.querySelector('.control-bar');
  if (controls) controls.style.display = 'none';
  const list = document.getElementById('list');
  const dashboard = document.getElementById('dashboard');
  if (list) list.style.display = 'none';
  if (dashboard) dashboard.style.display = 'none';
  ['vbtn-home', 'vbtn-list', 'vbtn-dash'].forEach(id => document.getElementById(id)?.classList.remove('active'));
}

function sectionGroups() {
  const normal = catalog.sections.filter(section => !['training'].includes(section.id));
  return [
    { title: 'Workspace', items: [{ id: 'overview', title: 'Overview' }, { id: 'users', title: 'Client Users' }, { id: 'training-roles', title: 'Training Roles' }, { id: 'requirements', title: 'Requirements' }] },
    { title: 'Discovery & Readiness', items: normal.map(section => ({ id: section.id, title: section.title })) },
    { title: 'Training', items: [{ id: 'training', title: 'Training Stages' }] },
    { title: 'Stock Modules', items: catalog.moduleSections.filter(section => section.group === 'stock').map(section => ({ id: `module:${section.id}`, title: section.title })) },
    { title: 'Accounting Modules', items: catalog.moduleSections.filter(section => section.group === 'accounting').map(section => ({ id: `module:${section.id}`, title: section.title })) },
  ];
}

function projectOption(item) {
  const progress = computeProjectProgress(item.document || {}, catalog).percent;
  return `<option value="${attr(item.id)}"${project?.id === item.id ? ' selected' : ''}>${esc(item.name)} · ${progress}%</option>`;
}

function renderShell() {
  if (!client) return;
  const moduleBadges = (client.modules || []).map(item => `<span class="erp-badge">${esc(item)}</span>`).join('');
  const nav = sectionGroups().map(group => `<div class="erp-nav-group">${esc(group.title)}</div>${group.items.map(item => `<button class="erp-nav${activeSection === item.id ? ' active' : ''}" data-erp-nav="${attr(item.id)}">${esc(item.title)}</button>`).join('')}`).join('');
  root.innerHTML = `<div class="erp-shell">
    <section class="erp-top">
      <div class="erp-topline">
        <button class="erp-back" data-erp-back>← All Clients</button>
        <div style="flex:1">
          <div class="erp-kicker">Client workspace · ERP Discovery & Training</div>
          <div class="erp-title">${esc(client.name)}</div>
          <div class="erp-subtitle">${esc(client.contact || 'No main contact')} · ${esc(client.city || 'No city')} · Implementor: ${esc(client.implementor || 'Unassigned')}</div>
          <div class="erp-badges"><span class="erp-badge">${esc(client.status)}</span>${moduleBadges}</div>
        </div>
      </div>
      <div class="erp-projectbar">
        <select data-project-select ${!projects.length ? 'disabled' : ''}>${projects.length ? projects.map(projectOption).join('') : '<option>No ERP projects yet</option>'}</select>
        <button class="erp-btn on-dark" data-project-new>+ New project</button>
        <button class="erp-btn on-dark" data-project-import>Import .erpdisc</button>
        <button class="erp-btn on-dark" data-project-export ${project ? '' : 'disabled'}>Export</button>
        <button class="erp-btn on-dark" data-project-print ${project ? '' : 'disabled'}>Print / PDF</button>
        <button class="erp-btn primary" data-project-save ${project ? '' : 'disabled'}>Save project</button>
        <span class="erp-save-state">${dirty ? '<span class="erp-dirty-dot"></span>Unsaved changes' : 'Saved'}</span>
        <input class="erp-file" type="file" accept="application/json,.erpdisc" data-project-file>
      </div>
    </section>
    <aside class="erp-side">${nav}</aside>
    <section class="erp-main"></section>
  </div>`;
  bindShell();
  renderMain();
}

function renderNoProject() {
  const setup = databaseReady ? '' : `<div class="erp-error">The ERP project tables are not available yet. Apply 9_client_projects.sql in Supabase, then reopen this workspace.${databaseError ? `<div class="erp-muted" style="margin-top:6px">${esc(databaseError)}</div>` : ''}</div>`;
  return `${setup}<div class="erp-empty"><h3>No ERP project for this client</h3><p>Create a new project or import an existing .erpdisc file.</p><div style="display:flex;gap:8px;justify-content:center"><button class="erp-btn primary" data-project-new>+ New project</button><button class="erp-btn" data-project-import>Import .erpdisc</button></div></div>`;
}

function renderOverview() {
  const discovery = computeProjectProgress(documentState, catalog);
  const training = computeTrainingProgress(documentState, catalog);
  const openRequirements = documentState.requirements.filter(item => !['Done', 'Accepted'].includes(item.status)).length;
  return `<div class="erp-card">
    <h2>${esc(project.name)}</h2><div class="erp-muted">Project details are stored against ${esc(client.name)}. The client record remains the single source for company information.</div>
    <div class="erp-fields" style="margin-top:14px">
      <div class="erp-field"><label>Project name</label><input class="erp-input" data-project-field="name" value="${attr(project.name)}"></div>
      <div class="erp-field"><label>Consultant</label><input class="erp-input" data-project-field="consultant" value="${attr(project.consultant || client.implementor || '')}"></div>
      <div class="erp-field"><label>Work phase</label><select class="erp-select" data-project-field="phase">${options(PHASES, project.phase || PHASES[0])}</select></div>
      <div class="erp-field"><label>Version</label><input class="erp-input" data-project-field="version" value="${attr(project.version || '1.0')}"></div>
      <div class="erp-field"><label>Implementation progress</label><input class="erp-input" value="${Number(client.progress || 0)}%" disabled></div>
      <div class="erp-field"><label>Live date</label><input class="erp-input" value="${attr(client.liveDate || 'Not set')}" disabled></div>
    </div>
  </div>
  <div class="erp-grid">
    <div class="erp-stat"><strong>${discovery.percent}%</strong><span>Discovery completion</span><div class="erp-progress"><span style="width:${discovery.percent}%"></span></div><div class="erp-muted" style="margin-top:6px">${discovery.complete} of ${discovery.total} items</div></div>
    <div class="erp-stat"><strong>${training.percent}%</strong><span>Training completion</span><div class="erp-progress"><span style="width:${training.percent}%"></span></div><div class="erp-muted" style="margin-top:6px">${training.complete} of ${training.total} stages</div></div>
    <div class="erp-stat"><strong>${openRequirements}</strong><span>Open requirements</span><div class="erp-muted" style="margin-top:14px">${documentState.requirements.length} total requirements</div></div>
  </div>
  <div class="erp-card" style="margin-top:12px"><h3>Project history</h3>${documentState.changeHistory.length ? documentState.changeHistory.slice().reverse().slice(0, 12).map(item => `<div class="erp-question"><strong>${esc(item.date || item.savedAt || '')}</strong> · ${esc(item.phase || '')}<div class="erp-muted">${esc(item.consultant || '')}${item.progress !== undefined ? ` · ${esc(item.progress)}%` : ''}</div></div>`).join('') : '<div class="erp-muted">No saved history yet.</div>'}</div>`;
}

function renderQuestions(section) {
  const items = section.questions.map((item, index) => {
    if (section.checklist) {
      return `<div class="erp-question"><label class="erp-checkline"><input type="checkbox" data-check="${attr(item.id)}" ${documentState.checks[item.id] ? 'checked' : ''}><span class="erp-qtext">${index + 1}. ${esc(item.text)}</span></label><textarea class="erp-textarea" data-note="${attr(item.id)}" placeholder="Notes / special requirements…">${esc(documentState.notes[item.id] || '')}</textarea></div>`;
    }
    return `<div class="erp-question"><div class="erp-qtext">${index + 1}. ${esc(item.text)}</div><textarea class="erp-textarea" data-answer="${attr(item.id)}" placeholder="Answer / discovery notes…">${esc(documentState.answers[item.id] || '')}</textarea></div>`;
  }).join('');
  const migration = section.id === 'migration' ? `<div class="erp-card"><h3>Migration details</h3><div class="erp-fields"><div class="erp-field"><label>Historical data decision</label><input class="erp-input" data-migration="history" value="${attr(documentState.migrationExtra.history)}"></div><div class="erp-field"><label>Freeze / final migration date</label><input type="date" class="erp-input" data-migration="freeze" value="${attr(documentState.migrationExtra.freeze)}"></div><div class="erp-field"><label>Data source / owner</label><textarea class="erp-textarea" data-migration="source">${esc(documentState.migrationExtra.source)}</textarea></div></div></div>` : '';
  return `<div class="erp-card"><h2>${esc(section.title)}</h2><div class="erp-muted">${section.checklist ? 'Mark completed items and keep specific notes for each item.' : 'Record the discovery answer for each topic.'}</div>${items}</div>${migration}`;
}

function renderTraining() {
  const section = catalog.sections.find(item => item.id === 'training');
  const stages = section.questions.map((item, index) => {
    const value = documentState.trainingStages[item.id] || { status: documentState.checks[item.id] ? 'Completed' : 'Not started' };
    return `<div class="erp-stage" data-status="${attr(value.status || 'Not started')}">
      <div class="erp-stage-head"><div class="erp-stage-title"><span class="erp-stage-num">${index + 1}</span>${esc(item.text)}</div><select class="erp-select" style="max-width:180px" data-stage-key="${attr(item.id)}" data-stage-field="status">${options(TRAINING_STATUSES, value.status || 'Not started')}</select></div>
      <div class="erp-fields">
        <div class="erp-field"><label>Planned date</label><input type="date" class="erp-input" data-stage-key="${attr(item.id)}" data-stage-field="plannedDate" value="${attr(value.plannedDate || '')}"></div>
        <div class="erp-field"><label>Completed date</label><input type="date" class="erp-input" data-stage-key="${attr(item.id)}" data-stage-field="completedDate" value="${attr(value.completedDate || '')}"></div>
        <div class="erp-field"><label>Trainer</label><input class="erp-input" data-stage-key="${attr(item.id)}" data-stage-field="trainer" value="${attr(value.trainer || project.consultant || client.implementor || '')}"></div>
        <div class="erp-field"><label>Participants</label><input class="erp-input" data-stage-key="${attr(item.id)}" data-stage-field="participants" value="${attr(value.participants || '')}"></div>
        <div class="erp-field"><label>Next action</label><input class="erp-input" data-stage-key="${attr(item.id)}" data-stage-field="nextAction" value="${attr(value.nextAction || '')}"></div>
        <div class="erp-field"><label>Special notes</label><textarea class="erp-textarea" data-stage-key="${attr(item.id)}" data-stage-field="notes">${esc(value.notes || '')}</textarea></div>
      </div>
    </div>`;
  }).join('');
  return `<div class="erp-card"><h2>Training Plan</h2><div class="erp-alert">Training progress is calculated from completed stages and stays separate from the client's implementation progress.</div>${stages}</div>`;
}

function renderUsers() {
  return `<div class="erp-card"><div class="erp-actions"><div><h2>Client Users</h2><div class="erp-muted">People involved in discovery, implementation or training.</div></div><button class="erp-btn primary" data-add-user>+ Add user</button></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>Name</th><th>Position / Department</th><th></th></tr></thead><tbody>${documentState.users.map((item, index) => `<tr><td><input data-user-index="${index}" data-user-field="name" value="${attr(item.name)}"></td><td><input data-user-index="${index}" data-user-field="position" value="${attr(item.position)}"></td><td><button class="erp-btn danger" data-remove-user="${index}">Remove</button></td></tr>`).join('')}</tbody></table></div>${documentState.users.length ? '' : '<div class="erp-empty">No users recorded.</div>'}</div>`;
}

function renderTrainingRoles() {
  return `<div class="erp-card"><div class="erp-actions"><div><h2>Training Roles</h2><div class="erp-muted">Plan training by role and actual work.</div></div><button class="erp-btn primary" data-add-role>+ Add role</button></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>Role / Department</th><th>Main tasks</th><th>Level</th><th>Training needs</th><th>Super user</th><th></th></tr></thead><tbody>${documentState.trainingRoles.map((item, index) => `<tr><td><input data-role-index="${index}" data-role-field="role" value="${attr(item.role)}"></td><td><textarea data-role-index="${index}" data-role-field="tasks">${esc(item.tasks)}</textarea></td><td><select data-role-index="${index}" data-role-field="level">${options(['1 - Beginner','2 - Basic User','3 - Experienced User','4 - Super User','5 - Administrator'], item.level)}</select></td><td><textarea data-role-index="${index}" data-role-field="training">${esc(item.training)}</textarea></td><td><select data-role-index="${index}" data-role-field="superUser">${options(['No','Yes'], item.superUser)}</select></td><td><button class="erp-btn danger" data-remove-role="${index}">Remove</button></td></tr>`).join('')}</tbody></table></div>${documentState.trainingRoles.length ? '' : '<div class="erp-empty">No training roles recorded.</div>'}</div>`;
}

function renderRequirements() {
  const types = ['Process', 'Setup', 'Dev', 'Migration', 'Training'];
  const priorities = ['Low', 'Medium', 'High', 'Critical'];
  const statuses = ['Open', 'In Progress', 'Decision Required', 'Done', 'Accepted'];
  return `<div class="erp-card"><div class="erp-actions"><div><h2>Requirements / Decisions</h2><div class="erp-muted">Track actions, decisions and training requirements for this project.</div></div><button class="erp-btn primary" data-add-requirement>+ Add requirement</button></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>ID</th><th>Topic</th><th>Type</th><th>Priority</th><th>Owner</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>${documentState.requirements.map((item, index) => `<tr><td><input data-req-index="${index}" data-req-field="id" value="${attr(item.id)}"></td><td><textarea data-req-index="${index}" data-req-field="topic">${esc(item.topic)}</textarea></td><td><select data-req-index="${index}" data-req-field="type">${options(types, item.type)}</select></td><td><select data-req-index="${index}" data-req-field="priority">${options(priorities, item.priority)}</select></td><td><input data-req-index="${index}" data-req-field="owner" value="${attr(item.owner)}"></td><td><select data-req-index="${index}" data-req-field="status">${options(statuses, item.status)}</select></td><td><input type="date" data-req-index="${index}" data-req-field="date" value="${attr(item.date)}"></td><td><button class="erp-btn danger" data-remove-requirement="${index}">Remove</button></td></tr>`).join('')}</tbody></table></div>${documentState.requirements.length ? '' : '<div class="erp-empty">No requirements recorded.</div>'}</div>`;
}

function renderModule(section) {
  const rows = section.items.map(item => {
    const value = documentState.moduleData[item.id] || {};
    return `<div class="erp-module-item"><input type="checkbox" data-module-key="${attr(item.id)}" data-module-field="checked" ${value.checked ? 'checked' : ''}><div class="erp-module-title">${esc(item.text)}</div><div class="erp-field"><label>Status</label><select class="erp-select" data-module-key="${attr(item.id)}" data-module-field="status">${options(MODULE_STATUSES, value.status || (value.checked ? 'Completed' : 'Not started'))}</select><label style="margin-top:7px">Date</label><input type="date" class="erp-input" data-module-key="${attr(item.id)}" data-module-field="date" value="${attr(value.date || '')}"></div><div class="erp-module-wide"><div class="erp-field"><label>Special notes</label><textarea class="erp-textarea" data-module-key="${attr(item.id)}" data-module-field="note">${esc(value.note || '')}</textarea></div><div class="erp-field" style="margin-top:7px"><label>Requirement / next action</label><textarea class="erp-textarea" data-module-key="${attr(item.id)}" data-module-field="action">${esc(value.action || '')}</textarea></div></div></div>`;
  }).join('');
  return `<div class="erp-card"><h2>${esc(section.title)}</h2><div class="erp-muted">${section.items.length} ERP functions · ${esc(section.group)}</div>${rows}</div>`;
}

function renderMain() {
  const container = root.querySelector('.erp-main');
  if (!container) return;
  if (!project) {
    container.innerHTML = renderNoProject();
    bindContent();
    return;
  }
  if (activeSection === 'overview') container.innerHTML = renderOverview();
  else if (activeSection === 'users') container.innerHTML = renderUsers();
  else if (activeSection === 'training-roles') container.innerHTML = renderTrainingRoles();
  else if (activeSection === 'requirements') container.innerHTML = renderRequirements();
  else if (activeSection === 'training') container.innerHTML = renderTraining();
  else if (activeSection.startsWith('module:')) container.innerHTML = renderModule(catalog.moduleSections.find(item => item.id === activeSection.slice(7)));
  else container.innerHTML = renderQuestions(catalog.sections.find(item => item.id === activeSection));
  bindContent();
}

function ensureModule(key) {
  if (!documentState.moduleData[key]) documentState.moduleData[key] = { checked: false, status: 'Not started', note: '', action: '', date: '', phase: project.phase || PHASES[0], users: [] };
  return documentState.moduleData[key];
}

function ensureStage(key) {
  if (!documentState.trainingStages[key]) documentState.trainingStages[key] = { status: 'Not started', plannedDate: '', completedDate: '', trainer: project.consultant || client.implementor || '', participants: '', notes: '', nextAction: '' };
  return documentState.trainingStages[key];
}

function bindInputs(selector, callback) {
  const container = root.querySelector('.erp-main') || root;
  container.querySelectorAll(selector).forEach(element => element.addEventListener('input', () => { callback(element); setDirty(); }));
}

function bindContent() {
  const container = root.querySelector('.erp-main') || root;
  container.querySelectorAll('[data-project-new]').forEach(button => button.addEventListener('click', createProject));
  container.querySelectorAll('[data-project-import]').forEach(button => button.addEventListener('click', () => root.querySelector('[data-project-file]')?.click()));
  bindInputs('[data-project-field]', element => { project[element.dataset.projectField] = element.value; });
  bindInputs('[data-answer]', element => { documentState.answers[element.dataset.answer] = element.value; });
  bindInputs('[data-note]', element => { documentState.notes[element.dataset.note] = element.value; });
  container.querySelectorAll('[data-check]').forEach(element => element.addEventListener('change', () => { documentState.checks[element.dataset.check] = element.checked; setDirty(); }));
  bindInputs('[data-migration]', element => { documentState.migrationExtra[element.dataset.migration] = element.value; });
  bindInputs('[data-stage-key]', element => {
    const stage = ensureStage(element.dataset.stageKey); stage[element.dataset.stageField] = element.value;
    if (element.dataset.stageField === 'status') documentState.checks[element.dataset.stageKey] = element.value === 'Completed';
  });
  container.querySelectorAll('[data-module-key]').forEach(element => element.addEventListener(element.type === 'checkbox' ? 'change' : 'input', () => {
    const item = ensureModule(element.dataset.moduleKey); item[element.dataset.moduleField] = element.type === 'checkbox' ? element.checked : element.value; setDirty();
  }));
  bindInputs('[data-user-index]', element => { documentState.users[Number(element.dataset.userIndex)][element.dataset.userField] = element.value; });
  bindInputs('[data-role-index]', element => { documentState.trainingRoles[Number(element.dataset.roleIndex)][element.dataset.roleField] = element.value; });
  bindInputs('[data-req-index]', element => { documentState.requirements[Number(element.dataset.reqIndex)][element.dataset.reqField] = element.value; });
  container.querySelector('[data-add-user]')?.addEventListener('click', () => { documentState.users.push({ id: crypto.randomUUID(), name: '', position: '' }); setDirty(); renderMain(); });
  container.querySelectorAll('[data-remove-user]').forEach(button => button.addEventListener('click', () => { documentState.users.splice(Number(button.dataset.removeUser), 1); setDirty(); renderMain(); }));
  container.querySelector('[data-add-role]')?.addEventListener('click', () => { documentState.trainingRoles.push({ role: '', tasks: '', level: '2 - Basic User', training: '', superUser: 'No' }); setDirty(); renderMain(); });
  container.querySelectorAll('[data-remove-role]').forEach(button => button.addEventListener('click', () => { documentState.trainingRoles.splice(Number(button.dataset.removeRole), 1); setDirty(); renderMain(); }));
  container.querySelector('[data-add-requirement]')?.addEventListener('click', () => { documentState.requirements.push({ id: `R${String(documentState.requirements.length + 1).padStart(2, '0')}`, topic: '', type: 'Process', priority: 'Medium', owner: '', status: 'Open', date: new Date().toISOString().slice(0, 10), phase: project.phase || PHASES[0] }); setDirty(); renderMain(); });
  container.querySelectorAll('[data-remove-requirement]').forEach(button => button.addEventListener('click', () => { documentState.requirements.splice(Number(button.dataset.removeRequirement), 1); setDirty(); renderMain(); }));
}

function bindShell() {
  root.querySelector('[data-erp-back]')?.addEventListener('click', backToClients);
  root.querySelectorAll('[data-erp-nav]').forEach(button => button.addEventListener('click', () => { activeSection = button.dataset.erpNav; renderShell(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  root.querySelector('[data-project-select]')?.addEventListener('change', event => selectProject(event.target.value));
  root.querySelector('[data-project-new]')?.addEventListener('click', createProject);
  root.querySelector('[data-project-import]')?.addEventListener('click', () => root.querySelector('[data-project-file]')?.click());
  root.querySelector('[data-project-file]')?.addEventListener('change', importProject);
  root.querySelector('[data-project-save]')?.addEventListener('click', saveProject);
  root.querySelector('[data-project-export]')?.addEventListener('click', exportProject);
  root.querySelector('[data-project-print]')?.addEventListener('click', () => window.print());
}

async function loadProjects(preferredId = '') {
  databaseReady = true;
  databaseError = '';
  const { data, error } = await api().getSupabase().from('client_projects').select('*').eq('client_id', client.id).order('updated_at', { ascending: false });
  if (error) {
    console.error('ERP projects load error:', error);
    databaseReady = false;
    databaseError = error.message || 'Could not load ERP projects.';
    projects = []; project = null; documentState = blankProjectDocument(); renderShell(); return;
  }
  projects = data || [];
  project = projects.find(item => item.id === preferredId) || projects[0] || null;
  documentState = project ? normalizeProjectDocument(project.document) : blankProjectDocument();
  activeSection = 'overview'; dirty = false; renderShell();
}

async function createProject() {
  if (!databaseReady) { api().toast('Apply 9_client_projects.sql in Supabase first.'); return; }
  const name = prompt('Project name:', 'ERP Implementation');
  if (!name?.trim()) return;
  const payload = { client_id: client.id, name: name.trim().slice(0, 150), consultant: client.implementor || '', phase: 'During Implementation', version: '1.0', document: blankProjectDocument(), created_by: api().getCurrentUser(), updated_by: api().getCurrentUser() };
  const { data, error } = await api().getSupabase().from('client_projects').insert(payload).select('*').single();
  if (error) { api().toast(`Could not create project: ${error.message}`); return; }
  await api().getSupabase().from('client_project_history').insert({ project_id: data.id, action: 'Created', user_name: api().getCurrentUser(), detail: { source: 'Client Monitor' } });
  api().audit('ERP Project', client.name, `Created ${data.name}`);
  await loadProjects(data.id);
}

function selectProject(id) {
  if (dirty && !confirm('Discard unsaved project changes?')) { renderShell(); return; }
  project = projects.find(item => item.id === id) || null;
  documentState = project ? normalizeProjectDocument(project.document) : blankProjectDocument();
  activeSection = 'overview'; dirty = false; renderShell();
}

async function saveProject() {
  if (!project || !dirty) { if (project) api().toast('Project is already saved.'); return; }
  const progress = computeProjectProgress(documentState, catalog);
  const training = computeTrainingProgress(documentState, catalog);
  const now = new Date();
  documentState.changeHistory.push({ date: now.toISOString().slice(0, 10), savedAt: now.toISOString(), phase: project.phase, consultant: project.consultant, progress: progress.percent, trainingProgress: training.percent, user: api().getCurrentUser() });
  const payload = { name: project.name.trim().slice(0, 150) || 'ERP Implementation', consultant: project.consultant || '', phase: project.phase || PHASES[0], version: project.version || '1.0', document: normalizeProjectDocument(documentState), updated_by: api().getCurrentUser(), updated_at: now.toISOString() };
  let query = api().getSupabase().from('client_projects').update(payload).eq('id', project.id);
  if (project.updated_at) query = query.eq('updated_at', project.updated_at);
  const { data, error } = await query.select('*');
  if (error) { documentState.changeHistory.pop(); api().toast(`Could not save project: ${error.message}`); return; }
  if (!data?.length) { documentState.changeHistory.pop(); alert('This project was updated by another user. Reopen it before saving so their changes are not overwritten.'); return; }
  project = data[0];
  const index = projects.findIndex(item => item.id === project.id); if (index >= 0) projects[index] = project;
  await api().getSupabase().from('client_project_history').insert({ project_id: project.id, action: 'Saved', user_name: api().getCurrentUser(), detail: { discoveryProgress: progress.percent, trainingProgress: training.percent, section: activeSection } });
  api().audit('ERP Project', client.name, `Saved ${project.name} · Discovery ${progress.percent}% · Training ${training.percent}%`);
  setDirty(false); renderShell(); api().toast('ERP project saved.');
}

async function importProject(event) {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { api().toast('ERP Discovery files must be smaller than 5 MB.'); return; }
  try {
    const imported = validateErpDiscoveryImport(JSON.parse(await file.text()));
    const counts = { answers: Object.keys(imported.document.answers).length, modules: Object.keys(imported.document.moduleData).length, requirements: imported.document.requirements.length, users: imported.document.users.length };
    if (!confirm(`Import “${imported.projectName}” into ${client.name}?\n\nSource company: ${imported.companyName || 'Not specified'}\n${counts.answers} answers · ${counts.modules} module items · ${counts.requirements} requirements · ${counts.users} users`)) return;
    if (imported.sourceProjectId && projects.some(item => item.source_project_id === imported.sourceProjectId)) { api().toast('This ERP Discovery project has already been imported for this client.'); return; }
    const payload = { client_id: client.id, source_project_id: imported.sourceProjectId || null, imported_filename: file.name.slice(0, 255), name: imported.projectName, consultant: imported.consultant || client.implementor || '', phase: imported.phase, version: imported.version, document: imported.document, created_by: api().getCurrentUser(), updated_by: api().getCurrentUser() };
    const { data, error } = await api().getSupabase().from('client_projects').insert(payload).select('*').single();
    if (error) throw error;
    await api().getSupabase().from('client_project_history').insert({ project_id: data.id, action: 'Imported', user_name: api().getCurrentUser(), detail: { filename: file.name, sourceProjectId: imported.sourceProjectId || null, counts } });
    api().audit('ERP Project', client.name, `Imported ${file.name} as ${data.name}`);
    await loadProjects(data.id); api().toast('ERP Discovery project imported.');
  } catch (error) { api().toast(`Import failed: ${error.message || 'Invalid ERP Discovery file'}`); }
}

function exportProject() {
  if (!project) return;
  const output = { projectId: project.source_project_id || project.id, meta: { company: client.name, project: project.name, consultant: project.consultant, phase: project.phase, version: project.version, lastSaved: project.updated_at }, ...normalizeProjectDocument(documentState) };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${client.name.replace(/[^a-z0-9]+/gi, '_')}_${project.name.replace(/[^a-z0-9]+/gi, '_')}.erpdisc`; link.click(); URL.revokeObjectURL(link.href);
}

function backToClients() {
  if (dirty && !confirm('Leave this project without saving your changes?')) return;
  window.closeClientWorkspaceView(); api().goToClient(client.id);
}

window.closeClientWorkspaceView = function closeClientWorkspaceView() {
  root.classList.remove('active'); root.style.display = 'none';
};

window.openClientWorkspace = async function openClientWorkspace(clientId) {
  const found = api()?.getClients().find(item => Number(item.id) === Number(clientId));
  if (!found) { api()?.toast('Client not found.'); return; }
  client = found; projects = []; project = null; documentState = blankProjectDocument(); activeSection = 'overview'; dirty = false;
  hideStandardViews(); root.style.display = 'block'; root.classList.add('active'); root.innerHTML = '<div class="erp-empty">Loading client workspace…</div>'; window.scrollTo({ top: 0 });
  await loadProjects();
};
