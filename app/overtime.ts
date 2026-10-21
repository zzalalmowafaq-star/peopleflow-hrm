// Overtime rules: thresholds, rounding and pay multipliers per company.
// Overtime is measured against the employee's assigned working schedule.
import {attendanceAnalysis,shiftDay} from './hr-calculations';

export const missingCheckoutOptions=['Report as exception','Close at scheduled hours'];
export const defaultOvertimePolicy={id:'',name:'Default (not configured)',company:'',toleranceMinutes:15,roundingMinutes:15,weekdayRate:0,restDayRate:0,holidayRate:0,maxShiftHours:16,duplicateMinutes:2,missingCheckout:'Report as exception',configured:false};

export function overtimePolicyFor(employee:any,policies:any[]=[]){
 const active=policies.filter(p=>p.status!=='Archived');
 const policy=active.find(p=>p.company&&p.company===employee?.company)||active.find(p=>!p.company);
 return policy?{...defaultOvertimePolicy,...policy,configured:true}:defaultOvertimePolicy;
}

const roundDown=(hours:number,minutes:number)=>minutes>0?Math.floor(hours*60/minutes+1e-9)*minutes/60:Math.round(hours*100)/100;
const r2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;

export function overtimeAnalysis(records:any[],employee:any,schedules:any[],holidays:any[],from:string,to:string,policies:any[]=[]){
 const policy=overtimePolicyFor(employee,policies);const schedule=schedules.find(s=>s.id===employee.workScheduleId);
 if(!schedule)return {available:false,reason:'Assign a working schedule to measure overtime.',policy,weekday:0,restDay:0,holiday:0,total:0,days:[] as any[]};
 const analysis=attendanceAnalysis(records,employee,schedules,holidays,from,to);const workdays=String(schedule.weekdays).split(',');
 let weekday=0,restDay=0,holiday=0;const days:any[]=[];
 for(let d=from;d<=to;d=shiftDay(d,1)){
  if(d<(employee.start||'0000')||(employee.end&&d>=employee.end))continue;
  const worked=analysis.days[d]||0;if(!worked)continue;
  const isHoliday=holidays.some(h=>h.status==='Active'&&h.date===d&&(!h.company||h.company===employee.company));
  const dayName=new Date(d+'T12:00:00Z').toLocaleDateString('en',{weekday:'short',timeZone:'UTC'});
  let kind='Working day',hours=0;const expected=Number(schedule.hoursPerDay);
  if(isHoliday){kind='Public holiday';hours=roundDown(worked,policy.roundingMinutes);holiday+=hours}
  else if(!workdays.includes(dayName)){kind='Rest day';hours=roundDown(worked,policy.roundingMinutes);restDay+=hours}
  else{const extra=Math.max(0,worked-expected);hours=extra*60<policy.toleranceMinutes?0:roundDown(extra,policy.roundingMinutes);weekday+=hours}
  days.push({date:d,kind,worked:r2(worked),expected:kind==='Working day'?expected:0,overtime:r2(hours)});
 }
 return {available:true,reason:'',policy,weekday:r2(weekday),restDay:r2(restDay),holiday:r2(holiday),total:r2(weekday+restDay+holiday),days};
}

// Hourly rate: hourly employees use their reference pay; monthly employees use
// reference pay divided by the scheduled hours of the payslip month.
export function overtimeHourlyRate(referencePay:number,employee:any,schedules:any[],holidays:any[],from:string){
 const frequency=employee.privateInfo?.payFrequency;
 if(frequency==='Hourly')return {rate:referencePay,basis:'hourly reference pay'};
 if(frequency!=='Monthly')throw Error('Overtime pay needs a Monthly or Hourly pay frequency on the employee.');
 const monthStart=from.slice(0,7)+'-01',next=new Date(monthStart+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
 const monthEnd=shiftDay(next.toISOString().slice(0,10),-1);
 const hours=attendanceAnalysis([],employee,schedules,holidays,monthStart,monthEnd).expected||0;
 if(!hours)throw Error('No scheduled hours in this month to derive an hourly overtime rate.');
 return {rate:referencePay/hours,basis:'monthly pay ÷ '+hours+' scheduled hours'};
}

export function overtimeLines(analysis:any,rate:number,currencyRound=(n:number)=>r2(n)){
 if(!analysis.available)throw Error(analysis.reason);
 if(!analysis.policy.configured)throw Error('Configure an overtime rule under Attendances → Overtime Rules before paying overtime.');
 const p=analysis.policy;const lines:any[]=[];
 const add=(code:string,name:string,hours:number,multiplier:number)=>{if(hours>0&&multiplier>0)lines.push({code,name:`${name} · ${hours} h × ${multiplier}`,category:'Earning',amount:currencyRound(hours*rate*multiplier),hours,multiplier})};
 add('OT_WORKDAY','Overtime on working days',analysis.weekday,Number(p.weekdayRate));
 add('OT_RESTDAY','Work on rest days',analysis.restDay,Number(p.restDayRate));
 add('OT_HOLIDAY','Work on public holidays',analysis.holiday,Number(p.holidayRate));
 return lines;
}
