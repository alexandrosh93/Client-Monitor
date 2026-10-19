/* Tasks — minimal project monitoring: list + board, per client, with assignee/due/priority. */
(function () {
  const STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
  const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
  const PRIO_COLOR = { Low: '#9a9384', Normal: '#46433d', High: '#a8741a', Urgent: '#8c2f2b' };
  const api = () => window.clientMonitorApi;
  const sb = () => api().getSupabase();
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  let tasks = [];
  let loaded = false;
  let mode = 'list';
  let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let filter = { client: '', assignee: '', showDone: false, q: '' };
  const PRESETS = ['Kickoff meeting', 'Collect client requirements', 'Install server / environment', 'Company & chart of accounts setup', 'Data migration', 'User training', 'UAT / testing with client', 'Go-live', 'Post go-live follow-up', 'VAT setup & test', 'Stock take', 'Support request'];

  const root = () => document.getElementById('tasks-view');
  const GENERAL = 'General';
  const clientName = id => id ? ((api().getClients().find(c => c.id === id) || {}).name || '—') : GENERAL;
  const people = () => api().getImplementors();

  async function load() {
    const { data, error } = await sb().from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false });
    if (error) { api().toast('Tasks could not be loaded'); console.error(error); return; }
    tasks = data || []; loaded = true;
  }

  async function patch(id, fields) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    const before = { ...t };
    Object.assign(t, fields, { updated_at: new Date().toISOString() });
    if ('status' in fields) t.completed_at = fields.status === 'Done' ? new Date().toISOString() : null;
    render(); window.fillClientTasks && window.fillClientTasks(); window.renderMyTasksCard && window.renderMyTasksCard();
    const { error } = await sb().from('tasks').update({ ...fields, updated_at: t.updated_at, completed_at: t.completed_at }).eq('id', id);
    if (error) { Object.assign(t, before); render(); window.fillClientTasks(); api().toast('Save failed'); }
    else if ('status' in fields) api().audit('Edit', clientName(t.client_id), `Task "${t.title}": ${before.status} → ${fields.status}`);
  }

  async function add(e) {
    e.preventDefault();
    const f = e.target;
    const title = f.title.value.trim();
    const typed = f.client.value.trim().toLowerCase();
    const match = api().getClients().filter(c => c.name.toLowerCase() === typed);
    let clientId = null;
    if (typed && typed !== GENERAL.toLowerCase()) {
      if (match.length !== 1) { api().toast('Pick a client from the list, or leave empty for a General task'); return; }
      clientId = match[0].id;
    } else if (!typed && filter.client && filter.client !== 'none') clientId = Number(filter.client);
    if (!title) { api().toast('Task title is required'); return; }
    const row = { client_id: clientId, title, assignee: f.assignee.value, priority: f.priority.value, due_date: f.due.value || null, created_by: api().getCurrentUser() };
    const { data, error } = await sb().from('tasks').insert(row).select().single();
    if (error) { api().toast('Could not add task'); console.error(error); return; }
    tasks.push(data); f.title.value = ''; render();
    api().audit('Create', clientName(clientId), `Task added: "${title}"`);
  }

  async function remove(id) {
    const t = tasks.find(x => x.id === id); if (!t || !confirm(`Delete task "${t.title}"?`)) return;
    tasks = tasks.filter(x => x.id !== id); render();
    const { error } = await sb().from('tasks').delete().eq('id', id);
    if (error) { api().toast('Delete failed'); await load(); render(); }
  }

  const visible = () => tasks.filter(t =>
    (!filter.client || (filter.client === 'none' ? !t.client_id : String(t.client_id) === filter.client)) &&
    (!filter.assignee || t.assignee === filter.assignee) &&
    (!filter.q || (t.title + ' ' + clientName(t.client_id)).toLowerCase().includes(filter.q.toLowerCase())) &&
    (filter.showDone || mode !== 'list' || t.status !== 'Done'));

  const sel = (name, items, val, extra = '') => `<select ${extra} data-f="${name}">${items.map(i => `<option${i === val ? ' selected' : ''}>${esc(i)}</option>`).join('')}</select>`;
  function dueLabel(t) {
    if (!t.due_date) return '<span class="tk-muted">No date</span>';
    const late = t.status !== 'Done' && t.due_date < today();
    const dt = new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return `<span class="${late ? 'tk-late' : t.due_date === today() ? 'tk-today' : ''}">${dt}</span>`;
  }

  const STATUS_COLOR = { 'To do': '#7a756b', 'In progress': '#1f4d3a', 'Blocked': '#8c2f2b', 'Done': '#3e6b45' };
  const AV = ['#1f4d3a', '#6a4b6e', '#a8741a', '#3e6b45', '#8c2f2b', '#4d6a7a', '#7a5a3a', '#3b4f6b'];
  const collapsed = new Set();
  const initials = n => (n || '').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  const avColor = n => AV[[...(n || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
  const avatar = n => n ? `<span class="tk-av" style="background:${avColor(n)}" title="${esc(n)}">${esc(initials(n))}</span>` : '<span class="tk-av empty" title="Unassigned">＋</span>';
  const flag = p => `<span class="tk-flag" style="color:${PRIO_COLOR[p]}" title="${p}">⚑</span>`;

  function rowHtml(t) {
    const done = t.status === 'Done';
    return `<div class="tk-row${done ? ' done' : ''}" data-id="${t.id}">
      <button class="tk-circle" data-act="toggle" style="--c:${STATUS_COLOR[t.status]}" title="${done ? 'Reopen' : 'Mark done'}">${done ? '✓' : ''}</button>
      <input class="tk-title" value="${esc(t.title)}" data-act="title">
      ${t.client_id ? `<a class="tk-client" data-act="client">${esc(clientName(t.client_id))}</a>` : '<span class="tk-client general">General</span>'}
      <span class="tk-pick">${avatar(t.assignee)}<select data-act="assignee"><option value="">Unassigned</option>${people().map(p => `<option${p === t.assignee ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></span>
      <span class="tk-pick tk-due">${dueLabel(t)}<input type="date" value="${t.due_date || ''}" data-act="due"></span>
      <span class="tk-pick">${flag(t.priority)}<select data-act="priority">${PRIORITIES.map(p => `<option${p === t.priority ? ' selected' : ''}>${p}</option>`).join('')}</select></span>
      <span class="tk-pick"><span class="tk-pill" style="background:${STATUS_COLOR[t.status]}">${t.status}</span><select data-act="status">${STATUSES.map(s => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select></span>
      <button class="tk-x" data-act="delete" title="Delete">×</button></div>`;
  }

  function cardHtml(t) {
    return `<div class="tk-card" draggable="true" data-id="${t.id}" style="border-left:3px solid ${PRIO_COLOR[t.priority]}">
      <div class="tk-card-title">${esc(t.title)}</div>
      <div class="tk-card-meta">${t.client_id ? `<a data-act="client">${esc(clientName(t.client_id))}</a>` : '<span class="tk-client general">General</span>'}</div>
      <div class="tk-card-foot">${flag(t.priority)}${dueLabel(t)}<span style="margin-left:auto">${avatar(t.assignee)}</span></div></div>`;
  }

  function groupHtml(s, items) {
    const closed = collapsed.has(s);
    return `<section class="tk-group"><div class="tk-group-h" data-group="${s}"><span class="tk-caret">${closed ? '▸' : '▾'}</span><span class="tk-pill" style="background:${STATUS_COLOR[s]}">${s}</span><span class="tk-muted">${items.length}</span></div>${closed ? '' : items.map(rowHtml).join('')}</section>`;
  }

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function reminderEvents() {
    const q = filter.q.toLowerCase();
    const out = [];
    for (const c of api().getClients()) {
      if (filter.client && filter.client !== 'none' && String(c.id) !== filter.client) continue;
      if (filter.client === 'none') continue;
      if (filter.assignee && c.implementor !== filter.assignee) continue;
      if (q && !c.name.toLowerCase().includes(q)) continue;
      if (c.vatDate && !c.vatDone) out.push({ date: c.vatDate, label: 'VAT', client: c, color: '#856404', bg: '#fff3cd' });
      if (c.stkDate && !c.stkDone) out.push({ date: c.stkDate, label: 'Stock Take', client: c, color: '#7a6500', bg: '#fef9c3' });
      if (c.liveDate) out.push({ date: c.liveDate, label: 'Go-live', client: c, color: '#065f46', bg: '#d1fae5' });
      if (c.nextFollowupDate) out.push({ date: c.nextFollowupDate, label: 'Follow-up', client: c, color: '#15803d', bg: '#dcfce7' });
    }
    return out;
  }
  function calendarHtml(list) {
    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const first = new Date(year, month, 1), offset = (first.getDay() + 6) % 7;
    const start = new Date(year, month, 1 - offset);
    const byDate = {};
    const push = (d, html) => { (byDate[d] = byDate[d] || []).push(html); };
    list.filter(t => t.due_date).forEach(t => push(t.due_date, `<a class="cal-chip task${t.status === 'Done' ? ' done' : ''}" data-cal-task="${t.id}" style="border-left-color:${STATUS_COLOR[t.status]}" title="${esc(t.title)} · ${t.status} · ${esc(clientName(t.client_id))}">${esc(t.title)}</a>`));
    reminderEvents().forEach(r => push(r.date, `<a class="cal-chip rem" data-cal-client="${r.client.id}" style="background:${r.bg};color:${r.color}" title="${r.label} · ${esc(r.client.name)}">${r.label}: ${esc(r.client.name)}</a>`));
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), key = iso(d);
      const items = byDate[key] || [], show = items.slice(0, 3);
      cells += `<div class="cal-cell${d.getMonth() !== month ? ' other' : ''}${key === today() ? ' today' : ''}"><div class="cal-num">${d.getDate()}</div>${show.join('')}${items.length > 3 ? `<details class="cal-more"><summary>+${items.length - 3} more</summary>${items.slice(3).join('')}</details>` : ''}</div>`;
    }
    const title = calMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return `<div class="cal-head"><button class="tk-chip" data-cal-nav="-1">‹</button><div class="cal-title">${title}</div><button class="tk-chip" data-cal-nav="1">›</button><button class="tk-chip" data-cal-nav="0">Today</button>
      <span class="tk-muted" style="margin-left:auto">Tasks by due date · coloured chips are client reminders</span></div>
      <div class="cal-grid">${days.map(d => `<div class="cal-dow">${d}</div>`).join('')}${cells}</div>`;
  }

  function render() {
    const el = root(); if (!el) return;
    const list = visible();
    const clients = api().getClients().slice().sort((a, b) => a.name.localeCompare(b.name));
    const me = api().getCurrentUser();
    const open = tasks.filter(t => t.status !== 'Done').length;
    const overdue = tasks.filter(t => t.status !== 'Done' && t.due_date && t.due_date < today()).length;
    const shownStatuses = filter.showDone ? STATUSES : STATUSES.filter(s => s !== 'Done');
    el.innerHTML = `<div class="tk-wrap">
      <div class="tk-head"><div><div class="tk-h1">Tasks</div><div class="tk-muted">${open} open${overdue ? ` · <span class="tk-late">${overdue} overdue</span>` : ''}</div></div>
        <div class="tk-toggle"><button class="${mode === 'list' ? 'on' : ''}" data-mode="list">☰ List</button><button class="${mode === 'board' ? 'on' : ''}" data-mode="board">▥ Board</button><button class="${mode === 'calendar' ? 'on' : ''}" data-mode="calendar">▦ Calendar</button></div></div>
      <div class="tk-filters">
        <input class="tk-search" data-search placeholder="Search tasks or clients…" value="${esc(filter.q)}">
        <input data-filter-client list="tk-clients" placeholder="Filter by client…" value="${esc(filter.client ? (filter.client === 'none' ? GENERAL : clientName(Number(filter.client))) : '')}" autocomplete="off">
        <select data-filter="assignee"><option value="">Everyone</option>${people().map(p => `<option${p === filter.assignee ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <button class="tk-chip${filter.assignee === me ? ' on' : ''}" data-filter-me>Me</button>
        ${mode === 'list' ? `<label class="tk-muted"><input type="checkbox" data-filter-done ${filter.showDone ? 'checked' : ''}> Show done</label>` : ''}</div>
      <form class="tk-add" id="tk-add">
        <input name="title" list="tk-presets" placeholder="New task" autocomplete="off">
        <select data-template title="Predefined titles"><option value="">Templates…</option>${PRESETS.map(p => `<option>${esc(p)}</option>`).join('')}</select>
        <datalist id="tk-presets">${PRESETS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
        <input name="client" list="tk-clients" placeholder="Client (empty = General task)" value="${esc(filter.client ? (filter.client === 'none' ? GENERAL : clientName(Number(filter.client))) : '')}" autocomplete="off">
        <datalist id="tk-clients"><option value="General">${clients.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
        <select name="assignee"><option value="">Unassigned</option>${people().map(p => `<option${p === me ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <input type="date" name="due"><select name="priority">${PRIORITIES.map(p => `<option${p === 'Normal' ? ' selected' : ''}>${p}</option>`).join('')}</select>
        <button class="tk-btn">Add</button></form>
      ${!loaded ? '<div class="tk-muted">Loading…</div>' : mode === 'calendar' ? calendarHtml(list)
        : mode === 'list'
        ? (list.length ? shownStatuses.map(s => { const g = list.filter(t => t.status === s); return g.length ? groupHtml(s, g) : ''; }).join('') : '<div class="tk-empty">No tasks here. Add the first one above.</div>')
        : `<div class="tk-board">${STATUSES.map(s => { const col = list.filter(t => t.status === s); return `<div class="tk-col" data-status="${s}"><div class="tk-col-h"><span class="tk-pill" style="background:${STATUS_COLOR[s]}">${s}</span><span>${col.length}</span></div>${col.map(cardHtml).join('')}</div>`; }).join('')}</div>`}
    </div>`;
  }

  function onClick(e) {
    const nav = e.target.closest('[data-cal-nav]');
    if (nav) { const n = Number(nav.dataset.calNav); calMonth = n === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1); return render(); }
    const ct = e.target.closest('[data-cal-task]');
    if (ct) { const x = tasks.find(y => y.id === ct.dataset.calTask); if (x) { filter.q = x.title; mode = 'list'; filter.showDone = true; } return render(); }
    const cc = e.target.closest('[data-cal-client]');
    if (cc) return api().goToClient(Number(cc.dataset.calClient));
    const m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; return render(); }
    if (e.target.closest('[data-filter-me]')) { const me = api().getCurrentUser(); filter.assignee = filter.assignee === me ? '' : me; return render(); }
    const dueCell = e.target.closest('.tk-due');
    if (dueCell) { const inp = dueCell.querySelector('input[type=date]'); try { inp.showPicker(); } catch (_) { inp.focus(); } return; }
    const gh = e.target.closest('[data-group]'); if (gh) { const g = gh.dataset.group; collapsed.has(g) ? collapsed.delete(g) : collapsed.add(g); return render(); }
    const row = e.target.closest('[data-id]'); if (!row) return;
    const act = e.target.closest('[data-act]'); const id = row.dataset.id, a = act && act.dataset.act;
    if (e.target.closest('[data-act="client"]')) { const t = tasks.find(x => x.id === id); if (t.client_id) api().goToClient(t.client_id); }
    else if (a === 'delete') remove(id);
    else if (a === 'toggle') { const t = tasks.find(x => x.id === id); patch(id, { status: t.status === 'Done' ? 'To do' : 'Done' }); }
  }
  function onInput(e) {
    if (!e.target.hasAttribute('data-search')) return;
    filter.q = e.target.value; const pos = e.target.selectionStart; render();
    const n = root().querySelector('[data-search]'); n.focus(); n.setSelectionRange(pos, pos);
  }
  function onChange(e) {
    const t = e.target;
    if (t.hasAttribute('data-template')) { const f = document.getElementById('tk-add'); if (t.value) { f.title.value = t.value; f.title.focus(); } t.value = ''; return; }
    if (t.hasAttribute('data-filter-client')) {
      const v = t.value.trim().toLowerCase();
      const m = api().getClients().filter(c => c.name.toLowerCase() === v);
      if (!v) filter.client = ''; else if (v === GENERAL.toLowerCase()) filter.client = 'none'; else if (m.length === 1) filter.client = String(m[0].id); else { api().toast('Pick a client from the list'); return; }
      return render();
    }
    if (t.dataset.filter) { filter[t.dataset.filter] = t.value; return render(); }
    if (t.hasAttribute('data-filter-done')) { filter.showDone = t.checked; return render(); }
    const row = t.closest('.tk-row'); if (!row || !t.dataset.act) return;
    const map = { title: 'title', assignee: 'assignee', due: 'due_date', priority: 'priority', status: 'status' };
    const k = map[t.dataset.act]; if (!k) return;
    const v = t.value.trim ? t.value.trim() : t.value;
    if (k === 'title' && !v) return render();
    patch(row.dataset.id, { [k]: k === 'due_date' && !v ? null : v });
  }
  function bindDnD(el) {
    el.addEventListener('dragstart', e => { const c = e.target.closest('.tk-card'); if (c) e.dataTransfer.setData('text/plain', c.dataset.id); });
    el.addEventListener('dragover', e => { if (e.target.closest('.tk-col')) e.preventDefault(); });
    el.addEventListener('drop', e => {
      const col = e.target.closest('.tk-col'); if (!col) return; e.preventDefault();
      const id = e.dataTransfer.getData('text/plain'), t = tasks.find(x => x.id === id);
      if (t && t.status !== col.dataset.status) patch(id, { status: col.dataset.status });
    });
  }

  async function open(opts = {}) {
    const el = root(); if (!el) return;
    window.closeClientWorkspaceView && window.closeClientWorkspaceView();
    window.closeAiSuggestionsView && window.closeAiSuggestionsView();
    document.getElementById('home-view')?.classList.remove('active');
    const cb = document.querySelector('.control-bar'); if (cb) cb.style.display = 'none';
    ['list', 'dashboard'].forEach(i => { const n = document.getElementById(i); if (n) n.style.display = 'none'; });
    ['vbtn-home', 'vbtn-list', 'vbtn-dash'].forEach(i => document.getElementById(i)?.classList.remove('active'));
    document.getElementById('vbtn-tasks')?.classList.add('active');
    if (opts.client !== undefined) filter.client = String(opts.client || '');
    if (opts.assignee !== undefined) { filter.assignee = opts.assignee; if (opts.client === undefined) filter.client = ''; }
    el.style.display = 'block'; render();
    await load(); render();
  }
  window.closeTasksView = function () {
    const el = root(); if (el) el.style.display = 'none';
    document.getElementById('vbtn-tasks')?.classList.remove('active');
  };
  window.openTasksView = open;

  // Per-client shortcut inside the expanded client card.
  let loadTried = false;
  function clientTasksHtml(id) {
    const all = tasks.filter(t => t.client_id === id)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const open = all.filter(t => t.status !== 'Done').length;
    const rows = all.slice(0, 3).map(t => `<div class="ctk-row${t.status === 'Done' ? ' done' : ''}" data-ctk-id="${t.id}">
      <span class="ctk-title" title="${esc(t.title)}">${esc(t.title)}</span><span class="ctk-meta">${dueLabel(t)}</span>
      <span class="tk-pick"><span class="tk-pill" style="background:${STATUS_COLOR[t.status]}">${t.status}</span><select data-ctk-status>${STATUSES.map(s => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select></span></div>`).join('');
    return `<div class="ctk-head"><span class="xlbl" style="margin:0">Tasks · ${open} open</span>
      <a data-ctk-open="${id}">${all.length > 3 ? `All ${all.length}` : 'Open'} →</a></div>
      ${rows || '<div class="tk-muted">No tasks yet.</div>'}`;
  }
  window.fillClientTasks = async function () {
    const hosts = document.querySelectorAll('[data-ctk]'); if (!hosts.length) return;
    if (!loaded && !loadTried) { loadTried = true; await load(); }
    if (!loaded) return;
    document.querySelectorAll('[data-ctk]').forEach(h => {
      const keep = h.querySelector('.ctk-add')?.value;
      h.innerHTML = clientTasksHtml(Number(h.dataset.ctk));
      if (keep) h.querySelector('.ctk-add').value = keep;
    });
  };
  document.addEventListener('click', e => {
    const open = e.target.closest('[data-ctk-open]');
    if (open) { e.stopPropagation(); return window.openTasksView({ client: Number(open.dataset.ctkOpen) }); }
  });
  document.addEventListener('change', e => {
    const sel = e.target.closest && e.target.closest('[data-ctk-status]');
    if (sel) patch(sel.closest('[data-ctk-id]').dataset.ctkId, { status: sel.value });
  });

  // Home dashboard card: my open tasks that are overdue / due today.
  window.renderMyTasksCard = async function () {
    const host = document.getElementById('hv-mytasks'); if (!host) return;
    if (!loaded) await load();
    const me = api().getCurrentUser();
    const mine = tasks.filter(t => t.assignee === me && t.status !== 'Done')
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    const overdue = mine.filter(t => t.due_date && t.due_date < today()).length;
    const rows = mine.slice(0, 6).map(t => `<div class="hv-mt-row" data-ctk-id="${t.id}">
      <span class="hv-mt-due">${dueLabel(t)}</span>
      <span class="ctk-title" title="${esc(t.title)}">${esc(t.title)}</span>
      ${t.client_id ? `<a class="tk-client" onclick="goToClient(${t.client_id})">${esc(clientName(t.client_id))}</a>` : '<span class="tk-client general">General</span>'}
      <span class="tk-pick"><span class="tk-pill" style="background:${STATUS_COLOR[t.status]}">${t.status}</span><select data-ctk-status>${STATUSES.map(s => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select></span></div>`).join('');
    host.innerHTML = `<div class="hv-card" style="margin-bottom:1.25rem;">
      <div class="hv-card-hdr"><div><div class="hv-card-title">My tasks</div>
        <div style="font-size:10px;color:var(--text-3);margin-top:2px">${mine.length} open${overdue ? ` · <span class="tk-late">${overdue} overdue</span>` : ''}</div></div>
        <button class="hv-card-link" onclick="openTasksView({})">All tasks →</button></div>
      ${rows || '<div style="font-size:13px;color:var(--text-3);padding:.25rem 0">No open tasks assigned to you.</div>'}
      ${mine.length > 6 ? `<div class="tk-muted" style="padding:.35rem 0 0">+${mine.length - 6} more…</div>` : ''}</div>`;
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('tk-presets')) document.body.insertAdjacentHTML('beforeend', `<datalist id="tk-presets">${PRESETS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>`);
    const el = root(); if (!el) return;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('submit', e => { if (e.target.id === 'tk-add') add(e); });
    bindDnD(el);
  });
})();
