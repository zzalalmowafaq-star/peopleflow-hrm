import {allowed,scopedEmployees} from '../../../access-policy';
import {allEmployees} from '../../../access-store';
import {env} from 'cloudflare:workers';
import {currentUser,sameOrigin,reply} from '../../../local-auth';
import {readPunchFile,pairPunches,screenAgainstExisting,employeeBadgeMap,badgeKey} from '../../../attendance-device';
export const dynamic='force-dynamic';

const MAX_RECORDS=20000;
async function list(module:string){const rows:any[]=[];let cursor:string|undefined;do{const page=await env.BUCKET!.list({prefix:'operations/'+module+'/',cursor});for(const item of page.objects){const o=await env.BUCKET!.get(item.key);if(o)rows.push(await o.json<any>());}cursor=page.truncated?page.cursor:undefined;}while(cursor);return rows;}

export async function POST(request:Request){
 const actor=await currentUser(request);if(!actor)return reply({error:'Sign in required.'},401);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!allowed(actor,'attendance','Write'))return reply({error:'Attendance editing access is required to import device punches.'},403);
 try{
  const raw=await request.text();if(raw.length>7000000)return reply({error:'Files are limited to 6 MB. Split the export by date range.'},413);
  const body=JSON.parse(raw);if(!['preview','import'].includes(body.action))throw Error('Invalid import action.');if(typeof body.text!=='string')throw Error('Choose a device export file.');
  const dateOrder=body.dateOrder==='MDY'?'MDY':'DMY';let fallbackZone='UTC';if(typeof body.timezone==='string'&&body.timezone){try{new Intl.DateTimeFormat('en',{timeZone:body.timezone});fallbackZone=body.timezone}catch{throw Error('Invalid device timezone.')}}
  const employees=scopedEmployees(actor,await allEmployees());
  const [schedules,policies,existing]=await Promise.all([list('workSchedules'),list('overtimePolicies'),list('attendance')]);
  const {map}=employeeBadgeMap(employees);
  const timezoneFor=(badge:string)=>{const e=map.get(badgeKey(badge));return schedules.find(s=>s.id===e?.workScheduleId)?.timezone||e?.timezone||fallbackZone};
  const parsed=readPunchFile(body.text,timezoneFor,dateOrder);
  const paired=pairPunches(parsed.punches,employees,schedules,policies);
  const screened=screenAgainstExisting(paired.records,existing);
  const name=(id:string)=>employees.find(e=>e.id===id)?.name||id;
  const exceptions=[...parsed.exceptions,...paired.exceptions,...screened.skipped.map(s=>({row:s.record.rows[0],badge:'',employee:name(s.record.employeeId),time:s.record.checkIn,reason:s.reason}))].sort((a,b)=>a.row-b.row);
  const summary={punches:parsed.punches.length+parsed.exceptions.length,readable:parsed.punches.length,employees:paired.employees,duplicates:paired.duplicates,stillCheckedIn:paired.stillIn,ready:screened.ready.length,autoClosed:screened.ready.filter(r=>r.autoClosed).length,alreadyImported:screened.skipped.filter(s=>s.reason==='Already imported.').length,exceptions:exceptions.length,hours:Math.round(screened.ready.reduce((n,r)=>n+(Date.parse(r.checkOut)-Date.parse(r.checkIn))/3600000,0)*100)/100,columns:parsed.columns};
  const preview=screened.ready.slice(0,200).map(r=>({employee:name(r.employeeId),checkIn:r.checkIn,checkOut:r.checkOut,hours:Math.round((Date.parse(r.checkOut)-Date.parse(r.checkIn))/36000)/100,autoClosed:r.autoClosed}));
  if(body.action==='preview')return reply({summary,preview,exceptions:exceptions.slice(0,5000)});
  if(!screened.ready.length)throw Error('Nothing new to import. Review the exceptions list.');
  if(screened.ready.length>MAX_RECORDS)throw Error(`Imports are limited to ${MAX_RECORDS.toLocaleString()} attendance records. Split the export by date range.`);
  const batch=crypto.randomUUID(),now=new Date().toISOString();let created=0;const failed:any[]=[];
  for(const r of screened.ready){const id=crypto.randomUUID();
   const record={module:'attendance',status:'Checked out',employeeId:r.employeeId,checkIn:r.checkIn,checkOut:r.checkOut,notes:r.notes,hours:Math.round((Date.parse(r.checkOut)-Date.parse(r.checkIn))/36000)/100,source:'Device import',importBatch:batch,autoClosed:r.autoClosed,id,createdAt:now,updatedAt:now,updatedBy:actor.name,audit:[{at:now,by:actor.name,action:'Imported from device file'+(r.autoClosed?' (auto check-out)':'')}],file:null};
   const saved=await env.BUCKET!.put('operations/attendance/'+id+'.json',JSON.stringify(record),{onlyIf:{etagDoesNotMatch:'*'}});
   if(saved)created++;else failed.push({employee:name(r.employeeId),checkIn:r.checkIn,reason:'Storage conflict'});}
  await env.BUCKET!.put('operations/attendanceImports/'+batch+'.json',JSON.stringify({id:batch,at:now,by:actor.name,created,failed:failed.length,summary,exceptions:exceptions.length}));
  return reply({batch,created,failed,summary,exceptions:exceptions.slice(0,5000)});
 }catch(e){return reply({error:e instanceof Error?e.message:'Unable to import attendance.'},400);}
}
