import { ERP_DISCOVERY_CATALOG as catalog } from './erp-discovery-catalog.mjs';
import { renderClientJobReport } from './client-job-report.mjs';
import { MODULE_STATUSES, blankProjectDocument, buildClientJobReportItems, buildClientReportSnapshot, collectModuleItemsByStatus, computeProjectProgress, filterModuleChangesByDate, filterModuleItems, normalizeProjectDocument } from './erp-discovery-model.mjs';

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
let moduleViewFilter = '';
let discoveryFilter = 'all';
let discoverySearch = '';
let workspaceActivityDate = '';
let workspaceStatusFilter = '';
let jobReportDate = '';
let jobReportItems = new Set();
const jobReportOpen = new Set();
let jobReportComments = new Map();
let jobReportGeneralComment = '';
let jobReportClientRepresentative = '';
let jobReportConsultant = '';
let jobReportDraftId = '';
let jobReportNumber = '';
let jobReportCustomerComment = '';
let jobReportSatisfaction = '';
const expandedModuleItems = new Set();

const api = () => window.clientMonitorApi;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const attr = esc;
const options = (items, selected) => items.map(item => `<option${item === selected ? ' selected' : ''}>${esc(item)}</option>`).join('');
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const questionLabels = new Map(catalog.sections.flatMap(section => section.questions.map(item => [item.id, item.text])));
const moduleLabels = new Map(catalog.moduleSections.flatMap(section => section.items.map(item => [item.id, item.text])));

function clientReportData() {
  return buildClientReportSnapshot(documentState, catalog);
}

