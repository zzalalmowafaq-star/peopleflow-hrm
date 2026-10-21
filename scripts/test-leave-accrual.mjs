import {rewriteTestImports} from './test-module.mjs';
import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import assert from 'node:assert/strict';
let actor={id:'a',name:'Admin',role:'Administrator'},seq=0;const store=new Map();
const bucket={get:async key=>{const v=store.get(key);return v?{etag:v.etag,json:async()=>JSON.parse(v.value)}:null},put:async(key,value,options)=>{const old=store.get(key);if(options?.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options?.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++seq);store.set(key,{value,etag});return {etag}},list:async({prefix})=>({objects:[...store.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false})};
globalThis.hrEnv={BUCKET:bucket};globalThis.hrActor=()=>actor;
const url=s=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(rewriteTestImports(s))).toString('base64');
const accrual=await import(url(readFileSync('app/leave-accrual.ts','utf8'))),calc=await import(url(readFileSync('app/hr-calculations.ts','utf8')));

// Calculation: monthly and yearly credits, timing, proration, waiting period, cap and employment end.
const plan={id:'p',name:'Annual',status:'Active',leaveType:'Annual leave',frequency:'Monthly',amount:1.75,timing:'End of each period',waitMonths:0,cap:0};
const alloc=(p,e={},start='2026-01-01',end='2026-12-31')=>({allocationType:'Accrual',status:'Approved',employeeId:'e',leaveType:'Annual leave',start,end,accrual:accrual.accrualSnapshot(p,e)});
const at=(a,d)=>accrual.accruedDays(a,d);
let a=alloc(plan,{start:'2025-01-01'});assert.equal(at(a,'2026-01-30'),0);assert.equal(at(a,'2026-01-31'),1.75);assert.equal(at(a,'2026-06-30'),10.5);assert.equal(at(a,'2026-12-31'),21);assert.equal(at(a,'2027-05-01'),21);
assert.equal(at(alloc({...plan,timing:'Start of each period'}),'2026-01-01'),1.75);
a=alloc(plan,{start:'2026-03-16'});assert.equal(at(a,'2026-03-31'),0.9);assert.equal(at(a,'2026-12-31'),16.65);assert.equal(at(a,'2026-03-15'),0);
assert.equal(at(alloc({...plan,waitMonths:3},{start:'2026-01-01'}),'2026-12-31'),15.75);
assert.equal(at(alloc({...plan,waitMonths:3},{start:'2024-01-01'}),'2026-12-31'),21);
assert.equal(at(alloc({...plan,cap:10}),'2026-12-31'),10);
const yearly={...plan,frequency:'Yearly',amount:20};assert.equal(at(alloc(yearly),'2026-12-30'),0);assert.equal(at(alloc(yearly),'2026-12-31'),20);assert.equal(at(alloc({...yearly,timing:'Start of each period'}),'2026-01-01'),20);
assert.equal(at(alloc(plan,{start:'2020-01-01',end:'2026-07-01'}),'2026-12-31'),10.5);
assert.equal(at(alloc(plan,{start:'2027-02-01'}),'2026-12-31'),0);
assert.equal(at({days:12,status:'Approved'},'2026-01-01'),12);assert.equal(accrual.addMonths('2026-01-31',1),'2026-02-28');
assert.equal(accrual.planAppliesTo({company:'Zalal'},{company:' zalal '}),true);assert.equal(accrual.planAppliesTo({company:'Zalal'},{company:'Other'}),false);
a=alloc(plan,{start:'2025-01-01'});const req={id:'r',employeeId:'e',leaveType:'Annual leave',status:'Approved',start:'2026-03-02',end:'2026-03-04'};
let b=calc.leaveBalance('e','Annual leave','2026-01-01','2026-12-31',[a],[req],{},[],[],'',{asOf:'2026-03-31'});assert.deepEqual(b,{entitlement:5.25,used:3,remaining:2.25});
b=calc.leaveBalance('e','Annual leave','2026-02-02','2026-02-02',[a],[req],{},[],[],'',{asOf:'2026-02-02',usedThrough:'2026-02-02'});assert.deepEqual(b,{entitlement:1.75,used:0,remaining:1.75});
console.log('Leave accrual: monthly/yearly credits, timing, proration, waiting period, cap and employment dates passed.');

