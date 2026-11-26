/* Tasks — per-client task tracking.
   Views: grouped list, board, calendar. Click a task to open the detail panel
   (description, checklist, assignee, due date, priority, client). */
(function () {
  const STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
  const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
  const PRIO_RANK = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
  const PRIO_COLOR = { Low: '#9ca3af', Normal: '#3b6cc7', High: '#f59e0b', Urgent: '#dc2626' };
  const STATUS_COLOR = { 'To do': '#9ca3af', 'In progress': '#3b6cc7', 'Blocked': '#dc2626', 'Done': '#10b981' };
  const AV = ['#3b6cc7', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#ef4444', '#6366f1'];
  const PRESETS = ['Kickoff meeting', 'Collect client requirements', 'Install server / environment', 'Company & chart of accounts setup', 'Data migration', 'User training', 'UAT / testing with client', 'Go-live', 'Post go-live follow-up', 'VAT setup & test', 'Stock take', 'Support request'];
  const GENERAL = 'General';

  const api = () => window.clientMonitorApi;
  const sb = () => api().getSupabase();
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => iso(new Date());
  const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const root = () => document.getElementById('tasks-view');
  const clientName = id => id ? ((api().getClients().find(c => c.id === id) || {}).name || '—') : GENERAL;
  const people = () => api().getImplementors();
  const checklistOf = t => Array.isArray(t.checklist) ? t.checklist : [];
  const newId = () => Math.random().toString(36).slice(2, 9);

  let tasks = [];
  let loaded = false;
  let mode = 'list';
  let groupBy = 'status';
  let quick = '';
  let addOpen = false;
  let filtersOpen = false;
  let openId = null;
  let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  let filter = { client: '', assignee: '', showDone: false, q: '' };
  const collapsed = new Set();
  const presets = new Map();

  /* ── data ── */
  function normalize(t) {
    if (!Array.isArray(t.checklist)) t.checklist = [];
    if (t.description == null) t.description = '';
    return t;
  }
  async function load() {
    const { data, error } = await sb().from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false });
    if (error) { api().toast('Tasks could not be loaded'); console.error(error); return; }
    tasks = (data || []).map(normalize); loaded = true;
  }

  function refreshOthers() {
    window.fillClientTasks && window.fillClientTasks();
    window.renderMyTasksCard && window.renderMyTasksCard();
  }

  async function patch(id, fields) {
    const t = tasks.find(x => x.id === id); if (!t) return;
    const before = { ...t };
    Object.assign(t, fields, { updated_at: new Date().toISOString() });
    if ('status' in fields) t.completed_at = fields.status === 'Done' ? new Date().toISOString() : null;
    render(); refreshOthers();
    const { error } = await sb().from('tasks').update({ ...fields, updated_at: t.updated_at, completed_at: t.completed_at }).eq('id', id);
    if (error) {
      Object.assign(t, before); render(); refreshOthers(); if (openId === id) renderDrawer();
      console.error(error);
      api().toast(/description|checklist/i.test(String(error.message || '')) ? 'Run 13_tasks_details.sql in Supabase to save descriptions and checklists' : 'Save failed');
    } else if ('status' in fields) api().audit('Edit', clientName(t.client_id), `Task "${t.title}": ${before.status} → ${fields.status}`);
  }

  async function insertTask(row) {
    const me = api().getCurrentUser();
    const full = { status: 'To do', priority: 'Normal', assignee: '', due_date: null, client_id: null, created_by: me, ...row };
    const { data, error } = await sb().from('tasks').insert(full).select().single();
    if (error) { api().toast('Could not add task'); console.error(error); return null; }
    tasks.push(normalize(data)); render(); refreshOthers();
    api().audit('Create', clientName(full.client_id), `Task added: "${full.title}"`);
    return data;
  }

  // Client picked from a text box: '' or "General" → no client; exact name → id; anything else → undefined (invalid).
  function clientFromText(text) {
    const v = String(text || '').trim().toLowerCase();
    if (!v || v === GENERAL.toLowerCase()) return null;
    const m = api().getClients().filter(c => c.name.toLowerCase() === v);
    return m.length === 1 ? m[0].id : undefined;
  }

  async function add(e) {
    e.preventDefault();
    const f = e.target;
    const title = f.title.value.trim();
    if (!title) { api().toast('Task title is required'); return; }
    let clientId = clientFromText(f.client.value);
    if (clientId === undefined) { api().toast('Pick a client from the list, or leave empty for a General task'); return; }
    if (!f.client.value.trim() && filter.client && filter.client !== 'none') clientId = Number(filter.client);
    f.title.value = ''; // clear first, otherwise render() would restore the old text
    const made = await insertTask({ client_id: clientId, title, assignee: f.assignee.value, priority: f.priority.value, due_date: f.due.value || null });
    if (made) { const n = root().querySelector('#tk-add [name=title]'); if (n) n.focus(); }
  }

  async function quickAdd(title, key) {
    const preset = presets.get(key) || {};
    const defaultClient = filter.client && filter.client !== 'none' ? Number(filter.client) : null;
    const made = await insertTask({ title, assignee: api().getCurrentUser(), client_id: defaultClient, ...preset });
    if (made) { const n = root().querySelector(`[data-qa="${CSS.escape(key)}"]`); if (n) n.focus(); }
  }

  async function remove(id) {
    const t = tasks.find(x => x.id === id); if (!t || !confirm(`Delete task "${t.title}"?`)) return false;
    tasks = tasks.filter(x => x.id !== id); render(); refreshOthers();
    const { error } = await sb().from('tasks').delete().eq('id', id);
    if (error) { api().toast('Delete failed'); await load(); render(); refreshOthers(); }
    return true;
  }

  /* ── filtering / grouping ── */
  function quickOK(t) {
    const td = today();
    switch (quick) {
      case 'me': return t.assignee === api().getCurrentUser();
      case 'overdue': return t.status !== 'Done' && t.due_date && t.due_date < td;
      case 'week': return t.status !== 'Done' && t.due_date && t.due_date >= td && t.due_date <= addDays(7);
      case 'nodate': return !t.due_date;
      default: return true;
    }
  }
  const visible = () => tasks.filter(t =>
    (!filter.client || (filter.client === 'none' ? !t.client_id : String(t.client_id) === filter.client)) &&
    (!filter.assignee || t.assignee === filter.assignee) &&
    (!filter.q || (t.title + ' ' + clientName(t.client_id)).toLowerCase().includes(filter.q.toLowerCase())) &&
    quickOK(t) &&
    (filter.showDone || mode !== 'list' || t.status !== 'Done'));
  const sortTasks = list => list.slice().sort((a, b) =>
    (a.due_date || '9999').localeCompare(b.due_date || '9999') ||
    (PRIO_RANK[a.priority] - PRIO_RANK[b.priority]) ||
    (a.created_at || '').localeCompare(b.created_at || ''));

  function groupsFor(list) {
    const items = sortTasks(list);
    if (groupBy === 'none') { presets.set('all', {}); return [{ key: 'all', label: 'All tasks', items }]; }
    let groups = [];
    if (groupBy === 'status') {
      groups = STATUSES.filter(s => filter.showDone || s !== 'Done').map(s => ({ key: s, label: s, color: STATUS_COLOR[s], items: items.filter(t => t.status === s), preset: { status: s } }));
    } else if (groupBy === 'assignee') {
      const names = [...new Set([...people(), ...items.map(t => t.assignee).filter(Boolean)])];
      groups = names.map(n => ({ key: 'a:' + n, label: n, avatar: n, items: items.filter(t => t.assignee === n), preset: { assignee: n } }));
      groups.push({ key: 'a:', label: 'Unassigned', items: items.filter(t => !t.assignee), preset: { assignee: '' } });
    } else if (groupBy === 'client') {
      const ids = [...new Set(items.map(t => t.client_id || null))].sort((a, b) => (a === null) - (b === null) || clientName(a).localeCompare(clientName(b)));
      groups = ids.map(id => ({ key: 'c:' + (id || ''), label: clientName(id), items: items.filter(t => (t.client_id || null) === id), preset: { client_id: id } }));
    } else if (groupBy === 'due') {
      const td = today(), wk = addDays(7), open = items.filter(t => t.status !== 'Done');
      groups = [
        { key: 'd:late', label: 'Overdue', color: '#c0392b', items: open.filter(t => t.due_date && t.due_date < td), preset: { due_date: td } },
        { key: 'd:today', label: 'Today', color: '#b7791f', items: open.filter(t => t.due_date === td), preset: { due_date: td } },
        { key: 'd:week', label: 'Next 7 days', color: '#3b6cc7', items: open.filter(t => t.due_date > td && t.due_date <= wk), preset: { due_date: addDays(1) } },
        { key: 'd:later', label: 'Later', items: open.filter(t => t.due_date > wk), preset: { due_date: addDays(14) } },
        { key: 'd:none', label: 'No date', items: open.filter(t => !t.due_date), preset: {} },
        { key: 'd:done', label: 'Done', color: STATUS_COLOR.Done, items: items.filter(t => t.status === 'Done'), preset: { status: 'Done' } },
      ];
    }
    groups.forEach(g => presets.set(g.key, g.preset || {}));
    return groups.filter(g => g.items.length);
  }

  /* ── small renderers ── */
  const initials = n => (n || '').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  const avColor = n => AV[[...(n || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
  const avatar = n => n ? `<span class="tk-av" style="background:${avColor(n)}" title="${esc(n)}">${esc(initials(n))}</span>` : '<span class="tk-av empty" title="Unassigned">＋</span>';
  const flag = p => `<span class="tk-flag" style="color:${PRIO_COLOR[p]}" title="${p}">⚑</span>`;
  const clientChip = t => t.client_id ? `<a class="tk-client" data-act="client">${esc(clientName(t.client_id))}</a>` : '<span class="tk-client general">General</span>';

  function dueChip(t) {
    if (!t.due_date) return '<span class="tk-muted tk-nodate">No date</span>';
    const td = today();
    let cls = 'later', txt = fmtDate(t.due_date);
    if (t.status === 'Done') cls = 'done';
    else if (t.due_date < td) cls = 'late';
    else if (t.due_date === td) { cls = 'today'; txt = 'Today'; }
    else if (t.due_date === addDays(1)) { cls = 'soon'; txt = 'Tomorrow'; }
    else if (t.due_date <= addDays(7)) cls = 'soon';
    return `<span class="tk-dchip ${cls}">${txt}</span>`;
  }
  function badges(t) {
    const cl = checklistOf(t), done = cl.filter(x => x.done).length;
    return (cl.length ? `<span class="tk-bd${done === cl.length ? ' ok' : ''}" title="Checklist">✓ ${done}/${cl.length}</span>` : '') +
      (t.description ? '<span class="tk-bd" title="Has a description">≡</span>' : '');
  }
  const statusSelect = t => `<span class="tk-pick"><span class="tk-pill" style="background:${STATUS_COLOR[t.status]}">${t.status}</span><select data-act="status">${STATUSES.map(s => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select></span>`;

  function rowHtml(t) {
    const done = t.status === 'Done';
    return `<div class="tk-row${done ? ' done' : ''}" data-id="${t.id}">
      <button class="tk-circle" data-act="toggle" style="--c:${STATUS_COLOR[t.status]}" title="${done ? 'Reopen' : 'Mark done'}">${done ? '✓' : ''}</button>
      <div class="tk-tcell"><span class="tk-title" data-act="open" title="Open details">${esc(t.title)}</span>${badges(t)}</div>
      ${clientChip(t)}
      <span class="tk-pick">${avatar(t.assignee)}<select data-act="assignee"><option value="">Unassigned</option>${people().map(p => `<option${p === t.assignee ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></span>
      <span class="tk-pick tk-due">${dueChip(t)}<input type="date" value="${t.due_date || ''}" data-act="due"></span>
      <span class="tk-pick">${flag(t.priority)}<select data-act="priority">${PRIORITIES.map(p => `<option${p === t.priority ? ' selected' : ''}>${p}</option>`).join('')}</select></span>
      ${statusSelect(t)}
      <button class="tk-x" data-act="delete" title="Delete">×</button></div>`;
  }

  function cardHtml(t) {
    const hot = t.priority === 'Urgent' || t.priority === 'High';
    return `<div class="tk-card${t.status === 'Done' ? ' done' : ''}" draggable="true" data-id="${t.id}" data-act="open">
      ${hot ? `<span class="tk-prio" style="background:${PRIO_COLOR[t.priority]}">${t.priority}</span>` : ''}
      <div class="tk-card-title">${esc(t.title)}</div>
      <div class="tk-card-meta">${t.client_id ? `<span class="tk-client">${esc(clientName(t.client_id))}</span>` : '<span class="tk-client general">General</span>'}</div>
      <div class="tk-card-foot"><span class="tk-bds">${t.due_date ? dueChip(t) : ''}${badges(t)}</span><span style="margin-left:auto">${avatar(t.assignee)}</span></div></div>`;
  }

  function groupHtml(g) {
    const closed = collapsed.has(g.key);
    const head = g.color ? `<span class="tk-pill" style="background:${g.color}">${esc(g.label)}</span>` : `${g.avatar ? avatar(g.avatar) : ''}<span class="tk-gl">${esc(g.label)}</span>`;
    return `<section class="tk-group"><div class="tk-group-h" data-group="${esc(g.key)}"><span class="tk-caret">${closed ? '▸' : '▾'}</span>${head}<span class="tk-muted">${g.items.length}</span></div>${closed ? '' : g.items.map(rowHtml).join('') + `<div class="tk-qa-row"><input class="tk-qa" data-qa="${esc(g.key)}" placeholder="+ Add task" autocomplete="off"></div>`}</section>`;
  }

  function listHtml(list) {
    const groups = groupsFor(list);
    return groups.length ? groups.map(groupHtml).join('') : '<div class="tk-empty">No tasks here. Type a title above and press Enter.</div>';
  }
  function boardHtml(list) {
    const items = sortTasks(list);
    return `<div class="tk-board">${STATUSES.map(s => {
      const col = items.filter(t => t.status === s);
      presets.set('col:' + s, { status: s });
      return `<div class="tk-col" data-status="${s}"><div class="tk-col-h"><span class="tk-pill" style="background:${STATUS_COLOR[s]}">${s}</span><span>${col.length}</span></div>${col.map(cardHtml).join('')}<input class="tk-qa" data-qa="col:${s}" placeholder="+ Add a card" autocomplete="off"></div>`;
    }).join('')}</div>`;
  }

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
    presets.clear();
    const prev = el.querySelector('#tk-add [name=title]');
    const keepTitle = prev ? prev.value : '', hadFocus = !!prev && document.activeElement === prev;
    const list = visible();
    const clients = api().getClients().slice().sort((a, b) => a.name.localeCompare(b.name));
    const me = api().getCurrentUser(), td = today(), wk = addDays(7);
    const openTasks = tasks.filter(t => t.status !== 'Done');
    const overdue = openTasks.filter(t => t.due_date && t.due_date < td).length;
    const week = openTasks.filter(t => t.due_date && t.due_date >= td && t.due_date <= wk).length;
    const clientText = filter.client ? (filter.client === 'none' ? GENERAL : clientName(Number(filter.client))) : '';
    const chip = (key, label, n, red) => `<button class="tk-chip${quick === key ? ' on' : ''}" data-quick="${key}">${label}${n ? ` <span class="tk-n${red ? ' red' : ''}">${n}</span>` : ''}</button>`;
    el.innerHTML = `<div class="tk-wrap">
      <div class="tk-head"><div><div class="tk-h1">Tasks</div><div class="tk-muted">${openTasks.length} open${overdue ? ` · <span class="tk-late">${overdue} overdue</span>` : ''}</div></div>
        <div class="tk-toggle"><button class="${mode === 'list' ? 'on' : ''}" data-mode="list">☰ List</button><button class="${mode === 'board' ? 'on' : ''}" data-mode="board">▥ Board</button><button class="${mode === 'calendar' ? 'on' : ''}" data-mode="calendar">▦ Calendar</button></div></div>
      <form class="tk-add" id="tk-add">
        <input name="title" list="tk-presets" placeholder="Add a task and press Enter  (shortcut: C)" autocomplete="off">
        <button class="tk-btn">Add</button>
        <button type="button" class="tk-chip" data-add-more>${addOpen ? 'Less ▴' : 'Options ▾'}</button>
        <div class="tk-add-more${addOpen ? ' open' : ''}">
          <select data-template title="Predefined titles"><option value="">Templates…</option>${PRESETS.map(p => `<option>${esc(p)}</option>`).join('')}</select>
          <datalist id="tk-presets">${PRESETS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
          <input name="client" list="tk-clients" placeholder="Client (empty = General task)" value="${esc(clientText)}" autocomplete="off">
          <datalist id="tk-clients"><option value="General">${clients.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
          <select name="assignee"><option value="">Unassigned</option>${people().map(p => `<option${p === me ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
          <input type="date" name="due"><select name="priority">${PRIORITIES.map(p => `<option${p === 'Normal' ? ' selected' : ''}>${p}</option>`).join('')}</select>
        </div></form>
      <div class="tk-filters">
        <input class="tk-search" data-search placeholder="Search tasks or clients…  ( / )" value="${esc(filter.q)}">
        <button type="button" class="tk-chip tk-ftoggle${filtersOpen ? ' on' : ''}" data-filters-toggle>Filters ${filtersOpen ? '▴' : '▾'}</button>
        <div class="tk-chips">${chip('', 'All')}${chip('me', 'Me')}${chip('overdue', 'Overdue', overdue, true)}${chip('week', 'Next 7 days', week)}${chip('nodate', 'No date')}</div>
        <div class="tk-fsec${filtersOpen ? ' open' : ''}">
          <input data-filter-client list="tk-clients" placeholder="Filter by client…" value="${esc(clientText)}" autocomplete="off">
          <select data-filter="assignee"><option value="">Everyone</option>${people().map(p => `<option${p === filter.assignee ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
          ${mode === 'list' ? `<label class="tk-muted tk-gb">Group by <select data-group-by>${[['status', 'Status'], ['assignee', 'Assignee'], ['client', 'Client'], ['due', 'Due date'], ['none', 'None']].map(([v, l]) => `<option value="${v}"${v === groupBy ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="tk-muted"><input type="checkbox" data-filter-done ${filter.showDone ? 'checked' : ''}> Show done</label>` : ''}</div></div>
      ${!loaded ? '<div class="tk-muted">Loading…</div>' : mode === 'calendar' ? calendarHtml(list) : mode === 'list' ? listHtml(list) : boardHtml(list)}
    </div>`;
    if (keepTitle) { const n = el.querySelector('#tk-add [name=title]'); if (n) { n.value = keepTitle; if (hadFocus) n.focus(); } }
  }

  /* ── list / board events ── */
  function onClick(e) {
    const nav = e.target.closest('[data-cal-nav]');
    if (nav) { const n = Number(nav.dataset.calNav); calMonth = n === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1); return render(); }
    const ct = e.target.closest('[data-cal-task]'); if (ct) return openDrawer(ct.dataset.calTask);
    const cc = e.target.closest('[data-cal-client]'); if (cc) return api().goToClient(Number(cc.dataset.calClient));
    const m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; return render(); }
    const q = e.target.closest('[data-quick]'); if (q) { quick = q.dataset.quick; return render(); }
    if (e.target.closest('[data-add-more]')) { addOpen = !addOpen; return render(); }
    if (e.target.closest('[data-filters-toggle]')) { filtersOpen = !filtersOpen; return render(); }
    const dueCell = e.target.closest('.tk-due');
    if (dueCell) { const inp = dueCell.querySelector('input[type=date]'); try { inp.showPicker(); } catch (_) { inp.focus(); } return; }
    const gh = e.target.closest('[data-group]'); if (gh) { const g = gh.dataset.group; collapsed.has(g) ? collapsed.delete(g) : collapsed.add(g); return render(); }
    const row = e.target.closest('[data-id]'); if (!row) return;
    const act = e.target.closest('[data-act]'); const id = row.dataset.id, a = act && act.dataset.act;
    if (a === 'client') { const t = tasks.find(x => x.id === id); if (t && t.client_id) api().goToClient(t.client_id); }
    else if (a === 'delete') remove(id);
    else if (a === 'toggle') { const t = tasks.find(x => x.id === id); patch(id, { status: t.status === 'Done' ? 'To do' : 'Done' }); }
    else if (a === 'open') openDrawer(id);
  }
  function onInput(e) {
    if (!e.target.hasAttribute('data-search')) return;
    filter.q = e.target.value; const pos = e.target.selectionStart; render();
    const n = root().querySelector('[data-search]'); n.focus(); n.setSelectionRange(pos, pos);
  }
  function onChange(e) {
    const t = e.target;
    if (t.hasAttribute('data-template')) { const f = document.getElementById('tk-add'); if (t.value) { f.title.value = t.value; f.title.focus(); } t.value = ''; return; }
    if (t.hasAttribute('data-group-by')) { groupBy = t.value; return render(); }
    if (t.hasAttribute('data-filter-client')) {
      const v = clientFromText(t.value);
      if (v === undefined) { api().toast('Pick a client from the list'); return; }
      filter.client = v === null ? (t.value.trim() ? 'none' : '') : String(v);
      return render();
    }
    if (t.dataset.filter) { filter[t.dataset.filter] = t.value; return render(); }
    if (t.hasAttribute('data-filter-done')) { filter.showDone = t.checked; return render(); }
    const row = t.closest('.tk-row'); if (!row || !t.dataset.act) return;
    const map = { assignee: 'assignee', due: 'due_date', priority: 'priority', status: 'status' };
    const k = map[t.dataset.act]; if (!k) return;
    const v = t.value;
    patch(row.dataset.id, { [k]: k === 'due_date' && !v ? null : v });
  }
  function onKey(e) {
    const qa = e.target.closest && e.target.closest('[data-qa]'); if (!qa) return;
    if (e.key === 'Enter') { e.preventDefault(); const v = qa.value.trim(); if (v) { qa.value = ''; quickAdd(v, qa.dataset.qa); } }
    else if (e.key === 'Escape') { qa.value = ''; qa.blur(); }
  }
  function bindDnD(el) {
    let dragId = '';
    el.addEventListener('dragstart', e => { const c = e.target.closest('.tk-card'); if (c) { dragId = c.dataset.id; e.dataTransfer.setData('text/plain', dragId); c.classList.add('dragging'); } });
    el.addEventListener('dragend', e => { e.target.closest && e.target.closest('.tk-card')?.classList.remove('dragging'); el.querySelectorAll('.tk-col.over').forEach(c => c.classList.remove('over')); });
    el.addEventListener('dragover', e => { const col = e.target.closest('.tk-col'); if (col) { e.preventDefault(); col.classList.add('over'); } });
    el.addEventListener('dragleave', e => { const col = e.target.closest('.tk-col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
    el.addEventListener('drop', e => {
      const col = e.target.closest('.tk-col'); if (!col) return; e.preventDefault(); col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain') || dragId, t = tasks.find(x => x.id === id);
      if (t && t.status !== col.dataset.status) patch(id, { status: col.dataset.status });
    });
  }

  /* ── detail panel (Trello "card back" / Linear peek) ── */
  let drawer = null, drawerBg = null;
  function ensureDrawer() {
    if (drawer) return drawer;
    document.getElementById('protected-app').insertAdjacentHTML('beforeend', '<div id="tk-drawer-bg" class="no-print"></div><aside id="tk-drawer" class="no-print" role="dialog" aria-label="Task details"></aside>');
    drawer = document.getElementById('tk-drawer'); drawerBg = document.getElementById('tk-drawer-bg');
    drawerBg.addEventListener('click', closeDrawer);
    drawer.addEventListener('click', onDrawerClick);
    drawer.addEventListener('change', onDrawerChange);
    drawer.addEventListener('keydown', onDrawerKey);
    drawer.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.d === 'title') autosizeTitle(); });
    return drawer;
  }
  function openDrawer(id) {
    if (!tasks.find(x => x.id === id)) return;
    ensureDrawer(); openId = id; renderDrawer();
    drawer.classList.add('open'); drawerBg.classList.add('open');
    autosizeTitle();
  }
  function closeDrawer() {
    if (!drawer) return;
    if (drawer.contains(document.activeElement)) document.activeElement.blur(); // commits a pending edit
    drawer.classList.remove('open'); drawerBg.classList.remove('open'); openId = null;
  }
  function renderDrawer() {
    const t = tasks.find(x => x.id === openId); if (!t) return closeDrawer();
    const cl = checklistOf(t), done = cl.filter(x => x.done).length, pct = cl.length ? Math.round(done / cl.length * 100) : 0;
    const clients = api().getClients().slice().sort((a, b) => a.name.localeCompare(b.name));
    drawer.innerHTML = `
      <div class="tkd-head">${t.client_id ? `<a class="tkd-client" data-d="client">${esc(clientName(t.client_id))} →</a>` : '<span class="tk-client general">General</span>'}<button class="tkd-x" data-d="close" aria-label="Close">×</button></div>
      <div class="tkd-body">
        <textarea class="tkd-title" data-d="title" rows="1" aria-label="Title">${esc(t.title)}</textarea>
        <div class="tkd-seg" role="group" aria-label="Status">${STATUSES.map(s => `<button class="${t.status === s ? 'on' : ''}" style="--c:${STATUS_COLOR[s]}" data-d="status" data-v="${s}">${s}</button>`).join('')}</div>
        <div class="tkd-grid">
          <label><span>Assignee</span><select data-d="assignee"><option value="">Unassigned</option>${people().map(p => `<option${p === t.assignee ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
          <label><span>Priority</span><select data-d="priority">${PRIORITIES.map(p => `<option${p === t.priority ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
          <label class="wide"><span>Due date</span><div class="tkd-due"><input type="date" data-d="due" value="${t.due_date || ''}"><button type="button" data-d="dueq" data-v="0">Today</button><button type="button" data-d="dueq" data-v="1">Tomorrow</button><button type="button" data-d="dueq" data-v="7">Next week</button><button type="button" data-d="dueq" data-v="">Clear</button></div></label>
          <label class="wide"><span>Client</span><input data-d="client-input" list="tkd-clients" value="${esc(t.client_id ? clientName(t.client_id) : '')}" placeholder="General (no client)" autocomplete="off"><datalist id="tkd-clients"><option value="General">${clients.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></label>
        </div>
        <label class="tkd-sec"><span class="tkd-lbl">Description</span><textarea data-d="description" rows="4" placeholder="Add more details…">${esc(t.description || '')}</textarea></label>
        <div class="tkd-sec"><span class="tkd-lbl">Checklist ${cl.length ? `<b>${done}/${cl.length}</b>` : ''}</span>
          ${cl.length ? `<div class="tkd-prog"><i style="width:${pct}%"></i></div>` : ''}
          <ul class="tkd-list">${cl.map(i => `<li data-ci="${i.id}"><input type="checkbox" data-d="ci-toggle" ${i.done ? 'checked' : ''}><span class="${i.done ? 'done' : ''}">${esc(i.text)}</span><button type="button" data-d="ci-del" aria-label="Remove item">×</button></li>`).join('')}</ul>
          <input class="tkd-ci-add" data-d="ci-add" placeholder="Add an item and press Enter" autocomplete="off">
        </div>
      </div>
      <div class="tkd-foot"><span class="tk-muted">Created${t.created_by ? ' by ' + esc(t.created_by) : ''}${t.created_at ? ' · ' + esc(new Date(t.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })) : ''}</span><button type="button" class="tkd-del" data-d="delete">Delete task</button></div>`;
    autosizeTitle();
  }
  function autosizeTitle() {
    const ta = drawer && drawer.querySelector('.tkd-title');
    if (ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  }
  function mutateChecklist(fn) {
    const t = tasks.find(x => x.id === openId); if (!t) return;
    const list = checklistOf(t).map(x => ({ ...x })); fn(list);
    patch(openId, { checklist: list });
  }
  async function onDrawerClick(e) {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const d = b.dataset.d, t = tasks.find(x => x.id === openId); if (!t) return;
    if (d === 'close') closeDrawer();
    else if (d === 'status') { patch(openId, { status: b.dataset.v }); renderDrawer(); }
    else if (d === 'dueq') { const v = b.dataset.v; patch(openId, { due_date: v === '' ? null : addDays(Number(v)) }); renderDrawer(); }
    else if (d === 'client' && t.client_id) { const id = t.client_id; closeDrawer(); api().goToClient(id); }
    else if (d === 'ci-del') { const id = b.closest('li').dataset.ci; mutateChecklist(l => { const i = l.findIndex(x => x.id === id); if (i >= 0) l.splice(i, 1); }); renderDrawer(); }
    else if (d === 'delete') { if (await remove(openId)) closeDrawer(); }
  }
  function onDrawerChange(e) {
    const el = e.target, d = el.dataset.d, t = tasks.find(x => x.id === openId); if (!d || !t) return;
    if (d === 'title') { const v = el.value.trim(); if (!v) return renderDrawer(); if (v !== t.title) patch(openId, { title: v }); }
    else if (d === 'assignee') patch(openId, { assignee: el.value });
    else if (d === 'priority') patch(openId, { priority: el.value });
    else if (d === 'due') { patch(openId, { due_date: el.value || null }); renderDrawer(); }
    else if (d === 'client-input') {
      const v = clientFromText(el.value);
      if (v === undefined) { api().toast('Pick a client from the list, or leave empty for General'); return renderDrawer(); }
      patch(openId, { client_id: v }); renderDrawer();
    }
    else if (d === 'description') { if (el.value !== (t.description || '')) patch(openId, { description: el.value }); }
    else if (d === 'ci-toggle') { const id = el.closest('li').dataset.ci; mutateChecklist(l => { const i = l.find(x => x.id === id); if (i) i.done = el.checked; }); renderDrawer(); }
  }
  function onDrawerKey(e) {
    const d = e.target.dataset && e.target.dataset.d;
    if (d === 'title' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    else if (d === 'ci-add' && e.key === 'Enter') {
      e.preventDefault(); const v = e.target.value.trim(); if (!v) return;
      mutateChecklist(l => l.push({ id: newId(), text: v.slice(0, 300), done: false })); renderDrawer();
      drawer.querySelector('[data-d="ci-add"]')?.focus();
    }
  }
  window.openTaskDrawer = openDrawer;

  /* ── page open / close ── */
  async function open(opts = {}) {
    const el = root(); if (!el || !window.clientMonitorApi.setProtectedRoute('tasks')) return;
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
    closeDrawer();
    const el = root(); if (el) el.style.display = 'none';
    document.getElementById('vbtn-tasks')?.classList.remove('active');
  };
  window.openTasksView = open;

  /* ── per-client shortcut inside the expanded client card ── */
  let loadTried = false;
  function clientTasksHtml(id) {
    const all = tasks.filter(t => t.client_id === id).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const openCount = all.filter(t => t.status !== 'Done').length;
    const rows = all.slice(0, 3).map(t => `<div class="ctk-row${t.status === 'Done' ? ' done' : ''}" data-ctk-id="${t.id}">
      <span class="ctk-title" title="${esc(t.title)}">${esc(t.title)}</span><span class="ctk-meta">${dueChip(t)}</span>
      <span class="tk-pick"><span class="tk-pill" style="background:${STATUS_COLOR[t.status]}">${t.status}</span><select data-ctk-status>${STATUSES.map(s => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select></span></div>`).join('');
    return `<div class="ctk-head"><span class="xlbl" style="margin:0">✓ Tasks · ${openCount} open</span>
      <a data-ctk-open="${id}">${all.length > 3 ? `All ${all.length}` : 'Open'} →</a></div>
      ${rows || '<div class="tk-muted">No tasks yet.</div>'}`;
  }
  window.fillClientTasks = async function () {
    const hosts = document.querySelectorAll('[data-ctk]'); if (!hosts.length) return;
    if (!loaded && !loadTried) { loadTried = true; await load(); }
    if (!loaded) return;
    document.querySelectorAll('[data-ctk]').forEach(h => { h.innerHTML = clientTasksHtml(Number(h.dataset.ctk)); });
  };
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-ctk-open]');
    if (o) { e.stopPropagation(); return window.openTasksView({ client: Number(o.dataset.ctkOpen) }); }
    const t = e.target.closest('.ctk-title');
    if (t) { const row = t.closest('[data-ctk-id]'); if (row) { e.stopPropagation(); openDrawer(row.dataset.ctkId); } }
  });
  document.addEventListener('change', e => {
    const sel = e.target.closest && e.target.closest('[data-ctk-status]');
    if (sel) patch(sel.closest('[data-ctk-id]').dataset.ctkId, { status: sel.value });
  });

  /* ── Home dashboard card: my open tasks ── */
  window.renderMyTasksCard = async function () {
    const host = document.getElementById('hv-mytasks'); if (!host) return;
    if (!loaded) await load();
    const me = api().getCurrentUser();
    const mine = tasks.filter(t => t.assignee === me && t.status !== 'Done').sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    const overdue = mine.filter(t => t.due_date && t.due_date < today()).length;
    const rows = mine.slice(0, 6).map(t => `<div class="hv-mt-row" data-ctk-id="${t.id}">
      <span class="hv-mt-due">${dueChip(t)}</span>
      <span class="ctk-title" title="${esc(t.title)}">${esc(t.title)}</span>
      ${t.client_id ? `<a class="tk-client" onclick="goToClient(${t.client_id})">${esc(clientName(t.client_id))}</a>` : '<span class="tk-client general">General</span>'}
      <span class="tk-pick"><span class="tk-pill" style="background:${STATUS_COLOR[t.status]}">${t.status}</span><select data-ctk-status>${STATUSES.map(s => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select></span></div>`).join('');
    host.innerHTML = `<div class="hv-card" style="margin-bottom:1.25rem">
      <div class="hv-card-hdr"><div><div class="hv-card-title">✓ My Tasks</div>
        <div style="font-size:10px;color:var(--text-3);margin-top:2px">${mine.length} open${overdue ? ` · <span class="tk-late">${overdue} overdue</span>` : ''}</div></div>
        <button class="hv-card-link" onclick="openTasksView({})">All tasks →</button></div>
      ${rows || '<div style="font-size:13px;color:var(--text-3);padding:.25rem 0">No open tasks assigned to you. ✓</div>'}
      ${mine.length > 6 ? `<div class="tk-muted" style="padding:.35rem 0 0">+${mine.length - 6} more…</div>` : ''}</div>`;
  };

  /* ── keyboard: C = new task, / = search, Esc = close panel ── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && openId) { closeDrawer(); return; }
    const el = root(); if (!el || el.style.display !== 'block') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === 'c') { e.preventDefault(); el.querySelector('#tk-add [name=title]')?.focus(); }
    else if (e.key === '/') { e.preventDefault(); el.querySelector('[data-search]')?.focus(); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('tk-presets')) document.body.insertAdjacentHTML('beforeend', `<datalist id="tk-presets">${PRESETS.map(p => `<option value="${esc(p)}">`).join('')}</datalist>`);
    const el = root(); if (!el) return;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    el.addEventListener('submit', e => { if (e.target.id === 'tk-add') add(e); });
    bindDnD(el);
  });
})();
