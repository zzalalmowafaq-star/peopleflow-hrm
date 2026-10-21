export type EmployeeSearch={query:string;department:string;company:string;status:string;sort:string};
export function employeeStatus(e:any,today:string){return e.end&&e.end<=today?'Former':e.start>today?'Upcoming':'Active';}
export function selectEmployees(employees:any[],search:EmployeeSearch,today:string){
 const words=search.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 return employees.filter(e=>(!search.department||e.department===search.department)&&(!search.company||e.company===search.company)&&(!search.status||employeeStatus(e,today)===search.status)&&words.every(w=>[e.name,e.role,e.department,e.company,e.email,e.employeeNumber,e.location].join(' ').toLocaleLowerCase().includes(w))).sort((a,b)=>{const key=search.sort.replace('-desc','');const n=String(a[key]||'').localeCompare(String(b[key]||''));return search.sort.endsWith('-desc')?-n:n;});
}
export function groupEmployees(employees:any[],key:string,all:any[]=employees){if(!key)return [['',employees]] as [string,any[]][];const groups=new Map<string,any[]>();for(const e of employees){const label=key==='managerId'?(all.find(m=>m.id===e.managerId)?.name||'No manager'):e[key]||'Not specified';groups.set(label,[...(groups.get(label)||[]),e]);}return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]));}
export function employeeCSV(rows:any[]){const cols=['employeeNumber','name','role','department','company','email','workPhone','workMobile','location','start','end'];const esc=(v:any)=>{let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};return '\uFEFF'+[cols,...rows.map(r=>cols.map(k=>r[k]))].map(r=>r.map(esc).join(',')).join('\r\n');}

