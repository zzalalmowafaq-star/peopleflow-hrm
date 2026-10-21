// Explicit signed amount format avoids ambiguous debit/credit conventions.
export function readBankCSV(raw:string){
 if(raw.length>150000)throw Error('Use a CSV file smaller than 150 KB.');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 const source=raw.replace(/^\uFEFF/,'');
 for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell.trim());cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('Unclosed CSV quotation.');row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 const header=rows.shift()?.map(v=>v.toLowerCase());if(!header||header.join(',')!=='reference,date,label,amount')throw Error('Use these CSV columns in order: reference,date,label,amount. Positive amounts are receipts; negative amounts are withdrawals.');
 if(!rows.length||rows.length>500)throw Error('Import 1–500 statement rows at a time.');
 const seen=new Set<string>();return rows.map((r,i)=>{if(r.length!==4)throw Error('Row '+(i+2)+': expected four columns.');const [reference,date,label,value]=r;if(!reference||reference.length>160||seen.has(reference))throw Error('Row '+(i+2)+': use a distinct bank reference.');seen.add(reference);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Row '+(i+2)+': use a valid YYYY-MM-DD date.');if(!label||label.length>200)throw Error('Row '+(i+2)+': add a description up to 200 characters.');if(!/^-?\d+(\.\d+)?$/.test(value)||!Number(value))throw Error('Row '+(i+2)+': use a nonzero signed decimal amount without grouping separators.');return {externalRef:reference,date,label,amount:Math.abs(Number(value)),direction:Number(value)>0?'Inbound':'Outbound'};});
}
