'use client';
import {useState} from 'react';

const template='User ID,Date Time,State,Device\r\n1001,2026-10-20 08:02:11,Check-In,Gate 1\r\n1001,2026-10-20 17:31:40,Check-Out,Gate 1\r\n1002,2026-10-20 21:58:03,Check-In,Line 2\r\n1002,2026-10-21 06:04:55,Check-Out,Line 2\r\n';
const download=(name:string,text:string)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
const cell=(v:any)=>{let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};
const local=(v:string)=>{if(!v)return '';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString()};

export default function AttendanceImport({onDone}:{onDone:()=>void}){
 const [text,setText]=useState(''),[fileName,setFileName]=useState(''),[timezone,setTimezone]=useState(Intl.DateTimeFormat().resolvedOptions().timeZone),[dateOrder,setDateOrder]=useState('DMY');
 const [result,setResult]=useState<any>(null),[imported,setImported]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function run(action:'preview'|'import'){
  setBusy(true);setError('');
  try{const r=await fetch('/api/attendance/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,text,timezone,dateOrder})});const d:any=await r.json();if(!r.ok)throw Error(d.error);
   if(action==='preview'){setResult(d);setImported(null)}else{setImported(d);setResult(null)}}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function choose(file?:File){setResult(null);setImported(null);setError('');if(!file)return;if(file.size>6*1024*1024){setError('Files are limited to 6 MB. Split the export by date range.');return}setFileName(file.name);setText(await file.text())}
 const report=(rows:any[])=>download('attendance-import-exceptions.csv','Row,Device ID,Employee,Time (local),Reason\r\n'+rows.map(r=>[r.row,r.badge,r.employee||'',local(r.time),r.reason].map(cell).join(',')).join('\r\n'));
 const s=result?.summary||imported?.summary;const exceptions=(result||imported)?.exceptions||[];
 return <div className="hr-app">
  <div className="app-toolbar"><div><div className="eyebrow">ATTENDANCES</div><h1>Import Device Punches</h1><p>Load the punch log from fingerprint or face terminals, review it, then create attendance records.</p></div><button onClick={()=>download('device-punch-template.csv',template)}>Download template</button></div>
  <section className="panel" style={{padding:24}}>
   <div className="odoo-control" style={{flexWrap:'wrap'}}>
    <label>Device export (CSV / TSV / TXT)<input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={e=>choose(e.target.files?.[0])}/></label>
    <label>Device clock timezone<input value={timezone} onChange={e=>setTimezone(e.target.value)} aria-label="Device timezone" placeholder="Asia/Tashkent"/></label>
    <label>Dates written as<select value={dateOrder} onChange={e=>setDateOrder(e.target.value)}><option value="DMY">Day first (21/10/2026)</option><option value="MDY">Month first (10/21/2026)</option></select></label>
    <button className="primary" disabled={!text||busy} onClick={()=>run('preview')}>{busy&&!imported?'Checking…':'Validate & preview'}</button>
   </div>
   {fileName&&<p className="module-note">Selected: {fileName}</p>}
   <p className="module-note">Columns are detected automatically: a device user ID or employee reference (User ID, AC-No., Badge, employeeNumber), a date-time column (or separate Date and Time), and optionally In/Out state and device name. Employees are matched by <strong>Attendance device ID / badge</strong> on their profile, otherwise by employee reference. Each employee's schedule timezone is used when set; the timezone above applies to everyone else. Punches without a state are paired in time order, including night shifts that cross midnight. Re-importing the same file is safe: records already imported are skipped.</p>
  </section>
  {error&&<div className="error" role="alert">{error}</div>}
  {s&&<div className="workflow-summary">
   {imported?<button><span>Attendance records created</span><strong>{imported.created}</strong></button>:<button><span>Records ready to import</span><strong>{s.ready}</strong></button>}
   <button><span>Hours in these records</span><strong>{s.hours.toFixed(2)}</strong></button>
   <button><span>Punches read</span><strong>{s.readable} / {s.punches}</strong></button>
   <button><span>Employees matched</span><strong>{s.employees}</strong></button>
   <button><span>Auto check-outs</span><strong>{s.autoClosed}</strong></button>
   <button><span>Repeated punches ignored</span><strong>{s.duplicates}</strong></button>
   <button><span>Already imported</span><strong>{s.alreadyImported}</strong></button>
   <button><span>Still checked in (left open)</span><strong>{s.stillCheckedIn}</strong></button>
   <button><span>Exceptions to review</span><strong>{s.exceptions}</strong></button>
  </div>}
  {result&&<div className="toolbar-actions" style={{margin:'16px 0'}}>
   <button className="primary" disabled={busy||!result.summary.ready} onClick={()=>{if(confirm(`Create ${result.summary.ready} attendance records?`))run('import')}}>{busy?'Importing…':`Import ${result.summary.ready} attendance records`}</button>
   {!!exceptions.length&&<button onClick={()=>report(exceptions)}>Download exceptions ({exceptions.length})</button>}
  </div>}
  {imported&&<div className="toolbar-actions" style={{margin:'16px 0'}}>
   <p>{imported.created} attendance records imported{imported.failed.length?`, ${imported.failed.length} failed — re-import the file to retry them`:''}.</p>
   <button className="primary" onClick={onDone}>Open attendance analysis</button>
   {!!exceptions.length&&<button onClick={()=>report(exceptions)}>Download exceptions ({exceptions.length})</button>}
  </div>}
  {result?.preview?.length>0&&<><h2>Preview{result.summary.ready>200?' (first 200)':''}</h2><section className="panel table-wrap"><table><thead><tr><th>Employee</th><th>Check-in</th><th>Check-out</th><th>Hours</th><th>Note</th></tr></thead><tbody>{result.preview.map((r:any,i:number)=><tr key={i}><td>{r.employee}</td><td>{local(r.checkIn)}</td><td>{local(r.checkOut)}</td><td>{r.hours.toFixed(2)}</td><td>{r.autoClosed?<span className="pill pending">Auto check-out</span>:''}</td></tr>)}</tbody></table></section></>}
  {exceptions.length>0&&<><h2>Exceptions{exceptions.length>200?' (first 200)':''}</h2><section className="panel table-wrap"><table><thead><tr><th>Row</th><th>Device ID</th><th>Employee</th><th>Time</th><th>Reason</th></tr></thead><tbody>{exceptions.slice(0,200).map((r:any,i:number)=><tr key={i}><td>{r.row}</td><td>{r.badge}</td><td>{r.employee||''}</td><td>{local(r.time)||''}</td><td>{r.reason}</td></tr>)}</tbody></table></section></>}
 </div>;
}
