const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const amountPattern = /(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}|(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/g;
export function money(value) {
  const raw = text(value).replace(/[^\d.,-]/g, '');
  if (!raw) return null;
  const decimal = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
  const normalized = decimal === '.' ? raw.replaceAll(',', '') : raw.replaceAll('.', '').replace(',', '.');
  const result = Number(normalized);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
export function isPdfAttachment(a) {
  return !!a && !a.isInline && !a.is_inline && (a.contentType === 'application/pdf' || a.content_type === 'application/pdf' || /\.pdf$/i.test(a.name || ''));
}
export function itemsToLines(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str || !Array.isArray(item.transform)) continue;
    const y = item.transform[5], x = item.transform[4];
    let row = rows.find(r => Math.abs(r.y - y) < 3);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ str: item.str, x, width: item.width || 0 });
  }
  return rows.sort((a, b) => b.y - a.y).map(row => {
    let previous;
    return row.items.sort((a, b) => a.x - b.x).map(item => {
      const gap = previous ? item.x - previous.x - previous.width : 0;
      previous = item;
      return (gap > 24 ? ' | ' : gap > 1 ? ' ' : '') + item.str;
    }).join('').trim();
  }).filter(Boolean).join('\n');
}
export function parseSoftwareOrder(pages, meta = {}) {
  const selected = pages.map((page, i) => ({ page: i + 1, text: text(page, 30000) })).filter(p => /software\s+order\s+form/i.test(p.text));
  const base = { attachment_name: text(meta.name, 250), extraction: meta.ocr ? 'ocr' : 'text',
    total_pages: meta.totalPages || pages.length, pages_read: pages.length,
    signature_status: 'Review the client signature in the original PDF', issues: [] };
  if (!selected.length) return { ...base, kind: pages.some(p => text(p).length > 40 || /\bInvoice\b|Software Proposal/i.test(p)) ? 'not_order' : 'needs_review',
    issues: [pages.some(p => text(p).length > 40) ? 'No Software Order Form heading found. Check the document type in the original PDF.' : 'No readable Software Order Form found. Check the original PDF.'] };
  const source = selected[0];
  // Use the commercial form, excluding supplier bank details and contract boilerplate.
  const body = source.text.split(/software\s+order\s*(?:form)?/i).slice(1).join(' ').split(/I,?\s+the\s+undersigned|Bank\s+Details|For\s+A\.?V/i)[0];
  const lines = body.split(/\n/).map(x => x.trim()).filter(Boolean);
  const at = lines.findIndex(line => /^Licensee\b/i.test(line));
  const licensee = at >= 0 ? lines[at].replace(/^Licensee\s*:*/i, '').trim() || lines[at + 1] || '' : '';
  const company = licensee.split(/\s*\|\s*|\bORD\d+\b|Order\s+No\.?/i)[0].trim();
  const header = body.split(/Products\s+Description/i)[0];
  function field(label) {
    const match = header.match(new RegExp('(?:^|\\n)' + label + '[ \\t:|]*([^\\n]*)', 'i'));
    return text(match?.[1]?.split(/\s*\|\s*|\s+Fax\s*:/i)[0], 250);
  }
  function labelledAmount(label) {
    const line = lines.find(l => new RegExp('(?:^|\\|\\s*)' + label + '\\b', 'i').test(l));
    const tail = line?.replace(new RegExp('^.*?' + label, 'i'), '') || '';
    return money(tail.match(amountPattern)?.[0] || '');
  }
  const products = [];
  const productArea = body.split(/Products\s+Description/i)[1]?.split(/(?:Gross\s+)?License\s+Cost|Less\s+Discount|TOTAL\s+AMOUNT/i)[0] || '';
  for (const line of productArea.split('\n')) {
    const match = line.match(/^\s*((?:Premier|E[ -]?Soft)\b.+?)\s*(?:\|\s*|\s{2,})(\d+\s+(?:Employees|Users?))\s*(?:\|\s*|\s{2,})([\d,.]+)/i);
    if (match) products.push({ description: text(match[1], 250), license: text(match[2], 80), amount: money(match[3]) });
  }
  const orderNumber = source.text.match(/\bORD\d{6,12}(?!\d)/i)?.[0]?.toUpperCase() || '';
  const orderDate = header.match(/\bDate[\s:|]*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1] || '';
  const clientNumber = header.match(/Client\s+No\.?[\s:|]*([A-Z0-9-]+)/i)?.[1] || '';
  const additional = /additional|upgrade|increase\s+licen[cs]e|\b\d+(?:st|nd|rd|th)\s+licen[cs]e|επιπλ[εέ]ον|αναβ[αά]θμι/i.test(productArea + ' ' + meta.name);
  const addressStart = at >= 0 ? at + (lines[at].replace(/^Licensee\s*:*/i, '').trim() ? 1 : 2) : -1;
  const addressEnd = lines.findIndex(l => /^Telephone\b/i.test(l));
  const address = addressStart >= 0 && addressEnd > addressStart ? lines.slice(addressStart, addressEnd).map(l => l.split(/\s*\|\s*|\s{3,}/)[0]).filter(l => l && !/^(?:Date\b|Client\s+No|ORD\d|Vat\s+No)/i.test(l)).map(l=>l.replace(/,$/, '')).join(', ') : '';
  const fees = lines.filter(l => /(?:Installation|Training|Maintenance|Conversion).*Fees\s*:/i.test(l)).map(l => text(l.replace(/\s*\|\s*/g, ' '), 400));
  const paymentTerms = text(lines.find(l => /Payment\s+Terms\s*:/i.test(l))?.replace(/^.*?Payment\s+Terms\s*:/i, ''), 400);
  const result = { ...base, kind: 'software_order', company_name: text(company, 200), order_number: orderNumber,
    order_date: orderDate, client_number: clientNumber, address: text(address, 600),
    contact: field('Contact'), phone: field('Telephone'), email: field('Email'), products,
    license_cost: labelledAmount('License Cost'), total_amount: labelledAmount('TOTAL AMOUNT'),
    currency: 'EUR', fees, payment_terms: paymentTerms, additional_licenses: additional,
    evidence: [{ page: source.page, text: text(body.replace(/\s*\|\s*/g, ' ').replace(/ {2,}/g, ' '), 2200) }] };
  if (!company) result.issues.push('Company name could not be extracted.');
  if (!orderNumber) result.issues.push('Order number could not be extracted.');
  if (!products.length) result.issues.push('Review the products and licenses in the PDF.');
  if (result.total_amount === null) result.issues.push('Total amount could not be extracted.');
  if (meta.ocr) result.issues.push('Scanned PDF: verify OCR against the original.');
  if (result.pages_read < result.total_pages) result.issues.push('Only the first ' + result.pages_read + ' pages were read.');
  return result;
}
export function validateOrder(value) {
  if (!value || typeof value !== 'object' || !['software_order', 'not_order', 'needs_review'].includes(value.kind)) return null;
  const result = { kind: value.kind, attachment_name: text(value.attachment_name, 250), extraction: value.extraction === 'ocr' ? 'ocr' : 'text',
    signature_status: 'Review the client signature in the original PDF', total_pages: Math.max(0, Math.min(1000, Number(value.total_pages) || 0)),
    pages_read: Math.max(0, Math.min(20, Number(value.pages_read) || 0)), issues: (Array.isArray(value.issues) ? value.issues : []).slice(0,10).map(x => text(x,400)) };
  for (const key of ['company_name','order_number','order_date','client_number','contact','phone','email','address','payment_terms']) result[key] = text(value[key], key === 'address' ? 600 : 400);
  for (const key of ['license_cost','total_amount']) result[key] = typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null;
  result.currency = 'EUR'; result.additional_licenses = value.additional_licenses === true;
  result.products = (Array.isArray(value.products) ? value.products : []).slice(0,30).map(p => ({ description:text(p?.description,250),license:text(p?.license,80),amount:typeof p?.amount === 'number' && Number.isFinite(p.amount) && p.amount >= 0 ? p.amount : null }));
  result.fees = (Array.isArray(value.fees) ? value.fees : []).slice(0,10).map(x=>text(x,400));
  result.evidence = (Array.isArray(value.evidence) ? value.evidence : []).slice(0,5).map(x=>({page:Math.max(1,Math.min(1000,Number(x?.page)||1)),text:text(x?.text,2200)}));
  return result.attachment_name ? result : null;
}
export function mergeOrders(current, incoming) {
  const map = new Map();
  for (const o of [...current, ...incoming]) map.set(o.order_number || o.attachment_name, o);
  return [...map.values()].slice(0,10);
}
