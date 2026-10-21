// Attendance device import: parses punch exports from fingerprint / face
// terminals (ZKTeco-style, UBOX, generic CSV) and pairs punches into
// check-in / check-out records. Pure functions only — no storage access.
import {overtimePolicyFor} from './overtime';

export type Punch={row:number;badge:string;time:number;direction:'in'|'out'|'';device:string};
export type PunchException={row:number;badge:string;employee?:string;time?:string;reason:string};
export type ImportedAttendance={employeeId:string;checkIn:string;checkOut:string;notes:string;autoClosed:boolean;rows:number[]};

export const PUNCH_LIMITS={rows:60000,bytes:6*1024*1024};

const headerAliases:Record<string,string[]>={
 badge:['badge','badgeid','badgeno','userid','user','userno','acno','enrollno','enrollnumber','enroll','pin','employeeid','employeeno','employeenumber','empno','empid','employeereference','reference','personid','personnelid','staffid','id','no','cardno','tabelno','tabelnumber'],
 timestamp:['timestamp','datetime','checktime','punchtime','attendancetime','recordtime','logtime','verifytime','time stamp'],
 date:['date','punchdate','attendancedate','day'],
 time:['time','punchclock','clocktime','hour'],
 direction:['direction','state','status','type','inout','checktype','punchstate','attstate','event','checkinout','mode'],
 device:['device','terminal','machine','sn','deviceid','devicename','terminalid','machineno','reader']
};
const norm=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'');

export function splitDelimited(text:string){
 const firstLine=text.split(/\r?\n/,1)[0]||'';
 const delimiter=[',','\t',';','|'].map(d=>[d,firstLine.split(d).length] as const).sort((a,b)=>b[1]-a[1])[0][0];
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else quoted=false}else cell+=ch;continue}
  if(ch==='"'&&cell==='')quoted=true;else if(ch===delimiter){row.push(cell);cell=''}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row);row=[];cell=''}
  else cell+=ch;}
 row.push(cell);if(row.some(c=>c.trim()))rows.push(row);
 return rows;
}

const directionWords:Record<string,'in'|'out'>={in:'in',i:'in',checkin:'in',cin:'in',entry:'in',enter:'in','0':'in','3':'in','4':'in',breakin:'in',otin:'in',overtimein:'in',kirish:'in',vhod:'in','вход':'in','приход':'in',
 out:'out',o:'out',checkout:'out',cout:'out',exit:'out',leave:'out','1':'out','2':'out','5':'out',breakout:'out',otout:'out',overtimeout:'out',chiqish:'out',vyhod:'out','выход':'out','уход':'out'};
export function parseDirection(raw:string):'in'|'out'|''{
 const v=raw.trim().toLowerCase();if(!v)return '';
 const key=v.replace(/[^a-z0-9а-яё]/gi,'');
 return directionWords[key]||directionWords[v]||'';
}

// Wall-clock time in an IANA timezone → UTC milliseconds (handles DST).
function zoneOffset(ms:number,timezone:string){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
 return Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour%24,+parts.minute,+parts.second)-Math.floor(ms/1000)*1000;
}
export function wallTimeToUTC(y:number,mo:number,d:number,h:number,mi:number,s:number,timezone:string){
 const guess=Date.UTC(y,mo-1,d,h,mi,s);let ms=guess-zoneOffset(guess,timezone);
 const second=guess-zoneOffset(ms,timezone);if(second!==ms)ms=second;
 return ms;
}

