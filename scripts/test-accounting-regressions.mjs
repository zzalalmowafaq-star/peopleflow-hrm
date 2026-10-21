import {rewriteTestImports} from './test-module.mjs';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
const url=s=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(rewriteTestImports(s))).toString('base64');
const engineURL=url(readFileSync('app/accounting-engine.ts','utf8'));
const {newBooks,applyAccounting,accountingReports,paymentCapacity}=await import(engineURL);
const views=await import(url(readFileSync('app/accounting-report-view.ts','utf8').replace("'./accounting-engine'",JSON.stringify(engineURL))));
function fixture(type='invoice'){
 const s=newBooks('Regression books','USD'),run=input=>applyAccounting(s,input,'Test'),account=code=>s.accounts.find(a=>a.code===code),journal=type=>s.journals.find(j=>j.type===type);
 const partner=run({action:'contact',name:'Test partner'});
 const doc=run({action:'document',type,partnerId:partner.id,date:'2026-01-10',dueDate:'2026-01-31',journalId:journal(type==='invoice'?'Sales':'Purchases').id,lines:[{label:'Service',accountId:account(type==='invoice'?'4000':'5000').id,quantity:1,price:100}]});
 return {s,run,account,journal,doc};
}
// Control roles are protected before any entries exist, for both AR and AP.
for(const [type,code,role] of [['invoice','1100','Receivable'],['bill','2000','Payable']]){
 const f=fixture(type);assert.throws(()=>f.run({action:'account',...f.account(code),type:'Income'}),/control account/);
 assert.equal(f.account(code).type,role);f.run({action:'account',...f.account(code),name:'Renamed control'});f.run({action:'postDocument',id:f.doc.id});
 assert.equal(accountingReports(f.s,'2026-01-01','2026-01-31').profit,type==='invoice'?10000:-10000);
 const legacy=fixture(type);legacy.account(code).type='Income';assert.throws(()=>legacy.run({action:'postDocument',id:legacy.doc.id}),/Control account/);assert.equal(legacy.s.entries.length,0);
}
{
 const f=fixture();assert.throws(()=>f.run({action:'account',...f.account('1000'),type:'Income'}),/bank or cash journal/);
 const tax=f.run({action:'tax',name:'Tax',rate:10,saleAccountId:f.account('2100').id,purchaseAccountId:f.account('2200').id});
 assert.throws(()=>f.run({action:'account',...f.account('2100'),type:'Income'}),/sales tax account/);
 assert.throws(()=>f.run({action:'account',...f.account('2200'),type:'Expense'}),/purchase tax account/);
 assert.ok(tax.id);
}
// Recheck a saved draft's journal and line-account roles at posting time.
for(const type of ['invoice','bill']){
 const f=fixture(type),journal=f.journal(type==='invoice'?'Sales':'Purchases');f.run({action:'journal',...journal,active:false});
 assert.throws(()=>f.run({action:'postDocument',id:f.doc.id}),/active journal/);assert.equal(f.s.entries.length,0);assert.equal(f.doc.status,'Draft');
 f.run({action:'journal',...journal,active:true});f.run({action:'postDocument',id:f.doc.id});assert.equal(f.doc.status,'Posted');
 const changed=fixture(type);changed.run({action:'journal',...changed.journal(type==='invoice'?'Sales':'Purchases'),type:'General'});assert.throws(()=>changed.run({action:'postDocument',id:changed.doc.id}),/active journal/);
 const account=fixture(type);account.run({action:'account',...account.account(type==='invoice'?'4000':'5000'),type:'Liability'});assert.throws(()=>account.run({action:'postDocument',id:account.doc.id}),/Document line account/);
}
// Payments must fit every subsequent daily balance, not just the final balance.
for(const type of ['invoice','bill']){
 const f=fixture(type);f.run({action:'postDocument',id:f.doc.id});const payment=amount=>({action:'payment',documentId:f.doc.id,date:'2026-01-11',amount,journalId:f.journal('Bank').id});
 const first=f.run(payment(100));f.run({action:'reversePayment',paymentId:first.id,date:'2026-02-01'});
 assert.equal(paymentCapacity(f.s,f.doc,'2026-01-20'),0);assert.equal(paymentCapacity(f.s,f.doc,'2026-02-01'),10000);
 const before=f.s.entries.length;assert.throws(()=>f.run({...payment(100),date:'2026-01-20'}),/recorded date/);assert.equal(f.s.entries.length,before);
 f.run({...payment(100),date:'2026-02-01'});assert.equal(accountingReports(f.s,'2026-01-01','2026-01-31')[type==='invoice'?'receivables':'payables'][0].due,0);
}
{
 const f=fixture();f.run({action:'postDocument',id:f.doc.id});const pay=(date,amount)=>f.run({action:'payment',documentId:f.doc.id,date,amount,journalId:f.journal('Bank').id});
 const first=pay('2026-01-11',60);f.run({action:'reversePayment',paymentId:first.id,date:'2026-02-01'});assert.equal(paymentCapacity(f.s,f.doc,'2026-01-20'),4000);
 pay('2026-01-20',40);assert.throws(()=>pay('2026-01-21',0.01),/recorded date/);pay('2026-02-01',60);
 for(const to of ['2026-01-11','2026-01-20','2026-01-31','2026-02-01'])assert.ok(accountingReports(f.s,'2026-01-01',to).receivables[0].due>=0);
 const future=fixture();future.run({action:'postDocument',id:future.doc.id});future.run({action:'payment',documentId:future.doc.id,date:'2026-03-01',amount:100,journalId:future.journal('Bank').id});assert.equal(paymentCapacity(future.s,future.doc,'2026-01-20'),0);
}
// Screen rows and CSV rows share one report model; check expected statement
// signs, retained earnings, totals and all aging boundaries independently.
const f=fixture();f.run({action:'postDocument',id:f.doc.id});
const fmt=n=>(n/100).toFixed(2);const profit=views.buildAccountingReport(f.s,'profit','2026-01-01','2026-01-31');
assert.deepEqual(profit.rows.find(r=>r.cells[0]==='4000 Sales revenue').cells,['4000 Sales revenue',10000]);
assert.deepEqual(profit.rows.find(r=>r.cells[0]==='Net profit').cells,['Net profit',10000]);
assert.equal(profit.rows.some(r=>String(r.cells[0]).includes('Trade receivables')),false);
const pnlCSV=views.accountingReportCSV(f.s,profit,'2026-01-01','2026-01-31',fmt);assert.deepEqual(pnlCSV.find(r=>r[0]==='Net profit'),['Net profit','100.00']);
assert.doesNotThrow(()=>views.buildAccountingReport(f.s,'balance','2026-01-01','2025-12-31'));
const balance=views.buildAccountingReport(f.s,'balance','2026-01-01','2026-01-31');
assert.deepEqual(balance.rows.find(r=>String(r.cells[0]).startsWith('Accumulated earnings')).cells,['Accumulated earnings (all dates through report end)',10000]);
assert.deepEqual(balance.rows.find(r=>String(r.cells[0]).startsWith('Balance check')).cells,['Balance check (assets minus liabilities and equity)',0]);
assert.equal(balance.rows.some(r=>r.cells[0]==='4000 Sales revenue'),false);
for(const kind of ['receivables','payables']){
 const s=newBooks('Aging','USD');s.documents=[0,1,30,31,60,61,90,91].map((age,i)=>({id:String(i),type:kind==='receivables'?'invoice':'bill',status:'Posted',number:'TEST/'+i,partnerName:'Partner '+i,date:'2026-01-01',dueDate:new Date(Date.parse('2026-10-21')-age*86400000).toISOString().slice(0,10),total:10000}));
 const view=views.buildAccountingReport(s,kind,'2026-01-01','2026-10-21');assert.deepEqual(view.headers,['Document','Partner','Due date','Not due','1–30 days','31–60 days','61–90 days','90+ days']);
 assert.deepEqual(view.rows.at(-1).cells,['Total','','',10000,20000,20000,20000,10000]);
 for(const [i,bucket] of [0,1,1,2,2,3,3,4].entries())assert.equal(view.rows[i].cells[3+bucket],10000);
 const csv=views.accountingReportCSV(s,view,'2026-01-01','2026-10-21',fmt);assert.deepEqual(csv.at(-1),['Total','','','100.00','200.00','200.00','200.00','100.00']);
}
for(const kind of ['profit','balance','trial','ledger','tax','receivables','payables']){
 const view=views.buildAccountingReport(f.s,kind,'2026-01-01','2026-01-31'),csv=views.accountingReportCSV(f.s,view,'2026-01-01','2026-01-31',fmt),header=csv.findIndex(r=>r===view.headers);
 assert.deepEqual(csv.slice(header+1),view.rows.map(r=>r.cells.map((c,i)=>views.reportCell(view,c,i,fmt))));
}
console.log('All four accounting regressions passed: control roles, posting-time journal validation, historical payment capacity, and matching financial statement/aging exports.');
