import { ERP_DISCOVERY_CATALOG as catalog } from './erp-discovery-catalog.mjs';
import { blankProjectDocument, computeProjectProgress, normalizeProjectDocument } from './erp-discovery-model.mjs';

const MODULE_STATUSES = ['Not started', 'Needs setup', 'Needs training', 'In progress', 'Completed', 'Not applicable'];
const PHASES = ['During Implementation', 'During Support'];
const root = document.getElementById('client-workspace');

let client = null;
let project = null;
let documentState = blankProjectDocument();
let activeSection = 'overview';
let dirty = false;
let databaseReady = true;
let databaseError = '';
let saveTimer = null;
let saveInFlight = false;
let saveQueued = false;
let changeVersion = 0;
let expandedNavGroup = 'workspace';

const api = () => window.clientMonitorApi;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const attr = esc;
const options = (items, selected) => items.map(item => `<option${item === selected ? ' selected' : ''}>${esc(item)}</option>`).join('');

function setDirty(value = true) {
  dirty = value;
  if (value) changeVersion += 1;
  const label = root.querySelector('.erp-save-state');
  if (label) label.innerHTML = value ? '<span class="erp-dirty-dot"></span>Autosave pending…' : `Saved automatically${project?.updated_at ? ` · ${esc(new Date(project.updated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}` : ''}`;
  if (value) scheduleAutosave();
}

function scheduleAutosave(delay = 800) {
  clearTimeout(saveTimer);
  if (!project || !dirty) return;
  saveTimer = setTimeout(() => saveProject(), delay);
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
  const discovery = [];
  for (const section of catalog.sections) {
    if (section.id === 'training') discovery.push({ id: 'training-roles', title: section.title });
    else discovery.push({ id: section.id, title: section.title });
    if (section.id === 'scenarios') discovery.push({ id: 'requirements', title: '11. Requirements / Decisions Log' });
  }
  return [
    { id: 'workspace', title: 'Workspace', items: [{ id: 'overview', title: 'Overview' }, { id: 'users', title: 'Client Users' }] },
    { id: 'discovery', title: 'Discovery & Readiness', items: discovery },
    { id: 'accounting', title: 'Accounting Modules', items: catalog.moduleSections.filter(section => section.group === 'accounting').map(section => ({ id: `module:${section.id}`, title: section.title })) },
    { id: 'stock', title: 'Stock Modules', items: catalog.moduleSections.filter(section => section.group === 'stock').map(section => ({ id: `module:${section.id}`, title: section.title })) },
  ];
}

function renderShell() {
  if (!client) return;
  const moduleBadges = (client.modules || []).map(item => `<span class="erp-badge">${esc(item)}</span>`).join('');
  const nav = sectionGroups().map(group => {
    const open = expandedNavGroup === group.id;
    const hasActive = group.items.some(item => item.id === activeSection);
    return `<section class="erp-nav-section${hasActive ? ' has-active' : ''}">
      <button class="erp-nav-group" data-erp-group="${attr(group.id)}" aria-expanded="${open}">
        <span>${esc(group.title)}</span><span class="erp-nav-count">${group.items.length}</span><span class="erp-nav-chevron">›</span>
      </button>
      <div class="erp-nav-items" data-erp-group-items="${attr(group.id)}"${open ? '' : ' hidden'}>
        ${group.items.map(item => `<button class="erp-nav${activeSection === item.id ? ' active' : ''}" data-erp-nav="${attr(item.id)}" data-erp-nav-group="${attr(group.id)}">${esc(item.title)}</button>`).join('')}
      </div>
    </section>`;
  }).join('');
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
        <button class="erp-btn on-dark" data-project-print ${project ? '' : 'disabled'}>Print / PDF</button>
        <span class="erp-save-state">${dirty ? '<span class="erp-dirty-dot"></span>Autosave pending…' : `Saved automatically${project?.updated_at ? ` · ${esc(new Date(project.updated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}` : ''}`}</span>
      </div>
    </section>
    <aside class="erp-side">${nav}</aside>
    <section class="erp-main"></section>
  </div>`;
  bindShell();
  renderMain();
}

function renderNoProject() {
  const setup = databaseReady ? '' : `<div class="erp-error">The ERP workspace could not be loaded.${databaseError ? `<div class="erp-muted" style="margin-top:6px">${esc(databaseError)}</div>` : ''}</div>`;
  return `${setup}<div class="erp-empty"><h3>Preparing this client workspace…</h3><p>Each client automatically has one ERP project.</p></div>`;
}

function renderOverview() {
  const discovery = computeProjectProgress(documentState, catalog);
  const openRequirements = documentState.requirements.filter(item => !['Done', 'Accepted'].includes(item.status)).length;
  return `<div class="erp-card">
    <h2>${esc(project.name)}</h2><div class="erp-muted">Project details are stored against ${esc(client.name)}. The client record remains the single source for company information.</div>
    <div class="erp-fields" style="margin-top:14px">
      <div class="erp-field"><label>Consultant</label><input class="erp-input" data-project-field="consultant" value="${attr(project.consultant || client.implementor || '')}"></div>
      <div class="erp-field"><label>Work phase</label><select class="erp-select" data-project-field="phase">${options(PHASES, project.phase || PHASES[0])}</select></div>
      <div class="erp-field"><label>Version</label><input class="erp-input" data-project-field="version" value="${attr(project.version || '1.0')}"></div>
      <div class="erp-field"><label>Implementation progress</label><input class="erp-input" value="${Number(client.progress || 0)}%" disabled></div>
      <div class="erp-field"><label>Live date</label><input class="erp-input" value="${attr(client.liveDate || 'Not set')}" disabled></div>
    </div>
  </div>
  <div class="erp-grid erp-grid-two">
    <div class="erp-stat"><strong>${discovery.percent}%</strong><span>Discovery completion</span><div class="erp-progress"><span style="width:${discovery.percent}%"></span></div><div class="erp-muted" style="margin-top:6px">${discovery.complete} of ${discovery.total} items</div></div>
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

function renderUsers() {
  return `<div class="erp-card"><div class="erp-actions"><div><h2>Client Users</h2><div class="erp-muted">People involved in discovery, implementation or training.</div></div><button class="erp-btn primary" data-add-user>+ Add user</button></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>Name</th><th>Position / Department</th><th></th></tr></thead><tbody>${documentState.users.map((item, index) => `<tr><td><input data-user-index="${index}" data-user-field="name" value="${attr(item.name)}"></td><td><input data-user-index="${index}" data-user-field="position" value="${attr(item.position)}"></td><td><button class="erp-btn danger" data-remove-user="${index}">Remove</button></td></tr>`).join('')}</tbody></table></div>${documentState.users.length ? '' : '<div class="erp-empty">No users recorded.</div>'}</div>`;
}

function renderTrainingRoles() {
  return `<div class="erp-card"><div class="erp-actions"><div><h2>9. Training Topics ανά Ρόλο</h2><div class="erp-muted">Plan training by role and actual work.</div></div><button class="erp-btn primary" data-add-role>+ Add role</button></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>Role / Department</th><th>Main tasks</th><th>Level</th><th>Training needs</th><th>Super user</th><th></th></tr></thead><tbody>${documentState.trainingRoles.map((item, index) => `<tr><td><input data-role-index="${index}" data-role-field="role" value="${attr(item.role)}"></td><td><textarea data-role-index="${index}" data-role-field="tasks">${esc(item.tasks)}</textarea></td><td><select data-role-index="${index}" data-role-field="level">${options(['1 - Beginner','2 - Basic User','3 - Experienced User','4 - Super User','5 - Administrator'], item.level)}</select></td><td><textarea data-role-index="${index}" data-role-field="training">${esc(item.training)}</textarea></td><td><select data-role-index="${index}" data-role-field="superUser">${options(['No','Yes'], item.superUser)}</select></td><td><button class="erp-btn danger" data-remove-role="${index}">Remove</button></td></tr>`).join('')}</tbody></table></div>${documentState.trainingRoles.length ? '' : '<div class="erp-empty">No training roles recorded.</div>'}</div>`;
}

function renderRequirements() {
  const types = ['Process', 'Setup', 'Dev', 'Migration', 'Training'];
  const priorities = ['Low', 'Medium', 'High', 'Critical'];
  const statuses = ['Open', 'In Progress', 'Decision Required', 'Done', 'Accepted'];
  return `<div class="erp-card"><div class="erp-actions"><div><h2>11. Requirements / Decisions Log</h2><div class="erp-muted">Track actions, decisions and training requirements for this project.</div></div><button class="erp-btn primary" data-add-requirement>+ Add requirement</button></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>ID</th><th>Topic</th><th>Type</th><th>Priority</th><th>Owner</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>${documentState.requirements.map((item, index) => `<tr><td><input data-req-index="${index}" data-req-field="id" value="${attr(item.id)}"></td><td><textarea data-req-index="${index}" data-req-field="topic">${esc(item.topic)}</textarea></td><td><select data-req-index="${index}" data-req-field="type">${options(types, item.type)}</select></td><td><select data-req-index="${index}" data-req-field="priority">${options(priorities, item.priority)}</select></td><td><input data-req-index="${index}" data-req-field="owner" value="${attr(item.owner)}"></td><td><select data-req-index="${index}" data-req-field="status">${options(statuses, item.status)}</select></td><td><input type="date" data-req-index="${index}" data-req-field="date" value="${attr(item.date)}"></td><td><button class="erp-btn danger" data-remove-requirement="${index}">Remove</button></td></tr>`).join('')}</tbody></table></div>${documentState.requirements.length ? '' : '<div class="erp-empty">No requirements recorded.</div>'}</div>`;
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
  else if (activeSection.startsWith('module:')) container.innerHTML = renderModule(catalog.moduleSections.find(item => item.id === activeSection.slice(7)));
  else container.innerHTML = renderQuestions(catalog.sections.find(item => item.id === activeSection));
  bindContent();
}

function ensureModule(key) {
  if (!documentState.moduleData[key]) documentState.moduleData[key] = { checked: false, status: 'Not started', note: '', action: '', date: '', phase: project.phase || PHASES[0], users: [] };
  return documentState.moduleData[key];
}

function bindInputs(selector, callback) {
  const container = root.querySelector('.erp-main') || root;
  container.querySelectorAll(selector).forEach(element => element.addEventListener('input', () => { callback(element); setDirty(); }));
}

function bindContent() {
  const container = root.querySelector('.erp-main') || root;
  bindInputs('[data-project-field]', element => { project[element.dataset.projectField] = element.value; });
  bindInputs('[data-answer]', element => { documentState.answers[element.dataset.answer] = element.value; });
  bindInputs('[data-note]', element => { documentState.notes[element.dataset.note] = element.value; });
  container.querySelectorAll('[data-check]').forEach(element => element.addEventListener('change', () => { documentState.checks[element.dataset.check] = element.checked; setDirty(); }));
  bindInputs('[data-migration]', element => { documentState.migrationExtra[element.dataset.migration] = element.value; });
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
  root.querySelectorAll('[data-erp-group]').forEach(button => button.addEventListener('click', () => {
    expandedNavGroup = expandedNavGroup === button.dataset.erpGroup ? '' : button.dataset.erpGroup;
    root.querySelectorAll('[data-erp-group]').forEach(groupButton => groupButton.setAttribute('aria-expanded', String(groupButton.dataset.erpGroup === expandedNavGroup)));
    root.querySelectorAll('[data-erp-group-items]').forEach(items => { items.hidden = items.dataset.erpGroupItems !== expandedNavGroup; });
  }));
  root.querySelectorAll('[data-erp-nav]').forEach(button => button.addEventListener('click', () => { activeSection = button.dataset.erpNav; expandedNavGroup = button.dataset.erpNavGroup; renderShell(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  root.querySelector('[data-project-print]')?.addEventListener('click', () => window.print());
}

async function loadProject() {
  databaseReady = true;
  databaseError = '';
  const { data, error } = await api().getSupabase().from('client_projects').select('*').eq('client_id', client.id).order('updated_at', { ascending: false });
  if (error) {
    console.error('ERP projects load error:', error);
    databaseReady = false;
    databaseError = error.message || 'Could not load ERP projects.';
    project = null; documentState = blankProjectDocument(); renderShell(); return;
  }
  project = data?.[0] || null;
  if (!project) {
    await createProject();
    return;
  }
  documentState = normalizeProjectDocument(project.document);
  activeSection = 'overview'; dirty = false; changeVersion = 0; renderShell();
}

async function createProject() {
  if (!databaseReady) return;
  const payload = { client_id: client.id, name: `${client.name} ERP Project`.slice(0, 150), consultant: client.implementor || '', phase: 'During Implementation', version: '1.0', document: blankProjectDocument(), created_by: api().getCurrentUser(), updated_by: api().getCurrentUser() };
  const { data, error } = await api().getSupabase().from('client_projects').insert(payload).select('*').single();
  if (error) {
    if (error.code === '23505') { await loadProject(); return; }
    databaseReady = false; databaseError = error.message || 'Could not prepare this client workspace.'; renderShell(); return;
  }
  project = data; documentState = blankProjectDocument(); dirty = false; changeVersion = 0;
  await api().getSupabase().from('client_project_history').insert({ project_id: data.id, action: 'Created', user_name: api().getCurrentUser(), detail: { source: 'Client Monitor' } });
  api().audit('ERP Project', client.name, `Created ${data.name}`);
  renderShell();
}

async function saveProject() {
  clearTimeout(saveTimer);
  if (!project || !dirty) return true;
  if (saveInFlight) { saveQueued = true; return true; }
  saveInFlight = true;
  const saveLabel = root.querySelector('.erp-save-state');
  if (saveLabel) saveLabel.innerHTML = '<span class="erp-dirty-dot"></span>Saving…';
  const savingVersion = changeVersion;
  const savingProject = { ...project };
  const savingClient = { ...client };
  const savingDocument = normalizeProjectDocument(documentState);
  const progress = computeProjectProgress(savingDocument, catalog);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const historyItem = { date: today, savedAt: now.toISOString(), phase: savingProject.phase, consultant: savingProject.consultant, progress: progress.percent, user: api().getCurrentUser() };
  const lastHistory = savingDocument.changeHistory.at(-1);
  if (lastHistory?.date === today) savingDocument.changeHistory[savingDocument.changeHistory.length - 1] = historyItem;
  else savingDocument.changeHistory.push(historyItem);
  const payload = { name: `${savingClient.name} ERP Project`.slice(0, 150), consultant: savingProject.consultant || '', phase: savingProject.phase || PHASES[0], version: savingProject.version || '1.0', document: savingDocument, updated_by: api().getCurrentUser(), updated_at: now.toISOString() };
  let query = api().getSupabase().from('client_projects').update(payload).eq('id', savingProject.id);
  if (savingProject.updated_at) query = query.eq('updated_at', savingProject.updated_at);
  const { data, error } = await query.select('*');
  saveInFlight = false;
  if (error) {
    if (saveLabel) saveLabel.innerHTML = '<span class="erp-dirty-dot"></span>Autosave failed · retrying…';
    api().toast(`Autosave failed: ${error.message}`);
    scheduleAutosave(2500);
    return false;
  }
  if (!data?.length) {
    if (saveLabel) saveLabel.innerHTML = '<span class="erp-dirty-dot"></span>Autosave paused · reopen workspace';
    api().toast('Autosave paused because this workspace changed in another window. Reopen it to continue.');
    return false;
  }
  if (project?.id === savingProject.id) {
    project = data[0];
    documentState.changeHistory = savingDocument.changeHistory;
    if (changeVersion === savingVersion) setDirty(false);
    else scheduleAutosave(200);
  }
  if (saveQueued) { saveQueued = false; scheduleAutosave(100); }
  return true;
}

async function backToClients() {
  if (dirty) await saveProject();
  window.closeClientWorkspaceView(); api().goToClient(client.id);
}

window.closeClientWorkspaceView = function closeClientWorkspaceView() {
  if (dirty) saveProject();
  root.classList.remove('active'); root.style.display = 'none';
};

window.openClientWorkspace = async function openClientWorkspace(clientId) {
  const found = api()?.getClients().find(item => Number(item.id) === Number(clientId));
  if (!found) { api()?.toast('Client not found.'); return; }
  client = found; project = null; documentState = blankProjectDocument(); activeSection = 'overview'; expandedNavGroup = 'workspace'; dirty = false; changeVersion = 0;
  hideStandardViews(); root.style.display = 'block'; root.classList.add('active'); root.innerHTML = '<div class="erp-empty">Loading client workspace…</div>'; window.scrollTo({ top: 0 });
  await loadProject();
};

document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) saveProject(); });
