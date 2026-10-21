import {allowed,scopedEmployees} from '../../access-policy';
import {allEmployees} from '../../access-store';
import {env} from 'cloudflare:workers';
import {currentUser,sameOrigin,reply} from '../../local-auth';
import {normalizeHR} from '../../hr-schema';
import {applyAccrualPlan,planAppliesTo} from '../../leave-accrual';
export const dynamic='force-dynamic';
// Creates accrual allocations from one plan for every matching employee in scope.
// action "preview" writes nothing; action "generate" saves all rows in one ledger write.
async function legacy(module:string){const rows:any[]=[];let cursor:string|undefined;do{const page=await env.BUCKET!.list({prefix:`operations/${module}/`,cursor});for(const key of page.objects){const o=await env.BUCKET!.get(key.key);if(o)rows.push(await o.json<any>());}cursor=page.truncated?page.cursor:undefined;}while(cursor);return rows;}
export async function POST(request:Request){const actor=await currentUser(request);if(!actor)return reply({error:'Sign in required.'},401);if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);if(!allowed(actor,'leaveAllocations','Write'))return reply({error:'Editing access to allocations is required.'},403);
 try{const raw=await request.text();if(raw.length>5000)return reply({error:'Request is too large.'},413);const input=JSON.parse(raw);const generate=input.action==='generate';
  const status=input.status==='Approved'?'Approved':'To approve';if(status==='Approved'&&!allowed(actor,'leaveAllocations','Approve'))throw Error('Approval access is required to create approved allocations.');
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(String(input.planId||'')))throw Error('Choose an accrual plan.');const planObject=await env.BUCKET!.get('operations/accrualPlans/'+input.planId+'.json');const plan=planObject?{...await planObject.json<any>(),id:input.planId}:null;if(!plan||plan.status!=='Active')throw Error('Choose an active accrual plan.');
  const start=String(input.start||''),end=String(input.end||''),department=String(input.department||'').trim();const name=String(input.name||'').trim()||`${plan.name} ${start.slice(0,4)}`;
  normalizeHR('leaveAllocations',{employeeId:'check',name,leaveType:plan.leaveType,start,end});
  const ledger=await env.BUCKET!.get('operations/leave-ledger.json');const state=ledger?await ledger.json<any>():{leave:await legacy('leave'),leaveAllocations:await legacy('leaveAllocations')};
  const employees=scopedEmployees(actor,await allEmployees()).filter(e=>planAppliesTo(plan,e)&&(!department||String(e.department||'').trim().toLowerCase()===department.toLowerCase())).sort((a,b)=>String(a.name).localeCompare(String(b.name)));if(employees.length>2000)throw Error('Too many employees in one run. Filter by department.');
  const now=new Date().toISOString(),rows:any[]=[],created:any[]=[];
  for(const e of employees){const row:any={employeeId:e.id,name:e.name,department:e.department||'',company:e.company||'',days:0,skip:''};rows.push(row);
   if(e.end&&e.end<=start){row.skip='Left before the period starts';continue}
   if(state.leaveAllocations.some((a:any)=>a.employeeId===e.id&&a.leaveType===plan.leaveType&&['To approve','Approved'].includes(a.status)&&a.start<=end&&a.end>=start)){row.skip='Already has a '+plan.leaveType.toLowerCase()+' allocation in this period';continue}
   if(status==='Approved'&&actor.role!=='Administrator'&&actor.employeeId===e.id){row.skip='Your own allocation needs another approver';continue}
   try{const record=applyAccrualPlan({...normalizeHR('leaveAllocations',{employeeId:e.id,name,leaveType:plan.leaveType,allocationType:'Accrual',planId:plan.id,start,end,status:'To approve'}),status},plan,e);row.days=record.days;
    created.push({...record,id:crypto.randomUUID(),createdAt:now,updatedAt:now,updatedBy:actor.name,audit:[{at:now,by:actor.name,action:'Generated from accrual plan '+plan.name+' ('+status+')'}],file:null});}catch(err){row.skip=err instanceof Error?err.message:'Not eligible';}}
  if(generate){if(!created.length)throw Error('No allocations to create. Every employee was skipped.');state.leaveAllocations=[...state.leaveAllocations,...created].map(({revision,...r}:any)=>r);const saved=await env.BUCKET!.put('operations/leave-ledger.json',JSON.stringify(state),{onlyIf:ledger?{etagMatches:ledger.etag}:{etagDoesNotMatch:'*'}});if(!saved)return reply({error:'Allocations changed while generating. Preview again and retry.'},409);}
  return reply({plan:{id:plan.id,name:plan.name,leaveType:plan.leaveType},status,created:generate?created.length:0,eligible:created.length,rows});
 }catch(e){return reply({error:e instanceof Error?e.message:'Unable to generate allocations.'},400);}}