function reportDate(value) {
  if (!value) return 'Not scheduled';
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function clientGreeting() {
  return client.contact ? `Hello ${client.contact},` : 'Hello,';
}

function changeLabel(item) {
  return String(item.label || item.field || 'Project update')
    .replace(/ — note$/i, ' — Comment')
    .replace(/ — action$/i, ' — Next action')
    .replace(/ — status$/i, ' — Training status')
    .replace(/ — date$/i, ' — Training / review date')
    .replace(/ — checked$/i, ' — Project scope');
}

function changeSectionTitle(sectionId) {
  if (sectionId?.startsWith('module:')) return catalog.moduleSections.find(section => `module:${section.id}` === sectionId)?.title || 'Module';
  if (sectionId === 'requirements') return 'Requirements / decisions';
  if (sectionId === 'users') return 'Client users';
  if (sectionId === 'overview') return 'Project summary';
  return catalog.sections.find(section => section.id === sectionId)?.title || 'Project';
}

function reportSummaryLines() {
  const data = clientReportData();
  return [
    `Project phase: ${project.phase || PHASES[0]}`,
    `Implementation progress: ${Number(client.progress || 0)}%`,
    `Target live date: ${client.liveDate ? reportDate(client.liveDate) : 'To be confirmed'}`,
    `Screens in project: ${data.selectedModuleCount}`,
    `Training status: ${data.statusCounts['Needs Training']} needs training · ${data.statusCounts['In Progress']} in progress · ${data.statusCounts.Completed} completed`,
  ];
}

function wholeProjectReportText() {
  const data = clientReportData();
  const openRequirements = data.requirements.filter(item => !['Done', 'Accepted'].includes(item.status));
  const lines = [clientGreeting(), '', `Please find below the latest ERP project summary for ${client.name}.`, '', 'PROJECT SUMMARY', ...reportSummaryLines()];
  if (openRequirements.length) {
    lines.push('', 'OPEN ACTIONS & REQUIREMENTS');
    openRequirements.forEach(item => lines.push(`• ${item.id || 'Action'} — ${item.topic}${item.owner ? ` | Owner: ${item.owner}` : ''}${item.status ? ` | ${item.status}` : ''}${item.date ? ` | ${reportDate(item.date)}` : ''}`));
  }
  if (data.moduleSections.length) {
    lines.push('', 'MODULES & TRAINING');
    data.moduleSections.forEach(section => {
      lines.push('', section.title);
      section.items.forEach(item => lines.push(`• ${item.text} — ${item.status}${item.date ? ` | ${reportDate(item.date)}` : ''}${item.attendees.length ? ` | Attendees: ${item.attendees.join(', ')}` : ''}${item.action ? ` | Next: ${item.action}` : ''}${item.note ? ` | Note: ${item.note}` : ''}`));
    });
  }
  lines.push('', 'Kind regards,', project.consultant || client.implementor || 'PremierSoft');
  return lines.join('\n');
}

function dateChanges(date) {
  return filterModuleChangesByDate(documentState.changeLog, date).reverse();
}

function dateChangesReportText(date) {
  const changes = dateChanges(date);
  const lines = [clientGreeting(), '', `Here is the ERP project update for ${client.name} on ${reportDate(date)}.`, '', 'PROJECT SUMMARY', ...reportSummaryLines(), '', 'UPDATES'];
  if (changes.length) changes.forEach(item => {
    const time = item.at ? new Date(item.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    lines.push(`• ${time ? `${time} · ` : ''}${changeSectionTitle(item.section)} · ${changeLabel(item)}: ${item.value || '(cleared)'}${item.user ? ` — ${item.user}` : ''}`);
  });
  else lines.push('No project updates were recorded for this date.');
  lines.push('', 'Kind regards,', project.consultant || client.implementor || 'PremierSoft');
  return lines.join('\n');
}

function reportCover(title, subtitle = '') {
  return `<header class="erp-report-cover"><div class="erp-report-brand">PREMIERSOFT</div><h1>${esc(client.name)}</h1><p>${esc(title)}</p>${subtitle ? `<span>${esc(subtitle)}</span>` : ''}</header>`;
}

function reportSummaryHtml() {
  const data = clientReportData();
  return `<section class="erp-report-section"><h2>Project summary</h2><div class="erp-report-summary">
    <div><span>Project phase</span><strong>${esc(project.phase || PHASES[0])}</strong></div>
    <div><span>Implementation progress</span><strong>${Number(client.progress || 0)}%</strong></div>
    <div><span>Target live date</span><strong>${esc(client.liveDate ? reportDate(client.liveDate) : 'To be confirmed')}</strong></div>
  </div><div class="erp-report-status"><span class="needs">${data.statusCounts['Needs Training']} Needs Training</span><span class="progress">${data.statusCounts['In Progress']} In Progress</span><span class="complete">${data.statusCounts.Completed} Completed</span></div></section>`;
}

function wholeProjectReportHtml() {
  const data = clientReportData();
  const openRequirements = data.requirements.filter(item => !['Done', 'Accepted'].includes(item.status));
  const requirementsHtml = openRequirements.length ? `<section class="erp-report-section"><h2>Open actions & requirements</h2><table><thead><tr><th>ID</th><th>Action / requirement</th><th>Owner</th><th>Status</th><th>Target date</th></tr></thead><tbody>${openRequirements.map(item => `<tr><td>${esc(item.id || '—')}</td><td>${esc(item.topic)}</td><td>${esc(item.owner || '—')}</td><td>${esc(item.status || 'Open')}</td><td>${esc(item.date ? reportDate(item.date) : '—')}</td></tr>`).join('')}</tbody></table></section>` : '';
  const modulesHtml = data.moduleSections.length ? `<section class="erp-report-section"><h2>Modules & training progress</h2>${data.moduleSections.map(section => `<div class="erp-report-group"><h3>${esc(section.title)}</h3><table><thead><tr><th>Screen</th><th>Status</th><th>Review date</th><th>Training attendees</th><th>Client notes / next action</th></tr></thead><tbody>${section.items.map(item => `<tr><td>${esc(item.text)}</td><td><span class="erp-report-pill status-${item.status.toLowerCase().replace(/\s+/g, '-')}">${esc(item.status)}</span></td><td>${esc(item.date ? reportDate(item.date) : '—')}</td><td>${esc(item.attendees.join(', ') || '—')}</td><td>${item.note ? `<strong>Note:</strong> ${esc(item.note)}` : ''}${item.note && item.action ? '<br>' : ''}${item.action ? `<strong>Next:</strong> ${esc(item.action)}` : (!item.note ? '—' : '')}</td></tr>`).join('')}</tbody></table></div>`).join('')}</section>` : '';
  return `${reportCover('ERP Implementation · Client Project Report', `Prepared ${new Date().toLocaleDateString('en-GB')}`)}${reportSummaryHtml()}${requirementsHtml}${modulesHtml}<footer>Prepared by ${esc(project.consultant || client.implementor || 'PremierSoft')} · ${esc(new Date().toLocaleString('en-GB'))}</footer>`;
}

function dateChangesReportHtml(date) {
  const changes = dateChanges(date);
  const grouped = Map.groupBy ? Map.groupBy(changes, item => changeSectionTitle(item.section)) : changes.reduce((map, item) => { const key = changeSectionTitle(item.section); if (!map.has(key)) map.set(key, []); map.get(key).push(item); return map; }, new Map());
  const updatesHtml = changes.length ? [...grouped].map(([section, items]) => `<div class="erp-report-group"><h3>${esc(section)}</h3>${items.map(item => { const time = item.at ? new Date(item.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''; return `<div class="erp-report-update"><span>${esc(time || '—')}</span><div><strong>${esc(changeLabel(item))}</strong><p>${esc(item.value || '(cleared)')}</p>${item.user ? `<small>Updated by ${esc(item.user)}</small>` : ''}</div></div>`; }).join('')}</div>`).join('') : '<div class="erp-report-empty">No module or training updates were recorded for this date.</div>';
  return `${reportCover('ERP Implementation · Training Day Report', reportDate(date))}${reportSummaryHtml()}<section class="erp-report-section"><h2>Module & training work completed on ${esc(reportDate(date))}</h2>${updatesHtml}</section><footer>Prepared by ${esc(project.consultant || client.implementor || 'PremierSoft')} · ${esc(new Date().toLocaleString('en-GB'))}</footer>`;
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
    ? { title: `Project Update — ${date || 'Select date'}`, text: dateChangesReportText(date), html: dateChangesReportHtml(date), dateRequired: !date }
    : { title: 'ERP Project Summary', text: wholeProjectReportText(), html: wholeProjectReportHtml(), dateRequired: false };
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
  printable.innerHTML = report.html;
  root.append(printable);
  document.body.classList.add('erp-report-printing');
  window.addEventListener('afterprint', () => { document.body.classList.remove('erp-report-printing'); printable.remove(); }, { once: true });
  window.print();
}

function jobReportSections() {
  return buildClientJobReportItems(documentState, catalog, [...jobReportItems]);
}

function jobReportHtml() {
  return renderClientJobReport({
    client, date: reportDate(jobReportDate), jobNumber: jobReportNumber,
    consultant: jobReportConsultant, representative: jobReportClientRepresentative,
    sections: jobReportSections(), comments: Object.fromEntries(jobReportComments),
    generalComment: jobReportGeneralComment, customerComment: jobReportCustomerComment,
    satisfaction: jobReportSatisfaction,
  });
}

async function completeJobReport() {
  if (!jobReportDate) { api().toast('Select the job report date.'); return; }
  const sections = jobReportSections();
  if (!sections.length) { api().toast('Tick at least one trained screen for the job report.'); return; }
  const createdAt = new Date().toISOString();
  const reportItems = sections.flatMap(section => section.items.map(item => ({ id: item.id, module: section.title, screen: item.text, comment: jobReportComments.get(item.id) || '' })));
  const reportRecord = { id: jobReportDraftId, date: jobReportDate, items: reportItems, generalComment: jobReportGeneralComment, clientRepresentative: jobReportClientRepresentative, consultant: jobReportConsultant, jobNumber: jobReportNumber, customerComment: jobReportCustomerComment, satisfaction: jobReportSatisfaction, createdAt, createdBy: api().getCurrentUser() };
  const existingReport = documentState.jobReports.findIndex(item => item.id === jobReportDraftId);
  if (existingReport >= 0) documentState.jobReports[existingReport] = reportRecord; else documentState.jobReports.push(reportRecord);
  for (const section of sections) for (const screen of section.items) {
    if (!documentState.moduleData[screen.id]?.checked) continue; // out-of-project screens appear only in the report
    const value = ensureModule(screen.id);
    value.date = jobReportDate;
    if (value.status === 'Needs Training') value.status = 'In Progress';
    const comment = jobReportComments.get(screen.id) || '';
    if (comment && !String(value.note || '').includes(comment)) value.note = [value.note, `${reportDate(jobReportDate)}: ${comment}`].filter(Boolean).join('\n');
    recordChange(`module.${screen.id}.date`, `${screen.text} — Training / review date`, jobReportDate, `module:${section.id}`, jobReportDate);
    recordChange(`module.${screen.id}.status`, `${screen.text} — Training status`, value.status, `module:${section.id}`, jobReportDate);
    if (comment) recordChange(`module.${screen.id}.note`, `${screen.text} — Comment`, comment, `module:${section.id}`, jobReportDate);
  }
  setDirty();
  if (saveInFlight) {
    api().toast('Saving changes. Please wait until saved, then complete the report again.');
    return;
  }
  if (!await saveProject()) return;
  root.querySelector('.erp-print-report')?.remove();
  const printable = document.createElement('section');
  printable.className = 'erp-print-report';
  printable.innerHTML = jobReportHtml();
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
  window.closeTasksView?.();
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
  const discovery = [{ id: 'discovery', title: 'Browse topics' }, { id: 'training-roles', title: 'Training & roles' }, { id: 'requirements', title: 'Decisions & requirements' }];
  return [
    { id: 'workspace', title: 'Workspace', items: [{ id: 'overview', title: 'Overview' }, { id: 'job-report', title: 'Client Job Report' }, { id: 'users', title: 'Client Users' }] },
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
    const hasActive = group.items.some(item => item.id === activeSection) || (group.id === 'discovery' && catalog.sections.some(item => item.id === activeSection));
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
          <div class="erp-kicker">Client workspace</div>
          <div class="erp-title">${esc(client.name)}</div>
          <div class="erp-subtitle">${esc(client.contact || 'No main contact')} · ${esc(client.city || 'No city')} · Implementor: ${esc(client.implementor || 'Unassigned')}</div>
          <div class="erp-badges"><span class="erp-badge">${esc(client.status)}</span>${moduleBadges}</div>
        </div>
      </div>
      <div class="erp-projectbar">
        <button type="button" class="erp-btn on-dark" data-open-job-report ${project ? '' : 'disabled'}>Client Job Report</button>
        <div class="erp-report-control"><span>Email client</span><select data-email-scope><option value="whole">Client project summary</option><option value="changes">Updates on date</option></select><input type="date" data-email-date value="${localDate()}" disabled><a class="erp-btn on-dark erp-email-report" data-email-report href="#" role="button" title="${client.email ? `Prepare this client report for ${attr(client.email)} in your default email app` : 'Add an email on the client card first'}">${client.email ? 'Prepare email' : 'Add client email'}</a></div>
        <div class="erp-report-control"><span>Client PDF</span><select data-print-scope><option value="whole">Client project summary</option><option value="changes">Updates on date</option></select><input type="date" data-print-date value="${localDate()}" disabled><button class="erp-btn on-dark" data-project-print ${project ? '' : 'disabled'}>Print / Save PDF</button></div>
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
  if (!workspaceActivityDate) workspaceActivityDate = localDate();
  const discovery = computeProjectProgress(documentState, catalog);
  const openRequirements = documentState.requirements.filter(item => !['Done', 'Accepted'].includes(item.status)).length;
  const activity = filterModuleChangesByDate(documentState.changeLog, workspaceActivityDate);
  const moduleItems = collectModuleItemsByStatus(catalog.moduleSections, documentState.moduleData, workspaceStatusFilter);
  const allModuleItems = collectModuleItemsByStatus(catalog.moduleSections, documentState.moduleData);
  const statusCounts = Object.fromEntries(MODULE_STATUSES.map(status => [status, allModuleItems.filter(item => item.status === status).length]));
  const activityRows = activity.map(item => {
    const section = catalog.moduleSections.find(candidate => `module:${candidate.id}` === item.section);
    const moduleKey = String(item.field || '').split('.').slice(1, -1).join('.');
    const time = item.at ? new Date(item.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<button type="button" class="erp-activity-row" data-workspace-module="${attr(moduleKey)}" data-workspace-section="${attr(section?.id || '')}"${section && moduleKey ? '' : ' disabled'}><span class="erp-activity-time">${esc(time || '—')}</span><span class="erp-activity-copy"><strong>${esc(item.label || item.field)}</strong><small>${esc(section?.title || 'Module')} · ${esc(item.user || 'Unknown user')}</small><span>${esc(item.value || '(empty)')}</span></span><span class="erp-activity-arrow">›</span></button>`;
  }).join('');
  const moduleRows = moduleItems.map(item => `<button type="button" class="erp-workspace-module-row" data-workspace-module="${attr(item.id)}" data-workspace-section="${attr(item.sectionId)}"><span><strong>${esc(item.text)}</strong><small>${esc(item.sectionTitle)}${item.date ? ` · ${esc(item.date)}` : ''}</small></span><span class="erp-module-status status-${item.status.toLowerCase().replace(/\s+/g, '-')}">${esc(item.status)}</span><span class="erp-activity-arrow">›</span></button>`).join('');
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
  <div class="erp-workspace-insights">
    <section class="erp-card erp-activity-card">
      <div class="erp-insight-head"><div><h3>Updates & comments</h3><div class="erp-muted">Changes made in any module on the selected date.</div></div><label class="erp-date-filter"><span>Date</span><input type="date" value="${attr(workspaceActivityDate)}" data-workspace-activity-date></label></div>
      <div class="erp-activity-list">${activityRows || `<div class="erp-empty erp-insight-empty">No module updates or comments on ${esc(workspaceActivityDate)}.</div>`}</div>
    </section>
    <section class="erp-card erp-status-card">
      <div class="erp-insight-head"><div><h3>All module screens</h3><div class="erp-muted">Filter every Accounting and Stock screen by training status.</div></div><strong class="erp-result-count">${moduleItems.length}</strong></div>
      <div class="erp-status-filters"><button type="button" class="${workspaceStatusFilter ? '' : 'active'}" data-workspace-status="" aria-pressed="${!workspaceStatusFilter}">All <strong>${allModuleItems.length}</strong></button>${MODULE_STATUSES.map(status => `<button type="button" class="status-${status.toLowerCase().replace(/\s+/g, '-')}${workspaceStatusFilter === status ? ' active' : ''}" data-workspace-status="${attr(status)}" aria-pressed="${workspaceStatusFilter === status}">${esc(status)} <strong>${statusCounts[status]}</strong></button>`).join('')}</div>
      <div class="erp-workspace-module-list">${moduleRows || `<div class="erp-empty erp-insight-empty">No screens match ${esc(workspaceStatusFilter || 'the selected filter')}.</div>`}</div>
    </section>
  </div>
  <div class="erp-card" style="margin-top:12px"><h3>Project history</h3>${documentState.changeHistory.length ? documentState.changeHistory.slice().reverse().slice(0, 12).map(item => `<div class="erp-question"><strong>${esc(item.date || item.savedAt || '')}</strong> · ${esc(item.phase || '')}<div class="erp-muted">${esc(item.consultant || '')}${item.progress !== undefined ? ` · ${esc(item.progress)}%` : ''}</div></div>`).join('') : '<div class="erp-muted">No saved history yet.</div>'}</div>`;
}

const discoveryTitle = section => section.title.replace(/^\d+(?:\.\d+)*\.?\s*/, '');
const discoveryDone = (section, item) => section.checklist ? !!documentState.checks[item.id] : !!String(documentState.answers[item.id] || '').trim();
const discoveryGroups = [
  { title: 'Company & workflows', ids: ['company', 'current', 'sales', 'purchases', 'stock', 'items', 'customers', 'suppliers', 'accounting'] },
  { title: 'Setup & preparation', ids: ['reports', 'integrations', 'migration', 'training', 'scenarios'] },
  { title: 'Ready to launch', ids: ['golive', 'summary'] },
];

function discoveryTools(search = false) {
  return `<div class="erp-discovery-tools">${search ? `<label class="erp-discovery-search">Search topics<input type="search" class="erp-input" data-discovery-search value="${attr(discoverySearch)}" placeholder="Find a topic or question…"></label>` : ''}<div class="erp-status-filters" aria-label="Completion filter">${[['all', 'All'], ['pending', 'To do'], ['done', 'Completed']].map(([value, label]) => `<button type="button" data-discovery-filter="${value}" aria-pressed="${discoveryFilter === value}" class="${discoveryFilter === value ? 'active' : ''}">${label}</button>`).join('')}</div></div>`;
}

function renderDiscovery() {
  return `<div class="erp-card erp-discovery"><h2>Discovery & Readiness</h2><p class="erp-muted">Project discovery, preparation and launch checks.</p>${discoveryTools(true)}${discoveryGroups.map(group => `<section data-discovery-group><h3>${group.title}</h3><div class="erp-discovery-grid">${group.ids.map(id => {
    const section = catalog.sections.find(item => item.id === id);
    const done = section.questions.filter(item => discoveryDone(section, item)).length;
    return `<button type="button" class="erp-topic" data-discovery-open="${id}" data-discovery-row data-done="${done === section.questions.length}" data-search="${attr([section.title, ...section.questions.map(item => item.text)].join(' ').toLocaleLowerCase())}"><span class="erp-topic-title">${esc(discoveryTitle(section))}</span><span class="erp-muted">${done} / ${section.questions.length} ${section.checklist ? 'completed' : 'answered'} <span aria-hidden="true">→</span></span></button>`;
  }).join('')}</div></section>`).join('')}<div class="erp-empty" data-discovery-empty hidden>No topics match. Try another search or show all.</div><div class="erp-discovery-links"><button class="erp-btn" data-discovery-open="training-roles">Training & roles →</button><button class="erp-btn" data-discovery-open="requirements">Decisions & requirements →</button></div></div>`;
}

function renderQuestions(section) {
  const items = section.questions.map(item => {
    const done = discoveryDone(section, item);
    const field = section.checklist ? 'note' : 'answer';
    const value = section.checklist ? documentState.notes[item.id] : documentState.answers[item.id];
    return `<details class="erp-discovery-question" data-discovery-row data-question-id="${attr(item.id)}" data-done="${done}"><summary><span class="erp-discovery-state" aria-label="${done ? 'Completed' : 'To do'}">${done ? '✓' : '○'}</span><span>${esc(item.text)}</span><span class="erp-discovery-chevron" aria-hidden="true">⌄</span></summary><div class="erp-discovery-answer">${section.checklist ? `<label class="erp-checkline"><input type="checkbox" data-check="${attr(item.id)}" ${done ? 'checked' : ''}> Completed</label>` : ''}<label>${section.checklist ? 'Notes (optional)' : 'Your answer'}<textarea class="erp-textarea" data-${field}="${attr(item.id)}" placeholder="${section.checklist ? 'Add a note…' : 'Write your answer…'}">${esc(value || '')}</textarea></label></div></details>`;
  }).join('');
  const migration = section.id === 'migration' ? `<details class="erp-card"><summary>Migration details</summary><div class="erp-fields"><label class="erp-field">Historical data decision<input class="erp-input" data-migration="history" value="${attr(documentState.migrationExtra.history)}"></label><label class="erp-field">Freeze / final migration date<input type="date" class="erp-input" data-migration="freeze" value="${attr(documentState.migrationExtra.freeze)}"></label><label class="erp-field">Data source / owner<textarea class="erp-textarea" data-migration="source">${esc(documentState.migrationExtra.source)}</textarea></label></div></details>` : '';
  return `<div class="erp-card erp-discovery"><button class="erp-back" data-discovery-open="discovery">← All topics</button><h2>${esc(discoveryTitle(section))}</h2><p class="erp-muted">${section.checklist ? 'Open an item to mark it complete or add a note.' : 'Open a question to view or add your answer.'} Changes save automatically.</p>${discoveryTools()}${items}<div class="erp-empty" data-discovery-empty hidden>No items in this view. Choose another filter.</div></div>${migration}`;
}

function filterDiscovery() {
  const container = root.querySelector('.erp-discovery');
  if (!container) return;
  container.querySelectorAll('[data-discovery-row]').forEach(row => {
    const done = row.dataset.done === 'true';
    row.hidden = (discoveryFilter === 'pending' && done) || (discoveryFilter === 'done' && !done) || (row.dataset.search !== undefined && !row.dataset.search.includes(discoverySearch.trim().toLocaleLowerCase()));
  });
  container.querySelectorAll('[data-discovery-group]').forEach(group => { group.hidden = !group.querySelector('[data-discovery-row]:not([hidden])'); });
  container.querySelector('[data-discovery-empty]').hidden = !!container.querySelector('[data-discovery-row]:not([hidden])');
}

function renderUsers() {
  return `<div class="erp-card"><div class="erp-actions"><div><h2>Client Users</h2><div class="erp-muted">People involved in discovery, implementation or training.</div></div><button class="erp-btn primary" data-add-user>+ Add user</button></div><div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>Name</th><th>Position / Department</th><th></th></tr></thead><tbody>${documentState.users.map((item, index) => `<tr><td><input data-user-index="${index}" data-user-field="name" value="${attr(item.name)}"></td><td><input data-user-index="${index}" data-user-field="position" value="${attr(item.position)}"></td><td><button class="erp-btn danger" data-remove-user="${index}">Remove</button></td></tr>`).join('')}</tbody></table></div>${documentState.users.length ? '' : '<div class="erp-empty">No users recorded.</div>'}</div>`;
}

function renderJobReport() {
  if (!jobReportDate) jobReportDate = localDate();
  if (!jobReportClientRepresentative) jobReportClientRepresentative = client.contact || '';
  if (!jobReportConsultant) jobReportConsultant = project.consultant || client.implementor || '';
  if (!jobReportDraftId) jobReportDraftId = crypto.randomUUID();
  const selectedBySection = section => section.items.filter(item => jobReportItems.has(item.id)).length;
  const groupTitles = { accounting: 'Accounting Modules', stock: 'Stock Modules' };
  const checklists = ['accounting', 'stock'].map(group => {
    const sections = catalog.moduleSections.filter(section => section.group === group && section.items.length);
    if (!sections.length) return '';
    return `<div class="erp-job-group"><h3 class="erp-job-group-title">${groupTitles[group]}</h3><div class="erp-job-modules">${sections.map(section => {
      const picked = selectedBySection(section);
      const inProject = section.items.filter(item => documentState.moduleData[item.id]?.checked).length;
      const open = jobReportOpen.has(section.id) || picked > 0;
      return `<details class="erp-job-module" data-job-module="${attr(section.id)}"${open ? ' open' : ''}>
        <summary><span class="erp-job-module-title">${esc(section.title)}</span><span class="erp-job-module-meta">${inProject ? `${inProject} in project · ` : ''}${section.items.length} screens</span>${picked ? `<span class="erp-job-picked">${picked} selected</span>` : ''}</summary>
        <div class="erp-job-module-tools"><button type="button" class="erp-link" data-job-select-all="${attr(section.id)}">Select all</button><button type="button" class="erp-link" data-job-clear="${attr(section.id)}">Clear</button></div>
        <div class="erp-job-screens">${section.items.map(item => `<div class="erp-job-screen${jobReportItems.has(item.id) ? ' selected' : ''}" data-job-text="${attr(item.text.toLowerCase())}"><label><input type="checkbox" data-job-report-item="${attr(item.id)}" ${jobReportItems.has(item.id) ? 'checked' : ''}><span>${esc(item.text)}</span>${documentState.moduleData[item.id]?.checked ? '<em class="erp-job-tag">In project</em>' : ''}</label>${jobReportItems.has(item.id) ? `<textarea data-job-report-comment="${attr(item.id)}" placeholder="Optional short comment for this screen…">${esc(jobReportComments.get(item.id) || '')}</textarea>` : ''}</div>`).join('')}</div>
      </details>`;
    }).join('')}</div></div>`;
  }).join('');
  const selectedCount = jobReportSections().reduce((total, section) => total + section.items.length, 0);
  return `<div class="erp-card erp-job-report-card">
    <div class="erp-actions"><div><h2>Client Job Report</h2><div class="erp-muted">Open a module and tick only the screens you trained on this date. Any screen can be selected, whether or not it is in the project.</div></div><span class="erp-job-count">${selectedCount} selected</span></div>
    <div class="erp-job-toolbar"><label class="erp-field"><span>Visit / training date</span><input type="date" class="erp-input" data-job-report-date value="${attr(jobReportDate)}"></label><label class="erp-field"><span>Job No. (optional)</span><input class="erp-input" data-job-report-number maxlength="100" placeholder="From your service system" value="${attr(jobReportNumber)}"></label><button type="button" class="erp-btn primary" data-complete-job-report ${selectedCount ? '' : 'disabled'}>Complete & Print PDF</button></div>
    <div class="erp-job-search"><input class="erp-input" type="search" data-job-search placeholder="Search screens…"><button type="button" class="erp-link" data-job-expand="all">Expand all</button><button type="button" class="erp-link" data-job-expand="none">Collapse all</button></div>
    ${checklists}
    <section class="erp-job-extras"><h3>Customer feedback <span class="erp-muted">(optional)</span></h3><div class="erp-job-signatures"><label class="erp-field"><span>Customer satisfaction</span><select class="erp-select" data-job-report-satisfaction><option value="">Not recorded</option>${options(['Satisfied', 'Neutral', 'Needs attention'], jobReportSatisfaction)}</select></label><label class="erp-field"><span>Customer comments</span><textarea class="erp-textarea" data-job-report-customer-comment placeholder="Feedback from the client…">${esc(jobReportCustomerComment)}</textarea></label></div></section>
    <section class="erp-job-extras"><div class="erp-field"><label>General comment <span>(optional)</span></label><textarea class="erp-textarea" data-job-report-general placeholder="General notes about today’s training…">${esc(jobReportGeneralComment)}</textarea></div><div class="erp-job-signatures"><div class="erp-field"><label>Client representative</label><input class="erp-input" data-job-report-client value="${attr(jobReportClientRepresentative)}"></div><div class="erp-field"><label>Consultant</label><input class="erp-input" data-job-report-consultant value="${attr(jobReportConsultant)}"></div></div><div class="erp-muted">The PDF includes signature lines for both people.</div></section>
  </div>`;
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
  const visibleItems = filterModuleItems(section.items, documentState.moduleData, moduleViewFilter);
  const rows = visibleItems.map(item => {
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
  const activeLabel = moduleViewFilter === 'selected' ? 'Screens in project' : moduleViewFilter;
  const filterNotice = moduleViewFilter ? `<div class="erp-module-filter-notice"><span>Showing: <strong>${esc(activeLabel)}</strong> · ${visibleItems.length} screen${visibleItems.length === 1 ? '' : 's'}</span><button type="button" data-module-clear-filter>Show all screens</button></div>` : '';
  const empty = moduleViewFilter && !visibleItems.length ? `<div class="erp-empty erp-module-empty">No screens match ${esc(activeLabel)}.</div>` : '';
  return `<div class="erp-card erp-module-card"><div class="erp-actions erp-module-toolbar"><div><h2>${esc(section.title)}</h2><div class="erp-muted">Choose the screens required for this project, then track training separately. Click a summary card to filter.</div></div><div class="erp-module-toolbar-buttons"><button class="erp-btn" data-module-expand-all>Expand all</button><button class="erp-btn" data-module-collapse-all>Collapse all</button></div></div><div class="erp-module-overview"><button type="button" class="erp-module-total${moduleViewFilter === 'selected' ? ' active' : ''}" data-module-filter="selected" aria-pressed="${moduleViewFilter === 'selected'}"><strong>${selectedItems.length}</strong><span>of ${section.items.length} screens in project</span></button>${MODULE_STATUSES.map(status => `<button type="button" class="erp-module-metric status-${status.toLowerCase().replace(/\s+/g, '-')}${moduleViewFilter === status ? ' active' : ''}" data-module-filter="${attr(status)}" aria-pressed="${moduleViewFilter === status}"><strong>${statusCounts[status]}</strong><span>${esc(status)}</span></button>`).join('')}</div>${filterNotice}<div class="erp-module-list">${rows}</div>${empty}</div>`;
}

function renderMain() {
  const container = root.querySelector('.erp-main');
  if (!container) return;
  if (!project) {
    container.innerHTML = renderNoProject();
    bindContent();
    return;
  }
  if (activeSection === 'discovery') container.innerHTML = renderDiscovery();
  else if (activeSection === 'overview') container.innerHTML = renderOverview();
  else if (activeSection === 'job-report') container.innerHTML = renderJobReport();
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

function recordChange(field, label, value, section = activeSection, changeDate = '') {
  const now = new Date();
  const date = changeDate || localDate(now);
  const entry = { date, at: now.toISOString(), section, field, label, value: String(value ?? ''), user: api().getCurrentUser() };
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
  filterDiscovery();
  container.querySelectorAll('[data-discovery-open]').forEach(button => button.addEventListener('click', () => {
    activeSection = button.dataset.discoveryOpen; expandedNavGroup = 'discovery'; discoveryFilter = 'all'; renderShell();
    root.querySelector('.erp-main').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  container.querySelector('[data-discovery-search]')?.addEventListener('input', event => { discoverySearch = event.target.value; filterDiscovery(); });
  container.querySelectorAll('[data-discovery-filter]').forEach(button => button.addEventListener('click', () => {
    discoveryFilter = button.dataset.discoveryFilter;
    container.querySelectorAll('[data-discovery-filter]').forEach(item => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); });
    filterDiscovery();
  }));
  container.querySelectorAll('[data-discovery-row] textarea, [data-discovery-row] input').forEach(input => input.addEventListener('input', () => {
    const row = input.closest('[data-discovery-row]');
    const section = catalog.sections.find(item => item.id === activeSection);
    const done = section.checklist ? row.querySelector('[data-check]').checked : !!row.querySelector('[data-answer]').value.trim();
    row.dataset.done = String(done);
    const state = row.querySelector('.erp-discovery-state'); state.textContent = done ? '✓' : '○'; state.setAttribute('aria-label', done ? 'Completed' : 'To do');
  }));
  container.querySelector('[data-workspace-activity-date]')?.addEventListener('change', event => { workspaceActivityDate = event.currentTarget.value || localDate(); renderMain(); });
  container.querySelector('[data-job-report-date]')?.addEventListener('change', event => { jobReportDate = event.currentTarget.value || localDate(); });
  container.querySelectorAll('[data-job-report-item]').forEach(element => element.addEventListener('change', () => {
    if (element.checked) jobReportItems.add(element.dataset.jobReportItem); else jobReportItems.delete(element.dataset.jobReportItem);
    renderMain();
  }));
  container.querySelectorAll('[data-job-module]').forEach(el => el.addEventListener('toggle', () => { if (el.open) jobReportOpen.add(el.dataset.jobModule); else jobReportOpen.delete(el.dataset.jobModule); }));
  container.querySelectorAll('[data-job-select-all],[data-job-clear]').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.jobSelectAll || btn.dataset.jobClear;
    const section = catalog.moduleSections.find(item => item.id === id); if (!section) return;
    const visibleIds = [...btn.closest('details').querySelectorAll('.erp-job-screen:not([hidden]) [data-job-report-item]')].map(input => input.dataset.jobReportItem);
    for (const itemId of visibleIds) { if (btn.dataset.jobSelectAll) jobReportItems.add(itemId); else jobReportItems.delete(itemId); }
    jobReportOpen.add(id); renderMain();
  }));
  container.querySelectorAll('[data-job-expand]').forEach(btn => btn.addEventListener('click', () => {
    container.querySelectorAll('[data-job-module]').forEach(el => { el.open = btn.dataset.jobExpand === 'all'; });
  }));
  container.querySelector('[data-job-search]')?.addEventListener('input', event => {
    const q = event.currentTarget.value.trim().toLowerCase();
    container.querySelectorAll('[data-job-module]').forEach(module => {
      let hits = 0;
      module.querySelectorAll('.erp-job-screen').forEach(row => { const show = !q || row.dataset.jobText.includes(q); row.hidden = !show; if (show) hits += 1; });
      module.hidden = !!q && !hits;
      if (q && hits) module.open = true;
    });
  });
  container.querySelectorAll('[data-job-report-comment]').forEach(element => element.addEventListener('input', () => { jobReportComments.set(element.dataset.jobReportComment, element.value); }));
  container.querySelector('[data-job-report-general]')?.addEventListener('input', event => { jobReportGeneralComment = event.currentTarget.value; });
  container.querySelector('[data-job-report-number]')?.addEventListener('input', event => { jobReportNumber = event.currentTarget.value; });
  container.querySelector('[data-job-report-customer-comment]')?.addEventListener('input', event => { jobReportCustomerComment = event.currentTarget.value; });
  container.querySelector('[data-job-report-satisfaction]')?.addEventListener('change', event => { jobReportSatisfaction = event.currentTarget.value; });
  container.querySelector('[data-job-report-client]')?.addEventListener('input', event => { jobReportClientRepresentative = event.currentTarget.value; });
  container.querySelector('[data-job-report-consultant]')?.addEventListener('input', event => { jobReportConsultant = event.currentTarget.value; });
  container.querySelector('[data-complete-job-report]')?.addEventListener('click', completeJobReport);
  container.querySelectorAll('[data-workspace-status]').forEach(button => button.addEventListener('click', () => { workspaceStatusFilter = button.dataset.workspaceStatus || ''; renderMain(); }));
  container.querySelectorAll('[data-workspace-module]').forEach(button => button.addEventListener('click', () => {
    const section = catalog.moduleSections.find(item => item.id === button.dataset.workspaceSection);
    if (!section || !button.dataset.workspaceModule) return;
    activeSection = `module:${section.id}`;
    expandedNavGroup = section.group === 'stock' ? 'stock' : 'accounting';
    moduleViewFilter = '';
    expandedModuleItems.add(button.dataset.workspaceModule);
    renderShell();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
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
  container.querySelectorAll('[data-module-filter]').forEach(button => button.addEventListener('click', () => {
    moduleViewFilter = moduleViewFilter === button.dataset.moduleFilter ? '' : button.dataset.moduleFilter;
    renderMain();
  }));
  container.querySelector('[data-module-clear-filter]')?.addEventListener('click', () => { moduleViewFilter = ''; renderMain(); });
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

// On phones the section menu sits above the content, so jump to the content after choosing a section.
function scrollToSection() {
  if (window.innerWidth > 800) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const main = root.querySelector('.erp-main');
  if (main) window.scrollTo({ top: main.getBoundingClientRect().top + window.scrollY - 64, behavior: 'smooth' });
}

function bindShell() {
  root.querySelector('[data-open-job-report]')?.addEventListener('click', () => {
    activeSection = 'job-report';
    expandedNavGroup = 'workspace';
    renderShell();
    scrollToSection();
  });
  root.querySelector('[data-erp-back]')?.addEventListener('click', backToClients);
  root.querySelectorAll('[data-erp-group]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.erpGroup === 'discovery') { activeSection = 'discovery'; expandedNavGroup = 'discovery'; discoveryFilter = 'all'; renderShell(); scrollToSection(); return; }
    expandedNavGroup = expandedNavGroup === button.dataset.erpGroup ? '' : button.dataset.erpGroup;
    root.querySelectorAll('[data-erp-group]').forEach(groupButton => groupButton.setAttribute('aria-expanded', String(groupButton.dataset.erpGroup === expandedNavGroup)));
    root.querySelectorAll('[data-erp-group-items]').forEach(items => { items.hidden = items.dataset.erpGroupItems !== expandedNavGroup; });
  }));
  root.querySelectorAll('[data-erp-nav]').forEach(button => button.addEventListener('click', () => { activeSection = button.dataset.erpNav; expandedNavGroup = button.dataset.erpNavGroup; moduleViewFilter = ''; renderShell(); scrollToSection(); }));
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
  activeSection = 'overview'; discoveryFilter = 'all'; discoverySearch = ''; dirty = false; changeVersion = 0; renderShell();
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
  jobReportNumber = ''; jobReportCustomerComment = ''; jobReportSatisfaction = '';
  const found = api()?.getClients().find(item => Number(item.id) === Number(clientId));
  if (!found) { api()?.toast('Client not found.'); return; }
  client = found; project = null; documentState = blankProjectDocument(); activeSection = 'overview'; expandedNavGroup = 'workspace'; moduleViewFilter = ''; workspaceActivityDate = localDate(); workspaceStatusFilter = ''; jobReportDate = localDate(); jobReportItems = new Set(); jobReportComments = new Map(); jobReportGeneralComment = ''; jobReportClientRepresentative = found.contact || ''; jobReportConsultant = found.implementor || ''; jobReportDraftId = crypto.randomUUID(); dirty = false; changeVersion = 0;
  hideStandardViews(); root.style.display = 'block'; root.classList.add('active'); root.innerHTML = '<div class="erp-empty">Loading client workspace…</div>'; window.scrollTo({ top: 0 });
  await loadProject();
};

document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) saveProject(); });
