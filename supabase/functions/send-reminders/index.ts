import { timingSafeEqual } from 'node:crypto';
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const encode = new TextEncoder();
const answer = (message: string, status = 200) =>
  new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });
const escapeHtml = (value: unknown) => String(value ?? '—')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

type Client = {
  name: string;
  contact: string | null;
  city: string | null;
  status: string | null;
  implementor: string | null;
  vat_date: string | null;
  stk_date: string | null;
  live_date: string | null;
  vat_done: boolean;
  stk_done: boolean;
};
type DateField = 'vat_date' | 'stk_date' | 'live_date';
type ReminderGroup = { vat: Client[]; stk: Client[]; live: Client[] };

async function sendReminders(req: Request) {
  if (req.method !== 'POST') return answer('Method not allowed', 405);
  const secret = encode.encode(Deno.env.get('REMINDER_CRON_SECRET') ?? '');
  const presented = encode.encode(req.headers.get('X-Reminder-Cron-Secret') ?? '');
  if (secret.length < 32) return answer('Reminder authorization is not configured', 503);
  if (secret.length !== presented.length || !timingSafeEqual(secret, presented)) {
    return answer('Unauthorized', 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const host = Deno.env.get('SMTP_HOST');
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const username = Deno.env.get('SMTP_USER');
  const password = Deno.env.get('SMTP_PASS');
  const from = Deno.env.get('FROM_EMAIL') ?? username;
  const domain = Deno.env.get('REMINDER_ALLOWED_DOMAIN')?.trim().toLowerCase();
  if (!url || !serviceKey || !host || !username || !password || !from
      || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || ![465, 587].includes(port)) {
    return answer('Reminder delivery is not configured', 503);
  }

  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Nicosia', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = localDate.formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  const today = Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')));
  function addDays(n: number): string {
    return new Date(today + n * 86_400_000).toISOString().slice(0, 10);
  }

  function fmt(iso: string): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  const { data: implementors, error: implementorError } = await sb.from('implementors').select('name,email');
  if (implementorError) throw new Error('Could not load reminder recipients');
  const recipientByImplementor = new Map<string, string>();
  for (const row of implementors ?? []) {
    const email = String(row.email ?? '').trim().toLowerCase();
    if (/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(email) && email.endsWith('@' + domain)) {
      recipientByImplementor.set(row.name, email);
    }
  }

  const vatDays = [addDays(0), addDays(1)];
  const stkDays = vatDays;
  const liveDays = [addDays(0), addDays(3), addDays(7)];
  const groups = new Map<string, ReminderGroup>();
  const pageSize = 500;
  for (let offset = 0;; offset += pageSize) {
    const { data, error } = await sb.from('clients')
      .select('name,contact,city,status,implementor,vat_date,vat_done,stk_date,stk_done,live_date')
      .or(`vat_date.in.(${vatDays}),stk_date.in.(${stkDays}),live_date.in.(${liveDays})`)
      .order('id').range(offset, offset + pageSize - 1);
    if (error) throw new Error('Could not load reminder records');
    for (const client of (data ?? []) as Client[]) {
      const email = recipientByImplementor.get(client.implementor ?? '');
      if (!email) continue;
      const group = groups.get(email) ?? { vat: [], stk: [], live: [] };
      if (client.vat_date && !client.vat_done && vatDays.includes(client.vat_date)) group.vat.push(client);
      if (client.stk_date && !client.stk_done && stkDays.includes(client.stk_date)) group.stk.push(client);
      if (client.live_date && liveDays.includes(client.live_date)) group.live.push(client);
      groups.set(email, group);
    }
    if (!data || data.length < pageSize) break;
  }
  if (![...groups.values()].some(group => group.vat.length || group.stk.length || group.live.length)) {
    return answer('No reminders to send');
  }

  const smtp = new SMTPClient({ connection: {
    hostname: host, port, tls: port === 465, auth: { username, password },
  } });
  let sent = 0;
  let uncertain = 0;
  const reminderDate = addDays(0);
  const todayLabel = fmt(reminderDate);
  try {
    for (const [toEmail, g] of groups) {
      const total = g.vat.length + g.stk.length + g.live.length;
      if (!total) continue;
      const key = { reminder_date: reminderDate, recipient: toEmail };
      const { data: claim, error: claimError } = await sb.from('reminder_deliveries')
        .upsert(key, { onConflict: 'reminder_date,recipient', ignoreDuplicates: true })
        .select('recipient').maybeSingle();
      if (claimError) throw new Error('Could not reserve reminder delivery');
      if (!claim) {
        const { data: existing, error } = await sb.from('reminder_deliveries').select('sent_at').match(key).single();
        if (error) throw new Error('Could not verify reminder delivery');
        if (!existing.sent_at) uncertain++;
        continue;
      }

      function table(rows: Client[], dateField: DateField, color: string, bg: string): string {
        return `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
          <tr style="background:${bg}">
            <th style="text-align:left;padding:6px 8px">Client</th>
            <th style="padding:6px 8px">Contact</th>
            <th style="padding:6px 8px">Date</th>
            <th style="padding:6px 8px">City</th>
            <th style="padding:6px 8px">Status</th>
          </tr>
          ${rows.map(c => `<tr style="border-bottom:1px solid #eee">
            <td style="padding:6px 8px;font-weight:600">${escapeHtml(c.name)}</td>
            <td style="padding:6px 8px">${escapeHtml(c.contact ?? '—')}</td>
            <td style="padding:6px 8px;font-weight:700;color:${color}">${fmt(c[dateField] ?? '')}</td>
            <td style="padding:6px 8px">${escapeHtml(c.city)}</td>
            <td style="padding:6px 8px">${escapeHtml(c.status)}</td>
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

      try {
        await smtp.send({
          from, to: toEmail,
          subject: `📋 ${total} reminder${total > 1 ? 's' : ''} — ${todayLabel}`,
          html,
        });
        const { error } = await sb.from('reminder_deliveries').update({ sent_at: new Date().toISOString() }).match(key);
        if (error) throw new Error('Could not record delivery');
        sent++;
      } catch {
        // Keep the claim when the SMTP server may already have accepted the message.
        uncertain++;
      }
    }
  } finally {
    await smtp.close();
  }
  return uncertain
    ? answer(`Sent ${sent} reminder emails. ${uncertain} deliveries require review.`, 503)
    : answer(`Sent ${sent} reminder emails`);
}

Deno.serve(async request => {
  try {
    return await sendReminders(request);
  } catch (error) {
    console.error('Reminder processing failed', error instanceof Error ? error.name : 'Unknown error');
    return answer('Reminder processing failed', 500);
  }
});
