// Pure validation and candidate detection. Detection is deliberately labelled as rules, not AI.
import { validateOrder, mergeOrders } from './software-orders.mjs';
export function cleanText(value, limit = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
export function outlookLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com'].includes(url.hostname) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function senderList(value) {
  const list = [...new Set(String(value).split(/[,;\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];
  if (!list.length || list.length > 10 || list.some(x => !/^[a-z0-9.!#$%&*+\-/=?^_`{|}~]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(x))) {
    throw new Error('Enter between 1 and 10 valid sender email addresses, separated by commas.');
  }
  return list;
}
export function normalName(value) {
  return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function leadKey(row) {
  return [row.source_sender.toLowerCase(), row.source_date, row.source_subject.replace(/^(?:(?:re|fw|fwd):\s*)+/gi, '').trim().toLowerCase()].join('|');
}
export function validateLead(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const sourceUrl = outlookLink(row.source_url);
  const date = cleanText(row.source_date, 40);
  let sender;
  try { sender = senderList(row.source_sender); } catch { return null; }
  if (sender.length !== 1 || !sourceUrl || !date || !Number.isFinite(Date.parse(date))) return null;
  const result = {
    client_name: cleanText(row.client_name, 200),
    classification: cleanText(row.classification, 100) || 'Needs review',
    reason: cleanText(row.reason, 1200), next_action: cleanText(row.next_action, 1000),
    source_subject: cleanText(row.source_subject, 400), source_date: date,
    source_sender: sender[0], source_url: sourceUrl,
    evidence_scope: cleanText(row.evidence_scope, 400) || 'Email subject and preview only. Confirm against the source.',
    confirmed_new_client: false,
    orders: (Array.isArray(row.orders) ? row.orders : []).slice(0,10).map(validateOrder).filter(order => order && !(order.kind === 'software_order' && order.additional_licenses)),
  };
  return result.client_name && result.source_subject && result.reason ? result : null;
}
export function readReview(value) {
  if (!value || value.schema_version !== 1 || !Array.isArray(value.candidates) || value.candidates.length > 100) {
    throw new Error('Use a Client Monitor review file with schema_version 1 and up to 100 candidates.');
  }
  const rows = value.candidates.map(validateLead);
  if (rows.some(x => !x)) throw new Error('The file contains an invalid candidate or a non-Outlook source link. Nothing was imported.');
  return rows;
}
export function mergeLeads(current, incoming) {
  const rows = new Map(current.map(row => [leadKey(row), row]));
  for (const row of incoming) {
    const key = leadKey(row), prior = rows.get(key);
    if (!prior) rows.set(key, row);
    else if (row.orders?.length) rows.set(key, { ...prior, ...(row.orders.some(o => o.kind === 'software_order') ? row : {}), orders: mergeOrders(prior.orders || [], row.orders) });
  }
  return [...rows.values()].sort((a, b) => Date.parse(b.source_date) - Date.parse(a.source_date));
}
export function candidateFromOrders(message, orders, allowedSenders) {
  const sender = String(message.from?.emailAddress?.address || '').toLowerCase();
  if (!allowedSenders.includes(sender)) return null;
  const found = orders.filter(o => o.kind === 'software_order' && !o.additional_licenses);
  const review = orders.filter(o => o.kind === 'needs_review');
  if (!found.length && !review.length) return null;
  const names = [...new Set(found.map(o => o.company_name).filter(Boolean))];
  return validateLead({
    client_name: names.length === 1 ? names[0] : cleanText(message.subject) || 'Software Order PDF — confirm company',
    classification: found.length ? 'Software Order — review onboarding' : 'PDF needs manual review',
    reason: found.length ? 'The attached Software Order identifies ' + (names.join(', ') || 'a company to confirm') + '. Review the order and client record before saving.' : 'A PDF attachment could not be read. Open the source and check the order.',
    next_action: 'Confirm the company, products, client signature and implementation arrangements.',
    source_subject: cleanText(message.subject) || '(No subject)', source_date: message.receivedDateTime,
    source_sender: sender, source_url: message.webLink,
    evidence_scope: 'PDF extraction' + (found.some(o => o.extraction === 'ocr') ? ' including OCR' : '') + '. Verify the original; the client signature is not confirmed.',
    orders: orders.filter(o => o.kind !== 'software_order' || !o.additional_licenses),
  });
}
export function candidateFromMessage(message, allowedSenders) {
  const sender = String(message.from?.emailAddress?.address || '').toLowerCase();
  if (!allowedSenders.includes(sender)) return null;
  const subject = cleanText(message.subject, 400);
  const text = normalName(subject + ' ' + cleanText(message.bodyPreview));
  const exclude = /\b(additional|extension|extention|renewal|spam|automatic reply|out of office)\b|επιπλεον|αναβαθμιση|προσθετ/;
  const signal = /\b(new client|new customer|new company|software order|software proposal|software requirements|positive response|signed order|payroll system|accounting software)\b|παραγγελια|θετικη.*ανταποκριση|νεο[ςι]? πελατ|συστημα μισθοδοσιας/;
  if (exclude.test(text) || !signal.test(text)) return null;
  return validateLead({
    client_name: subject.replace(/^(?:(?:re|fw|fwd):\s*)+/gi, ''),
    classification: 'Possible new client — confirm company',
    reason: 'This email matches order, proposal, or new-company terms. It may concern an existing customer. Open the source before adding a client.',
    next_action: 'Confirm the company name, check for an existing record, and review the order or onboarding requirements.',
    source_subject: subject, source_date: message.receivedDateTime,
    source_sender: sender, source_url: message.webLink,
    evidence_scope: 'Rule-based match using subject and preview. No AI analysis or attachment review.',
  });
}
