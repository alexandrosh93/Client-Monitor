// Pure validation and candidate detection. Detection is deliberately labelled as rules, not AI.
import { validateOrder, mergeOrders, isAdditionalLicenseRequest, isOwnCompanyName } from './software-orders.mjs?v=pdf-client-name-20261013';
export { isOwnCompanyName };
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
export function isIgnoredProposal(value) {
  return /\bsoftware\s+proposal\b/i.test(cleanText(value, 500));
}
export function isIgnoredLicenseChange(value) {
  return isAdditionalLicenseRequest(cleanText(value, 2000));
}
export function managerFromSender(value) {
  const local = String(value || '').trim().toLowerCase().split('@')[0];
  if (local === 'andreas' || local === 'andreas.kyriacou') return 'AK';
  if (local === 'vakis' || local === 'vakis.theodosiou') return 'VT';
  return '';
}
export function leadKey(row) {
  return [row.source_sender.toLowerCase(), row.source_date, row.source_subject.replace(/^(?:(?:re|fw|fwd):\s*)+/gi, '').trim().toLowerCase()].join('|');
}
export function validateLead(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (isIgnoredProposal(row.source_subject) || isIgnoredLicenseChange([row.source_subject, row.classification, row.reason].join(' ')) || isOwnCompanyName(row.client_name)) return null;
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
  const rows = value.candidates.filter(row => !isIgnoredProposal(row?.source_subject) && !isIgnoredLicenseChange([row?.source_subject, row?.classification, row?.reason].join(' '))).map(validateLead);
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
  if (!allowedSenders.includes(sender) || isIgnoredProposal(message.subject) || isIgnoredLicenseChange(cleanText(message.subject) + ' ' + cleanText(message.bodyPreview))) return null;
  const found = orders.filter(o => o.kind === 'software_order' && !o.additional_licenses && o.company_name && !isOwnCompanyName(o.company_name));
  if (!found.length) return null;
  const names = [...new Set(found.map(o => o.company_name).filter(Boolean))];
  return validateLead({
    client_name: names.join(' / '),
    classification: 'Software Order — review onboarding',
    reason: 'The attached Software Order identifies ' + names.join(', ') + '. Review the order and client record before saving.',
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
  const exclude = /\b(additional|extension|extention|renewal|spam|automatic reply|out of office)\b|\bsoftware\s+proposal\b|επιπλεον|αναβαθμιση|προσθετ/;
  const signal = /\b(new client|new customer|new company|software order|software proposal|software requirements|positive response|signed order|payroll system|accounting software)\b|παραγγελια|θετικη.*ανταποκριση|νεο[ςι]? πελατ|συστημα μισθοδοσιας/;
  if (exclude.test(text) || isIgnoredLicenseChange(subject + ' ' + cleanText(message.bodyPreview)) || !signal.test(text)) return null;
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

// Module names suggested by the products on Software Orders (same rules as the new-client form).
export function modulesFromOrders(orders) {
  const text = (orders || []).flatMap(o => o.products || []).map(p => p.description || '').join(' ').toLowerCase();
  const found = [];
  if (/payroll/.test(text)) found.push('Payroll');
  if (/\baccounting\b/.test(text)) found.push('Accounting');
  if (/\binvoic(?:ing|e)\b/.test(text)) found.push('Invoicing');
  if (/stock|inventory/.test(text)) found.push('Stock');
  if (/mobile/.test(text)) found.push('Mobile Application');
  return found;
}

// One review card per company: emails about the same client are combined, and each group says
// whether the company is already a client (matched by exact name or by the order's client number).
export function groupLeads(rows, clients) {
  const groups = new Map();
  for (const row of rows) {
    const orders = (row.orders || []).filter(o => o.kind === 'software_order');
    const numbers = orders.map(o => cleanText(o.client_number, 100)).filter(Boolean);
    const matches = (clients || []).filter(c => normalName(c.name) === normalName(row.client_name) || (cleanText(c.clientCode, 100) && numbers.includes(cleanText(c.clientCode, 100))));
    const companies = new Set(orders.map(order => normalName(order.company_name)).filter(Boolean));
    const numberConflict = matches.length === 1 && numbers.length > 0 && cleanText(matches[0].clientCode, 100) && !numbers.includes(cleanText(matches[0].clientCode, 100));
    const matchConflict = matches.length > 1 || new Set(numbers).size > 1 || companies.size > 1 || !!numberConflict;
    const existing = !matchConflict && matches.length === 1 ? matches[0] : null;
    const key = existing ? 'client:' + existing.id : 'name:' + normalName(row.client_name);
    if (!groups.has(key)) groups.set(key, { key, name: existing ? existing.name : row.client_name, existing, matchConflict, rows: [] });
    if (matchConflict) groups.get(key).matchConflict = true;
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(g => {
    g.rows.sort((a, b) => Date.parse(b.source_date) - Date.parse(a.source_date));
    g.orders = mergeOrders([], g.rows.flatMap(r => r.orders || []));
    g.modules = modulesFromOrders(g.orders.filter(o => o.kind === 'software_order'));
    g.newModules = g.existing ? g.modules.filter(m => !(g.existing.modules || []).some(current => normalName(current) === normalName(m))) : g.modules;
    return g;
  }).sort((a, b) => Date.parse(b.rows[0].source_date) - Date.parse(a.rows[0].source_date));
}
