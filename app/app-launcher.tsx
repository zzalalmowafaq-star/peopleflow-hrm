'use client';
import {availableApps,appIcons} from './suite-shell';
export default function AppLauncher({user,onSelect}:{user:any;onSelect:(app:string)=>void}){return <section className="suite-launcher"><div className="launcher-brand">peopleflow<span>HR MANAGEMENT</span></div><div className="suite-launcher-grid">{availableApps(user).map((a,i)=>{const Icon=appIcons[a.id];return <button key={a.id} onClick={()=>onSelect(a.id)}><span className={'launcher-icon hue-'+i%5}><Icon size={31} strokeWidth={1.6}/></span><strong>{a.name}</strong></button>})}</div><p>Signed in as {user.name}</p></section>}

