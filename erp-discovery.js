import { ERP_DISCOVERY_CATALOG as catalog } from './erp-discovery-catalog.mjs';
import { MODULE_STATUSES, blankProjectDocument, computeProjectProgress, normalizeProjectDocument } from './erp-discovery-model.mjs';

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
const expandedModuleItems = new Set();

const api = () => window.clientMonitorApi;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const attr = esc;
const options = (items, selected) => items.map(item => `<option${item === selected ? ' selected' : ''}>${esc(item)}</option>`).join('');
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const questionLabels = new Map(catalog.sections.flatMap(section => section.questions.map(item => [item.id, item.text])));
const moduleLabels = new Map(catalog.moduleSections.flatMap(section => section.items.map(item => [item.id, item.text])));

function reportHeader(title) {
  return [client.name, title, `Consultant: ${project.consultant || client.implementor || 'Unassigned'}`, `Phase: ${project.phase || PHASES[0]}`, `Generated: ${new Date().toLocaleString('en-GB')}`, ''];
}

function moduleReportLine(item, index) {
  const value = documentState.moduleData[item.id] || {};
  const attendees = (value.users || []).map(userId => documentState.users.find(user => user.id === userId)?.name || userId).filter(Boolean);
  return `${index + 1}. ${item.text} | Included in project: ${value.checked ? 'Yes' : 'No'}${value.checked ? ` | Status: ${value.status || 'Needs Training'}` : ''}${value.date ? ` | ${value.date}` : ''}${attendees.length ? ` | Training attendees: ${attendees.join(', ')}` : ''}${value.note ? ` | Notes: ${value.note}` : ''}${value.action ? ` | Next: ${value.action}` : ''}`;
}

function wholeProjectReportText() {
  const progress = computeProjectProgress(documentState, catalog);
  const lines = reportHeader('Whole ERP Project Report');
  lines.push(`Implementation progress: ${Number(client.progress || 0)}%`, `Discovery completion: ${progress.percent}% (${progress.complete}/${progress.total})`, `Live date: ${client.liveDate || 'Not set'}`, '', 'CLIENT USERS');
  documentState.users.forEach((item, index) => lines.push(`${index + 1}. ${item.name || 'Unnamed'} — ${item.position || 'No position'}`));
  for (const section of catalog.sections) {
    lines.push('', section.title.toUpperCase());
    section.questions.forEach((item, index) => {
      if (section.checklist) lines.push(`${index + 1}. ${item.text} | ${documentState.checks[item.id] ? 'Completed' : 'Not completed'}${documentState.notes[item.id] ? ` | Notes: ${documentState.notes[item.id]}` : ''}`);
      else lines.push(`${index + 1}. ${item.text}\n${documentState.answers[item.id] || 'Not answered'}`);
    });
  }
  lines.push('', 'TRAINING TOPICS BY ROLE');
  documentState.trainingRoles.forEach((item, index) => lines.push(`${index + 1}. ${item.role || 'Unnamed role'} | Tasks: ${item.tasks || '-'} | Level: ${item.level || '-'} | Training: ${item.training || '-'} | Super user: ${item.superUser || 'No'}`));
  lines.push('', 'REQUIREMENTS / DECISIONS LOG');
  documentState.requirements.forEach(item => lines.push(`${item.id || '-'} | ${item.topic || 'No topic'} | ${item.type || '-'} | ${item.priority || '-'} | Owner: ${item.owner || '-'} | ${item.status || '-'} | ${item.date || '-'}`));
  for (const section of catalog.moduleSections) {
    lines.push('', section.title.toUpperCase());
    section.items.forEach((item, index) => lines.push(moduleReportLine(item, index)));
  }
  return lines.join('\n');
}

function dateChangesReportText(date) {
  const lines = reportHeader(`Project Changes — ${date || 'No date selected'}`);
  const changes = (documentState.changeLog || []).filter(item => item.date === date);
  if (changes.length) changes.forEach((item, index) => lines.push(`${index + 1}. ${item.label || item.field}: ${item.value || '(empty)'}${item.user ? ` — ${item.user}` : ''}`));
  else lines.push('No detailed changes were recorded for this date.');
  const saved = documentState.changeHistory.filter(item => item.date === date);
  saved.forEach(item => lines.push(`Project saved · ${item.phase || '-'} · ${item.consultant || '-'}${item.progress !== undefined ? ` · ${item.progress}%` : ''}`));
  return lines.join('\n');
}

