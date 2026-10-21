import {allowed,scopedEmployees,employeeForUser,userScope} from '../../access-policy';
import {requireEmployeeScope} from '../../access-store';
import {sanitizeEmployee,redactEmployee} from '../../employee-fields';
import {env} from 'cloudflare:workers';
import {payrollList} from '../../payroll-store';
import {currentUser} from '../../local-auth';
export const dynamic='force-dynamic';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(request:Request){
 const user=await currentUser(request); if(!user)return reply({error:'Please sign in to load your records.'},401);
 if(!env.BUCKET)return reply({error:'Database storage is not configured.'},503);
 const prefix=`hrm/local_seedy/`; let cursor:string|undefined; const keys:string[]=[];
 do{const page=await env.BUCKET.list({prefix,cursor});keys.push(...page.objects.map(o=>o.key));cursor=page.truncated?page.cursor:undefined;}while(cursor);
 const data=await Promise.all(keys.map(async key=>{const o=await env.BUCKET!.get(key);return o?o.json():null;}));
 const employees=data.filter((r:any)=>r?.kind==='employee') as any[];const visible=scopedEmployees(user,employees);const ids=new Set(visible.map(e=>e.id));if(!allowed(user,'Employees')&&!allowed(user,'Payroll')&&!allowed(user,'Reports'))return reply({error:'Record access required.'},403);const slips=allowed(user,'Payroll')?(await payrollList('slips')).filter(s=>['Confirmed','Paid'].includes(s.status)).map(s=>({id:'payslip-'+s.id,payslipId:s.id,sourcePayslip:true,kind:'payroll',employeeId:s.employeeId,date:s.to,gross:s.gross,deductions:s.deductions,currency:s.currency,status:s.status==='Paid'?'Paid':'Pending'})):[];
 return reply({records:[...(allowed(user,'Employees')?visible.map(e=>employeeForUser(e,user)):[]),...data.filter((r:any)=>r?.kind==='payroll'&&ids.has(r.employeeId)&&(allowed(user,'Payroll')||allowed(user,'Reports'))),...slips.filter(s=>ids.has(s.employeeId))],updatedAt:new Date().toISOString()});
}
export async function POST(request:Request){
 const user=await currentUser(request);if(!user)return reply({error:'Sign in required.'},401);
 
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'Invalid request origin.'},403);
 if(!env.BUCKET)return reply({error:'Storage unavailable.'},503);
 if(Number(request.headers.get('content-length')||0)>80000)return reply({error:'Record too large.'},413);
 try{
 const raw=await request.text();if(raw.length>80000)throw Error('Record too large.');const body=JSON.parse(raw);
 if(!['employee','payroll'].includes(body.kind))throw Error('Invalid record type.');
 const id=body.id||crypto.randomUUID();if(String(id).startsWith('payslip-')||body.sourcePayslip)throw Error('Use Payroll to manage calculated payslips.');if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw Error('Invalid record ID.');
 const text=(v:unknown,max=160)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('Complete all required fields.');return v.trim();};
 const date=(v:unknown)=>{const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw Error('Invalid date.');return s;};
 let record:any={id,kind:body.kind};
 if(body.kind==='employee'){if(!allowed(user,'Employees','Write'))return reply({error:'Employee editing access required.'},403);
 const previousObject=await env.BUCKET.get(`hrm/local_seedy/employee-${id}.json`);const previous=previousObject?await previousObject.json():null;
 if(previous)await requireEmployeeScope(user,id);record={...record,...sanitizeEmployee(body,previous,user.role==='Administrator')};
 const all:any[]=[];let cursor:string|undefined;do{const page=await env.BUCKET.list({prefix:'hrm/local_seedy/employee-',cursor});for(const o of page.objects){const obj=await env.BUCKET.get(o.key);if(obj)all.push(await obj.json());}cursor=page.truncated?page.cursor:undefined;}while(cursor);
 if(!scopedEmployees(user,[...all.filter(e=>e.id!==id),record]).some(e=>e.id===id))throw Error('The employee would be outside your access scope.');
 if(record.employeeNumber&&all.some(e=>e.id!==id&&e.employeeNumber?.toLowerCase()===record.employeeNumber.toLowerCase()))throw Error('Employee reference is already in use.');
 if(record.badgeId){const key=(v:any)=>String(v??'').trim().toUpperCase().replace(/^0+(?=\d)/,'');if(all.some(e=>e.id!==id&&(key(e.badgeId)===key(record.badgeId)||(!e.badgeId&&key(e.employeeNumber)===key(record.badgeId)))))throw Error('This attendance device ID is already used by another employee.');}
 for(const key of ['managerId','coachId'])if(record[key]&&(record[key]===id||!all.some(e=>e.id===record[key])))throw Error('Choose an existing employee as manager or coach.');
 const visited=new Set([id]);let manager=record.managerId;while(manager){if(visited.has(manager))throw Error('Manager assignment would create a reporting cycle.');visited.add(manager);manager=all.find(e=>e.id===manager)?.managerId;}
 if(record.workScheduleId&&!await env.BUCKET.get('operations/workSchedules/'+record.workScheduleId+'.json'))throw Error('Choose an existing working schedule.');
 record.createdAt=(previous as any)?.createdAt||new Date().toISOString();record.updatedBy=user.name;

 }else{if(!allowed(user,'Payroll','Write')&&!(user.role==='Manager'&&user.permissions===undefined))return reply({error:'Payroll editing access required.'},403);
 const legacyManager=user.role==='Manager'&&user.permissions===undefined;let previousPayroll:any=null;if(body.id){const previous=await env.BUCKET.get('hrm/local_seedy/payroll-'+id+'.json');if(previous){previousPayroll=await previous.json<any>();await requireEmployeeScope(user,previousPayroll.employeeId);}}if((body.status==='Paid'||previousPayroll?.status==='Paid')&&!allowed(user,'Payroll','Approve')&&!legacyManager)return reply({error:'Payroll approval access is required to mark or change paid entries.'},403);
 const employeeId=text(body.employeeId,80);if(!/^[a-zA-Z0-9-]+$/.test(employeeId))throw Error('Invalid employee.');
 if(!await env.BUCKET.get(`hrm/local_seedy/employee-${employeeId}.json`))throw Error('Employee not found.');
 const money=(v:any)=>{const n=Number(v);if(v===''||!Number.isFinite(n)||n<0||n>1e12)throw Error('Enter valid non-negative amounts.');return Math.round(n*100)/100;};
 await requireEmployeeScope(user,employeeId);const gross=money(body.gross),deductions=money(body.deductions);if(deductions>gross)throw Error('Deductions cannot exceed gross pay.');
 const currency=text(body.currency,3);if(!/^[A-Z]{3}$/.test(currency))throw Error('Use a three-letter currency code.');try{new Intl.NumberFormat('en',{style:'currency',currency});}catch{throw Error('Invalid currency.');}
 if(!['Pending','Paid'].includes(body.status))throw Error('Invalid payment status.');
 record={...record,employeeId,date:date(body.date),gross,deductions,currency,status:body.status};
 }
 record.updatedAt=new Date().toISOString();await env.BUCKET.put(`hrm/local_seedy/${body.kind}-${id}.json`,JSON.stringify(record),{httpMetadata:{contentType:'application/json'}});
 return reply({record:record.kind==='employee'?employeeForUser(record,user):record});
 }catch(e){return reply({error:e instanceof Error?e.message:'Unable to save record.'},400);}
}
