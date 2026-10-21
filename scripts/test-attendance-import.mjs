import {rewriteTestImports} from './test-module.mjs';
import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import assert from 'node:assert/strict';
let seq=0;const store=new Map();
const bucket={get:async key=>{const v=store.get(key);return v?{etag:v.etag,json:async()=>JSON.parse(v.value)}:null},put:async(key,value,options)=>{const old=store.get(key);if(options?.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options?.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag=String(++seq);store.set(key,{value,etag});return {etag}},list:async({prefix})=>({objects:[...store.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false})};
globalThis.hrEnv={BUCKET:bucket};globalThis.payrollEnv=globalThis.hrEnv;let actor={id:'a',name:'Admin',role:'Administrator'};globalThis.importActor=()=>actor;
const url=s=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(rewriteTestImports(s))).toString('base64');
const device=await import(url(readFileSync('app/attendance-device.ts','utf8')));
const overtime=await import(url(readFileSync('app/overtime.ts','utf8')));

// --- Parsing: formats, timezones, directions
const tz=()=> 'Asia/Tashkent';
assert.equal(new Date(device.parseLocalTimestamp('05.10.2026','08:00',  'Asia/Tashkent')).toISOString(),'2026-10-05T03:00:00.000Z');
assert.equal(new Date(device.parseLocalTimestamp('2026/10/05 8:00 PM','', 'Asia/Kabul')).toISOString(),'2026-10-05T15:30:00.000Z');
assert.equal(new Date(device.parseLocalTimestamp('10/05/2026 08:00','', 'UTC','MDY')).toISOString(),'2026-10-05T08:00:00.000Z');
assert.equal(new Date(device.parseLocalTimestamp('2026-03-08 03:30','', 'America/New_York')).toISOString(),'2026-03-08T07:30:00.000Z');
assert.equal(device.parseLocalTimestamp('31.02.2026 08:00','', 'UTC'),null);
assert.equal(device.parseDirection('Check-In'),'in');assert.equal(device.parseDirection('1'),'out');assert.equal(device.parseDirection('Выход'),'out');assert.equal(device.parseDirection(''),'');
let parsed=device.readPunchFile('AC-No.;Date;Time;State\n0101;05.10.2026;08:00;0\n;05.10.2026;08:00;0\n0101;garbage;08:00;1\n',tz);
assert.equal(parsed.punches.length,1);assert.equal(parsed.exceptions.length,2);assert.deepEqual(parsed.columns.sort(),['badge','date','direction','time']);
assert.throws(()=>device.readPunchFile('Name,Value\nx,y\n',tz),/device user ID/);
console.log('Device files: delimiters, date formats, 12-hour clock, DST, timezone conversion and in/out states passed.');

// --- Pairing
const schedule={id:'s',timezone:'Asia/Tashkent',hoursPerDay:8,weekdays:'Mon,Tue,Wed,Thu,Fri',status:'Active'};
const policy={id:'p',name:'ZM overtime',company:'ZM',toleranceMinutes:15,roundingMinutes:15,weekdayRate:2,restDayRate:2,holidayRate:3,maxShiftHours:16,duplicateMinutes:2,missingCheckout:'Report as exception',status:'Active'};
const employees=[{id:'e1',name:'Day Worker',badgeId:'0101',employeeNumber:'Z-1',company:'ZM',workScheduleId:'s',start:'2026-01-01',privateInfo:{payFrequency:'Monthly',salary:1760,salaryCurrency:'USD'}},{id:'e2',name:'Night Worker',employeeNumber:'A-7',company:'ZM',workScheduleId:'s',start:'2026-01-01'},{id:'e3',name:'Forgetful',employeeNumber:'X9',company:'ZM',workScheduleId:'s',start:'2026-01-01'}];
const night=device.readPunchFile('User ID,Date Time\na-7,2026-10-05 22:00\na-7,2026-10-06 06:00\nX9,2026-10-05 08:00\n999,2026-10-05 08:00\n101,2026-10-05 08:00\n101,2026-10-05 08:01\n101,2026-10-05 17:00\n',tz);
let paired=device.pairPunches(night.punches,employees,[schedule],[policy]);
assert.equal(paired.records.length,2);assert.equal(paired.duplicates,1);
const nightRecord=paired.records.find(r=>r.employeeId==='e2');assert.equal(nightRecord.checkIn,'2026-10-05T17:00:00.000Z');assert.equal(nightRecord.checkOut,'2026-10-06T01:00:00.000Z');
assert.ok(paired.records.some(r=>r.employeeId==='e1'),'leading zeros in device IDs match the badge');
assert.equal(paired.exceptions.length,2);assert.ok(paired.exceptions.some(e=>/without a check-out/.test(e.reason)));assert.ok(paired.exceptions.some(e=>/No employee/.test(e.reason)));
paired=device.pairPunches(night.punches,employees,[schedule],[{...policy,missingCheckout:'Close at scheduled hours'}]);
const auto=paired.records.find(r=>r.employeeId==='e3');assert.ok(auto.autoClosed);assert.equal((Date.parse(auto.checkOut)-Date.parse(auto.checkIn))/3600000,8);
const conflict=device.pairPunches(night.punches,[...employees,{id:'e4',name:'Clash',badgeId:'101'}],[schedule],[policy]);assert.ok(conflict.exceptions.some(e=>/more than one employee/.test(e.reason)));
const screened=device.screenAgainstExisting(paired.records,[{employeeId:'e2',checkIn:nightRecord.checkIn,checkOut:nightRecord.checkOut},{employeeId:'e1',checkIn:'2026-10-05T05:00:00.000Z',checkOut:'2026-10-05T06:00:00.000Z'}]);
assert.equal(screened.ready.length,1);assert.deepEqual(screened.skipped.map(s=>s.reason.split(' ')[0]).sort(),['Already','Overlaps']);
console.log('Pairing: night shifts across midnight, duplicates, badge/reference matching, conflicts, missing check-outs, auto check-out and re-import screening passed.');

// --- Overtime analysis
const holiday={date:'2026-10-07',status:'Active',company:'ZM',name:'Holiday'};
const att=(day,from,to)=>({employeeId:'e1',checkIn:new Date(device.parseLocalTimestamp(day,from,'Asia/Tashkent')).toISOString(),checkOut:new Date(device.parseLocalTimestamp(day,to,'Asia/Tashkent')).toISOString()});
const rows=[att('2026-10-05','08:00','18:40'),att('2026-10-06','08:00','16:10'),att('2026-10-07','08:00','12:00'),att('2026-10-10','09:00','13:20')];
const a=overtime.overtimeAnalysis(rows,employees[0],[schedule],[holiday],'2026-10-01','2026-10-31',[policy]);
assert.deepEqual([a.weekday,a.restDay,a.holiday,a.total],[2.5,4.25,4,10.75]);
assert.equal(overtime.overtimeAnalysis(rows,{...employees[0],workScheduleId:''},[schedule],[],'2026-10-01','2026-10-31',[policy]).available,false);
assert.equal(overtime.overtimePolicyFor({company:'Other'},[policy]).configured,false);
assert.throws(()=>overtime.overtimeLines(overtime.overtimeAnalysis(rows,employees[0],[schedule],[holiday],'2026-10-01','2026-10-31',[]),10),/Configure an overtime rule/);
const {rate}=overtime.overtimeHourlyRate(1760,employees[0],[schedule],[holiday],'2026-10-01');assert.equal(Math.round(rate*1e6)/1e6,Math.round(1760/168*1e6)/1e6);
console.log('Overtime: tolerance, 15-minute rounding, rest days, public holidays, per-company rules and hourly rate passed.');

// --- Import API end to end
const auth=url('export const currentUser=async()=>globalThis.importActor();export const sameOrigin=r=>r.headers.get("origin")===new URL(r.url).origin;export const reply=(d,status=200)=>Response.json(d,{status});');
const api=await import(url(readFileSync('app/api/attendance/import/route.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.hrEnv;').replace("'../../../local-auth'",JSON.stringify(auth))));
for(const e of employees)await bucket.put('hrm/local_seedy/employee-'+e.id+'.json',JSON.stringify({kind:'employee',...e}));
await bucket.put('operations/workSchedules/s.json',JSON.stringify(schedule));await bucket.put('operations/overtimePolicies/p.json',JSON.stringify(policy));await bucket.put('operations/publicHolidays/h.json',JSON.stringify(holiday));
const file='No.\tName\tDate/Time\tStatus\tDevice\n'+[['0101','05.10.2026 08:00','C/In'],['0101','05.10.2026 18:40','C/Out'],['0101','06.10.2026 08:00','C/In'],['0101','06.10.2026 16:10','C/Out'],['0101','07.10.2026 08:00','C/In'],['0101','07.10.2026 12:00','C/Out'],['0101','10.10.2026 09:00','C/In'],['0101','10.10.2026 13:20','C/Out']].map(([id,t,s])=>[id,'Day Worker',t,s,'Gate 1'].join('\t')).join('\n');
const call=(body,origin='http://localhost')=>api.POST(new Request('http://localhost/api/attendance/import',{method:'POST',headers:{origin},body:JSON.stringify(body)}));
let r=await call({action:'preview',text:file,timezone:'UTC'});let d=await r.json();assert.equal(r.status,200,JSON.stringify(d));
assert.equal(d.summary.ready,4);assert.equal(d.summary.hours,27.17);assert.equal([...store.keys()].filter(k=>k.startsWith('operations/attendance/')).length,0,'preview must not write');
r=await call({action:'import',text:file});d=await r.json();assert.equal(d.created,4);
const saved=[...store.keys()].filter(k=>k.startsWith('operations/attendance/'));assert.equal(saved.length,4);const one=JSON.parse(store.get(saved[0]).value);assert.equal(one.source,'Device import');assert.equal(one.status,'Checked out');
r=await call({action:'preview',text:file});d=await r.json();assert.equal(d.summary.ready,0);assert.equal(d.summary.alreadyImported,4);
assert.equal((await call({action:'import',text:file})).status,400,'re-import creates nothing');
assert.equal((await call({action:'preview',text:file},'http://evil.example')).status,403);
actor={id:'v',name:'Viewer',role:'Viewer'};assert.equal((await call({action:'preview',text:file})).status,403);actor={id:'a',name:'Admin',role:'Administrator'};
console.log('Import API: preview without writes, import, idempotent re-import, origin and permission checks passed.');

// --- Payslip with overtime
const engineURL=url(readFileSync('app/payroll-engine.ts','utf8'));
const storeURL=url(readFileSync('app/payroll-store.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.payrollEnv;'));
const workedURL=url(readFileSync('app/payroll-worked-time.ts','utf8'));
const payroll=await import(url(readFileSync('app/api/payroll/route.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.payrollEnv;').replace("'../../local-auth'",JSON.stringify(auth)).replace("'../../payroll-store'",JSON.stringify(storeURL)).replace("'../../payroll-engine'",JSON.stringify(engineURL)).replace("'../../payroll-worked-time'",JSON.stringify(workedURL))));
const slip=async body=>{const res=await payroll.POST(new Request('http://localhost/api/payroll',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify({kind:'slips',employeeId:'e1',from:'2026-10-01',to:'2026-10-31',proration:'Full pay',acknowledgeFullPay:true,...body})}));return {status:res.status,data:await res.json()}};
let s=await slip({includeOvertime:true});assert.equal(s.status,200,JSON.stringify(s.data));
const lines=Object.fromEntries(s.data.record.lines.map(l=>[l.code,l.amount]));const h=1760/168;
assert.equal(lines.BASIC,1760);assert.equal(lines.OT_WORKDAY,Math.round(2.5*h*2*100)/100);assert.equal(lines.OT_RESTDAY,Math.round(4.25*h*2*100)/100);assert.equal(lines.OT_HOLIDAY,Math.round(4*h*3*100)/100);
assert.equal(s.data.record.gross,Math.round((1760+lines.OT_WORKDAY+lines.OT_RESTDAY+lines.OT_HOLIDAY)*100)/100);assert.equal(s.data.record.overtime.workdayHours,2.5);
const draft=s.data.record;s=await slip({id:draft.id,revision:draft.revision,includeOvertime:false});assert.equal(s.status,200);assert.equal(s.data.record.lines.length,1,'overtime is only paid when selected');
s=await slip({employeeId:'e1',from:'2026-10-25',to:'2026-11-05',includeOvertime:true,id:draft.id,revision:s.data.record.revision});assert.equal(s.status,400);
console.log('Payroll: overtime earnings by category, hourly rate from monthly pay, opt-in only and single-month validation passed.');
