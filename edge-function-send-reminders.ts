// ══════════════════════════════════════════════════════
// Supabase Edge Function: send-reminders
// ══════════════════════════════════════════════════════
// SETUP:
// 1. Go to Supabase Dashboard → Edge Functions → New function
// 2. Name it: send-reminders
// 3. Paste this code
// 4. Add environment variables:
//    RESEND_API_KEY = your Resend API key (from resend.com)
//    FROM_EMAIL     = reminders@premiersoft.com.cy (must be verified in Resend)
// 5. Deploy
// 6. Schedule daily at 8am via cron-job.org pointing to the function URL
// ══════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'reminders@premiersoft.com.cy';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function daysFromNow(n: number): string {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function fmt(iso: string): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // Get implementor emails
  const { data: implRows } = await sb.from('implementors').select('name, email');
  const implEmail: Record<string, string> = {};
  for (const r of implRows ?? []) {
    if (r.email) implEmail[r.name] = r.email;
  }

  // Get all active clients
  const { data: clients } = await sb.from('clients').select('*');
  if (!clients?.length) return new Response('No clients', { status: 200 });

  // Build reminder batches
  // VAT: remind 1 day before and on the day
  // STK: remind 1 day before and on the day
  // Live: remind 7 days before, 3 days before, and on the day
  const vatDays = [daysFromNow(0), daysFromNow(1)];
  const stkDays = [daysFromNow(0), daysFromNow(1)];
  const liveDays = [daysFromNow(0), daysFromNow(3), daysFromNow(7)];

  // Group reminders per implementor email
  const emails: Record<string, { vat: any[]; stk: any[]; live: any[] }> = {};

  function getOrCreate(email: string) {
    if (!emails[email]) emails[email] = { vat: [], stk: [], live: [] };
    return emails[email];
  }

  for (const c of clients) {
    const email = implEmail[c.implementor || ''];
    if (!email) continue;

    if (c.vat_date && !c.vat_done && vatDays.includes(c.vat_date))
      getOrCreate(email).vat.push(c);

    if (c.stk_date && !c.stk_done && stkDays.includes(c.stk_date))
      getOrCreate(email).stk.push(c);

    if (c.live_date && liveDays.includes(c.live_date))
      getOrCreate(email).live.push(c);
  }

  let sent = 0;
  for (const [toEmail, groups] of Object.entries(emails)) {
    const total = groups.vat.length + groups.stk.length + groups.live.length;
    if (!total) continue;

    let html = `<div style="font-family:sans-serif;font-size:14px;color:#1a1d2e;max-width:600px">
      <h2 style="color:#1e3a6e;border-bottom:2px solid #e4e7ec;padding-bottom:8px">
        📋 Client Reminders — ${fmt(today.toISOString().slice(0, 10))}
      </h2>`;

    if (groups.vat.length) {
      html += `<h3 style="color:#856404;margin-top:20px">⚑ VAT Training (${groups.vat.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="background:#fff3cd"><th style="text-align:left;padding:6px">Client</th><th style="padding:6px">Contact</th><th style="padding:6px">Date</th><th style="padding:6px">City</th></tr>`;
      for (const c of groups.vat)
        html += `<tr style="border-bottom:1px solid #eee"><td style="padding:6px;font-weight:500">${c.name}</td><td style="padding:6px">${c.contact || '—'}</td><td style="padding:6px;font-weight:600;color:#856404">${fmt(c.vat_date)}</td><td style="padding:6px">${c.city}</td></tr>`;
      html += '</table>';
    }

    if (groups.stk.length) {
      html += `<h3 style="color:#7a6500;margin-top:20px">📦 Stock Take (${groups.stk.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="background:#fef9c3"><th style="text-align:left;padding:6px">Client</th><th style="padding:6px">Contact</th><th style="padding:6px">Date</th><th style="padding:6px">City</th></tr>`;
      for (const c of groups.stk)
        html += `<tr style="border-bottom:1px solid #eee"><td style="padding:6px;font-weight:500">${c.name}</td><td style="padding:6px">${c.contact || '—'}</td><td style="padding:6px;font-weight:600;color:#7a6500">${fmt(c.stk_date)}</td><td style="padding:6px">${c.city}</td></tr>`;
      html += '</table>';
    }

    if (groups.live.length) {
      html += `<h3 style="color:#065f46;margin-top:20px">🚀 Go-Live (${groups.live.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="background:#d1fae5"><th style="text-align:left;padding:6px">Client</th><th style="padding:6px">Contact</th><th style="padding:6px">Live Date</th><th style="padding:6px">City</th></tr>`;
      for (const c of groups.live)
        html += `<tr style="border-bottom:1px solid #eee"><td style="padding:6px;font-weight:500">${c.name}</td><td style="padding:6px">${c.contact || '—'}</td><td style="padding:6px;font-weight:600;color:#065f46">${fmt(c.live_date)}</td><td style="padding:6px">${c.city}</td></tr>`;
      html += '</table>';
    }

    html += `<p style="font-size:12px;color:#9ca3af;margin-top:24px">
      Sent by A.V.PremierSoft Client Monitor
    </p></div>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: toEmail,
        subject: `📋 ${total} reminder${total > 1 ? 's' : ''} for today — Client Monitor`,
        html,
      }),
    });
    sent++;
  }

  return new Response(`Sent ${sent} emails`, { status: 200 });
});
