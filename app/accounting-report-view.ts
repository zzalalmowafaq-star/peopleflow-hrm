import {accountingReports} from './accounting-engine';

type Cell=string|number|null;
type Row={cells:Cell[];kind?:'section'|'total'};
export type AccountingReportView={title:string;headers:string[];rows:Row[];moneyColumns:number[];statement?:boolean;note?:string};
export function buildAccountingReport(books:any,report:string,from:string,to:string):AccountingReportView{
 const data=accountingReports(books,report==='balance'?to:from,to);
 const accountName=(id:string)=>{const a=books.accounts.find((a:any)=>a.id===id);return a?a.code+' '+a.name:'Unknown account'};
 if(report==='profit'){
  const rows:Row[]=[{cells:['Income',null],kind:'section'},...data.trial.filter((a:any)=>a.type==='Income'&&a.balance).map((a:any)=>({cells:[a.code+' '+a.name,-a.balance]})),{cells:['Total income',data.income],kind:'total'},{cells:['Expenses',null],kind:'section'},...data.trial.filter((a:any)=>a.type==='Expense'&&a.balance).map((a:any)=>({cells:[a.code+' '+a.name,a.balance]})),{cells:['Total expenses',data.expenses],kind:'total'},{cells:['Net profit',data.profit],kind:'total'}];
  return {title:'Profit & Loss',headers:['Account / total','Amount'],rows,moneyColumns:[1],statement:true};
 }
 if(report==='balance'){
  const rows:Row[]=[];let assets=0,liabilities=0,equity=0;
  for(const [label,types,sign] of [['Assets',['Asset','Receivable','Bank'],1],['Liabilities',['Liability','Payable'],-1],['Equity',['Equity'],-1]] as [string,string[],number][]){
   rows.push({cells:[label,null],kind:'section'});const accounts=data.balance.filter((a:any)=>types.includes(a.type)&&a.balance);let total=accounts.reduce((n:number,a:any)=>n+a.balance*sign,0);
   rows.push(...accounts.map((a:any)=>({cells:[a.code+' '+a.name,a.balance*sign]})));
   if(label==='Equity'){rows.push({cells:['Accumulated earnings (all dates through report end)',data.retained]});total+=data.retained;equity=total;}else if(label==='Assets')assets=total;else liabilities=total;
   rows.push({cells:['Total '+label.toLowerCase(),total],kind:'total'});
  }
  rows.push({cells:['Total liabilities and equity',liabilities+equity],kind:'total'},{cells:['Balance check (assets minus liabilities and equity)',assets-liabilities-equity],kind:'total'});
  return {title:'Balance Sheet',headers:['Account / total','Amount'],rows,moneyColumns:[1],statement:true};
 }
 if(report==='trial')return {title:'Trial Balance',headers:['Account','Debit','Credit','Balance'],moneyColumns:[1,2,3],rows:[...data.trial.filter((a:any)=>a.debit||a.credit).map((a:any)=>({cells:[a.code+' '+a.name,a.debit,a.credit,a.balance]})),{cells:['Total',...['debit','credit','balance'].map(k=>data.trial.reduce((n:number,a:any)=>n+a[k],0))],kind:'total'}]};
 if(report==='ledger')return {title:'General Ledger',headers:['Date','Entry','Account','Description','Debit','Credit'],moneyColumns:[4,5],rows:data.ledger.map((l:any)=>({cells:[l.date,l.number,accountName(l.accountId),l.label,l.debit,l.credit]}))};
 if(report==='tax')return {title:'Tax Summary',headers:['Tax','Direction','Taxable base','Tax amount'],moneyColumns:[2,3],rows:data.taxSummary.map((t:any)=>({cells:[t.name,t.direction,t.base,t.tax]})),note:'Bookkeeping summary of configured taxes on posted documents and their reversals. This is not a statutory tax return.'};
 if(report==='receivables'||report==='payables'){
  const totals=[0,0,0,0,0];const rows:Row[]=data[report].filter((d:any)=>d.due!==0).map((d:any)=>{const values=[0,0,0,0,0];for(const installment of d.installmentsDue||[{date:d.dueDate,amount:d.due}]){const age=Math.floor((Date.parse(to)-Date.parse(installment.date))/86400000),bucket=age<=0?0:age<=30?1:age<=60?2:age<=90?3:4;values[bucket]+=installment.amount;totals[bucket]+=installment.amount;}return {cells:[d.number,d.partnerName,d.dueDate,...values]};});
  rows.push({cells:['Total','','',...totals],kind:'total'});
  return {title:report==='receivables'?'Aged Receivables':'Aged Payables',headers:['Document','Partner','Due date','Not due','1–30 days','31–60 days','61–90 days','90+ days'],rows,moneyColumns:[3,4,5,6,7]};
 }
 throw Error('Unknown financial report.');
}

// Both the screen and CSV consume these rows, including statement signs,
// accumulated earnings, totals and aging buckets.
export function reportCell(view:AccountingReportView,cell:Cell,column:number,format:(n:number)=>string){return cell===null?'':view.moneyColumns.includes(column)&&typeof cell==='number'?format(cell):String(cell);}
export function accountingReportCSV(books:any,view:AccountingReportView,from:string,to:string,format:(n:number)=>string){return [['Company',books.name],['Country',books.country||''],['Company tax ID',books.taxId||''],['Address',books.address||''],['Currency',books.currency],['Report',view.title],...(view.title==='Balance Sheet'?[['As of',to]]:[['From',from,'Through',to]]),...(view.note?[[view.note]]:[]),view.headers,...view.rows.map(row=>row.cells.map((cell,i)=>reportCell(view,cell,i,format)))];}
