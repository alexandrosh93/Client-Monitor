(function () {
  'use strict';
  var helpers = import('./email-leads.mjs?v=proposal-pdf-20261021');
  var orderUpdates = import('./existing-client-orders.mjs?v=20261020');
  var orderHelpers;
  var outlook;
  var rows = [], ignored = new Set(), owner = '', mailbox = '', busy = false, abort;
  var skipped = []; // emails from the senders that were searched but did not become a suggestion, with the reason
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
  function amount(value) { return typeof value === 'number' ? new Intl.NumberFormat('en-CY', { style: 'currency', currency: 'EUR' }).format(value) : 'Check PDF'; }
  function softwareOrders(row) { return (row.orders || []).filter(order => order.kind === 'software_order' && !order.additional_licenses); }
  function onlyAdditionalOrders(row) {
    var orders = (row.orders || []).filter(order => order.kind === 'software_order');
    return orders.length > 0 && orders.every(order => order.additional_licenses);
  }
  function orderHtml(order) {
    if (order.kind !== 'software_order') return '<div class="email-order"><b>' + esc(order.attachment_name) + '</b><p class="ai-muted">' + (order.kind === 'not_order' ? 'No Software Order Form found.' : 'PDF needs manual review.') + ' ' + esc((order.issues || []).join(' ')) + '</p></div>';
    return '<div class="email-order"><b>' + esc(order.attachment_name) + '</b><p class="ai-muted">' + esc(order.order_number) + ' · ' + esc(order.order_date) + ' · ' + esc(order.company_name) + (order.additional_licenses ? ' · Additional licenses' : '') + '</p>' +
      '<p class="email-source">' + esc([order.contact, order.phone, order.email, order.address].filter(Boolean).join(' · ')) + '</p>' +
      '<table class="email-order-table"><thead><tr><th>Product</th><th>License</th><th>Amount</th></tr></thead><tbody>' + (order.products || []).map(p => '<tr><td>' + esc(p.description) + '</td><td>' + esc(p.license) + '</td><td>' + amount(p.amount) + '</td></tr>').join('') + '</tbody></table>' +
      '<p style="font-size:13px;margin-top:9px">License cost: ' + amount(order.license_cost) + ' · Order total incl. VAT: ' + amount(order.total_amount) + '</p>' +
      '<p class="ai-muted">Service fees and annual maintenance are listed separately: ' + esc((order.fees || []).join('; ')) + '</p><p class="ai-muted">Payment terms: ' + esc(order.payment_terms) + '</p>' +
      '<p class="ai-muted">' + esc(order.signature_status) + '. ' + esc((order.issues || []).join(' ')) + '</p>' +
      '<details><summary>PDF evidence · ' + esc(order.extraction) + '</summary>' + (order.evidence || []).map(e => '<p class="email-evidence">Page ' + e.page + ':<br>' + esc(e.text) + '</p>').join('') + '</details></div>';
  }
  root.innerHTML = '<div class="ai-card"><div class="ai-row-top"><b>Email · Clients & module purchases</b><span class="ai-pill" id="email-connection"></span></div>' +
    '<p class="ai-muted" style="margin-top:8px">Search messages from Andreas Kyriacou and Vakis Theodosiou. Review Software Order PDFs to add a new client or record a new purchase for an existing client.</p>' +
    '<div class="ai-actions"><button class="ai-btn ai-btn-primary" id="email-connect">Connect Outlook</button><button class="ai-btn" id="email-disconnect">Disconnect</button></div>' +
    '<details style="margin-top:12px" id="email-settings"><summary>Connection settings</summary>' +
    '<p class="ai-muted">A Microsoft app registration is required once. Use its public IDs below. No password or client secret is needed.</p>' +
    '<label class="email-label">Application (client) ID<input id="email-client-id" class="email-input" autocomplete="off"></label>' +
    '<label class="email-label">Directory (tenant) ID<input id="email-tenant-id" class="email-input" autocomplete="off"></label>' +
    '<p class="ai-muted">Register this exact Single-page application redirect URI: <code id="email-redirect"></code>. The connection requests delegated Mail.Read; it cannot send, edit, or delete mail.</p></details>' +
    '<label class="email-label">Sender email addresses<input id="email-senders" class="email-input" placeholder="Separate sender addresses with commas" autocomplete="off"></label>' +
    '<label class="email-label">Search from<input type="date" id="email-since" class="email-input"></label>' +
    '<p class="ai-muted" style="margin-top:12px">Software Order PDF attachments are always read, including scanned pages. The client name is taken from the PDF Licensee field.</p>' +
    '<div class="ai-actions"><button class="ai-btn ai-btn-primary" id="email-search">Search Outlook</button><button class="ai-btn" id="email-cancel" disabled>Cancel search</button></div>' +
    '<p class="ai-muted" id="ai-email-message" role="status" aria-live="polite" style="margin-top:10px"></p>' +
    '<p class="ai-muted">Reviews stay in this browser tab for this signed-in user. Export to keep a copy. Disconnect clears mailbox tokens and email reviews from this tab.</p>' +
    '<details style="margin-top:12px"><summary>Import AI-reviewed email findings</summary>' +
    '<p class="ai-muted">Choose the JSON review file provided by Codex, or paste its contents. Review each proposal before adding a client or saving a purchase to an existing client.</p>' +
    '<label class="email-label">Review file<input type="file" id="email-review-file" accept=".json,application/json"></label>' +
    '<label class="email-label">Review JSON<textarea class="ai-import" id="email-review-json" spellcheck="false"></textarea></label>' +
    '<div class="ai-actions"><button class="ai-btn" id="email-import">Import reviewed findings</button><button class="ai-btn" id="email-export">Export findings</button></div></details></div>' +
    '<div id="email-candidates"></div>';
  var style = document.createElement('style');
  style.textContent = '.email-label{display:block;font-size:12px;font-weight:600;margin-top:12px}.email-input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1px solid var(--border-md);border-radius:7px;background:var(--surface);color:var(--text)}#ai-email-workspace code{overflow-wrap:anywhere}#ai-email-workspace button:disabled{opacity:.5;cursor:default}.email-source{font-size:12px;overflow-wrap:anywhere;margin:8px 0}.email-review-fields{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(140px,.7fr) minmax(190px,1fr);gap:10px;align-items:end}.email-candidate-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:start}.email-candidate{padding:0!important;overflow:hidden;margin:0!important}.email-candidate[open]{grid-column:1/-1}.email-candidate-summary{list-style:none;display:grid;grid-template-columns:minmax(150px,1fr) auto 20px;gap:9px;align-items:center;padding:12px 13px;cursor:pointer}.email-candidate-summary::-webkit-details-marker{display:none}.email-candidate-summary:hover{background:var(--surface2)}.email-candidate-title{min-width:0}.email-candidate-title b{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.email-candidate-title small{display:block;margin-top:3px;color:var(--text-3);font-size:10px;font-weight:500}.email-candidate-contact{grid-column:1/3;font-size:10px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.email-candidate-chevron{grid-column:3;grid-row:1/3;font-size:21px;color:var(--text-3);transform:rotate(90deg);transition:transform .15s ease}.email-candidate[open] .email-candidate-chevron{transform:rotate(-90deg)}.email-candidate-details{border-top:1px solid var(--border-md);padding:13px 15px 15px;background:linear-gradient(180deg,var(--surface2),var(--surface))}.email-order{border-top:1px solid var(--border-md);padding-top:12px;margin-top:12px;font-size:13px;overflow-wrap:anywhere}.email-order-table{width:100%;font-size:12px;border-collapse:collapse}.email-order-table th,.email-order-table td{padding:6px;text-align:left;border-bottom:1px solid var(--border-md)}.email-evidence{white-space:pre-wrap;font-size:12px}.email-pdf-input{display:block;margin:8px 0;max-width:100%}.email-group-title{font-size:14px;font-weight:700;margin:18px 0 6px}.email-mods{font-size:13px;margin:0 0 10px;padding:8px 10px;background:var(--surface2);border-radius:8px}.email-sources{margin:0 0 8px;padding-left:18px;font-size:12px}.email-sources li{margin:3px 0}.email-skipped{margin-top:14px}.email-skipped summary{cursor:pointer}.email-skip-row{display:flex;gap:10px;justify-content:space-between;align-items:flex-start;padding:9px 0;border-top:1px solid var(--border);font-size:13px}.email-skip-why{font-size:12px;color:#8a5a1a;margin-top:3px}.email-count{background:#fff3cd;color:#856404;justify-self:start;grid-column:2;grid-row:2}@media(max-width:1050px){.email-candidate-grid{grid-template-columns:1fr}.email-candidate[open]{grid-column:auto}}@media(max-width:720px){.email-review-fields{grid-template-columns:1fr}.email-candidate-summary{grid-template-columns:minmax(0,1fr) 20px}.email-candidate-summary>.ai-pill,.email-candidate-contact{grid-column:1;justify-self:start}.email-candidate-chevron{grid-column:2;grid-row:1/4}}';
  document.head.appendChild(style);
  var date = new Date(); date.setDate(date.getDate() - 90);
  document.getElementById('email-since').value = date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
  document.getElementById('email-redirect').textContent = new URL('./outlook-redirect.html', location.href).href;
  connectionText(); setBusy(false);

  var groupsByKey = new Map();
  function groupCard(g, h) {
    var row = g.rows[0], i = rows.indexOf(row);
    var order = softwareOrders(row)[0] || g.orders.find(o => o.kind === 'software_order') || (g.isProposal ? (g.orders.find(o => o.company_name || o.client_number) || {}) : {});
    var contact = [order.client_number ? 'ID ' + order.client_number : '', order.email || ''].filter(Boolean).join(' · ');
    var emails = g.rows.length > 1 ? '<span class="ai-pill email-count">' + g.rows.length + ' emails</span>' : '';
    var review = g.existing && !g.isProposal ? orderHelpers.orderReview(g, g.existing) : null;
    if (review) g.newModules = review.newModules;
    var purchaseReview = review ? '<div class="email-purchase-review"><b>' + (review.pending.length ? 'Review this purchase' : 'Purchase already recorded') + '</b>' +
      (review.pending.length ? '<p class="ai-muted">Select the modules to add. Order details and the source email will be saved in the client’s history. Existing details, status and progress stay unchanged.</p><div class="email-module-options">' + review.newModules.map(module => '<label><input type="checkbox" data-email-module="' + esc(g.key) + '" value="' + esc(module) + '" checked> ' + esc(module) + '</label>').join('') + '</div>' + (!review.newModules.length ? '<p class="ai-muted">No new modules detected. You can still record this purchase.</p>' : '') : '<p class="ai-muted">This order is already in the client’s history.</p>') + '</div>' : '';
    var modulesLine = g.isProposal ? (g.existing ? '<p class="email-mods"><b>Already a client.</b> This is a proposal for more work — no order yet.</p>' : '') : g.existing
      ? '<p class="email-mods"><b>Already a client.</b> Current modules: ' + esc((g.existing.modules || []).join(', ') || 'none') + '. ' +
        (!review.pending.length ? 'Purchase recorded.' : g.newModules.length ? 'Suggested additions: <b>' + esc(g.newModules.join(', ')) + '</b>.' : 'No new modules detected in the order — check the products below.') + '</p>'
      : (g.modules.length ? '<p class="email-mods">Modules on the order: <b>' + esc(g.modules.join(', ')) + '</b></p>' : '');
    var sources = g.rows.map(r => '<li><a href="' + esc(r.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.source_subject) + ' ↗</a> <span class="ai-muted">· ' + esc(r.source_sender) + ' · ' + esc(new Date(r.source_date).toLocaleDateString('en-GB')) + '</span></li>').join('');
    return '<details class="ai-card email-candidate"><summary class="email-candidate-summary"><span class="email-candidate-title"><b>' + esc(g.name) + '</b><small>' + esc(row.source_sender) + ' · ' + esc(new Date(row.source_date).toLocaleDateString('en-GB')) + '</small></span><span class="ai-pill">' + (g.isProposal ? 'Proposal' : g.matchConflict ? 'Check client match' : g.existing ? 'Existing client' : 'New client') + '</span>' + emails + '<span class="email-candidate-contact">' + esc(g.existing && g.newModules.length ? '+ ' + g.newModules.join(', ') : (contact || 'Open for details')) + '</span><span class="email-candidate-chevron">›</span></summary><div class="email-candidate-details">' +
      modulesLine +
      '<p class="ai-muted">' + esc(row.reason) + '</p><p style="font-size:13px;margin:10px 0">' + esc(row.next_action) + '</p>' +
      '<p class="ai-muted">' + esc(row.evidence_scope) + '</p>' +
      '<p class="email-label" style="margin-bottom:4px">Source email' + (g.rows.length > 1 ? 's' : '') + '</p><ul class="email-sources">' + sources + '</ul>' +
      g.orders.map(orderHtml).join('') +
      (g.existing ? '' : '<div class="email-review-fields"><label class="email-label">Confirm company name<input class="email-input" id="email-name-' + i + '" maxlength="200" value="' + esc(row.client_name) + '"></label><label class="email-label">Client ID<input class="email-input" id="email-client-code-' + i + '" maxlength="100" value="' + esc(order.client_number || '') + '"></label><label class="email-label">Client email<input class="email-input" type="email" id="email-client-email-' + i + '" value="' + esc(order.email || '') + '" placeholder="client@company.com"></label></div>') +
      purchaseReview +
      (g.matchConflict ? '<p class="ai-muted">Company name and client number match multiple clients. Correct the client details before applying this order.</p>' : '') +
      '<div class="ai-actions">' +
      (review && !g.matchConflict && review.pending.length ? '<button class="ai-btn ai-btn-primary" data-email-add-mods="' + esc(g.key) + '">Save purchase to client</button>' : '') +
      (g.matchConflict ? '' : '<button class="ai-btn' + (g.existing && g.newModules.length ? '' : ' ai-btn-primary') + '" data-email-open="' + i + '">' + (g.existing ? 'View existing client' : 'Review new client form') + '</button>') +
      '<button class="ai-btn" data-email-dismiss-group="' + esc(g.key) + '">Dismiss</button></div>' +
      '<label class="email-label">Read a Software Order PDF saved from this email<input class="email-pdf-input" type="file" data-email-pdf="' + i + '" accept=".pdf,application/pdf"></label></div></details>';
  }
  async function render() {
    var h = await helpers;
    orderHelpers = await orderUpdates;
    var visible = rows.filter(row => !ignored.has(h.leadKey(row)) && !onlyAdditionalOrders(row) && softwareOrders(row).some(order => order.company_name && !h.isOwnCompanyName(order.company_name)));
    var proposalRows = rows.filter(row => row.proposal && !ignored.has(h.leadKey(row)) && !softwareOrders(row).length);
    var proposalGroups = h.groupLeads(proposalRows, clients).map(g => Object.assign(g, { key: 'proposal:' + g.key, isProposal: true }));
    var groups = h.groupLeads(visible, clients);
    groupsByKey = new Map(groups.concat(proposalGroups).map(g => [g.key, g]));
    var existing = groups.filter(g => g.existing), fresh = groups.filter(g => !g.existing && !g.matchConflict), conflicts = groups.filter(g => g.matchConflict);
    // Proposals are listed with the other suggestions (marked "Proposal"), not in a section of their own.
    proposalGroups.forEach(g => { if (g.existing) existing.push(g); else fresh.push(g); });
    var section = (title, note, list) => list.length ? '<h3 class="email-group-title">' + title + ' <span class="ai-muted">(' + list.length + ')</span></h3><p class="ai-muted" style="margin:-4px 0 10px">' + note + '</p><div class="email-candidate-grid">' + list.map(g => groupCard(g, h)).join('') + '</div>' : '';
    document.getElementById('email-candidates').innerHTML = '<p class="ai-muted" style="margin:12px 0">' + (groups.length + proposalGroups.length) + ' compan' + (groups.length + proposalGroups.length === 1 ? 'y' : 'ies') + ' to review' + (visible.length > groups.length ? ' (' + visible.length + ' emails combined)' : '') + '</p>' +
      section('New clients', 'Companies that are not in Client Monitor yet.', fresh) +
      section('Existing clients — new purchase', 'Review new modules and save the purchase to the client’s history.', existing) + section('Check client match', 'These orders need a clear client match before saving.', conflicts) +

      (function () {
        var hidden = rows.filter(row => ignored.has(h.leadKey(row)));
        var parts = [];
        if (hidden.length) parts.push('<details class="ai-card email-skipped"><summary><b>Dismissed earlier (' + hidden.length + ')</b></summary>' + hidden.map(r => '<div class="email-skip-row"><div><b>' + esc(r.client_name) + '</b><div class="ai-muted">' + esc(r.source_subject) + ' · ' + esc(new Date(r.source_date).toLocaleDateString('en-GB')) + '</div></div><button class="ai-btn" data-email-restore="' + esc(h.leadKey(r)) + '">Restore</button></div>').join('') + '</details>');
        if (skipped.length) parts.push('<details class="ai-card email-skipped"><summary><b>Emails not shown (' + skipped.length + ')</b> <span class="ai-muted">— why each email from these senders did not become a suggestion</span></summary>' + skipped.map(x => '<div class="email-skip-row"><div><b>' + esc(x.subject) + '</b><div class="ai-muted">' + esc(x.sender) + ' · ' + esc(new Date(x.date).toLocaleDateString('en-GB')) + '</div><div class="email-skip-why">' + esc(x.why) + '</div></div>' + (h.outlookLink(x.url) ? '<a class="ai-btn" href="' + esc(h.outlookLink(x.url)) + '" target="_blank" rel="noopener noreferrer">Open ↗</a>' : '') + '</div>').join('') + '</details>');
        return parts.join('');
      })();
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
      outlook = await import('./outlook-client.mjs?v=proposal-pdf-20261021');
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
      var candidates = [];
      var pdf = await import('./pdf-orders.mjs?v=proposal-pdf-20261021');
      var scan = await outlook.scanOrderAttachments(result.messages, { signal: abort.signal, readPdf: pdf.readOrderPdf, onProgress: text => message(text) });
      candidates.push(...scan.matches.map(match => onlyAdditionalOrders(match) ? null : h.candidateFromOrders(match.message, match.orders, result.senders)).filter(Boolean));
      var orderIds = new Set(candidates.map(c => c.source_url));
      var pdfById = new Map(scan.matches.map(m => [m.message.id, m.orders]));
      candidates.push(...result.messages.filter(m => !orderIds.has(h.outlookLink(m.webLink))).map(m => h.proposalFromMessage(m, result.senders, pdfById.get(m.id) || [])).filter(Boolean));
      var byId = new Map(scan.matches.map(m => [m.message.id, m]));
      skipped = result.messages.map(msg => {
        var why = '', match = byId.get(msg.id), text = (msg.subject || '') + ' ' + (msg.bodyPreview || '');
        if (h.isIgnoredProposal(msg.subject)) why = '';
        else if (h.isIgnoredLicenseChange(text)) why = 'Mentions additional / upgraded licences (ignored as not a new purchase).';
        else if (!msg.hasAttachments) why = h.isIgnoredProposal(msg.subject) ? 'Software Proposal without attachment (ignored until the order arrives).' : 'No attachment.';
        else if (!match) why = scan.limited ? 'Not checked — scan limit reached. Narrow the date range.' : h.isIgnoredProposal(msg.subject) ? 'Software Proposal without a PDF (ignored until the order arrives).' : 'No PDF attachment.';
        else if (onlyAdditionalOrders(match)) why = 'Order is for additional licences only.';
        else {
          var so = match.orders.filter(o => o.kind === 'software_order');
          if (!so.length && h.isIgnoredProposal(msg.subject)) why = 'Software Proposal without a Software Order PDF (proposals are ignored until the order arrives).';
          else if (!so.length) why = 'PDF is not a readable Software Order Form' + (match.orders[0]?.issues?.length ? ' (' + match.orders[0].issues.join(' ') + ')' : '') + '. Use "Read a Software Order PDF" or add the client manually.';
          else if (!so.some(o => o.company_name && !h.isOwnCompanyName(o.company_name))) why = 'Licensee (client name) not found in the PDF.';
          else if (!h.candidateFromOrders(msg, match.orders, result.senders)) why = 'Did not pass the order checks.';
        }
        return why ? { subject: msg.subject || '(No subject)', date: msg.receivedDateTime, sender: msg.from?.emailAddress?.address || '', url: msg.webLink, why } : null;
      }).filter(Boolean);
      abort.signal.throwIfAborted();
      rows = h.mergeLeads(rows, candidates); saveSettings(); save(); await render();
      message('Searched ' + result.messages.length + ' emails. ' + (scan ? 'Checked ' + scan.checkedPdfs + ' PDF attachments; ' + scan.errors.length + ' could not be read. ' : '') +
        (result.truncated || scan?.limited ? 'Scan limit reached: narrow the date range to check remaining messages. ' : '') + 'Review the company, order and client signature before saving.' + (scan?.errors.length ? ' ' + scan.errors.slice(0,3).join(' ') : ''), !!scan?.errors.length);
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
  root.addEventListener('change', async function (event) {
    var input = event.target.closest('input[data-email-pdf]');
    if (!input || busy || !signedIn() || !input.files[0]) return;
    var index = Number(input.dataset.emailPdf), row = rows[index], file = input.files[0];
    if (!row) return;
    if (file.size > 20 * 1024 * 1024) { message('Choose a PDF no larger than 20 MB.', true); return; }
    setBusy(true); abort = new AbortController();
    try {
      var pdf = await import('./pdf-orders.mjs?v=proposal-pdf-20261021'), h = await helpers;
      var order = await pdf.readOrderPdf(new Uint8Array(await file.arrayBuffer()), { name: file.name, signal: abort.signal, onProgress: text => message(text) });
      abort.signal.throwIfAborted();
      var combined = (await import('./software-orders.mjs?v=proposal-pdf-20261021')).mergeOrders(row.orders || [], [order]);
      if (onlyAdditionalOrders({ orders: combined })) {
        rows.splice(index, 1); save(); await render(); message('Additional Payroll Licenses order ignored.'); return;
      }
      var proposal = h.candidateFromOrders({ from: {emailAddress:{address:row.source_sender}}, subject:row.source_subject, receivedDateTime:row.source_date, webLink:row.source_url }, combined, [row.source_sender]);
      rows[index] = proposal && combined.some(o=>o.kind === 'software_order') ? { ...row, ...proposal } : { ...row, orders: combined };
      save(); await render(); message(order.kind === 'software_order' ? 'Software Order read. Review the company, products and amounts below.' : 'No readable Software Order Form found. Review the original PDF.');
    } catch (e) { message(e.name === 'AbortError' ? 'PDF reading cancelled.' : e.message, e.name !== 'AbortError'); }
    finally { abort = null; setBusy(false); }
  });
  root.addEventListener('click', async function (event) {
    var restore = event.target.closest('button[data-email-restore]');
    if (restore && !busy && signedIn()) { ignored.delete(restore.dataset.emailRestore); save(); await render(); return; }
    var btn = event.target.closest('button[data-email-open],button[data-email-dismiss-group],button[data-email-add-mods]');
    if (!btn || busy || !signedIn()) return;
    var h = await helpers;
    if (btn.hasAttribute('data-email-dismiss-group')) {
      var group = groupsByKey.get(btn.dataset.emailDismissGroup); if (!group) return;
      group.rows.forEach(r => ignored.add(h.leadKey(r))); save(); await render(); return;
    }
    if (btn.hasAttribute('data-email-add-mods')) {
      var g = groupsByKey.get(btn.dataset.emailAddMods); if (!g || !g.existing) return;
      var live = clients.find(c => c.id === g.existing.id); if (!live) return;
      var selected = [...root.querySelectorAll('[data-email-module]')].filter(input => input.dataset.emailModule === g.key && input.checked).map(input => input.value);
      setBusy(true); message('Saving purchase…');
      try {
        var result = await (await orderUpdates).saveOrderUpdate(sb, g, selected, currentUser);
        live.modules = result.modules; live.commentLog = result.commentLog; live.comment = result.commentLog[0]?.text || '';
        if (result.count) audit('Approve purchase', live.name, 'Modules added: ' + (result.added.join(', ') || 'none') + '; orders recorded: ' + result.count);
        save(); await render();
        message(result.count ? 'Purchase saved to ' + live.name + (result.added.length ? ' · Added ' + result.added.join(', ') : '') + '.' : 'This purchase is already recorded.');
      } catch (e) { message(e.message || 'Could not save the purchase. Please try again.', true); }
      finally { setBusy(false); }
      return;
    }
    var index = Number(btn.dataset.emailOpen), row = rows[index]; if (!row) return;
    var name = (document.getElementById('email-name-' + index)?.value || row.client_name).trim();
    if (!name) { message('Enter the company name before opening the new-client form.', true); return; }
    var matchedGroup = [...groupsByKey.values()].find(group => group.rows.includes(row));
    var existing = matchedGroup?.existing || clients.find(c => h.normalName(c.name) === h.normalName(name));
    if (existing) { goToClient(existing.id); return; }
    openAdd();
    document.getElementById('m-name').value = name;
    document.getElementById('m-mgr').value = h.managerFromSender(row.source_sender);
    document.getElementById('m-client-code').value = (document.getElementById('email-client-code-' + index)?.value || '').trim();
    document.getElementById('m-email').value = (document.getElementById('email-client-email-' + index)?.value || '').trim().toLowerCase();
    document.getElementById('m-status').value = 'Not started';
    var orders = softwareOrders(row).filter(o => h.normalName(o.company_name) === h.normalName(name));
    if (orders.length) {
      document.getElementById('m-contact').value = orders[0].contact || '';
      if (!document.getElementById('m-client-code').value) document.getElementById('m-client-code').value = orders[0].client_number || '';
      if (!document.getElementById('m-email').value) document.getElementById('m-email').value = String(orders[0].email || '').toLowerCase();
      var city = document.getElementById('m-city');
      if (city && /paphos|pafos/i.test(orders[0].address)) city.value = 'Paphos';
      var descriptions = orders.flatMap(o=>o.products || []).map(p=>p.description).join(' ').toLowerCase();
      document.querySelectorAll('#mods-check input[type=checkbox]').forEach(input=>{
        var mod = input.value.toLowerCase();
        var match = mod === 'payroll' && /payroll/.test(descriptions) || mod === 'accounting' && /accounting/.test(descriptions) || mod === 'stock' && /stock|inventory/.test(descriptions) || mod === 'mobile application' && /mobile/.test(descriptions);
        if (match) { input.checked = true; input.closest('label')?.classList.add('checked'); }
      });
    }
    document.getElementById('m-comment').value = 'Email suggestion — verify before saving.\n' + row.reason + '\nNext action: ' + row.next_action + '\n' + orders.map(o=> 'PDF: ' + o.attachment_name + '\nOrder: ' + o.order_number + ' / ' + o.order_date + '\nClient number: ' + o.client_number + '\nAddress: ' + o.address + '\nContact: ' + [o.contact,o.phone,o.email].filter(Boolean).join(' · ') + '\nProducts: ' + o.products.map(p=>p.description + ' (' + p.license + ')').join('; ') + '\nLicense cost: ' + amount(o.license_cost) + '; order total incl. VAT: ' + amount(o.total_amount) + '\nFees: ' + o.fees.join('; ') + '\nPayment: ' + o.payment_terms + '\n' + o.signature_status).join('\n\n') + '\nSource: ' + row.source_subject + '\n' + row.source_url;
  });
})();
