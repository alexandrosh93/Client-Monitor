/*
 * Client Monitor - AI Suggestions review workspace (phase 1)
 * Sources: conservative rules on existing client records + manually imported proposals.
 * Outlook candidate review is provided separately by email-suggestions.js.
 * Changes are written ONLY when a signed-in user clicks Approve.
 */
(function () {
  'use strict';
  var PANEL_ID = 'ai-suggestions-page';
  var STATUSES = ['Active', 'Not started', 'Dormant', 'Pending Follow-Up', 'Completed'];
  var FIELDS = {status:'Status', todo:'To-do', nextFollowupDate:'Next Follow-up', progress:'Progress'};
  var DB_FIELDS = {status:'status', todo:'todo', nextFollowupDate:'next_followup_date', progress:'progress'};
  var imported = [];
  var currentItems = [];
  var approving = false;
  var initialized = false;

  function html(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g,function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function readable(v) { return v == null || v === '' ? '(empty)' : String(v); }
  function isoToday() {
    var d=new Date(), y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0');
    return y+'-'+m+'-'+String(d.getDate()).padStart(2,'0');
  }
  function fingerprint(s) {
    return [s.clientId,s.field,String(s.expected),String(s.value),s.source].join('|');
  }
  function storageKey() { return 'cm_ai_reviews_v1_'+String(currentUser||'guest').toLowerCase(); }
  function dismissed() {
    try {
      var a=JSON.parse(localStorage.getItem(storageKey())||'[]');
      return Array.isArray(a)?new Set(a):new Set();
    } catch(e) { return new Set(); }
  }
  function markDismissed(s) {
    var set=dismissed(); set.add(fingerprint(s));
    try { localStorage.setItem(storageKey(),JSON.stringify([...set].slice(-500))); }
    catch(e) { console.warn('AI review dismissal could not be saved',e); }
  }
  function daysOverdue(date) {
    var dateParts=date.split('-').map(Number);
    var d=new Date(dateParts[0],dateParts[1]-1,dateParts[2]);
    var t=new Date();t.setHours(0,0,0,0);
    var n=0; while(d<t && n<999) {d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6)n++;}
    return n;
  }
  function suggestionsFromClients() {
    var res=[],today=isoToday();
    clients.forEach(function(c) {
      if(c.status==='Completed' && Number(c.progress||0)<100) {
        res.push({clientId:c.id,clientName:c.name,field:'progress',expected:Number(c.progress||0),
          value:100,reason:'This client is Completed but progress is below 100%. Verify the record before aligning progress.',
          source:'Client data',priority:2,sourceUrl:''});
      }
      if(c.status!=='Completed' && c.status!=='Pending Follow-Up' &&
          c.nextFollowupDate && c.nextFollowupDate<today) {
        res.push({clientId:c.id,clientName:c.name,field:'status',expected:c.status,
          value:'Pending Follow-Up',reason:'The recorded next follow-up ('+c.nextFollowupDate+
          ') is '+daysOverdue(c.nextFollowupDate)+' business day(s) overdue. Review whether the client should be moved to Pending Follow-Up.',
          source:'Client data',priority:1,sourceUrl:''});
      }
    });
    return res;
  }
  function allSuggestions() {
    var seen=new Set(),ignored=dismissed(),items=[];
    suggestionsFromClients().concat(imported).forEach(function(s) {
      var k=fingerprint(s);
      if(seen.has(k)||ignored.has(k))return;
      seen.add(k);items.push(s);
    });
    items.sort(function(a,b){return a.priority-b.priority||a.clientName.localeCompare(b.clientName);});
    return items;
  }
  function matchingClient(row) {
    if(row.client_id!==undefined && row.client_id!==null && row.client_id!=='') {
      return clients.find(function(c){return String(c.id)===String(row.client_id);})||null;
    }
    if(typeof row.client_name!=='string')return null;
    var name=row.client_name.trim().toLowerCase();
    var found=clients.filter(function(c){return c.name.trim().toLowerCase()===name;});
    return found.length===1?found[0]:null;
  }
  function validDate(v) {
    if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
    var d=new Date(v+'T12:00:00');
    return !isNaN(d.getTime()) && d.getFullYear()===Number(v.slice(0,4)) &&
      d.getMonth()+1===Number(v.slice(5,7)) && d.getDate()===Number(v.slice(8,10));
  }
  function validateImport(row) {
    if(!row||typeof row!=='object'||Array.isArray(row))return null;
    var c=matchingClient(row);
    if(!c||!Object.prototype.hasOwnProperty.call(FIELDS,row.field))return null;
    var val=row.value;
    if(row.field==='status'&&!STATUSES.includes(val))return null;
    if(row.field==='nextFollowupDate'&&!validDate(val))return null;
    if(row.field==='todo'&&(typeof val!=='string'||val.length>1500))return null;
    if(row.field==='progress'&&(!Number.isInteger(val)||val<0||val>100))return null;
    var expected=row.field==='progress'?Number(c[row.field]||0):String(c[row.field]||'');
    if(expected===val)return null;
    var u='';
    if(typeof row.source_url==='string') {
      try {var parsed=new URL(row.source_url);if(['https:','http:'].includes(parsed.protocol))u=parsed.href;}
      catch(e) {}
    }
    return {clientId:c.id,clientName:c.name,field:row.field,expected:expected,value:val,
      reason:typeof row.reason==='string'?row.reason.slice(0,650):'Review this proposed update against the source.',
      source:'Manual import',sourceUrl:u,priority:0};
  }
  function inject() {
    if(initialized)return;
    initialized=true;
    var style=document.createElement('style');
    style.textContent='#'+PANEL_ID+'{display:none;max-width:1100px;margin:0 auto;padding:1.5rem 1.5rem 5rem;color:var(--text)}'+
      '#'+PANEL_ID+'.active{display:block}'+
      '.ai-head{display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap}'+
      '.ai-h1{font-size:23px;font-weight:800;letter-spacing:-.03em;margin:0}'+
      '.ai-muted{font-size:12px;color:var(--text-2);line-height:1.55}'+
      '.ai-card{padding:17px;background:var(--surface);border:1px solid var(--border-md);border-radius:13px;margin-bottom:12px}'+
      '.ai-pill{border-radius:99px;padding:3px 9px;font-size:10px;font-weight:700;background:#e8eef8;color:#1e3a6e}'+
      '.ai-row-top{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}'+
      '.ai-client{font-size:15px;font-weight:700}'+
      '.ai-diff{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}'+
      '.ai-diff-box{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px;min-width:0;overflow-wrap:anywhere}'+
      '.ai-diff-label{font-size:10px;color:var(--text-3);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px}'+
      '.ai-btn{border:1px solid var(--border-md);padding:7px 13px;border-radius:7px;cursor:pointer;font:600 12px "DM Sans",sans-serif;background:var(--surface);color:var(--text)}'+
      '.ai-btn-primary{background:#1e3a6e;color:white;border-color:#1e3a6e}'+
      '.ai-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}'+
      '.ai-import{width:100%;box-sizing:border-box;min-height:95px;resize:vertical;border-radius:8px;border:1px solid var(--border-md);padding:10px;background:var(--surface);color:var(--text);font:12px monospace}'+
      '.ai-empty{padding:36px 12px;text-align:center;color:var(--text-2);font-size:13px}'+
      '@media(max-width:600px){.ai-diff{grid-template-columns:1fr}#'+PANEL_ID+'{padding:1rem 1rem 5rem}}';
    document.head.appendChild(style);

    var page=document.createElement('section');
    page.id=PANEL_ID;
    page.innerHTML='<div class="ai-head"><div><div class="ai-h1">AI Suggestions <span class="ai-pill">Review workspace</span></div>'+
      '<p class="ai-muted">Suggested changes from Client Monitor data or manually imported analysis. Nothing changes without your approval.</p></div>'+
      '<button class="ai-btn" id="ai-back">← Back to Home</button></div>'+
      '<div id="ai-email-workspace"></div>'+
      '<div class="ai-card"><b style="font-size:13px">Client record suggestions</b>'+
      '<p class="ai-muted" style="margin:5px 0 0">The checks below use rules on existing client records. Imported analysis is labelled separately. Review each change against its source.</p></div>'+
      '<div id="ai-items"></div>'+
      '<details class="ai-card"><summary style="font-size:13px;font-weight:700;cursor:pointer">Import suggestions (JSON)</summary>'+
      '<p class="ai-muted">Use a JSON array with exact client_name or client_id, field, value, and a short reason. Accepted fields: status, todo, nextFollowupDate, progress. Imported items are kept only in this browser session.</p>'+
      '<textarea id="ai-import-box" class="ai-import" spellcheck="false" placeholder=\'[{"client_name":"Example Ltd","field":"status","value":"Pending Follow-Up","reason":"Client reply needs follow-up"}]\'></textarea>'+
      '<div class="ai-actions"><button class="ai-btn ai-btn-primary" id="ai-import-action">Review imported suggestions</button>'+
      '<button class="ai-btn" id="ai-clear-import">Clear import</button><span class="ai-muted" id="ai-import-msg"></span></div></details>'+
      '<div class="ai-actions"><button class="ai-btn" id="ai-reset-dismissed">Restore dismissed suggestions (this device)</button></div>';
    document.querySelector('main').appendChild(page);
    document.getElementById('ai-back').addEventListener('click',function(){goHome();});
    document.getElementById('ai-import-action').addEventListener('click',importJson);
    document.getElementById('ai-clear-import').addEventListener('click',function(){
      imported=[];document.getElementById('ai-import-box').value='';
      document.getElementById('ai-import-msg').textContent='Import cleared.';showItems();
    });
    document.getElementById('ai-reset-dismissed').addEventListener('click',function(){
      localStorage.removeItem(storageKey());showItems();
    });
    page.addEventListener('click',function(event){
      var btn=event.target.closest('button[data-ai-action]');
      if(!btn||approving)return;
      var item=currentItems[Number(btn.dataset.aiIndex)];
      if(!item)return;
      if(btn.dataset.aiAction==='reject'){markDismissed(item);showItems();}
      if(btn.dataset.aiAction==='approve')approve(item);
      if(btn.dataset.aiAction==='open')goToClient(item.clientId);
    });
    var ref=document.querySelector('#sidemenu button[onclick^="goHome"]');
    if(ref){
      var link=document.createElement('button');
      link.className='smenu-item';link.type='button';
      link.innerHTML='<span aria-hidden="true" style="font-size:16px;width:16px">✦</span><span class="smenu-label">AI Suggestions</span>';
      link.addEventListener('click',function(){openWorkspace();closeSideMenuAfterAction();});
      ref.parentNode.insertBefore(link,ref.nextSibling);
    }
    var headerButton=document.createElement('button');
    headerButton.type='button';headerButton.className='view-btn';
    headerButton.id='vbtn-ai';headerButton.textContent='✦ Suggestions';
    headerButton.addEventListener('click',openWorkspace);
    var toggle=document.querySelector('.view-toggle');
    if(toggle)toggle.appendChild(headerButton);
    var origHome=goHome,origSetView=setView,origClients=goClients,origClient=goToClient;
    goHome=function(){closeWorkspace();return origHome.apply(this,arguments);};
    setView=function(){closeWorkspace();return origSetView.apply(this,arguments);};
    goClients=function(){closeWorkspace();return origClients.apply(this,arguments);};
    goToClient=function(){closeWorkspace();return origClient.apply(this,arguments);};
  }
  function closeWorkspace() {
    var page=document.getElementById(PANEL_ID);
    if(page)page.classList.remove('active');
    var button=document.getElementById('vbtn-ai');
    if(button)button.classList.remove('active');
  }
  function openWorkspace() {
    if(document.getElementById('login-screen') &&
       !document.getElementById('login-screen').classList.contains('hidden'))return;
    if(window.closeClientWorkspaceView)window.closeClientWorkspaceView();
    document.getElementById('home-view').classList.remove('active');
    document.querySelector('.control-bar').style.display='none';
    document.getElementById('list').style.display='none';
    document.getElementById('dashboard').style.display='none';
    ['vbtn-home','vbtn-list','vbtn-dash'].forEach(function(id){
      var el=document.getElementById(id);if(el)el.classList.remove('active');
    });
    document.getElementById('vbtn-ai').classList.add('active');
    document.getElementById(PANEL_ID).classList.add('active');
    showItems();
    window.dispatchEvent(new Event('cm-ai-open'));
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function showItems() {
    var items=allSuggestions();currentItems=items;
    var el=document.getElementById('ai-items');
    if(!el)return;
    if(!items.length){
      el.innerHTML='<div class="ai-card ai-empty">No suggestions need review right now. This does not mean every task is complete.</div>';
      return;
    }
    el.innerHTML='<div class="ai-muted" style="margin:12px 0"><strong>'+items.length+
      '</strong> suggestion(s) to review · Approve writes one field to Supabase, Reject dismisses locally.</div>'+
      items.map(function(s,i){
        return '<article class="ai-card"><div class="ai-row-top"><span class="ai-client">'+html(s.clientName)+'</span>'+
          '<span class="ai-pill">'+html(s.source)+'</span></div>'+
          '<div class="ai-muted" style="margin-top:7px">'+html(s.reason)+'</div>'+
          '<div class="ai-diff"><div class="ai-diff-box"><div class="ai-diff-label">Current '+html(FIELDS[s.field])+
          '</div><div>'+html(readable(s.expected))+'</div></div>'+
          '<div class="ai-diff-box"><div class="ai-diff-label">Suggested '+html(FIELDS[s.field])+
          '</div><div><b>'+html(readable(s.value))+'</b></div></div></div>'+
          '<div class="ai-actions"><button class="ai-btn ai-btn-primary" data-ai-action="approve" data-ai-index="'+i+
          '">Approve</button><button class="ai-btn" data-ai-action="reject" data-ai-index="'+i+
          '">Reject</button><button class="ai-btn" data-ai-action="open" data-ai-index="'+i+'">View client</button>'+
          (s.sourceUrl?'<a class="ai-btn" style="text-decoration:none" href="'+html(s.sourceUrl)+
          '" target="_blank" rel="noopener noreferrer">Source ↗</a>':'')+
          '</div></article>';
      }).join('');
  }
  async function approve(s) {
    if(approving)return;approving=true;
    var c=clients.find(function(x){return x.id===s.clientId;});
    try {
      if(!c)throw new Error('Client not found. Refresh to review again.');
      var live=await sb.from('clients').select('status,todo,progress,next_followup_date').eq('id',c.id).single();
      if(live.error)throw live.error;
      var dbField=DB_FIELDS[s.field];
      var before=live.data[dbField];
      var normalized=s.field==='progress'?Number(before||0):String(before||'');
      if(normalized!==s.expected)throw new Error('This field changed since the suggestion was prepared. Refresh and review again.');
      var update=await sb.from('clients').update({[dbField]:s.value}).eq('id',c.id).select('id').single();
      if(update.error)throw update.error;
      c[s.field]=s.value;
      audit('Approve suggestion',c.name,FIELDS[s.field]+': "'+readable(s.expected)+'" → "'+readable(s.value)+'"');
      if(s.field==='status')_pushSystemLog(c,'Status: "'+readable(s.expected)+'" → "'+readable(s.value)+'" (approved suggestion)');
      markDismissed(s);imported=imported.filter(function(x){return x!==s;});
      render();buildVatBanner();buildStkBanner();
      showItems();toast('Suggestion approved and saved.');
    }catch(e) {
      console.error('AI suggestion approval failed',e);
      toast('Not applied: '+(e.message||'Could not save.'));
    }finally{approving=false;}
  }
  function importJson() {
    var msg=document.getElementById('ai-import-msg'),raw=document.getElementById('ai-import-box').value;
    var data;
    try {data=JSON.parse(raw);}
    catch(e){msg.textContent='Invalid JSON. No suggestions imported.';return;}
    if(!Array.isArray(data)||data.length>50){msg.textContent='Provide a JSON array of up to 50 suggestions.';return;}
    var valid=data.map(validateImport).filter(Boolean);
    imported=valid;
    msg.textContent=valid.length+' valid suggestion(s); '+(data.length-valid.length)+' skipped (unmatched or invalid).';
    showItems();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',inject);
  else inject();
})();
