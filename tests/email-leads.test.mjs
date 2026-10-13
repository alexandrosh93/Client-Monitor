import test from 'node:test';
import assert from 'node:assert/strict';
import { senderList, outlookLink, readReview, mergeLeads, candidateFromMessage, normalName } from '../email-leads.mjs';

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
  for (const subject of ['Software Order Additional Payroll Licenses','Software Proposal - Example Ltd','SPAM Software Order','Αναβάθμιση σύστημα μισθοδοσίας']) assert.equal(candidateFromMessage({...message,subject},[sample.source_sender]),null);
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
