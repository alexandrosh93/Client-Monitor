/* Tasks — minimal project monitoring: list + board, per client, with assignee/due/priority. */
(function () {
  const STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
  const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
  const PRIO_COLOR = { Low: '#9ca3af', Normal: '#3b6cc7', High: '#f59e0b', Urgent: '#dc2626' };
  const api = () => window.clientMonitorApi;
  const sb = () => api().getSupabase();
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  let tasks = [];
  let loaded = false;
  let mode = 'list';
  let filter = { client: '', assignee: '', showDone: false };

  const root = () => document.getElementById('tasks-view');
  const clientName = id => (api().getClients().find(c => c.id === id) || {}).name || '—';
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
    render();
    const { error } = await sb().from('tasks').update({ ...fields, updated_at: t.updated_at, completed_at: t.completed_at }).eq('id', id);
    if (error) { Object.assign(t, before); render(); api().toast('Save failed'); }
    else if ('status' in fields) api().audit('Edit', clientName(t.client_id), `Task "${t.title}": ${before.status} → ${fields.status}`);
  }

  async function add(e) {
    e.preventDefault();
    const f = e.target;
    const title = f.title.value.trim(), clientId = Number(f.client.value);
    if (!title || !clientId) { api().toast('Task title and client are required'); return; }
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
    (!filter.client || String(t.client_id) === filter.client) &&
    (!filter.assignee || t.assignee === filter.assignee) &&
    (filter.showDone || mode === 'board' || t.status !== 'Done'));

  const sel = (name, items, val, extra = '') => `<select ${extra} data-f="${name}">${items.map(i => `<option${i === val ? ' selected' : ''}>${esc(i)}</option>`).join('')}</select>`;
  function dueLabel(t) {
    if (!t.due_date) return '<span class="tk-muted">No date</span>';
    const late = t.status !== 'Done' && t.due_date < today();
    const dt = new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    return `<span class="${late ? 'tk-late' : t.due_date === today() ? 'tk-today' : ''}">${late ? '⚠ ' : ''}${dt}</span>`;
  }

  function rowHtml(t) {
    return `<div class="tk-row${t.status === 'Done' ? ' done' : ''}" data-id="${t.id}">
      <input type="checkbox" ${t.status === 'Done' ? 'checked' : ''} data-act="toggle" title="Mark done">
      <input class="tk-title" value="${esc(t.title)}" data-act="title">
      <a class="tk-client" data-act="client">${esc(clientName(t.client_id))}</a>
      <select data-act="assignee"><option value="">Unassigned</option>${people().map(p => `<option${p === t.assignee ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <input type="date" value="${t.due_date || ''}" data-act="due">
      <select data-act="priority" style="color:${PRIO_COLOR[t.priority]}">${PRIORITIES.map(p => `<option${p === t.priority ? ' selected' : ''}>${p}</option>`).join('')}</select>
      <select data-act="status">${STATUSES.map(s => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
      <button class="tk-x" data-act="delete" title="Delete">×</button></div>`;
  }

  function cardHtml(t) {
    return `<div class="tk-card" draggable="true" data-id="${t.id}">
      <div class="tk-card-title">${esc(t.title)}</div>
      <div class="tk-card-meta"><a data-act="client">${esc(clientName(t.client_id))}</a></div>
      <div class="tk-card-foot"><span style="color:${PRIO_COLOR[t.priority]};font-weight:700">● ${t.priority}</span>${dueLabel(t)}<span class="tk-muted">${esc(t.assignee || '—')}</span></div></div>`;
  }

  function render() {
    const el = root(); if (!el) return;
    const list = visible();
    const clients = api().getClients().slice().sort((a, b) => a.name.localeCompare(b.name));
    const me = api().getCurrentUser();
    const open = tasks.filter(t => t.status !== 'Done').length;
    const overdue = tasks.filter(t => t.status !== 'Done' && t.due_date && t.due_date < today()).length;
    el.innerHTML = `<div class="tk-wrap">
      <div class="tk-head"><div><div class="tk-h1">Tasks</div><div class="tk-muted">${open} open${overdue ? ` · <span class="tk-late">${overdue} overdue</span>` : ''}</div></div>
        <div class="tk-toggle"><button class="${mode === 'list' ? 'on' : ''}" data-mode="list">☰ List</button><button class="${mode === 'board' ? 'on' : ''}" data-mode="board">▥ Board</button></div></div>
      <form class="tk-add" id="tk-add">
        <input name="title" placeholder="＋ New task…" autocomplete="off">
        <select name="client"><option value="">Client…</option>${clients.map(c => `<option value="${c.id}"${String(c.id) === filter.client ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select name="assignee"><option value="">Unassigned</option>${people().map(p => `<option${p === me ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <input type="date" name="due"><select name="priority">${PRIORITIES.map(p => `<option${p === 'Normal' ? ' selected' : ''}>${p}</option>`).join('')}</select>
        <button class="tk-btn">Add</button></form>
      <div class="tk-filters">
        <select data-filter="client"><option value="">All clients</option>${clients.map(c => `<option value="${c.id}"${String(c.id) === filter.client ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select data-filter="assignee"><option value="">Everyone</option>${people().map(p => `<option${p === filter.assignee ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <button class="tk-chip${filter.assignee === me ? ' on' : ''}" data-filter-me>My tasks</button>
        ${mode === 'list' ? `<label class="tk-muted"><input type="checkbox" data-filter-done ${filter.showDone ? 'checked' : ''}> Show done</label>` : ''}</div>
      ${!loaded ? '<div class="tk-muted">Loading…</div>' : mode === 'list'
        ? (list.length ? list.map(rowHtml).join('') : '<div class="tk-empty">No tasks here. Add the first one above.</div>')
        : `<div class="tk-board">${STATUSES.map(s => { const col = list.filter(t => t.status === s); return `<div class="tk-col" data-status="${s}"><div class="tk-col-h">${s} <span>${col.length}</span></div>${col.map(cardHtml).join('')}</div>`; }).join('')}</div>`}
    </div>`;
  }

  function onClick(e) {
    const m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; return render(); }
    if (e.target.closest('[data-filter-me]')) { const me = api().getCurrentUser(); filter.assignee = filter.assignee === me ? '' : me; return render(); }
    const row = e.target.closest('[data-id]'); if (!row) return;
    const id = row.dataset.id, a = e.target.dataset.act;
    if (e.target.closest('[data-act="client"]')) { const t = tasks.find(x => x.id === id); api().goToClient(t.client_id); }
    else if (a === 'delete') remove(id);
    else if (a === 'toggle') patch(id, { status: e.target.checked ? 'Done' : 'To do' });
  }
  function onChange(e) {
    const t = e.target;
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
    document.getElementById('home-view')?.classList.remove('active');
    const cb = document.querySelector('.control-bar'); if (cb) cb.style.display = 'none';
    ['list', 'dashboard'].forEach(i => { const n = document.getElementById(i); if (n) n.style.display = 'none'; });
    ['vbtn-home', 'vbtn-list', 'vbtn-dash'].forEach(i => document.getElementById(i)?.classList.remove('active'));
    document.getElementById('vbtn-tasks')?.classList.add('active');
    if (opts.client !== undefined) filter.client = String(opts.client || '');
    el.style.display = 'block'; render();
    await load(); render();
  }
  window.closeTasksView = function () {
    const el = root(); if (el) el.style.display = 'none';
    document.getElementById('vbtn-tasks')?.classList.remove('active');
  };
  window.openTasksView = open;

  // Home dashboard card: my open tasks that are overdue / due today.
  window.renderMyTasksCard = async function () {
    const host = document.getElementById('hv-mytasks'); if (!host) return;
    if (!loaded) await load();
    const me = api().getCurrentUser();
    const mine = tasks.filter(t => t.assignee === me && t.status !== 'Done' && t.due_date && t.due_date <= today())
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    if (!mine.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="hv-card" style="margin-bottom:1.25rem;border-left:3px solid #3b6cc7">
      <div class="hv-card-hdr"><div class="hv-card-title">✓ My Tasks Due</div><button class="hv-card-link" onclick="openTasksView({})">All tasks →</button></div>
      <div class="hv-upcoming-list">${mine.slice(0, 8).map(t => `<div class="hv-event" onclick="openTasksView({client:${t.client_id}})">
        <div class="hv-event-date" style="color:${t.due_date < today() ? '#a32d2d' : '#856404'};font-weight:800">${t.due_date < today() ? 'Overdue' : 'Today'}</div>
        <div class="hv-event-client">${esc(t.title)}</div><div class="hv-event-impl">${esc(clientName(t.client_id))}</div></div>`).join('')}</div></div>`;
  };

  document.addEventListener('DOMContentLoaded', () => {
    const el = root(); if (!el) return;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('submit', e => { if (e.target.id === 'tk-add') add(e); });
    bindDnD(el);
  });
})();
