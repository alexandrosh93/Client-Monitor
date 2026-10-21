import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSoftwareOrder, validateOrder, isPdfAttachment, isOwnCompanyName } from '../software-orders.mjs';
import { candidateFromOrders, mergeLeads } from '../email-leads.mjs';
const form = `A.V. PremierSoft Ltd
Email: supplier@example.com
SOFTWARE ORDER FORM
Licensee
Example Client Ltd | Order No. : ORD2600123
10 Example Street | Date : 12/10/2026
Limassol | Client No. : 221EXA01
Telephone: 25000000
Email : client@example.com
Contact : Ms. Example
Products Description | License | Amount
Premier Payroll System | 350 Employees | 5,300.00
Less Discount | 1,300.00
License Cost | 4,000.00
V.A.T | 760.00
TOTAL AMOUNT | 4,760.00
Installation Fees : €150.00 + Vat
Training & Implementation Fees : €60.00 per hour
Payment Terms: 50% on order / 50% on Installation
I, the undersigned accept the agreement
Bank Details: confidential`;
test('extracts licensee rather than supplier; preserves license and fee distinctions',()=>{
  const o=parseSoftwareOrder([form],{name:'order.pdf'});
  assert.equal(o.company_name,'Example Client Ltd');assert.equal(o.email,'client@example.com');
  assert.equal(o.order_number,'ORD2600123');assert.equal(o.order_date,'12/10/2026');
  assert.equal(o.products[0].license,'350 Employees');assert.equal(o.products[0].amount,5300);
  assert.equal(o.license_cost,4000);assert.equal(o.total_amount,4760);assert.equal(o.fees.length,2);
  assert.ok(!o.address.includes('Date'));assert.equal(parseSoftwareOrder([form.replace('Telephone: 25000000','Telephone:')],{name:'blank.pdf'}).phone,'');
  assert.ok(!JSON.stringify(o).includes('confidential'));assert.ok(!o.signature_status.includes('Signed'));
});
test('never treats PremierSoft as the client and finds the actual Licensee name',()=>{
  assert.equal(isOwnCompanyName('A.V. PREMIERSOFT LTD'),true);
  assert.equal(isOwnCompanyName('PremierSoft Limited'),true);
  const repeated=form.replace('Licensee\nExample Client Ltd', 'Licensee\nA.V. PREMIERSOFT LTD\nExample Client Ltd');
  assert.equal(parseSoftwareOrder([repeated],{name:'order.pdf'}).company_name,'Example Client Ltd');
  const ownOnly=parseSoftwareOrder([form.replace('Example Client Ltd','A.V. PREMIERSOFT LTD')],{name:'order.pdf'});
  assert.equal(ownOnly.company_name,'');
  const message={from:{emailAddress:{address:'sender@example.com'}},subject:'A.V. PREMIERSOFT LTD Software Order',receivedDateTime:'2026-10-12T00:00:00Z',webLink:'https://outlook.office.com/mail/id/example'};
  assert.equal(candidateFromOrders(message,[ownOnly],['sender@example.com']),null);
});
test('proposal filenames and invoices do not establish a Software Order',()=>{
  for(const body of ['Software Proposal\nExample Ltd\nTotal 1,000.00','Invoice\nORD2600123']) assert.equal(parseSoftwareOrder([body],{name:'Software Order.pdf'}).kind,'not_order');
  assert.equal(parseSoftwareOrder([''],{name:'scan.pdf'}).kind,'needs_review');
});
test('additional payroll licenses are ignored even with an order form',()=>{
  const o=parseSoftwareOrder([form.replace('Less Discount','Additional Payroll Licenses\n(Upgrade from 100 to 350 Employees)\nLess Discount')],{name:'order.pdf'});
  assert.equal(o.additional_licenses,true);
  const m={from:{emailAddress:{address:'sender@example.com'}},subject:'Software Order',receivedDateTime:'2026-10-12T00:00:00Z',webLink:'https://outlook.office.com/mail/id/example'};
  assert.equal(candidateFromOrders(m,[o],['sender@example.com']),null);
  assert.equal(candidateFromOrders(m,[o],['other@example.com']),null);
});
test('increase-license and additional-user-license orders are ignored',()=>{
  const message={from:{emailAddress:{address:'sender@example.com'}},subject:'Software Order',bodyPreview:'',receivedDateTime:'2026-10-12T00:00:00Z',webLink:'https://outlook.office.com/mail/id/example'};
  for (const phrase of ['Increase License To 15 Users','Additional User License']) {
    const order=parseSoftwareOrder([form.replace('Less Discount',phrase + '\nLess Discount')],{name:'order.pdf'});
    assert.equal(order.additional_licenses,true);
    assert.equal(candidateFromOrders(message,[order],['sender@example.com']),null);
  }
  assert.equal(candidateFromOrders({...message,subject:'Increase License To 15 Users'},[parseSoftwareOrder([form],{name:'order.pdf'})],['sender@example.com']),null);
});
test('additional licenses are removed when an email also contains a new order',()=>{
  const newOrder=parseSoftwareOrder([form],{name:'new-order.pdf'});
  const additional={...newOrder,order_number:'ORD2600124',attachment_name:'additional.pdf',additional_licenses:true};
  const m={from:{emailAddress:{address:'sender@example.com'}},subject:'Software Order',receivedDateTime:'2026-10-12T00:00:00Z',webLink:'https://outlook.office.com/mail/id/example'};
  const candidate=candidateFromOrders(m,[additional,newOrder],['sender@example.com']);
  assert.equal(candidate.orders.length,1);
  assert.equal(candidate.orders[0].attachment_name,'new-order.pdf');
});
test('Software Proposal emails with an order PDF become normal order suggestions',()=>{
  const order=parseSoftwareOrder([form],{name:'proposal.pdf'});
  const message={from:{emailAddress:{address:'sender@example.com'}},subject:'Software Proposal - Example Ltd',receivedDateTime:'2026-10-12T00:00:00Z',webLink:'https://outlook.office.com/mail/id/example'};
  assert.ok(candidateFromOrders(message,[order],['sender@example.com']));
});
test('PDF enrichment updates a preview candidate and retains multiple source orders',()=>{
  const first={source_sender:'sender@example.com',source_date:'2026-10-12T00:00:00Z',source_subject:'Software Order',client_name:'Unknown'};
  const one=parseSoftwareOrder([form],{name:'one.pdf'}),two={...one,order_number:'ORD2600124',attachment_name:'two.pdf'};
  const rows=mergeLeads([first],[{...first,client_name:one.company_name,orders:[one]},{...first,client_name:one.company_name,orders:[two]}]);
  assert.equal(rows.length,1);assert.equal(rows[0].client_name,'Example Client Ltd');assert.equal(rows[0].orders.length,2);
});
test('imported PDF results cannot assert a signed client or inject unbounded values',()=>{
  const o=validateOrder({...parseSoftwareOrder([form],{name:'order.pdf'}),signature_status:'Signed',total_amount:Infinity});
  assert.equal(o.total_amount,null);assert.equal(o.signature_status,'Review the client signature in the original PDF');
  assert.equal(isPdfAttachment({name:'order.pdf',isInline:true}),false);
  assert.equal(isPdfAttachment({name:'order.pdf',isInline:false}),true);
});
test('client name and number are read from a Software Proposal PDF, never our own company', async () => {
  const { clientFromDocument, isOwnCompanyName } = await import('../software-orders.mjs');
  const pages = ['A.V. PremierSoft Ltd\nSoftware Proposal\nPrepared for: | Kyprou Pharma Ltd\nClient No: C1234\nDate: 21/10/2026'];
  assert.deepEqual(clientFromDocument(pages), { name: 'Kyprou Pharma Ltd', number: 'C1234' });
  assert.equal(clientFromDocument(['To: A.V. Premiersoft Ltd\nTo: Olive Foods']).name, 'Olive Foods');
  for (const n of ['A.V. Premiersoft Ltd', 'AV PremierSoft Limited', 'Premier Soft']) assert.equal(isOwnCompanyName(n), true);
});