// Accepts 2026-10-21 08:05[:00], 2026/10/21 8:05 AM, 21.10.2026 08:05, 21/10/2026 08:05
// (slash dates are day-first unless dateOrder is 'MDY'), with optional ISO 'T'.
export function parseLocalTimestamp(dateText:string,timeText:string,timezone:string,dateOrder:'DMY'|'MDY'='DMY'):number|null{
 const joined=(dateText+' '+timeText).trim().replace('T',' ').replace(/\s+/g,' ');
 const m=joined.match(/^(\d{1,4})[-./](\d{1,2})[-./](\d{1,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([ap]\.?m\.?)?$/i);
 if(!m)return null;
 let y:number,mo:number,d:number;const a=+m[1],b=+m[2],c=+m[3];
 if(m[1].length===4){y=a;mo=b;d=c}else if(m[3].length===4){y=c;if(dateOrder==='MDY'){mo=a;d=b}else{d=a;mo=b}}else return null;
 let h=+m[4];const mi=+m[5],s=+(m[6]||0),ampm=m[7]?.toLowerCase().replace(/\./g,'');
 if(ampm){if(h<1||h>12)return null;if(ampm==='pm'&&h<12)h+=12;if(ampm==='am'&&h===12)h=0}
 if(mo<1||mo>12||d<1||d>31||h>23||mi>59||s>59)return null;
 const check=new Date(Date.UTC(y,mo-1,d));if(check.getUTCMonth()!==mo-1)return null;
 try{return wallTimeToUTC(y,mo,d,h,mi,s,timezone)}catch{return null}
}

export function readPunchFile(text:string,timezoneFor:(badge:string)=>string,dateOrder:'DMY'|'MDY'='DMY'){
 if(new TextEncoder().encode(text).length>PUNCH_LIMITS.bytes)throw Error('Files are limited to 6 MB. Split the export by date range.');
 const rows=splitDelimited(text.replace(/^\uFEFF/,''));if(rows.length<2)throw Error('The file needs a header row and at least one punch.');
 if(rows.length-1>PUNCH_LIMITS.rows)throw Error(`Files are limited to ${PUNCH_LIMITS.rows.toLocaleString()} punches. Split the export by date range.`);
 const headers=rows[0].map(h=>norm(h));const col:Record<string,number>={};
 for(const [field,aliases] of Object.entries(headerAliases)){const set=aliases.map(norm);const index=headers.findIndex((h,i)=>set.includes(h)&&!Object.values(col).includes(i));if(index>=0)col[field]=index;}
 if(col.badge===undefined)throw Error('Add a column with the device user ID or employee reference (for example "User ID", "AC-No." or "employeeNumber").');
 if(col.timestamp===undefined&&col.date===undefined)throw Error('Add a "Date Time" column, or separate "Date" and "Time" columns.');
 if(col.timestamp===undefined&&col.time===undefined){const both=rows.slice(1,6).every(r=>/\d:\d{2}/.test(r[col.date]||''));if(both){col.timestamp=col.date;delete col.date}else throw Error('Add a "Time" column next to "Date".')}
 const punches:Punch[]=[],exceptions:PunchException[]=[];
 rows.slice(1).forEach((cells,i)=>{const row=i+2;const badge=(cells[col.badge]||'').trim();
  if(!badge){exceptions.push({row,badge:'',reason:'Missing device user ID.'});return}
  const dateText=col.timestamp!==undefined?cells[col.timestamp]||'':cells[col.date]||'',timeText=col.timestamp!==undefined?'':cells[col.time]||'';
  const time=parseLocalTimestamp(dateText,timeText,timezoneFor(badge),dateOrder);
  if(time===null){exceptions.push({row,badge,time:(dateText+' '+timeText).trim(),reason:'Unreadable date/time. Use YYYY-MM-DD HH:MM or DD.MM.YYYY HH:MM.'});return}
  punches.push({row,badge,time,direction:col.direction!==undefined?parseDirection(cells[col.direction]||''):'',device:col.device!==undefined?(cells[col.device]||'').trim().slice(0,60):''});});
 return {punches,exceptions,columns:Object.keys(col)};
}

export const badgeKey=(v:any)=>String(v??'').trim().toUpperCase().replace(/^0+(?=\d)/,'');
export function employeeBadgeMap(employees:any[]){
 const map=new Map<string,any>(),conflicts=new Set<string>();
 const add=(key:string,e:any)=>{if(!key)return;const prior=map.get(key);if(prior&&prior.id!==e.id)conflicts.add(key);else map.set(key,e)};
 for(const e of employees)add(badgeKey(e.badgeId),e);
 for(const e of employees)if(!map.has(badgeKey(e.employeeNumber)))add(badgeKey(e.employeeNumber),e);
 for(const key of conflicts)map.delete(key);
 return {map,conflicts};
}

const iso=(ms:number)=>new Date(ms).toISOString();
// Pair punches into attendance records. Works across midnight (night shifts):
// a check-in is closed by the next out-punch within the policy's maximum shift.
export function pairPunches(punches:Punch[],employees:any[],schedules:any[],policies:any[],now=Date.now()){
 const {map,conflicts}=employeeBadgeMap(employees);
 const records:ImportedAttendance[]=[],exceptions:PunchException[]=[];let duplicates=0,stillIn=0;
 const byEmployee=new Map<string,Punch[]>();
 for(const p of punches){const key=badgeKey(p.badge);const e=map.get(key);
  if(!e){exceptions.push({row:p.row,badge:p.badge,time:iso(p.time),reason:conflicts.has(key)?'This ID matches more than one employee. Fix the badge / reference.':'No employee has this attendance device ID or employee reference.'});continue}
  if(p.time>now){exceptions.push({row:p.row,badge:p.badge,employee:e.name,time:iso(p.time),reason:'Punch is in the future. Check the device clock.'});continue}
  if(!byEmployee.has(e.id))byEmployee.set(e.id,[]);byEmployee.get(e.id)!.push(p);}
 for(const [employeeId,list] of byEmployee){
  const e=employees.find(x=>x.id===employeeId),policy=overtimePolicyFor(e,policies),schedule=schedules.find(s=>s.id===e.workScheduleId);
  const maxShift=policy.maxShiftHours*3600000,dupWindow=policy.duplicateMinutes*60000;
  list.sort((a,b)=>a.time-b.time||a.row-b.row);
  const clean:Punch[]=[];for(const p of list){const last=clean[clean.length-1];if(last&&p.time-last.time<=dupWindow&&(!p.direction||!last.direction||p.direction===last.direction)){duplicates++;continue}clean.push(p)}
  let open:Punch|null=null;
  const closeMissing=(p:Punch)=>{if(policy.missingCheckout==='Close at scheduled hours'&&schedule&&Number(schedule.hoursPerDay)>0){const end=Math.min(p.time+Number(schedule.hoursPerDay)*3600000,now);if(end>p.time){records.push({employeeId,checkIn:iso(p.time),checkOut:iso(end),notes:'Imported from device'+(p.device?' '+p.device:'')+'. Auto check-out: missing out-punch closed at scheduled hours.',autoClosed:true,rows:[p.row]});return}}
   exceptions.push({row:p.row,badge:p.badge,employee:e.name,time:iso(p.time),reason:'Check-in without a check-out. Add the missing punch manually.'});};
  for(const p of clean){
   if(open&&p.time-open.time>maxShift){closeMissing(open);open=null}
   if(p.direction==='in'||(!p.direction&&!open)){if(open)closeMissing(open);open=p;continue}
   if(open){records.push({employeeId,checkIn:iso(open.time),checkOut:iso(p.time),notes:'Imported from device'+(open.device?' '+open.device:''),autoClosed:false,rows:[open.row,p.row]});open=null}
   else exceptions.push({row:p.row,badge:p.badge,employee:e.name,time:iso(p.time),reason:'Check-out without a check-in. Add the missing punch manually.'});
  }
  if(open){if(now-open.time<maxShift)stillIn++;else closeMissing(open)}
 }
 records.sort((a,b)=>a.checkIn.localeCompare(b.checkIn));
 return {records,exceptions,duplicates,stillIn,employees:byEmployee.size};
}

// Existing records with the same employee and times are reported as already
// imported, so re-uploading an overlapping export is safe.
export function screenAgainstExisting(records:ImportedAttendance[],existing:any[]){
 const ready:ImportedAttendance[]=[],skipped:{record:ImportedAttendance;reason:string}[]=[];
 const accepted=[...existing];
 for(const r of records){
  const same=accepted.find(x=>x.employeeId===r.employeeId&&x.checkIn===r.checkIn&&x.checkOut===r.checkOut);
  if(same){skipped.push({record:r,reason:'Already imported.'});continue}
  const overlap=accepted.find(x=>x.employeeId===r.employeeId&&(!x.checkOut||x.checkOut>r.checkIn)&&x.checkIn<r.checkOut);
  if(overlap){skipped.push({record:r,reason:'Overlaps an existing attendance ('+overlap.checkIn.slice(0,16).replace('T',' ')+' UTC). Correct it under Management.'});continue}
  ready.push(r);accepted.push(r);
 }
 return {ready,skipped};
}
