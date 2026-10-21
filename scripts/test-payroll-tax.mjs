import {rewriteTestImports} from './test-module.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import assert from 'node:assert/strict';
const url=s=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(rewriteTestImports(s))).toString('base64');
const engineURL=url(readFileSync('app/payroll-engine.ts','utf8'));const engine=await import(engineURL);

// Calculation: Uzbekistan income tax, INPS and employer social tax.
const uz=engine.validateTaxProfile({name:'Uzbekistan',country:'UZ',...engine.uzbekistanTaxDefaults});
assert.deepEqual([uz.pitRate,uz.inpsRate,uz.inpsMode,uz.socialTaxRate],[12,0.1,'Paid from income tax',12]);
let slip=engine.calculatePayslip(10000000,0,0,[],[],uz);
const line=code=>slip.lines.find(l=>l.code===code)?.amount;
assert.equal(line('PIT_UZ'),1190000);assert.equal(line('INPS_UZ'),10000);assert.equal(line('SOCIAL_TAX_UZ'),1200000);
assert.equal(slip.deductions,1200000);assert.equal(slip.net,8800000);assert.equal(slip.employerContributions,1200000);assert.equal(slip.employerCost,11200000);assert.equal(slip.taxableIncome,10000000);
slip=engine.calculatePayslip(10000000,0,0,[],[],{...uz,inpsMode:'Withheld in addition'});assert.equal(line('PIT_UZ'),1200000);assert.equal(line('INPS_UZ'),10000);assert.equal(slip.net,8790000);
// Tax applies to all earnings (gross); other deductions come after and do not change the tax.
const allowance=engine.validateSalaryRule({name:'Transport',code:'TRANSPORT',category:'Earning',mode:'Fixed',basis:'Basic',amount:500000,sequence:1});
slip=engine.calculatePayslip(5000000,250000,100000,[allowance],[{code:'OT_WORKDAY',name:'Overtime',amount:250000}],uz);assert.equal(slip.gross,6000000);assert.equal(line('PIT_UZ'),714000);assert.equal(line('INPS_UZ'),6000);assert.equal(slip.deductions,820000);assert.equal(slip.net,5180000);assert.equal(slip.employerContributions,720000);
slip=engine.calculatePayslip(10000000,0,0,[],[],{...uz,socialTaxRate:25});assert.equal(slip.employerContributions,2500000);assert.equal(slip.net,8800000);
slip=engine.calculatePayslip(1000,0,0,[]);assert.equal(slip.employerContributions,0);assert.equal(slip.taxableIncome,null);assert.equal(slip.lines.length,1);
assert.throws(()=>engine.validateTaxProfile({...uz,pitRate:60}),/between 0 and 50/);assert.throws(()=>engine.validateTaxProfile({...uz,country:'KZ'}),/supported country/);assert.throws(()=>engine.validateTaxProfile({...uz,pitRate:0,inpsRate:1}),/cannot exceed/);assert.throws(()=>engine.validateTaxProfile({...uz,socialTaxRate:''}),/Social tax/);
assert.throws(()=>engine.validateSalaryRule({name:'Tax',code:'PIT_UZ',category:'Deduction',mode:'Percentage',basis:'Gross',amount:12,sequence:1}),/reserved/);
const profiles=[{id:'all',company:'',active:true},{id:'z',company:'Zalal LLC',active:true},{id:'old',company:'Other',active:false}];
assert.equal(engine.taxProfileFor(profiles,' zalal llc ').id,'z');assert.equal(engine.taxProfileFor(profiles,'Other').id,'all');assert.equal(engine.taxProfileFor([profiles[2]],'Other'),null);
console.log('Payroll tax: Uzbekistan income tax, INPS (from income tax or in addition), social tax, gross basis and profile matching passed.');

