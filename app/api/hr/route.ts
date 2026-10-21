import {allowed,recordAllowed,userScope,scopedEmployees} from '../../access-policy';
import {allEmployees,requireRecordScope} from '../../access-store';
import {env} from 'cloudflare:workers';
import {currentUser,sameOrigin,reply} from '../../local-auth';
import {canAccess,hrModules,normalizeHR} from '../../hr-schema';
import {leaveDays,leaveBalance,leaveOverlaps} from '../../hr-calculations';
import {accruedDays,applyAccrualPlan} from '../../leave-accrual';
export const dynamic='force-dynamic';
async function list(module:string):Promise<any[]>{if(['leave','leaveAllocations'].includes(module)){const ledger=await env.BUCKET!.get('operations/leave-ledger.json');if(ledger){const data=await ledger.json<any>();return data[module].map((r:any)=>({...r,revision:ledger.etag}));}}const records:any[]=[];let cursor:string|undefined;do{const page=await env.BUCKET!.list({prefix:`operations/${module}/`,cursor});for(const key of page.objects){const o=await env.BUCKET!.get(key.key);if(o)records.push({...await o.json<any>(),revision:o.etag});}cursor=page.truncated?page.cursor:undefined;}while(cursor);return records;}
export async function GET(request:Request){const actor=await currentUser(request);if(!actor)return reply({error:'Sign in required.'},401);const module=new URL(request.url).searchParams.get('module')||'';if(!canAccess(module,actor))return reply({error:'You do not have access to this application.'},403);const employees=await allEmployees(),jobs=module==='recruitment'?await list('jobPositions'):[];const ids=new Set(scopedEmployees(actor,employees).map(e=>e.id));const records=(await list(module)).filter(r=>recordAllowed(actor,r,employees,jobs)||(module==='workSchedules'&&employees.some(e=>ids.has(e.id)&&e.workScheduleId===r.id)));return reply({records:records.map(r=>actor.role==='Employee'&&module==='appraisals'?{id:r.id,module:r.module,employeeId:r.employeeId,name:r.name,date:r.date,status:r.status,selfFeedback:r.selfFeedback,revision:r.revision,...(r.status==='Done'?{managerFeedback:r.managerFeedback,rating:r.rating}:{})}:!allowed(actor,module,'Write')?(({notes,...rest})=>rest)(r):r)});}
export async function POST(request:Request){const actor=await currentUser(request);if(!actor)return reply({error:'Sign in required.'},401);if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 try{const raw=await request.text();if(raw.length>50000)return reply({error:'Record is too large.'},413);const input=JSON.parse(raw);const module=input.module;if(!canAccess(module,actor))return reply({error:'You do not have access to this application.'},403);if(!allowed(actor,module,'Write'))return reply({error:'Editing access required.'},403);const id=input.id||crypto.randomUUID();if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw Error('Invalid record ID.');const key=`operations/${module}/${id}.json`;const leaveLedger=['leave','leaveAllocations'].includes(module)?await env.BUCKET!.get('operations/leave-ledger.json'):null;const leaveState=leaveLedger?await leaveLedger.json<any>():null;const oldRow=leaveState?.[module]?.find((r:any)=>r.id===id);const oldObject=leaveState?(oldRow?{etag:leaveLedger!.etag,json:async<T>()=>oldRow as T}:null):await env.BUCKET!.get(key);const old=oldObject?await oldObject.json<any>():null;if(oldObject&&input.revision!==oldObject.etag)return reply({error:'This record changed. Refresh and try again.'},409);if(!oldObject&&input.id)return reply({error:'Record not found.'},404);const record={...normalizeHR(module,input),id};
 for(const field of hrModules[module].fields.filter(f=>f.type==='employee'))if(record[field.key]){if(!/^[a-zA-Z0-9-]{1,80}$/.test(record[field.key])||!await env.BUCKET!.get(`hrm/local_seedy/employee-${record[field.key]}.json`))throw Error('Choose an existing employee.');}
 const jobs=module==='recruitment'?await list('jobPositions'):[];if(old)await requireRecordScope(actor,old,jobs);await requireRecordScope(actor,record,jobs);const others=await list(module);
 const transitions:any={leave:{'To approve':['Approved','Refused','Cancelled'],Approved:['Cancelled'],Refused:['To approve'],Cancelled:[]},leaveAllocations:{'To approve':['Approved','Refused','Cancelled'],Approved:['Cancelled'],Refused:['To approve'],Cancelled:[]},expenses:{Draft:['Submitted'],Submitted:['Approved','Refused'],Approved:['Reimbursed'],Refused:['Draft'],Reimbursed:[]}};
 if(transitions[module]){
  const initial=hrModules[module].statuses[0];
  if(!old&&record.status!==initial)throw Error('Create this record in '+initial+' status first.');
  if(old&&old.status!==record.status&&!transitions[module][old.status]?.includes(record.status))throw Error('This approval transition is not allowed.');
  if(record.status!==old?.status&&['Approved','Refused','Reimbursed'].includes(record.status)&&actor.role!=='Administrator'&&actor.employeeId===record.employeeId)throw Error('Another approver must review your own request.');
  if(record.status!==old?.status&&['Approved','Refused','Reimbursed'].includes(record.status)&&!allowed(actor,module,'Approve'))throw Error('Approval access is required for this decision.');
  if(old&&['Approved','Reimbursed','Cancelled'].includes(old.status)&&hrModules[module].fields.some(f=>String(record[f.key]??'')!==String(old[f.key]??'')))throw Error('Approved or final records cannot be edited. Cancel or correct through a new request.');
 }
 if(module==='leave'||module==='leaveAllocations'){
  const e=await (await env.BUCKET!.get('hrm/local_seedy/employee-'+record.employeeId+'.json'))!.json<any>();
  const schedules=await list('workSchedules'),holidays=await list('publicHolidays');
  if(module==='leave'){
   record.days=leaveDays(record.start,record.end,e,schedules,holidays);
   if(!record.days)throw Error('This request contains no working days.');if(record.requestUnit==='Half day'||record.requestUnit==='Hours'){if(record.start!==record.end)throw Error('Half-day and hour requests must be within one working day.');if(record.requestUnit==='Half day'){if(!['AM','PM'].includes(record.halfDay))throw Error('Choose AM or PM for a half day.');record.days=0.5;}else{const schedule=schedules.find(s=>s.id===e.workScheduleId),hours=Number(record.hoursRequested);if(!schedule||!Number.isFinite(hours)||hours<=0||hours>Number(schedule.hoursPerDay))throw Error('Hour requests require an assigned schedule and positive hours up to its daily hours.');record.days=Math.round(hours/Number(schedule.hoursPerDay)*1000000)/1000000;}}
   if(record.status==='Approved'){
    // Accrual allocations count only days accrued by the first day of the leave, and
    // only leave starting by then. Later approved requests must still be covered.
    const allocations=await list('leaveAllocations');
    const balance=leaveBalance(record.employeeId,record.leaveType,record.start,record.end,allocations,others,e,schedules,holidays,id,{asOf:record.start,usedThrough:record.start});
    if(record.days>balance.remaining)throw Error('Insufficient approved entitlement for the full request period. Remaining on '+record.start+': '+balance.remaining+' days.');
    const withThis=[...others.filter(r=>r.id!==id),record];
    for(const next of others.filter(r=>r.id!==id&&r.employeeId===record.employeeId&&r.leaveType===record.leaveType&&r.status==='Approved'&&r.start>record.start).sort((a,b)=>a.start.localeCompare(b.start))){if(leaveBalance(record.employeeId,record.leaveType,next.start,next.end,allocations,withThis,e,schedules,holidays,'',{asOf:next.start,usedThrough:next.start}).remaining<0)throw Error('Approving this request would leave too little time off for the approved request starting '+next.start+'.');}
   }
  } else {
   if(record.allocationType==='Accrual'){
    if(old?.allocationType==='Accrual'&&old.accrual&&old.planId===record.planId&&old.employeeId===record.employeeId){record.accrual=old.accrual;record.leaveType=old.leaveType;record.days=accruedDays(record,record.end);if(record.days<=0)throw Error('Nothing accrues for this employee in this period.');}
    else{if(!/^[a-zA-Z0-9-]{1,80}$/.test(record.planId||''))throw Error('Choose an accrual plan.');const plan=await env.BUCKET!.get('operations/accrualPlans/'+record.planId+'.json');applyAccrualPlan(record,plan?{...await plan.json<any>(),id:record.planId}:null,e);}
   } else {record.allocationType='Fixed';record.planId='';}
   if(Number(record.days)<=0)throw Error('Allocation must be positive.');
   if(old?.status==='Approved'&&record.status==='Cancelled'&&(await list('leave')).some(r=>r.employeeId===record.employeeId&&r.leaveType===record.leaveType&&r.status==='Approved'&&r.start<=record.end&&r.end>=record.start))throw Error('Cancel affected approved requests before cancelling their allocation.');
  }
 }

 if(['workSchedules','publicHolidays','overtimePolicies','accrualPlans'].includes(module)&&!allowed(actor,module,'Approve'))return reply({error:'Approval-level access is required to configure schedules, public holidays, overtime rules and accrual plans.'},403);
 if(module==='accrualPlans'&&!record.company&&userScope(actor)!=='all')throw Error('Only an unrestricted approver can configure an accrual plan for all companies.');
 if(module==='overtimePolicies'&&!record.company&&userScope(actor)!=='all')throw Error('Only an unrestricted approver can configure an overtime rule for all companies.');
 if(module==='overtimePolicies'&&record.status==='Active'&&others.some(r=>r.id!==id&&r.status==='Active'&&(r.company||'').toLowerCase()===(record.company||'').toLowerCase()))throw Error('An active overtime rule already exists for '+(record.company||'all companies')+'. Archive it first.');
 if(module==='publicHolidays'&&!record.company&&userScope(actor)!=='all')throw Error('Only an unrestricted approver can configure a holiday for all companies.');
 if(module==='appraisalFeedback'){const obj=await env.BUCKET!.get('operations/appraisals/'+record.appraisalId+'.json');const appraisal=obj?await obj.json<any>():null;if(!appraisal||appraisal.employeeId!==record.employeeId)throw Error('Choose an appraisal for this employee.');if(old?.status==='Submitted')throw Error('Submitted feedback is locked.');}
 if(module==='planning'&&record.status==='Published'&&others.some(r=>r.id!==id&&r.employeeId===record.employeeId&&r.status==='Published'&&r.start<record.end&&r.end>record.start))throw Error('This published shift overlaps another shift.');
 if(module==='recruitmentStages'&&others.some(r=>r.id!==id&&r.status==='Active'&&record.status==='Active'&&r.name.toLowerCase()===record.name.toLowerCase()))throw Error('Active stage name already exists.');
 if(module==='recruitment'){
 if(record.jobId&&!/^[a-zA-Z0-9-]{1,80}$/.test(record.jobId))throw Error('Invalid job position.');if(record.stageId&&!/^[a-zA-Z0-9-]{1,80}$/.test(record.stageId))throw Error('Invalid recruitment stage.');if(record.jobId){const job=await env.BUCKET!.get('operations/jobPositions/'+record.jobId+'.json');if(!job)throw Error('Job position not found.');}
 if(record.stageId){const stage=await env.BUCKET!.get('operations/recruitmentStages/'+record.stageId+'.json');if(!stage)throw Error('Recruitment stage not found.');const configured=await stage.json<any>();if(configured.status==='Archived'&&old?.stageId!==record.stageId)throw Error('This stage is archived.');record.status=configured.mapsTo;}
 record.employeeId=old?.employeeId||'';
 }

 if(module==='attendance'&&others.some(r=>r.id!==id&&r.employeeId===record.employeeId&&(!record.checkOut||r.checkIn<record.checkOut)&&(!r.checkOut||r.checkOut>record.checkIn)))throw Error('This attendance overlaps another entry for the employee.');
 if(module==='leave'&&['To approve','Approved'].includes(record.status)&&others.some(r=>r.id!==id&&r.employeeId===record.employeeId&&['To approve','Approved'].includes(r.status)&&leaveOverlaps(r,record)))throw Error('This request overlaps another pending or approved request.');
 if(module==='departments'){if(others.some(r=>r.id!==id&&r.name.toLowerCase()===record.name.toLowerCase()))throw Error('Department name already exists.');if(record.parentId&&!others.some(r=>r.id===record.parentId))throw Error('Parent department not found.');const seen=new Set([id]);let p=record.parentId;while(p){if(seen.has(p))throw Error('Department hierarchy cannot contain a cycle.');seen.add(p);p=others.find(r=>r.id===p)?.parentId;}}
 if(module==='contracts'&&record.status==='Running'&&others.some(r=>r.id!==id&&r.employeeId===record.employeeId&&r.status==='Running'&&(!r.end||r.end>=record.start)&&(!record.end||record.end>=r.start)))throw Error('This employee already has an overlapping running contract.');
 const audit=[...(old?.audit||[]),{at:new Date().toISOString(),by:actor.name,action:old?`${old.status} → ${record.status}`:'Created'}].slice(-100);
 Object.assign(record,{createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:actor.name,audit,file:old?.file||null});
 let saved;
 if(['leave','leaveAllocations'].includes(module)){
 const state=leaveState||{leave:await list('leave'),leaveAllocations:await list('leaveAllocations')};
 state[module]=[...state[module].filter((r:any)=>r.id!==id),record].map(({revision,...r}:any)=>r);
 saved=await env.BUCKET!.put('operations/leave-ledger.json',JSON.stringify(state),{onlyIf:leaveLedger?{etagMatches:leaveLedger.etag}:{etagDoesNotMatch:'*'}});
 }else saved=await env.BUCKET!.put(key,JSON.stringify(record),{onlyIf:oldObject?{etagMatches:oldObject.etag}:{etagDoesNotMatch:'*'}});if(!saved)return reply({error:'This record changed. Refresh and try again.'},409);return reply({record:{...record,revision:saved.etag}});
 }catch(e){return reply({error:e instanceof Error?e.message:'Unable to save HR record.'},400);}}
