import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLeads, modulesFromOrders } from '../email-leads.mjs';
import { buildOrderUpdate, orderReview, saveOrderUpdate } from '../existing-client-orders.mjs';
const client = { id: 1, name: 'Example Ltd', clientCode: 'C01', modules: ['Accounting'], status: 'Completed', progress: 100, commentLog: [{ text: 'Keep this note' }] };
const order = { kind: 'software_order', company_name: 'Example Ltd', client_number: 'C01', order_number: 'ORD123456', order_date: '20/10/2026', attachment_name: 'order.pdf', products: [{ description: 'Stock Control', license: '3 Users', amount: 100 }, { description: 'Invoicing', amount: 50 }], license_cost: 150, total_amount: 178.5, fees: ['Training: 20'], payment_terms: 'On delivery' };
const row = { client_name: 'Example Ltd', source_date: '2026-10-20', source_subject: 'Software order', source_url: 'https://outlook.office.com/mail/id/1', orders: [order] };
const group = () => groupLeads([structuredClone(row)], [structuredClone(client)])[0];
test('purchase adds only selected modules and appends order/source details without mutating client', () => {
  const update = buildOrderUpdate(group(), client, ['Stock'], 'reviewer');
  assert.deepEqual(update.modules, ['Accounting', 'Stock']);
  assert.deepEqual(update.commentLog[1], client.commentLog[0]);
  for (const detail of ['ORD123456', '3 Users', '178.50', 'Training: 20', 'On delivery', row.source_url]) assert.ok(update.commentLog[0].text.includes(detail));
  assert.deepEqual(client.modules, ['Accounting']);
  assert.equal(update.status, undefined); assert.equal(update.progress, undefined);
  assert.throws(() => buildOrderUpdate(group(), client, ['Unknown module'], 'reviewer'));
});
test('repeat review and changed email or attachment do not add the order twice', () => {
  const update = buildOrderUpdate(group(), client, ['Stock'], 'reviewer');
  const renamed = group(); renamed.orders[0].attachment_name = 'copy.pdf';
  assert.equal(buildOrderUpdate(renamed, {...client,...update}, ['Stock'], 'reviewer'), null);
  assert.equal(orderReview(renamed, {...client,...update}).pending.length, 0);
});
test('records a purchase without forcing module changes and excludes additional licenses', () => {
  assert.deepEqual(buildOrderUpdate(group(), client, [], 'reviewer').modules, client.modules);
  const g=group();g.orders[0].additional_licenses=true;
  assert.equal(buildOrderUpdate(g,client,[],'reviewer'),null);
  assert.deepEqual(modulesFromOrders([{ products: [{description:'Invoicing'}] }]), ['Invoicing']);
});
test('conflicting IDs, duplicate names and mixed-company orders require review', () => {
  const other={...client,id:2,name:'Other Ltd',clientCode:'C02'};
  const conflicting={...row,orders:[{...order,client_number:'C02'}]};
  assert.equal(groupLeads([conflicting],[client,other])[0].matchConflict,true);
  assert.equal(groupLeads([conflicting],[client])[0].matchConflict,true);
  assert.equal(groupLeads([row],[client,{...client,id:2}])[0].existing,null);
  assert.equal(groupLeads([{...row,orders:[order,{...order,company_name:'Other Ltd'}]}],[client])[0].matchConflict,true);
  assert.deepEqual(groupLeads([row],[{...client,modules:['stock','INVOICING']}])[0].newModules,[]);
});
function fakeDb({fail=false,conflict=false,modules=['Accounting'],snapshot='{Accounting}',comment='Old plain text'}={}) {
  const writes=[];const filters=[];
  const db={from(table){assert.equal(table,'clients');let payload;
    const query={select(){return query},eq(key,value){if(payload)filters.push([key,value]);return query},is(key,value){if(payload)filters.push([key,value]);return query},update(value){payload=value;writes.push(value);return query},async single(){return payload ? {data:conflict||fail?null:{id:1},error:fail?{message:'Denied'}:null} : {data:{id:1,name:client.name,client_code:'C01',modules,modules_snapshot:snapshot,comment},error:null}}};return query;}};
  return {db,writes,filters};
}
test('successful save is one conditional update preserving fresh modules and legacy comments', async () => {
  const mock=fakeDb({modules:['Accounting','Payroll'],snapshot:'{Accounting,Payroll}'});
  const result=await saveOrderUpdate(mock.db,group(),['Stock'],'reviewer');
  assert.deepEqual(result.modules,['Accounting','Payroll','Stock']);
  assert.equal(result.commentLog[1].text,'Old plain text');
  assert.equal(mock.writes.length,1);
  assert.deepEqual(Object.keys(mock.writes[0]).sort(),['comment','modules']);
  assert.ok(mock.filters.some(([k,v])=>k==='modules'&&v==='{Accounting,Payroll}'));
  assert.ok(mock.filters.some(([k,v])=>k==='comment'&&v==='Old plain text'));
});
test('failed or conflicting writes reject instead of reporting success', async () => {
  for(const opts of [{fail:true},{conflict:true}]) {
    const mock=fakeDb(opts);await assert.rejects(saveOrderUpdate(mock.db,group(),['Stock'],'reviewer'),/not saved/);
  }
  assert.deepEqual(client.modules,['Accounting']);
});
test('repeated saved order causes no database write; jsonb snapshots are preserved', async () => {
  const first=buildOrderUpdate(group(),client,['Stock'],'reviewer');
  const repeat=fakeDb({modules:first.modules,comment:JSON.stringify(first.commentLog)});
  assert.equal((await saveOrderUpdate(repeat.db,group(),['Stock'],'reviewer')).count,0);
  assert.equal(repeat.writes.length,0);
  const json=fakeDb({snapshot:'["Accounting"]'});await saveOrderUpdate(json.db,group(),['Stock'],'reviewer');
  assert.ok(json.filters.some(([k,v])=>k==='modules'&&v==='["Accounting"]'));
});