// Payroll API: tax setup permissions, one active setup per company, payslips and batches with tax.
let actor={name:'Admin',role:'Administrator'},seq=0;const store=new Map();globalThis.payrollActor=()=>actor;
globalThis.payrollEnv={BUCKET:{get:async key=>{const v=store.get(key);return v?{etag:v.etag,json:async()=>JSON.parse(v.value)}:null},put:async(key,value,options)=>{const old=store.get(key);if(options?.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options?.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++seq);store.set(key,{value,etag});return {etag}},list:async({prefix})=>({objects:[...store.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false})}};
const auth=url('export const currentUser=async()=>globalThis.payrollActor();export const sameOrigin=r=>r.headers.get("origin")===new URL(r.url).origin;export const reply=(d,status=200)=>Response.json(d,{status});');
const storeURL=url(readFileSync('app/payroll-store.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.payrollEnv;'));
const calcURL=url(readFileSync('app/hr-calculations.ts','utf8')),workedURL=url(readFileSync('app/payroll-worked-time.ts','utf8').replace("'./hr-calculations'",JSON.stringify(calcURL)));
const api=await import(url(readFileSync('app/api/payroll/route.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.payrollEnv;').replace("'../../local-auth'",JSON.stringify(auth)).replace("'../../payroll-store'",JSON.stringify(storeURL)).replace("'../../payroll-engine'",JSON.stringify(engineURL)).replace("'../../payroll-worked-time'",JSON.stringify(workedURL))));
const post=async b=>{const r=await api.POST(new Request('http://localhost/api/payroll',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify(b)}));return {status:r.status,body:await r.json()}};
const ok=async b=>{const r=await post(b);assert.equal(r.status,200,JSON.stringify(r.body));return r.body};
const employee=(id,company,salary)=>globalThis.payrollEnv.BUCKET.put(`hrm/local_seedy/employee-${id}.json`,JSON.stringify({id,name:id.toUpperCase()+' Xodim',company,privateInfo:{salary,salaryCurrency:'UZS',payFrequency:'Monthly'}}));
await employee('a','Zalal LLC',10000000);await employee('b','Budget School',8000000);await employee('c','',6000000);
const slipInput=(employeeId,extra={})=>({kind:'slips',employeeId,from:'2026-09-01',to:'2026-09-30',proration:'Full pay',acknowledgeFullPay:true,applyTax:true,...extra});
assert.match((await post(slipInput('a'))).body.error,/No active tax setup applies to Zalal LLC/);
actor={name:'Payroll writer',role:'Manager',permissions:{Payroll:'Write'}};assert.match((await post({kind:'taxProfiles',name:'UZ',country:'UZ',...engine.uzbekistanTaxDefaults})).body.error,/approval access/);actor={name:'Admin',role:'Administrator'};
const general=(await ok({kind:'taxProfiles',name:'Uzbekistan payroll taxes',company:'',country:'UZ',...engine.uzbekistanTaxDefaults,active:true})).record;
assert.match((await post({kind:'taxProfiles',name:'Duplicate',company:' ',country:'UZ',...engine.uzbekistanTaxDefaults})).body.error,/already exists for all companies/);
const budget=(await ok({kind:'taxProfiles',name:'Budget organisation',company:'Budget School',country:'UZ',...engine.uzbekistanTaxDefaults,socialTaxRate:25})).record;
const a=(await ok(slipInput('a'))).record;assert.equal(a.net,8800000);assert.equal(a.employerContributions,1200000);assert.equal(a.taxProfile.id,general.id);assert.match(a.calculationNote,/income tax 12%, INPS 0.1%/);
const b=(await ok(slipInput('b'))).record;assert.equal(b.employerContributions,2000000);assert.equal(b.taxProfile.name,'Budget organisation');
const c=(await ok(slipInput('c',{applyTax:false}))).record;assert.equal(c.net,6000000);assert.equal(c.employerContributions,0);assert.match(c.calculationNote,/No statutory tax/);
// A payslip keeps the rates it was calculated with.
const fresh=(await (await api.GET(new Request('http://localhost/api/payroll'))).json()).taxProfiles.find(p=>p.id===general.id);assert.equal((await post({...general,kind:'taxProfiles',pitRate:13})).status,409);await ok({...fresh,kind:'taxProfiles',pitRate:13});let data=await (await api.GET(new Request('http://localhost/api/payroll'))).json();assert.equal(data.slips.find(s=>s.id===a.id).taxProfile.pitRate,12);assert.equal(data.taxProfiles.length,2);
const batch=await ok({action:'batch',kind:'slips',employeeIds:['a','b'],from:'2026-10-01',to:'2026-10-31',proration:'Full pay',acknowledgeFullPay:true,applyTax:true});assert.equal(batch.created,2);
data=await (await api.GET(new Request('http://localhost/api/payroll'))).json();const batchSlips=data.slips.filter(s=>s.batchId===batch.batch.id);assert.equal(batchSlips.find(s=>s.employeeId==='a').lines.find(l=>l.code==='PIT_UZ').amount,1290000);
console.log('Payroll tax API: tax setup permissions, one active setup per company, company-specific rates, rate snapshots and batches passed.');

// Accounting: employer contributions post as extra payroll expense and liability.
const accURL=url(readFileSync('app/accounting-engine.ts','utf8'));const acc=await import(accURL);
const books=acc.newBooks('Zalal LLC','UZS','UZ');const pick=type=>books.accounts.find(x=>x.type===type&&x.active).id;
const entry=acc.applyAccounting(books,{action:'payroll',payrollData:{...a,status:'Paid'},date:'2026-10-05',journalId:books.journals.find(j=>j.type==='General').id,expenseAccountId:pick('Expense'),payableAccountId:pick('Liability'),deductionAccountId:books.accounts.filter(x=>x.type==='Liability'&&x.active)[1].id},'Tester');
const lines=entry.lines;const debit=lines.reduce((s,l)=>s+l.debit,0),credit=lines.reduce((s,l)=>s+l.credit,0);assert.equal(debit,credit);assert.equal(debit,acc.minor(11200000,'UZS'));assert.ok(lines.some(l=>/Employer contributions payable/.test(l.label)));
console.log('Payroll tax accounting: employer social tax posts as balanced expense and liability passed.');

// PDF: one page per payslip, Cyrillic names render.
const pdfSource=readFileSync('app/payslip-pdf.ts','utf8').replace("'pdf-lib'",JSON.stringify(import.meta.resolve('pdf-lib'))).replace("'@pdf-lib/fontkit'",JSON.stringify(import.meta.resolve('@pdf-lib/fontkit')));const {payslipPDF}=await import(url(pdfSource));
const font=readFileSync('public/fonts/NotoSans-Regular.ttf');const one=await payslipPDF([{...a,employeeName:'Алишер Навоий',status:'Paid'}],font);assert.ok(one.length>8000);assert.equal(Buffer.from(one).subarray(0,5).toString(),'%PDF-');
const {PDFDocument}=await import(import.meta.resolve('pdf-lib'));assert.equal((await PDFDocument.load(await payslipPDF(batchSlips,font))).getPageCount(),2);
await assert.rejects(()=>payslipPDF([{...a,employeeName:'测试'}],font),/cannot render/);await assert.rejects(()=>payslipPDF([],font),/at least one/);
mkdirSync('.local-temp',{recursive:true});writeFileSync('.local-temp/payslip-pdf-test.pdf',one);
console.log('Payslip PDF: single and batch PDFs, Cyrillic names and unsupported-script errors passed.');
