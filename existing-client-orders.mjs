import { cleanText, modulesFromOrders, normalName, outlookLink } from './email-leads.mjs?v=proposal-pdf-20261021';

export function orderKey(order) {
  const number = cleanText(order.order_number, 250).toLowerCase();
  return number ? 'order:' + number : JSON.stringify([normalName(order.company_name), cleanText(order.attachment_name, 250), cleanText(order.order_date, 40)]);
}
export function orderReview(group, client) {
  const recorded = new Set((client.commentLog || []).flatMap(entry => Array.isArray(entry?.orderKeys) ? entry.orderKeys : []));
  const orders = group.orders.filter(order => order.kind === 'software_order' && !order.additional_licenses);
  const pending = orders.filter(order => !recorded.has(orderKey(order)));
  const current = new Set((client.modules || []).map(normalName));
  return { pending, newModules: modulesFromOrders(pending).filter(module => !current.has(normalName(module))) };
}
const amount = value => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-CY', { style: 'currency', currency: 'EUR' }).format(value) : 'Not extracted';
export function buildOrderUpdate(group, client, selectedModules, user, now = new Date().toISOString()) {
  const review = orderReview(group, client);
  if (!review.pending.length) return null;
  const selected = [...new Set(selectedModules)];
  if (selected.some(module => !review.newModules.includes(module))) throw new Error('The suggested modules changed. Review the order again.');
  const sources = group.rows.filter(row => (row.orders || []).some(order => review.pending.some(pending => orderKey(pending) === orderKey(order))));
  const text = ['Software order reviewed', 'Modules added: ' + (selected.join(', ') || 'None — order recorded only'), ...review.pending.map(order => [
    'Order: ' + (order.order_number || order.attachment_name) + (order.order_date ? ' / ' + order.order_date : ''),
    'Client: ' + order.company_name + (order.client_number ? ' / ' + order.client_number : ''),
    'Products: ' + (order.products || []).map(product => [product.description, product.license, amount(product.amount)].filter(Boolean).join(' · ')).join('; '),
    'License cost: ' + amount(order.license_cost) + '; total incl. VAT: ' + amount(order.total_amount),
    'Fees: ' + ((order.fees || []).join('; ') || 'Not extracted'),
    'Payment terms: ' + (order.payment_terms || 'Not extracted'),
    'Contact on order: ' + [order.contact, order.phone, order.email].filter(Boolean).join(' · '),
    'PDF: ' + order.attachment_name,
  ].join('\n')), ...sources.map(row => 'Source: ' + row.source_subject + '\n' + outlookLink(row.source_url))].join('\n\n');
  const entry = { text, ts: now, user, type: 'system', orderKeys: review.pending.map(orderKey) };
  return { modules: [...(client.modules || []), ...selected], commentLog: [entry, ...(client.commentLog || [])], added: selected, count: review.pending.length };
}

// Compare-and-set both fields together: a failed save must not change the local record.
export async function saveOrderUpdate(db, group, selectedModules, user) {
  if (!group.existing || group.matchConflict) throw new Error('Confirm which client owns this order first.');
  const response = await db.from('clients').select('id,name,client_code,modules,modules_snapshot:modules::text,comment').eq('id', group.existing.id).single();
  if (response.error) throw response.error;
  if (!response.data) throw new Error('Client not found. Refresh and review again.');
  const row = response.data;
  if (normalName(row.name) !== normalName(group.existing.name) || String(row.client_code || '') !== String(group.existing.clientCode || '')) throw new Error('Client details changed. Refresh and review the match again.');
  let log = [];
  if (row.comment) {
    try { const parsed = JSON.parse(row.comment); log = Array.isArray(parsed) ? parsed : [{ text: row.comment, ts: null, user: '' }]; }
    catch { log = [{ text: row.comment, ts: null, user: '' }]; }
  }
  const live = { ...group.existing, modules: row.modules || [], commentLog: log };
  // Another review may already have added one of these modules; never add it twice.
  const currentModules = new Set(live.modules.map(normalName));
  const update = buildOrderUpdate(group, live, selectedModules.filter(module => !currentModules.has(normalName(module))), user);
  if (!update) return { ...live, added: [], count: 0 };
  let query = db.from('clients').update({ modules: update.modules, comment: JSON.stringify(update.commentLog) }).eq('id', row.id);
  // Select's text cast gives PostgreSQL's native literal for either text[] or jsonb.
  if (row.modules != null && typeof row.modules_snapshot !== 'string') throw new Error('Could not verify current modules. Refresh and try again.');
  query = row.modules == null ? query.is('modules', null) : query.eq('modules', row.modules_snapshot);
  for (const field of ['comment', 'name', 'client_code']) query = row[field] == null ? query.is(field, null) : query.eq(field, row[field]);
  const saved = await query.select('id').single();
  if (saved.error || !saved.data) throw new Error('The order was not saved. The client may have changed or access was denied. Refresh and try again.');
  return { ...live, ...update };
}
