import {rewriteTestImports} from './test-module.mjs';
import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import assert from 'node:assert/strict';const url=s=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(rewriteTestImports(s))).toString('base64');const c=await import(url(readFileSync('app/hr-calculations.ts','utf8')));
let parts=c.splitAttendance({checkIn:'2026-10-20T17:00:00Z',checkOut:'2026-10-21T01:00:00Z'},'Asia/Tashkent');assert.deepEqual(parts,[{date:'2026-10-20',hours:2},{date:'2026-10-21',hours:6}]);
// Local midnight boundaries continue to work across daylight saving changes.
parts=c.splitAttendance({checkIn:'2026-03-08T05:00:00Z',checkOut:'2026-03-09T04:00:00Z'},'America/New_York');assert.equal(parts.length,1);assert.equal(parts[0].hours,23);assert.equal(c.splitAttendance({checkIn:'2026-10-20T17:00:00Z'},'UTC').length,0);
const schedule={id:'s',timezone:'Asia/Tashkent',weekdays:'Mon,Tue,Wed,Thu,Fri',hoursPerDay:8},employee={id:'e',workScheduleId:'s',company:'A'},holiday={date:'2026-10-21',status:'Active',company:'A'};
assert.equal(c.leaveDays('2026-10-19','2026-10-25',employee,[schedule],[holiday]),4);assert.equal(c.leaveDays('2026-10-19','2026-10-25',{company:'B'},[],[holiday]),7);
const a=c.attendanceAnalysis([{employeeId:'e',checkIn:'2026-10-20T17:00:00Z',checkOut:'2026-10-21T01:00:00Z'}],employee,[schedule],[],'2026-10-21','2026-10-21');assert.equal(a.worked,6);assert.equal(a.expected,8);assert.equal(a.short,2);assert.equal(c.attendanceAnalysis([],{},[],[],'2026-10-21','2026-10-21').expected,null);
assert.deepEqual(c.reportPeriod('2026-10-21','Weekly'),{from:'2026-10-19',to:'2026-10-25'});
const b=c.leaveBalance('e','Annual leave','2026-10-19','2026-10-25',[{employeeId:'e',leaveType:'Annual leave',status:'Approved',start:'2026-01-01',end:'2026-12-31',days:20}],[{id:'r',employeeId:'e',leaveType:'Annual leave',status:'Approved',start:'2026-10-19',end:'2026-10-25'}],employee,[schedule],[holiday]);assert.deepEqual(b,{entitlement:20,used:4,remaining:16});console.log('HR calculations: overnight timezone splits, DST, workdays, holidays, expected hours and leave balances passed.');

const worked=await import(url(readFileSync('app/payroll-worked-time.ts','utf8').replace("'./hr-calculations'",JSON.stringify(url(readFileSync('app/hr-calculations.ts','utf8'))))));
const salaried={...employee,start:'2026-01-01',privateInfo:{payFrequency:'Monthly'}};
let pay=worked.proratedPay(1760,'Scheduled workdays','2026-10-01','2026-10-02',salaried,[schedule],[],[],[]);
assert.equal(pay.basic,160);
pay=worked.proratedPay(1760,'Recorded attendance','2026-10-01','2026-10-02',salaried,[schedule],[],[{employeeId:'e',checkIn:'2026-10-01T04:00:00Z',checkOut:'2026-10-01T16:00:00Z'}],[{employeeId:'e',status:'Approved',leaveType:'Annual leave',start:'2026-10-02',end:'2026-10-02'}]);
assert.equal(pay.basic,160);assert.equal(pay.workedTime.recordedHours,8);assert.equal(pay.workedTime.paidLeaveHours,8);
assert.throws(()=>worked.proratedPay(1760,'Scheduled workdays','2026-10-01','2026-11-02',salaried,[schedule],[],[],[]));
console.log('Payroll proration: monthly denominator, partial period, daily attendance cap, paid leave and period validation passed.');

const partial={employeeId:'e',status:'Approved',leaveType:'Unpaid leave',requestUnit:'Half day',halfDay:'AM',days:.5,start:'2026-10-01',end:'2026-10-01'};
pay=worked.proratedPay(1760,'Scheduled workdays','2026-10-01','2026-10-01',salaried,[schedule],[],[],[partial]);assert.equal(pay.basic,40);
const paidPartial={...partial,leaveType:'Annual leave'};
pay=worked.proratedPay(1760,'Recorded attendance','2026-10-01','2026-10-01',salaried,[schedule],[],[{employeeId:'e',checkIn:'2026-10-01T04:00:00Z',checkOut:'2026-10-01T12:00:00Z'}],[paidPartial]);assert.equal(pay.basic,80);assert.equal(pay.workedTime.recordedHours,4);assert.equal(pay.workedTime.paidLeaveHours,4);
const fractionBalance=c.leaveBalance('e','Annual leave','2026-01-01','2026-12-31',[{employeeId:'e',leaveType:'Annual leave',status:'Approved',days:20,start:'2026-01-01',end:'2026-12-31'}],[paidPartial],employee,[schedule],[]);assert.equal(fractionBalance.used,.5);
console.log('Partial leave balances and payroll proration avoid double-counting paid leave and attendance.');
