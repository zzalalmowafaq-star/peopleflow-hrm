import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
export async function invoicePDF(books:any,doc:any,amount:(n:number)=>string,due:number,fontBytes:Uint8Array){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(fontBytes,{subset:true});
 const supported=new Set(font.getCharacterSet());let page:any,y=0;const width=499,left=48;
 const clean=(value:any)=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/[\x00-\x1f]/g,'');
 const measure=(value:string,size:number)=>font.widthOfTextAtSize(value,size);
 function lines(value:any,max:number,size:number){const text=clean(value);if([...text].some(c=>!supported.has(c.codePointAt(0)!)))throw Error('This document contains characters the PDF font cannot render. Use the printable HTML document for this language.');const result:string[]=[];let line='';for(const c of text){if(measure(line+c,size)>max&&line){result.push(line);line='';}line+=c;}result.push(line);return result;}
 function newPage(){page=pdf.addPage([595.28,841.89]);y=790;page.drawRectangle({x:48,y:805,width,height:3,color:rgb(.44,.29,.41)});}
 function ensure(height:number){if(y-height<65)newPage();}
 function text(value:any,size=10,max=width,color=rgb(.14,.17,.21)){const ls=lines(value,max,size);ensure(ls.length*(size+5)+8);for(const line of ls){page.drawText(line,{x:left,y,font,size,color});y-=size+5;}y-=5;}
 function row(cells:any[],sizes:number[],heading=false){const size=9,wrapped=cells.map((v,i)=>lines(v,sizes[i]-12,size)),height=Math.max(...wrapped.map(a=>a.length))*14+16;if(y-height<65){newPage();if(!heading)row(['Description','Qty','Unit price','Net','Tax'],[219,40,80,80,80],true);}if(heading)page.drawRectangle({x:left,y:y-height+8,width,height,color:rgb(.94,.92,.94)});let x=left;wrapped.forEach((ls,i)=>{ls.forEach((line,n)=>page.drawText(line,{x:x+6,y:y-7-n*14,font,size,color:rgb(.16,.18,.22)}));x+=sizes[i];});y-=height;page.drawLine({start:{x:left,y:y+8},end:{x:left+width,y:y+8},thickness:.4,color:rgb(.85,.86,.88)});}
 newPage();text(books.name,19);if(books.address)text(books.address);if(books.taxId)text('Tax ID: '+books.taxId);
 text(({invoice:'CUSTOMER INVOICE',bill:'VENDOR BILL',creditNote:'CUSTOMER CREDIT NOTE',vendorCredit:'VENDOR CREDIT'} as any)[doc.type]||'DOCUMENT',15);
 text((doc.number||'DRAFT')+'  |  '+doc.status,12);text('Document date: '+doc.date+'   Due date: '+doc.dueDate);text('Currency: '+books.currency);
 text('Partner: '+doc.partnerName,12);if(doc.partnerAddress)text(doc.partnerAddress);if(doc.partnerTaxId)text('Partner tax ID: '+doc.partnerTaxId);if(doc.reference)text('Reference: '+doc.reference);
 row(['Description','Qty','Unit price','Net','Tax'],[219,40,80,80,80],true);
 for(const l of doc.lines)row([l.label,l.quantity,amount(l.price),amount(l.net),amount(l.tax)],[219,40,80,80,80]);
 y-=14;text('Subtotal: '+amount(doc.subtotal));text('Tax: '+amount(doc.taxTotal));text('Total: '+amount(doc.total),14);text('Amount due: '+amount(due),12);
 if(doc.installments?.length>1){text('Payment schedule',12);for(const i of doc.installments)text(i.date+'  -  '+amount(i.amount));}
 const pages=pdf.getPages();pages.forEach((p,i)=>{p.drawText('Peopleflow HRM  |  '+(doc.number||'Draft'),{x:left,y:35,font,size:8,color:rgb(.45,.45,.45)});p.drawText((i+1)+' / '+pages.length,{x:500,y:35,font,size:8});});
 pdf.setTitle((doc.number||'Draft')+' - '+doc.partnerName);pdf.setAuthor(books.name);return pdf.save();
}
