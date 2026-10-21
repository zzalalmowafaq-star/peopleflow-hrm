'use client';
import {useEffect,useState} from 'react';
// Creates a period's accrual allocations for many employees at once: preview first, then create.
export default function AccrualGenerator({employees,canApprove,onClose,onDone}:{employees:any[];canApprove:boolean;onClose:()=>void;onDone:(created:number)=>void}){
 const year=new Date().getFullYear();
 const [plans,setPlans]=useState<any[]>([]),[form,setForm]=useState<any>({planId:'',name:'',start:year+'-01-01',end:year+'-12-31',department:'',status:'To approve'}),[result,setResult]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{fetch('/api/hr?module=accrualPlans').then(async r=>{const d:any=await r.json();if(!r.ok)throw Error(d.error);const active=d.records.filter((p:any)=>p.status==='Active');setPlans(active);if(active[0])setForm((f:any)=>({...f,planId:f.planId||active[0].id}))}).catch(e=>setError(e.message))},[]);
 const departments=Array.from(new Set(employees.map(e=>String(e.department||'').trim()).filter(Boolean))).sort();
 const change=(key:string,value:string)=>{setForm({...form,[key]:value});setResult(null)};
 async function run(action:'preview'|'generate'){setBusy(true);setError('');try{const r=await fetch('/api/leave-accruals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,action})});const d:any=await r.json();if(!r.ok)throw Error(d.error);if(action==='generate')onDone(d.created);else setResult(d)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const skipped=result?result.rows.filter((r:any)=>r.skip).length:0;
 return <div className="overlay"><section className="modal workflow-modal" role="dialog" aria-modal="true" aria-labelledby="accrual-generator-title"><div className="panel-head"><div><div className="eyebrow">TIME OFF ALLOCATIONS</div><h2 id="accrual-generator-title">Generate accrual allocations</h2></div><button aria-label="Close" onClick={onClose}>✕</button></div>
 <form onSubmit={e=>{e.preventDefault();run('preview')}}>
 <label>Accrual plan *<select required value={form.planId} onChange={e=>change('planId',e.target.value)}><option value="">Select…</option>{plans.map(p=><option key={p.id} value={p.id}>{p.name} · {p.leaveType}{p.company?' · '+p.company:''}</option>)}</select></label>
 <label>Allocation name<small>Leave blank to use the plan name and year.</small><input maxLength={300} value={form.name} onChange={e=>change('name',e.target.value)}/></label>
 <label>Valid from *<input type="date" required value={form.start} onChange={e=>change('start',e.target.value)}/></label>
 <label>Valid through *<input type="date" required value={form.end} onChange={e=>change('end',e.target.value)}/></label>
 <label>Department<select value={form.department} onChange={e=>change('department',e.target.value)}><option value="">All departments</option>{departments.map(d=><option key={d}>{d}</option>)}</select></label>
 <label>Create as<select value={form.status} onChange={e=>change('status',e.target.value)}><option>To approve</option>{canApprove&&<option>Approved</option>}</select></label>
 {!plans.length&&!error&&<p className="wide-field module-note">Create an active plan under Time Off → Accrual Plans first.</p>}
 {result&&<div className="wide-field"><p className="module-note">{result.eligible} allocation{result.eligible===1?'':'s'} will be created as {result.status}{skipped?`; ${skipped} employee${skipped===1?'':'s'} skipped`:''}. People who join or leave during the period accrue only while employed. Nothing is saved until you select Create.</p><div className="table-wrap" style={{maxHeight:320,overflow:'auto'}}><table><thead><tr><th>Employee</th><th>Department</th><th>Days by period end</th><th>Note</th></tr></thead><tbody>{result.rows.map((r:any)=><tr key={r.employeeId}><td>{r.name}</td><td>{r.department}</td><td>{r.skip?'—':r.days}</td><td>{r.skip}</td></tr>)}</tbody></table></div></div>}
 {error&&<div className="error wide-field" role="alert">{error}</div>}
 <div className="form-actions"><button type="button" onClick={onClose}>Close</button><button disabled={busy||!form.planId}>{busy?'Working…':'Preview'}</button>{result&&result.eligible>0&&<button type="button" className="primary" disabled={busy} onClick={()=>run('generate')}>Create {result.eligible} allocation{result.eligible===1?'':'s'}</button>}</div>
 </form></section></div>;
}