function mailtoUrl(email, subject, report) {
  const recipient = encodeURIComponent(email).replace(/%40/gi, '@');
  const prefix = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=`;
  const note = '\n\n[Report shortened for email. Use Print / PDF for the complete report.]';
  const original = report;
  let body = report;
  let url = `${prefix}${encodeURIComponent(body)}`;
  while (url.length > 1900 && body.length > 300) {
    body = `${original.slice(0, Math.max(300, Math.floor((body.length - note.length) * 0.72)))}${note}`;
    url = `${prefix}${encodeURIComponent(body)}`;
  }
  return url;
}

function selectedReport(kind) {
  const scope = root.querySelector(`[data-${kind}-scope]`)?.value || 'whole';
  const date = root.querySelector(`[data-${kind}-date]`)?.value || '';
  return scope === 'changes'
    ? { title: `Project Changes — ${date || 'Select date'}`, text: dateChangesReportText(date), dateRequired: !date }
    : { title: 'Whole ERP Project Report', text: wholeProjectReportText(), dateRequired: false };
}

function prepareEmailReport(event) {
  const email = String(client.email || '').trim().toLowerCase();
  if (!email) {
    event.preventDefault();
    api().toast('Add the email on the client card first.');
    window.closeClientWorkspaceView();
    api().goToClient(client.id);
    return;
  }
  const report = selectedReport('email');
  if (report.dateRequired) { event.preventDefault(); api().toast('Select a date for the changes report.'); return; }
  event.currentTarget.href = mailtoUrl(email, `${client.name} — ${report.title}`, report.text);
}

function printSelectedReport() {
  const report = selectedReport('print');
  if (report.dateRequired) { api().toast('Select a date for the changes report.'); return; }
  root.querySelector('.erp-print-report')?.remove();
  const printable = document.createElement('section');
  printable.className = 'erp-print-report';
  printable.innerHTML = `<h1>${esc(client.name)}</h1><h2>${esc(report.title)}</h2><pre>${esc(report.text)}</pre>`;
  root.append(printable);
  document.body.classList.add('erp-report-printing');
  window.addEventListener('afterprint', () => { document.body.classList.remove('erp-report-printing'); printable.remove(); }, { once: true });
  window.print();
}

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
        <div class="erp-report-control"><span>Email</span><select data-email-scope><option value="whole">Whole project</option><option value="changes">Changes on date</option></select><input type="date" data-email-date value="${localDate()}" disabled><a class="erp-btn on-dark erp-email-report" data-email-report href="#" role="button" title="${client.email ? `Open this report for ${attr(client.email)} in your default email app` : 'Add an email on the client card first'}">${client.email ? 'Open Outlook' : 'Add client email'}</a></div>
        <div class="erp-report-control"><span>Print / PDF</span><select data-print-scope><option value="whole">Whole project</option><option value="changes">Changes on date</option></select><input type="date" data-print-date value="${localDate()}" disabled><button class="erp-btn on-dark" data-project-print ${project ? '' : 'disabled'}>Print / PDF</button></div>
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
  const selectedItems = section.items.filter(item => documentState.moduleData[item.id]?.checked);
  const statusCounts = Object.fromEntries(MODULE_STATUSES.map(status => [status, selectedItems.filter(item => (documentState.moduleData[item.id]?.status || 'Needs Training') === status).length]));
  const rows = section.items.map(item => {
    const value = documentState.moduleData[item.id] || {};
    const open = expandedModuleItems.has(item.id);
    const included = Boolean(value.checked);
    const status = value.status || 'Needs Training';
    const statusClass = status.toLowerCase().replace(/\s+/g, '-');
    const selectedUsers = new Set(value.users || []);
    const attendeeCount = documentState.users.filter(user => selectedUsers.has(user.id) || selectedUsers.has(user.name)).length;
    const attendees = documentState.users.length ? documentState.users.map(user => {
      const selected = selectedUsers.has(user.id) || selectedUsers.has(user.name);
      return `<label class="erp-attendee"><input type="checkbox" data-module-user-key="${attr(item.id)}" data-module-user-id="${attr(user.id)}" ${selected ? 'checked' : ''}${included ? '' : ' disabled'}><span>${esc(user.name || 'Unnamed user')}${user.position ? `<small>${esc(user.position)}</small>` : ''}</span></label>`;
    }).join('') : '<div class="erp-muted">Add users in Client Users to select training attendees.</div>';
    return `<section class="erp-module-accordion${open ? ' open' : ''}${included ? ' selected' : ' not-selected'}" data-module-status="${attr(statusClass)}">
      <div class="erp-module-summary">
        <label class="erp-module-scope" title="Include this screen in the project">
          <input type="checkbox" data-module-key="${attr(item.id)}" data-module-field="checked" ${included ? 'checked' : ''}>
          <span class="erp-module-scope-box">✓</span><span>In project</span>
        </label>
        <button type="button" class="erp-module-open" data-module-toggle="${attr(item.id)}" aria-expanded="${open}">
          <span class="erp-module-index">${section.items.indexOf(item) + 1}</span>
          <span class="erp-module-heading"><strong>${esc(item.text)}</strong><small>${included ? `${value.date ? esc(value.date) : 'No date'}${attendeeCount ? ` · ${attendeeCount} trained user${attendeeCount === 1 ? '' : 's'}` : ' · No trained users'}` : 'Not included in this project'}</small></span>
          <span class="erp-module-status ${included ? `status-${statusClass}` : 'not-in-project'}">${included ? esc(status) : 'Not in project'}</span>
          <span class="erp-module-signals">${value.note ? '<span title="Special notes recorded">Notes</span>' : ''}${value.action ? '<span title="Next action recorded">Action</span>' : ''}</span>
          <span class="erp-module-chevron">›</span>
        </button>
      </div>
      <div class="erp-module-details"${open ? '' : ' hidden'}>
        <div class="erp-module-context ${included ? 'included' : ''}">${included ? '<strong>Included in this project.</strong> Use the status to track its training progress.' : '<strong>Not included.</strong> Tick “In project” above if this screen is required.'}</div>
        <div class="erp-module-form">
          <div class="erp-module-meta">
            <div class="erp-field"><label>Training status</label><select class="erp-select" data-module-key="${attr(item.id)}" data-module-field="status"${included ? '' : ' disabled'}>${options(MODULE_STATUSES, status)}</select></div>
            <div class="erp-field"><label>Training / review date</label><input type="date" class="erp-input" data-module-key="${attr(item.id)}" data-module-field="date" value="${attr(value.date || '')}"${included ? '' : ' disabled'}></div>
          </div>
          <div class="erp-module-wide"><div class="erp-field"><label>Users who attended training</label><div class="erp-attendees">${attendees}</div></div><div class="erp-module-notes-grid"><div class="erp-field"><label>Special notes</label><textarea class="erp-textarea" data-module-key="${attr(item.id)}" data-module-field="note" placeholder="Setup details, client-specific notes…">${esc(value.note || '')}</textarea></div><div class="erp-field"><label>Requirement / next action</label><textarea class="erp-textarea" data-module-key="${attr(item.id)}" data-module-field="action" placeholder="Next training or configuration action…">${esc(value.action || '')}</textarea></div></div></div>
        </div>
      </div>
    </section>`;
  }).join('');
  return `<div class="erp-card erp-module-card"><div class="erp-actions erp-module-toolbar"><div><h2>${esc(section.title)}</h2><div class="erp-muted">Choose the screens required for this project, then track training separately.</div></div><div class="erp-module-toolbar-buttons"><button class="erp-btn" data-module-expand-all>Expand all</button><button class="erp-btn" data-module-collapse-all>Collapse all</button></div></div><div class="erp-module-overview"><div class="erp-module-total"><strong>${selectedItems.length}</strong><span>of ${section.items.length} screens in project</span></div>${MODULE_STATUSES.map(status => `<div class="erp-module-metric status-${status.toLowerCase().replace(/\s+/g, '-')}"><strong>${statusCounts[status]}</strong><span>${esc(status)}</span></div>`).join('')}</div><div class="erp-module-list">${rows}</div></div>`;
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
  if (!documentState.moduleData[key]) documentState.moduleData[key] = { checked: false, status: 'Needs Training', note: '', action: '', date: '', phase: project.phase || PHASES[0], users: [] };
  return documentState.moduleData[key];
}

function recordChange(field, label, value) {
  const now = new Date();
  const date = localDate(now);
  const entry = { date, at: now.toISOString(), section: activeSection, field, label, value: String(value ?? ''), user: api().getCurrentUser() };
  const existing = documentState.changeLog.findIndex(item => item.date === date && item.field === field);
  if (existing >= 0) documentState.changeLog[existing] = entry;
  else documentState.changeLog.push(entry);
  if (documentState.changeLog.length > 2000) documentState.changeLog.splice(0, documentState.changeLog.length - 2000);
}

function bindInputs(selector, callback) {
  const container = root.querySelector('.erp-main') || root;
  container.querySelectorAll(selector).forEach(element => element.addEventListener('input', () => { callback(element); setDirty(); }));
}

function bindContent() {
  const container = root.querySelector('.erp-main') || root;
  container.querySelectorAll('[data-module-toggle]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.moduleToggle;
    if (expandedModuleItems.has(key)) expandedModuleItems.delete(key); else expandedModuleItems.add(key);
    renderMain();
  }));
  container.querySelector('[data-module-expand-all]')?.addEventListener('click', () => {
    const section = catalog.moduleSections.find(item => item.id === activeSection.slice(7));
    section?.items.forEach(item => expandedModuleItems.add(item.id));
    renderMain();
  });
  container.querySelector('[data-module-collapse-all]')?.addEventListener('click', () => {
    const section = catalog.moduleSections.find(item => item.id === activeSection.slice(7));
    section?.items.forEach(item => expandedModuleItems.delete(item.id));
    renderMain();
  });
  bindInputs('[data-project-field]', element => { project[element.dataset.projectField] = element.value; recordChange(`project.${element.dataset.projectField}`, `Project ${element.dataset.projectField}`, element.value); });
  bindInputs('[data-answer]', element => { documentState.answers[element.dataset.answer] = element.value; recordChange(`answer.${element.dataset.answer}`, `${questionLabels.get(element.dataset.answer) || element.dataset.answer} — Answer`, element.value); });
  bindInputs('[data-note]', element => { documentState.notes[element.dataset.note] = element.value; recordChange(`note.${element.dataset.note}`, `${questionLabels.get(element.dataset.note) || element.dataset.note} — Notes`, element.value); });
  container.querySelectorAll('[data-check]').forEach(element => element.addEventListener('change', () => { documentState.checks[element.dataset.check] = element.checked; recordChange(`check.${element.dataset.check}`, questionLabels.get(element.dataset.check) || element.dataset.check, element.checked ? 'Completed' : 'Not completed'); setDirty(); }));
  bindInputs('[data-migration]', element => { documentState.migrationExtra[element.dataset.migration] = element.value; recordChange(`migration.${element.dataset.migration}`, `Migration ${element.dataset.migration}`, element.value); });
  container.querySelectorAll('[data-module-key]').forEach(element => element.addEventListener(element.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input', () => {
    const item = ensureModule(element.dataset.moduleKey);
    const field = element.dataset.moduleField;
    const value = element.type === 'checkbox' ? element.checked : element.value;
    item[field] = value;
    recordChange(`module.${element.dataset.moduleKey}.${field}`, `${moduleLabels.get(element.dataset.moduleKey) || element.dataset.moduleKey} — ${field === 'checked' ? 'Included in project' : field}`, field === 'checked' ? (value ? 'Yes' : 'No') : value);
    setDirty();
    if (field === 'checked' || field === 'status') renderMain();
  }));
  container.querySelectorAll('[data-module-user-key]').forEach(element => element.addEventListener('change', () => {
    const item = ensureModule(element.dataset.moduleUserKey);
    const selected = new Set(item.users || []);
    if (element.checked) selected.add(element.dataset.moduleUserId);
    else selected.delete(element.dataset.moduleUserId);
    item.users = [...selected];
    recordChange(`module.${element.dataset.moduleUserKey}.users`, `${moduleLabels.get(element.dataset.moduleUserKey) || element.dataset.moduleUserKey} — Training attendees`, item.users.map(id => documentState.users.find(user => user.id === id)?.name || id).join(', '));
    setDirty();
  }));
  bindInputs('[data-user-index]', element => { const index = Number(element.dataset.userIndex); documentState.users[index][element.dataset.userField] = element.value; recordChange(`user.${documentState.users[index].id}.${element.dataset.userField}`, `Client user ${element.dataset.userField}`, element.value); });
  bindInputs('[data-role-index]', element => { const index = Number(element.dataset.roleIndex); documentState.trainingRoles[index][element.dataset.roleField] = element.value; recordChange(`role.${index}.${element.dataset.roleField}`, `Training role ${element.dataset.roleField}`, element.value); });
  bindInputs('[data-req-index]', element => { const index = Number(element.dataset.reqIndex); documentState.requirements[index][element.dataset.reqField] = element.value; recordChange(`requirement.${index}.${element.dataset.reqField}`, `Requirement ${documentState.requirements[index].id || index + 1} ${element.dataset.reqField}`, element.value); });
  container.querySelector('[data-add-user]')?.addEventListener('click', () => { const user = { id: crypto.randomUUID(), name: '', position: '' }; documentState.users.push(user); recordChange(`user.${user.id}`, 'Client user', 'Added'); setDirty(); renderMain(); });
  container.querySelectorAll('[data-remove-user]').forEach(button => button.addEventListener('click', () => { const removed = documentState.users.splice(Number(button.dataset.removeUser), 1)[0]; recordChange(`user.${removed?.id || button.dataset.removeUser}`, 'Client user', `Removed ${removed?.name || ''}`); setDirty(); renderMain(); }));
  container.querySelector('[data-add-role]')?.addEventListener('click', () => { documentState.trainingRoles.push({ role: '', tasks: '', level: '2 - Basic User', training: '', superUser: 'No' }); recordChange(`role.${documentState.trainingRoles.length - 1}`, 'Training role', 'Added'); setDirty(); renderMain(); });
  container.querySelectorAll('[data-remove-role]').forEach(button => button.addEventListener('click', () => { const index = Number(button.dataset.removeRole); const removed = documentState.trainingRoles.splice(index, 1)[0]; recordChange(`role.${index}`, 'Training role', `Removed ${removed?.role || ''}`); setDirty(); renderMain(); }));
  container.querySelector('[data-add-requirement]')?.addEventListener('click', () => { const item = { id: `R${String(documentState.requirements.length + 1).padStart(2, '0')}`, topic: '', type: 'Process', priority: 'Medium', owner: '', status: 'Open', date: localDate(), phase: project.phase || PHASES[0] }; documentState.requirements.push(item); recordChange(`requirement.${item.id}`, `Requirement ${item.id}`, 'Added'); setDirty(); renderMain(); });
  container.querySelectorAll('[data-remove-requirement]').forEach(button => button.addEventListener('click', () => { const removed = documentState.requirements.splice(Number(button.dataset.removeRequirement), 1)[0]; recordChange(`requirement.${removed?.id || button.dataset.removeRequirement}`, `Requirement ${removed?.id || ''}`, 'Removed'); setDirty(); renderMain(); }));
}

function bindShell() {
  root.querySelector('[data-erp-back]')?.addEventListener('click', backToClients);
  root.querySelectorAll('[data-erp-group]').forEach(button => button.addEventListener('click', () => {
    expandedNavGroup = expandedNavGroup === button.dataset.erpGroup ? '' : button.dataset.erpGroup;
    root.querySelectorAll('[data-erp-group]').forEach(groupButton => groupButton.setAttribute('aria-expanded', String(groupButton.dataset.erpGroup === expandedNavGroup)));
    root.querySelectorAll('[data-erp-group-items]').forEach(items => { items.hidden = items.dataset.erpGroupItems !== expandedNavGroup; });
  }));
  root.querySelectorAll('[data-erp-nav]').forEach(button => button.addEventListener('click', () => { activeSection = button.dataset.erpNav; expandedNavGroup = button.dataset.erpNavGroup; renderShell(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  root.querySelector('[data-email-report]')?.addEventListener('click', prepareEmailReport);
  root.querySelector('[data-project-print]')?.addEventListener('click', printSelectedReport);
  ['email', 'print'].forEach(kind => root.querySelector(`[data-${kind}-scope]`)?.addEventListener('change', event => {
    const dateInput = root.querySelector(`[data-${kind}-date]`);
    if (dateInput) dateInput.disabled = event.currentTarget.value !== 'changes';
  }));
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
  const today = localDate(now);
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
