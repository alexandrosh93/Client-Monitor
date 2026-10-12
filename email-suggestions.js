(function () {
  'use strict';
  var helpers = import('./email-leads.mjs');
  var outlook;
  var rows = [], ignored = new Set(), owner = '', mailbox = '', busy = false, abort;
  var root = document.getElementById('ai-email-workspace');
  if (!root) return;
  function esc(v) { return String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function key() { return 'cm_email_review_v1_' + owner; }
  function settingsKey() { return 'cm_outlook_settings_v1_' + owner; }
  function signedIn() { return currentUser && document.getElementById('login-screen').classList.contains('hidden'); }
  function message(text, error) {
    var el = document.getElementById('ai-email-message');
    el.textContent = text; el.style.color = error ? '#b42318' : '';
  }
  function save() {
    try { sessionStorage.setItem(key(), JSON.stringify({ rows: rows, ignored: [...ignored] })); }
    catch { message('Suggestions remain visible, but this browser could not save the session. Export a copy before leaving.', true); }
  }
  function config() { return { clientId: document.getElementById('email-client-id').value.trim(), tenantId: document.getElementById('email-tenant-id').value.trim() }; }
  function saveSettings() {
    localStorage.setItem(settingsKey(), JSON.stringify({ ...config(), senders: document.getElementById('email-senders').value.trim() }));
  }
  function setBusy(value) {
    busy = value;
    root.querySelectorAll('button, input, textarea').forEach(el => { el.disabled = value; });
    document.getElementById('email-cancel').disabled = !value;
    document.getElementById('email-search').disabled = value || !mailbox;
    document.getElementById('email-disconnect').disabled = value || (!mailbox && !rows.length);
  }
  function connectionText() {
    document.getElementById('email-connection').textContent = mailbox ? 'Connected: ' + mailbox : 'Outlook is not connected in this session.';
  }
  root.innerHTML = '<div class="ai-card"><div class="ai-row-top"><b>Email · New client suggestions</b><span class="ai-pill" id="email-connection"></span></div>' +
    '<p class="ai-muted" style="margin-top:8px">Search messages from Andreas Kyriacou and Vakis Theodosiou. Matching emails are candidates, not confirmed new clients. Live search uses keyword rules; you can also import AI-reviewed findings from Codex.</p>' +
    '<div class="ai-actions"><button class="ai-btn ai-btn-primary" id="email-connect">Connect Outlook</button><button class="ai-btn" id="email-disconnect">Disconnect</button></div>' +
    '<details style="margin-top:12px" id="email-settings"><summary>Connection settings</summary>' +
    '<p class="ai-muted">A Microsoft app registration is required once. Use its public IDs below. No password or client secret is needed.</p>' +
    '<label class="email-label">Application (client) ID<input id="email-client-id" class="email-input" autocomplete="off"></label>' +
    '<label class="email-label">Directory (tenant) ID<input id="email-tenant-id" class="email-input" autocomplete="off"></label>' +
    '<p class="ai-muted">Register this exact Single-page application redirect URI: <code id="email-redirect"></code>. The connection requests delegated Mail.Read; it cannot send, edit, or delete mail.</p></details>' +
    '<label class="email-label">Sender email addresses<input id="email-senders" class="email-input" placeholder="Separate sender addresses with commas" autocomplete="off"></label>' +
    '<label class="email-label">Search from<input type="date" id="email-since" class="email-input"></label>' +
    '<div class="ai-actions"><button class="ai-btn ai-btn-primary" id="email-search">Search Outlook</button><button class="ai-btn" id="email-cancel" disabled>Cancel search</button></div>' +
    '<p class="ai-muted" id="ai-email-message" role="status" aria-live="polite" style="margin-top:10px"></p>' +
    '<p class="ai-muted">Reviews stay in this browser tab for this signed-in user. Export to keep a copy. Disconnect clears mailbox tokens and email reviews from this tab.</p>' +
    '<details style="margin-top:12px"><summary>Import AI-reviewed email findings</summary>' +
    '<p class="ai-muted">Choose the JSON review file provided by Codex, or paste its contents. Client records are created only after you review and save their form.</p>' +
    '<label class="email-label">Review file<input type="file" id="email-review-file" accept=".json,application/json"></label>' +
    '<label class="email-label">Review JSON<textarea class="ai-import" id="email-review-json" spellcheck="false"></textarea></label>' +
    '<div class="ai-actions"><button class="ai-btn" id="email-import">Import reviewed findings</button><button class="ai-btn" id="email-export">Export findings</button></div></details></div>' +
    '<div id="email-candidates"></div>';
  var style = document.createElement('style');
  style.textContent = '.email-label{display:block;font-size:12px;font-weight:600;margin-top:12px}.email-input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1px solid var(--border-md);border-radius:7px;background:var(--surface);color:var(--text)}#ai-email-workspace code{overflow-wrap:anywhere}#ai-email-workspace button:disabled{opacity:.5;cursor:default}.email-source{font-size:12px;overflow-wrap:anywhere;margin:8px 0}.email-review-name{max-width:600px}';
  document.head.appendChild(style);
  var date = new Date(); date.setDate(date.getDate() - 90);
  document.getElementById('email-since').value = date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
  document.getElementById('email-redirect').textContent = new URL('./outlook-redirect.html', location.href).href;
  connectionText(); setBusy(false);

  async function render() {
    var h = await helpers;
    var visible = rows.filter(row => !ignored.has(h.leadKey(row)));
    document.getElementById('email-candidates').innerHTML = '<p class="ai-muted" style="margin:12px 0">' + visible.length + ' email candidate(s) to review</p>' + visible.map(row => {
      var i = rows.indexOf(row);
      var existing = clients.find(c => h.normalName(c.name) === h.normalName(row.client_name));
      return '<article class="ai-card"><div class="ai-row-top"><b>' + esc(row.client_name) + '</b><span class="ai-pill">' + esc(row.classification) + '</span></div>' +
        '<p class="email-source">' + esc(row.source_sender) + ' · ' + esc(new Date(row.source_date).toLocaleDateString('en-GB')) + '<br>' + esc(row.source_subject) + '</p>' +
        '<p class="ai-muted">' + esc(row.reason) + '</p><p style="font-size:13px;margin:10px 0">' + esc(row.next_action) + '</p>' +
        '<p class="ai-muted">' + esc(row.evidence_scope) + '</p>' +
        (existing ? '<p class="ai-muted">An exact matching client already exists. Review that record.</p>' : '<label class="email-label">Confirm company name<input class="email-input email-review-name" id="email-name-' + i + '" maxlength="200" value="' + esc(row.client_name) + '"></label>') +
        '<div class="ai-actions"><a class="ai-btn" href="' + esc(row.source_url) + '" target="_blank" rel="noopener noreferrer">Open source email ↗</a>' +
        '<button class="ai-btn ai-btn-primary" data-email-open="' + i + '">' + (existing ? 'View existing client' : 'Review new client form') + '</button>' +
        '<button class="ai-btn" data-email-dismiss="' + i + '">Dismiss</button></div></article>';
    }).join('');
    setBusy(busy);
  }
  window.addEventListener('cm-ai-open', async function () {
    if (!signedIn()) return;
    if (owner !== String(currentUser).toLowerCase()) {
      if (outlook) await outlook.disconnect();
      mailbox = ''; owner = String(currentUser).toLowerCase(); rows = []; ignored = new Set();
      try {
        var stored = JSON.parse(sessionStorage.getItem(key()) || '{}');
        rows = (stored.rows || []).map((await helpers).validateLead).filter(Boolean);
        ignored = new Set(Array.isArray(stored.ignored) ? stored.ignored : []);
      } catch { rows = []; }
      var defaults = window.CM_OUTLOOK_CONFIG || {};
      var settings = {};
      try { settings = JSON.parse(localStorage.getItem(settingsKey()) || '{}'); } catch {}
      document.getElementById('email-client-id').value = settings.clientId || defaults.clientId || '';
      document.getElementById('email-tenant-id').value = settings.tenantId || defaults.tenantId || '';
      document.getElementById('email-senders').value = settings.senders || defaults.senders || '';
    }
    connectionText(); await render();
  });
  document.getElementById('email-connect').onclick = async function () {
    if (!signedIn() || busy) return;
    setBusy(true); message('Opening Microsoft sign-in…');
    mailbox = ''; connectionText();
    try {
      outlook = await import('./outlook-client.mjs');
      await outlook.initialize(config());
      mailbox = await outlook.connect();
      saveSettings(); connectionText(); message('Connected. Choose the senders and date, then search Outlook.');
    } catch (e) { if (outlook) await outlook.disconnect(); mailbox = ''; connectionText(); message(e.message || 'Could not connect to Outlook.', true); document.getElementById('email-settings').open = true; }
    finally { setBusy(false); }
  };
  window.cmEmailDisconnect = async function () {
    if (abort) abort.abort();
    if (outlook) await outlook.disconnect();
    rows = []; ignored = new Set(); mailbox = '';
    sessionStorage.removeItem(key());
    document.getElementById('email-review-json').value = '';
    document.getElementById('email-review-file').value = '';
    connectionText(); await render(); message('Outlook disconnected. Email reviews cleared from this tab.');
  };
  document.getElementById('email-disconnect').onclick = window.cmEmailDisconnect;
  document.getElementById('email-cancel').onclick = function () { if (abort) abort.abort(); };
  document.getElementById('email-search').onclick = async function () {
    if (!signedIn() || busy || !mailbox) return;
    setBusy(true); abort = new AbortController(); message('Searching Outlook…');
    try {
      var result = await outlook.searchMail({ senders: document.getElementById('email-senders').value,
        since: document.getElementById('email-since').value, signal: abort.signal,
        onProgress: count => message('Read ' + count + ' matching sender emails…') });
      if (abort.signal.aborted) return;
      var h = await helpers;
      var candidates = result.messages.map(m => h.candidateFromMessage(m, result.senders)).filter(Boolean);
      rows = h.mergeLeads(rows, candidates); saveSettings(); save(); await render();
      message('Searched ' + result.messages.length + ' emails; found ' + candidates.length + ' possible new-client messages. ' +
        (result.truncated ? 'Search limit reached: narrow the date range to check remaining messages.' : 'Review each source; this is not a complete client audit.'));
    } catch (e) { message(e.name === 'AbortError' ? 'Search cancelled. Earlier reviews were kept.' : e.message, e.name !== 'AbortError'); }
    finally { abort = null; setBusy(false); }
  };
  document.getElementById('email-review-file').onchange = async function (event) {
    var file = event.target.files[0]; if (!file) return;
    if (file.size > 1000000) { message('Choose a review file smaller than 1 MB.', true); return; }
    try { document.getElementById('email-review-json').value = await file.text(); }
    catch { message('Could not read the selected file.', true); }
  };
  document.getElementById('email-import').onclick = async function () {
    if (!signedIn() || busy) return;
    try {
      var text = document.getElementById('email-review-json').value;
      if (text.length > 1000000) throw new Error('Use a review file smaller than 1 MB.');
      var h = await helpers, imported = h.readReview(JSON.parse(text));
      var before = rows.length; rows = h.mergeLeads(rows, imported); save(); await render();
      document.getElementById('email-review-json').value = '';
      message('Imported ' + (rows.length - before) + ' new reviewed candidates. Duplicate source emails were skipped.');
    } catch (e) { message(e instanceof SyntaxError ? 'Invalid JSON. Nothing was imported.' : e.message, true); }
  };
  document.getElementById('email-export').onclick = function () {
    if (!signedIn()) return;
    var blob = new Blob([JSON.stringify({ schema_version: 1, candidates: rows }, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'client-email-review.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  root.addEventListener('click', async function (event) {
    var btn = event.target.closest('button[data-email-open],button[data-email-dismiss]');
    if (!btn || busy || !signedIn()) return;
    var h = await helpers;
    if (btn.hasAttribute('data-email-dismiss')) {
      var dismissed = rows[Number(btn.dataset.emailDismiss)]; if (!dismissed) return;
      ignored.add(h.leadKey(dismissed)); save(); await render(); return;
    }
    var index = Number(btn.dataset.emailOpen), row = rows[index]; if (!row) return;
    var name = (document.getElementById('email-name-' + index)?.value || row.client_name).trim();
    if (!name) { message('Enter the company name before opening the new-client form.', true); return; }
    var existing = clients.find(c => h.normalName(c.name) === h.normalName(name));
    if (existing) { goToClient(existing.id); return; }
    openAdd();
    document.getElementById('m-name').value = name;
    document.getElementById('m-status').value = 'Not started';
    document.getElementById('m-comment').value = 'Email suggestion — verify before saving.\n' + row.reason + '\nNext action: ' + row.next_action + '\nSource: ' + row.source_subject + '\n' + row.source_url;
  });
})();