// HR API: plans, accrual allocations and approvals against accrued time.
const auth=url('export const currentUser=async()=>globalThis.hrActor();export const sameOrigin=r=>r.headers.get("origin")===new URL(r.url).origin;export const reply=(d,status=200)=>Response.json(d,{status});'),schema=url(readFileSync('app/hr-schema.ts','utf8'));
const load=file=>import(url(readFileSync(file,'utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.hrEnv;').replace("'../../local-auth'",JSON.stringify(auth)).replace("'../../hr-schema'",JSON.stringify(schema))));
const api=await load('app/api/hr/route.ts'),gen=await load('app/api/leave-accruals/route.ts');
const request=(path,b)=>new Request('http://localhost'+path,{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify(b)});
const post=b=>api.POST(request('/api/hr',b));const save=async b=>{const r=await post(b);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));return (await r.json()).record};
const fail=async(b,status=400)=>{const r=await post(b);assert.equal(r.status,status,JSON.stringify(await r.clone().json()));return (await r.json()).error};
const get=async m=>(await (await api.GET(new Request('http://localhost/api/hr?module='+m))).json()).records;
const employee=(id,fields)=>bucket.put(`hrm/local_seedy/employee-${id}.json`,JSON.stringify({id,name:id.toUpperCase()+' Employee',...fields}));
await employee('e',{start:'2025-01-01',department:'Ops',company:'Zalal'});
let savedPlan=await save({module:'accrualPlans',name:'Annual leave accrual',leaveType:'Annual leave',company:'',frequency:'Monthly',amount:1.75,timing:'End of each period',waitMonths:0,cap:0});
assert.match(await fail({module:'accrualPlans',name:'Bad',leaveType:'Annual leave',frequency:'Monthly',amount:0,timing:'End of each period',waitMonths:0,cap:0}),/more than 0/);
assert.match(await fail({module:'accrualPlans',name:'Bad',leaveType:'Annual leave',frequency:'Monthly',amount:1,timing:'End of each period',waitMonths:1.5,cap:0}),/whole number/);
actor={name:'Manager',role:'Manager'};await fail({module:'accrualPlans',name:'Manager plan',leaveType:'Annual leave',frequency:'Monthly',amount:1,timing:'End of each period',waitMonths:0,cap:0},403);actor={id:'a',name:'Admin',role:'Administrator'};
assert.match(await fail({module:'leaveAllocations',employeeId:'e',name:'No days',leaveType:'Annual leave',start:'2026-01-01',end:'2026-12-31'}),/positive/);
assert.match(await fail({module:'leaveAllocations',employeeId:'e',name:'No plan',allocationType:'Accrual',leaveType:'Annual leave',start:'2026-01-01',end:'2026-12-31'}),/accrual plan/);
let allocation=await save({module:'leaveAllocations',employeeId:'e',name:'Annual 2026',allocationType:'Accrual',planId:savedPlan.id,leaveType:'Sick leave',start:'2026-01-01',end:'2026-12-31'});
assert.equal(allocation.days,21);assert.equal(allocation.leaveType,'Annual leave');assert.equal(allocation.accrual.amount,1.75);
allocation=await save({...allocation,status:'Approved'});assert.equal(allocation.days,21);
const leave=async(start,end)=>save({module:'leave',employeeId:'e',leaveType:'Annual leave',start,end});
const feb=await leave('2026-02-02','2026-02-04');assert.match(await fail({...feb,status:'Approved'}),/Remaining on 2026-02-02: 1.75/);
const mar=await save({...await leave('2026-03-02','2026-03-04'),status:'Approved'});
const jun=await leave('2026-06-01','2026-06-08');assert.equal((await post({...jun,status:'Approved'})).status,400);
await save({...jun,status:'Cancelled'});await save({...await leave('2026-06-01','2026-06-05'),status:'Approved'});
const early=await leave('2026-02-16','2026-02-16');assert.match(await fail({...early,status:'Approved'}),/approved request starting 2026-03-02/);
// Editing the plan later does not change an existing allocation.
savedPlan=await save({...savedPlan,amount:3});const [stored]=(await get('leaveAllocations'));assert.equal(stored.days,21);assert.equal(stored.accrual.amount,1.75);
allocation=await save({...stored,status:'Cancelled'}).catch(()=>null);assert.equal(allocation,null,'An allocation with approved leave cannot be cancelled.');
const fixed=await save({module:'leaveAllocations',employeeId:'e',name:'Sick 2026',allocationType:'Fixed',leaveType:'Sick leave',days:10,start:'2026-01-01',end:'2026-12-31'});assert.equal(fixed.allocationType,'Fixed');assert.equal(fixed.days,10);
console.log('Accrual API: plan validation and permissions, plan snapshots, approvals against accrued days and later-request protection passed.');

// Bulk generation: preview writes nothing, skips existing and departed employees, prorates new joiners.
await employee('f',{start:'2026-07-01',department:'Sales',company:'Zalal'});await employee('g',{start:'2020-01-01',end:'2026-01-01',department:'Sales'});await employee('h',{start:'2019-05-01',department:'Ops'});
const run=b=>gen.POST(request('/api/leave-accruals',b));const body={planId:savedPlan.id,start:'2026-01-01',end:'2026-12-31',status:'Approved'};
const before=store.get('operations/leave-ledger.json').etag;let r=await run(body);assert.equal(r.status,200);let d=await r.json();assert.equal(store.get('operations/leave-ledger.json').etag,before);
const row=id=>d.rows.find(x=>x.employeeId===id);assert.equal(d.eligible,2);assert.match(row('e').skip,/Already has/);assert.match(row('g').skip,/Left before/);assert.equal(row('f').days,18);assert.equal(row('h').days,36);
r=await run({...body,department:'sales'});d=await r.json();assert.deepEqual(d.rows.map(x=>x.employeeId).sort(),['f','g']);
actor={name:'Manager',role:'Manager'};r=await run(body);assert.equal(r.status,400);r=await run({...body,status:'To approve'});assert.equal(r.status,200);actor={id:'a',name:'Admin',role:'Administrator'};
r=await run({...body,action:'generate'});d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.equal(d.created,2);
const generated=(await get('leaveAllocations')).filter(x=>['f','h'].includes(x.employeeId));assert.equal(generated.length,2);assert.ok(generated.every(x=>x.status==='Approved'&&x.allocationType==='Accrual'&&x.name==='Annual leave accrual 2026'&&x.accrual.amount===3));
r=await run({...body,action:'generate'});assert.equal(r.status,400);assert.match((await r.json()).error,/No allocations/);
await save({...generated.find(x=>x.employeeId==='h'),status:'Cancelled'});
console.log('Accrual generation: preview, department filter, approval permission, proration, skips and repeat protection passed.');
