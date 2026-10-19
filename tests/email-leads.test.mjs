import test from 'node:test';
import assert from 'node:assert/strict';
import { senderList, outlookLink, readReview, mergeLeads, candidateFromMessage, normalName, managerFromSender } from '../email-leads.mjs';

const sample = {
  client_name: 'Example Ltd', classification: 'Possible new client', reason: 'Proposal accepted.',
  source_sender: 'sender@example.com', source_date: '2026-10-12T10:00:00Z',
  source_subject: 'Software Order', source_url: 'https://outlook.office.com/mail/id/example',
};
test('only explicit Outlook HTTPS source links are allowed', () => {
  for (const url of ['javascript:alert(1)', 'https://outlook.office.com.evil.test/a', 'http://outlook.office.com', 'https://user@outlook.office.com']) assert.equal(outlookLink(url), '');
  assert.equal(outlookLink(sample.source_url), sample.source_url);
});
test('sender filters normalize aliases and reject injection or empty scope', () => {
  assert.deepEqual(senderList('SENDER@example.com, sender@example.com;other@example.com'), ['sender@example.com', 'other@example.com']);
  for (const text of ['', "a' or true@example.com", 'a@example.com or 1 eq 1']) assert.throws(() => senderList(text));
});
test('import validation is atomic and never marks a client confirmed', () => {
  const rows = readReview({schema_version:1,candidates:[{...sample,confirmed_new_client:true}]});
  assert.equal(rows[0].confirmed_new_client, false);
  assert.throws(() => readReview({schema_version:1,candidates:[sample,{...sample,source_url:'https://evil.test'}]}));
  assert.throws(() => readReview({schema_version:1,candidates:[{...sample,source_date:'yesterday'}]}));
});
test('repeat imports are deduplicated without replacing reviewed descriptions', () => {
  const existing = readReview({schema_version:1,candidates:[sample]});
  const fresh = readReview({schema_version:1,candidates:[{...sample,reason:'Generic rule',source_subject:'RE: Software Order'}]});
  assert.equal(mergeLeads(existing, fresh).length, 1);
  assert.equal(mergeLeads(existing, fresh)[0].reason, sample.reason);
});
test('live matches require exact sender and exclude upgrades and spam', () => {
  const message = {from:{emailAddress:{address:sample.source_sender}},subject:sample.source_subject,bodyPreview:'Positive response to proposal.',receivedDateTime:sample.source_date,webLink:sample.source_url};
  assert.ok(candidateFromMessage(message, [sample.source_sender]));
  assert.equal(candidateFromMessage(message, ['another@example.com']), null);
  for (const subject of ['Software Order Additional Payroll Licenses','Additional User License','Increase License To 15 Users','Software Proposal - Example Ltd','SPAM Software Order','Αναβάθμιση σύστημα μισθοδοσίας']) assert.equal(candidateFromMessage({...message,subject},[sample.source_sender]),null);
  assert.equal(candidateFromMessage({...message,subject:'Software Order',bodyPreview:'Please increase user license to 15 users.'},[sample.source_sender]),null);
  assert.ok(candidateFromMessage({...message,subject:'Παραγγελία συστήματος'},[sample.source_sender]));
});
test('review imports silently ignore Software Proposal candidates', () => {
  const rows=readReview({schema_version:1,candidates:[sample,{...sample,source_subject:'RE: Software Proposal - Example Ltd'}]});
  assert.equal(rows.length,1);
  assert.equal(rows[0].source_subject,'Software Order');
});
test('client matching tolerates punctuation and case without fuzzy identity guesses', () => {
  assert.equal(normalName('Example, LTD.'), normalName('example ltd'));
  assert.notEqual(normalName('Example Ltd'), normalName('Example Holdings Ltd'));
});
test('known sales senders map to the correct client manager', () => {
  assert.equal(managerFromSender('andreas.kyriacou@premiersoft.com.cy'),'AK');
  assert.equal(managerFromSender('andreas@premiersoft.com.cy'),'AK');
  assert.equal(managerFromSender('vakis.theodosiou@premiersoft.com.cy'),'VT');
  assert.equal(managerFromSender('vakis@premiersoft.com.cy'),'VT');
  assert.equal(managerFromSender('someone@example.com'),'');
});

test('leads for the same company are combined into one group', async () => {
  const { groupLeads } = await import('../email-leads.mjs');
  const row = (name, date, subject) => ({ client_name: name, source_date: date, source_subject: subject, source_sender: 'vakis@premiersoft.com.cy', orders: [] });
  const groups = groupLeads([row('Acme Ltd', '2026-10-01T10:00:00Z', 'Order 1'), row('ACME LTD.', '2026-10-05T10:00:00Z', 'Order 2'), row('Beta Ltd', '2026-10-03T10:00:00Z', 'Order 3')], []);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].rows.length, 2);
  assert.equal(groups[0].rows[0].source_subject, 'Order 2');
  assert.equal(groups[0].existing, null);
});

test('existing clients are recognised by name or client number and only new modules are proposed', async () => {
  const { groupLeads } = await import('../email-leads.mjs');
  const clients = [{ id: 7, name: 'Kyprou Pharma Ltd', clientCode: 'C123', modules: ['Accounting'] }];
  const order = { kind: 'software_order', client_number: 'C123', company_name: 'Kyprou Pharma', order_number: 'SO-1', products: [{ description: 'Stock Control' }, { description: 'Accounting' }] };
  const groups = groupLeads([{ client_name: 'Kyprou Pharma', source_date: '2026-10-05T10:00:00Z', source_subject: 'Order', source_sender: 'a@b.com', orders: [order] }], clients);
  assert.equal(groups[0].existing.id, 7);
  assert.deepEqual(groups[0].newModules, ['Stock']);
});
