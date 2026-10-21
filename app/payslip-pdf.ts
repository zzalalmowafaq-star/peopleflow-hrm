import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
// Builds one PDF with a page (or more) per payslip. Generated on this computer;
// the bundled Noto Sans font covers Latin and Cyrillic (Uzbek in either script, Russian).
export async function payslipPDF(slips:any[],fontBytes:Uint8Array){
 if(!slips.length)throw Error('Choose at least one payslip.');
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fontBytes,{subset:true});
 const supported=new Set(font.getCharacterSet());let page:any,y=0,slip:any;const width=499,left=48,dark=rgb(.14,.17,.21),muted=rgb(.42,.44,.48);
 const clean=(value:any)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/[\x00-\x1f]/g,'');
 const money=(n:any)=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 function lines(value:any,max:number,size:number){const text=clean(value);if([...text].some(c=>!supported.has(c.codePointAt(0)!)))throw Error('A payslip contains characters the PDF font cannot render (for example '+(slip?.employeeName||'a name')+'). Use Latin or Cyrillic text.');const result:string[]=[];let line='';for(const word of text.split(' ')){const next=line?line+' '+word:word;if(font.widthOfTextAtSize(next,size)>max&&line){result.push(line);line=word;}else line=next;while(font.widthOfTextAtSize(line,size)>max){let cut=line.length-1;while(cut>1&&font.widthOfTextAtSize(line.slice(0,cut),size)>max)cut--;result.push(line.slice(0,cut));line=line.slice(cut);}}result.push(line);return result;}
 function newPage(){page=pdf.addPage([595.28,841.89]);y=776;page.drawRectangle({x:left,y:805,width,height:3,color:rgb(.44,.29,.41)});}
 function ensure(height:number){if(y-height<70)newPage();}
 function text(value:any,size=10,color=dark,x=left,max=width){const ls=lines(value,max,size);ensure(ls.length*(size+5)+6);for(const l of ls){page.drawText(l,{x,y,font,size,color});y-=size+5;}y-=4;}
 function pair(label:string,value:any,size=10){ensure(size+10);page.drawText(clean(label),{x:left,y,font,size,color:muted});const v=lines(value,300,size)[0];page.drawText(v,{x:left+width-font.widthOfTextAtSize(v,size),y,font,size,color:dark});y-=size+8;}
 const cols=[90,289,120];
 function row(cells:any[],shade=false,bold=false){const size=bold?10:9,wrapped=cells.map((v,i)=>lines(v,cols[i]-12,size)),height=Math.max(...wrapped.map(a=>a.length))*14+12;ensure(height);if(shade)page.drawRectangle({x:left,y:y-height+9,width,height,color:rgb(.94,.92,.94)});let x=left;wrapped.forEach((ls,i)=>{ls.forEach((l,n)=>{const w=font.widthOfTextAtSize(l,size);page.drawText(l,{x:i===2?x+cols[i]-6-w:x+6,y:y-5-n*14,font,size,color:dark});});x+=cols[i];});y-=height;page.drawLine({start:{x:left,y:y+9},end:{x:left+width,y:y+9},thickness:.4,color:rgb(.85,.86,.88)});}
 function section(title:string,items:any[],total:string,amount:number){if(!items.length)return;y-=4;text(title,11);row(['Code','Description','Amount ('+slip.currency+')'],true);for(const l of items)row([l.code,l.name,money(l.amount)]);row(['',total,money(amount)],false,true);}
 for(slip of slips){
  newPage();text(slip.company||'Payslip',18);text('PAYSLIP',13,muted);
  pair('Employee',slip.employeeName);if(slip.department)pair('Department',slip.department);pair('Pay period',slip.from+' to '+slip.to);pair('Status',slip.status||'Draft');if(slip.payFrequency)pair('Pay frequency',slip.payFrequency);pair('Currency',slip.currency);
  const all=slip.lines||[],earnings=all.filter((l:any)=>l.category==='Earning'),deductions=all.filter((l:any)=>l.category==='Deduction'),employer=all.filter((l:any)=>l.category==='Employer contribution');
  section('Earnings',earnings,'Gross pay',slip.gross);section('Deductions',deductions,'Total deductions',slip.deductions);
  y-=6;ensure(40);page.drawRectangle({x:left,y:y-12,width,height:28,color:rgb(.93,.97,.94)});page.drawText('Net pay',{x:left+8,y:y-3,font,size:13,color:dark});const net=money(slip.net)+' '+slip.currency;page.drawText(net,{x:left+width-8-font.widthOfTextAtSize(net,13),y:y-3,font,size:13,color:dark});y-=40;
  if(employer.length){section('Employer contributions (paid by the employer, not deducted from pay)',employer,'Total employer contributions',slip.employerContributions);pair('Total cost to employer',money(slip.employerCost)+' '+slip.currency);}
  if(slip.calculationNote){y-=6;text('Calculation basis',10);text(slip.calculationNote,8,muted);}
 }
 const pages=pdf.getPages();pages.forEach((p,i)=>{p.drawText('Peopleflow HRM  |  Payslip',{x:left,y:35,font,size:8,color:muted});const n=(i+1)+' / '+pages.length;p.drawText(n,{x:left+width-font.widthOfTextAtSize(n,8),y:35,font,size:8,color:muted});});
 pdf.setTitle(slips.length===1?slips[0].name:'Payslips');pdf.setAuthor(slips[0].company||'Peopleflow HRM');return pdf.save();
}
