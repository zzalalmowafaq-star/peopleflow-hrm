// Leave accrual plans: entitlement that builds up over time, like Odoo's accrual plans.
// An accrual allocation stores a snapshot of its plan, and the accrued amount is
// calculated for any date on demand. Nothing has to run in the background, and
// later edits to a plan never change allocations that already exist.
export type AccrualSnapshot={planId:string;planName:string;frequency:'Monthly'|'Yearly';amount:number;timing:'End of each period'|'Start of each period';waitMonths:number;cap:number;serviceStart:string;serviceEnd:string};
const DAY=86400000;
const ms=(d:string)=>Date.parse(d+'T00:00:00Z');
const iso=(t:number)=>new Date(t).toISOString().slice(0,10);
const addDays=(d:string,n:number)=>iso(ms(d)+n*DAY);
const later=(a:string,b:string)=>a>b?a:b,earlier=(a:string,b:string)=>a<b?a:b;
export function addMonths(d:string,n:number){const [y,m,day]=d.split('-').map(Number);const target=new Date(Date.UTC(y,m-1+n,1));const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(day,last));return iso(target.getTime());}
function periodOf(d:string,frequency:string){if(frequency==='Yearly')return {start:d.slice(0,4)+'-01-01',end:d.slice(0,4)+'-12-31'};const start=d.slice(0,7)+'-01';return {start,end:addDays(addMonths(start,1),-1)};}
export const planAppliesTo=(plan:any,employee:any)=>!plan?.company||plan.company.trim().toLowerCase()===String(employee?.company||'').trim().toLowerCase();
export function accrualSnapshot(plan:any,employee:any):AccrualSnapshot{return {planId:plan.id,planName:plan.name,frequency:plan.frequency==='Yearly'?'Yearly':'Monthly',amount:Number(plan.amount)||0,timing:plan.timing==='Start of each period'?'Start of each period':'End of each period',waitMonths:Number(plan.waitMonths)||0,cap:Number(plan.cap)||0,serviceStart:employee?.start||'',serviceEnd:employee?.end||''};}
// The dates between which time accrues: the allocation period, limited to employment
// (the employment end date is the first day no longer employed) and the waiting period.
export function accrualWindow(allocation:any){const s:AccrualSnapshot=allocation.accrual;const eligible=addMonths(s.serviceStart||allocation.start,s.waitMonths||0);let to=allocation.end;if(s.serviceEnd)to=earlier(to,addDays(s.serviceEnd,-1));return {from:later(allocation.start,later(eligible,s.serviceStart||'')),to};}
// Days accrued by the end of `asOf`. Fixed allocations return their days unchanged.
// Each calendar month (or year) adds the plan amount, credited on its first or last
// day; partial periods at either end are prorated by calendar days.
export function accruedDays(allocation:any,asOf:string){if(allocation?.allocationType!=='Accrual'||!allocation.accrual)return Number(allocation?.days)||0;const s:AccrualSnapshot=allocation.accrual;const {from,to}=accrualWindow(allocation);if(to<from||asOf<from)return 0;let total=0;for(let p=periodOf(from,s.frequency);p.start<=to;p=periodOf(addDays(p.end,1),s.frequency)){const start=later(p.start,from),end=earlier(p.end,to);const fraction=(ms(end)-ms(start)+DAY)/(ms(p.end)-ms(p.start)+DAY);if((s.timing==='Start of each period'?start:end)<=asOf)total+=s.amount*fraction;}if(s.cap>0)total=Math.min(total,s.cap);return Math.round(total*100)/100;}
// Turns a validated allocation record into an accrual allocation for a plan.
export function applyAccrualPlan(record:any,plan:any,employee:any){if(!plan||plan.status!=='Active')throw Error('Choose an active accrual plan.');if(!planAppliesTo(plan,employee))throw Error('This accrual plan belongs to another company.');if(ms(record.end)-ms(record.start)>3660*DAY)throw Error('An accrual allocation can span at most ten years.');record.allocationType='Accrual';record.planId=plan.id;record.leaveType=plan.leaveType;record.accrual=accrualSnapshot(plan,employee);record.days=accruedDays(record,record.end);if(record.days<=0)throw Error('Nothing accrues for this employee in this period. Check the dates, the waiting period and the employment dates.');return record;}
