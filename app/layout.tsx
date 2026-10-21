import type {Metadata} from 'next';
import './globals.css';
import './suite.css';
export const metadata:Metadata={title:'Peopleflow · HRM',description:'Employee records, payroll and people reporting in one workspace.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
