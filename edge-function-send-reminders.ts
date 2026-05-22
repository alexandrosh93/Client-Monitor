// ══════════════════════════════════════════════════════
// Supabase Edge Function: send-reminders
// Uses YOUR OWN SMTP server — no third-party email service needed
// ══════════════════════════════════════════════════════
//
// SETUP (one time):
// 1. Supabase Dashboard → Edge Functions → New function → name: send-reminders
// 2. Paste this code and deploy
// 3. Add these environment variables (Edge Functions → your function → Secrets):
//      SMTP_HOST     your mail server  e.g. mail.premiersoft.com.cy
//      SMTP_PORT     usually 587 (TLS) or 465 (SSL)
//      SMTP_USER     your email address e.g. reminders@premiersoft.com.cy
//      SMTP_PASS     your email password
//      FROM_EMAIL    reminders@premiersoft.com.cy
// 4. Schedule it: Supabase Dashboard → Database → Cron Jobs → New cron job
//      Command:  SELECT net.http_post('YOUR_FUNCTION_URL', '{}', 'application/json');
//      Schedule: 0 8 * * *   (every day at 8:00 AM)
// ══════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SMTP_HOST = Deno.env.get('SMTP_HOST')!;
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') ?? 587);
const SMTP_USER = Deno.env.get('SMTP_USER')!;
const SMTP_PASS = Deno.env.get('SMTP_PASS')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? SMTP_USER;

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function addDays(n: number): string {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function fmt(iso: string): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // Load implementor emails
  const { data: implRows } = await sb.from('implementors').select('name, email');
  const implEmail: Record<string, string> = {};
  for (const r of implRows ?? []) {
    if (r.email) implEmail[r.name] = r.email;
  }

  // Load all clients
  const { data: clients } = await sb.from('clients').select('*');
  if (!clients?.length) return new Response('No clients', { status: 200 });

  // Reminder windows
  const vatDays  = [addDays(0), addDays(1)];           // today + tomorrow
  const stkDays  = [addDays(0), addDays(1)];
  const liveDays = [addDays(0), addDays(3), addDays(7)]; // today, 3 days, 7 days

  // Group reminders by implementor email
  const groups: Record<string, { vat: any[]; stk: any[]; live: any[] }> = {};

  function bucket(email: string) {
    if (!groups[email]) groups[email] = { vat: [], stk: [], live: [] };
    return groups[email];
  }

  for (const c of clients) {
    const email = implEmail[c.implementor ?? ''];
    if (!email) continue;
    if (c.vat_date && !c.vat_done && vatDays.includes(c.vat_date))  bucket(email).vat.push(c);
    if (c.stk_date && !c.stk_done && stkDays.includes(c.stk_date))  bucket(email).stk.push(c);
    if (c.live_date && liveDays.includes(c.live_date))               bucket(email).live.push(c);
  }

  // Build and send one email per implementor
  const smtp = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: SMTP_PORT === 465,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  });

  let sent = 0;
  const todayLabel = fmt(today.toISOString().slice(0, 10));

  for (const [toEmail, g] of Object.entries(groups)) {
    const total = g.vat.length + g.stk.length + g.live.length;
    if (!total) continue;

    function table(rows: any[], dateField: string, color: string, bg: string): string {
      return `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
        <tr style="background:${bg}">
          <th style="text-align:left;padding:6px 8px">Client</th>
          <th style="padding:6px 8px">Contact</th>
          <th style="padding:6px 8px">Date</th>
          <th style="padding:6px 8px">City</th>
          <th style="padding:6px 8px">Status</th>
        </tr>
        ${rows.map(c => `<tr style="border-bottom:1px solid #eee">
          <td style="padding:6px 8px;font-weight:600">${c.name}</td>
          <td style="padding:6px 8px">${c.contact ?? '—'}</td>
          <td style="padding:6px 8px;font-weight:700;color:${color}">${fmt(c[dateField])}</td>
          <td style="padding:6px 8px">${c.city}</td>
          <td style="padding:6px 8px">${c.status}</td>
        </tr>`).join('')}
      </table>`;
    }

    let html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1d2e;max-width:640px">
      <div style="background:#1e3a6e;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <div style="font-size:18px;font-weight:700">📋 Client Reminders</div>
        <div style="font-size:13px;opacity:.8;margin-top:2px">${todayLabel} · A.V.PremierSoft</div>
      </div>
      <div style="background:#fff;border:1px solid #e4e7ec;border-top:none;padding:20px;border-radius:0 0 8px 8px">`;

    if (g.vat.length) {
      html += `<h3 style="color:#856404;margin:0 0 4px">⚑ VAT Training (${g.vat.length})</h3>`;
      html += table(g.vat, 'vat_date', '#856404', '#fff3cd');
    }
    if (g.stk.length) {
      html += `<h3 style="color:#7a6500;margin:16px 0 4px">📦 Stock Take (${g.stk.length})</h3>`;
      html += table(g.stk, 'stk_date', '#7a6500', '#fef9c3');
    }
    if (g.live.length) {
      html += `<h3 style="color:#065f46;margin:16px 0 4px">🚀 Go-Live (${g.live.length})</h3>`;
      html += table(g.live, 'live_date', '#065f46', '#d1fae5');
    }

    html += `<p style="font-size:11px;color:#9ca3af;margin-top:20px;border-top:1px solid #f0f0f0;padding-top:12px">
      Automated reminder from A.V.PremierSoft Client Monitor
    </p></div></div>`;

    await smtp.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: `📋 ${total} reminder${total > 1 ? 's' : ''} — ${todayLabel}`,
      html,
    });
    sent++;
  }

  await smtp.close();
  return new Response(`Sent ${sent} reminder emails`, { status: 200 });
});
