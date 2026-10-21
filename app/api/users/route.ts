import {validateAccess} from '../../access-policy';
import {allEmployees} from '../../access-store';
import type {User} from '../../local-auth';
import {env} from 'cloudflare:workers';
import {USERS,registry,publicUser,reply,currentUser,local,sameOrigin,passwordHash,validPassword,sessionCookie,digest} from '../../local-auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){if(!local(request))return reply({error:'Local access only.'},403);if(!env.BUCKET)return reply({error:'Storage unavailable.'},503);const {users,audit}=await registry();const user=await currentUser(request);return reply({setup:users.length===0,user:user?publicUser(user):null,users:user?.role==='Administrator'?users.map(publicUser):[],audit:user?.role==='Administrator'?audit.slice(-100).reverse():[]});}
export async function POST(request:Request){
 if(!local(request)||!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!env.BUCKET)return reply({error:'Storage unavailable.'},503);
 try{
 const text=await request.text();if(text.length>50000)return reply({error:'Request too large.'},413);const b=JSON.parse(text);const {users,audit,etag}=await registry();const actor=await currentUser(request);
 if(b.action==='logout'){const token=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('hrm_session='))?.slice(12);if(token)await env.BUCKET.delete('access/sessions/'+await digest(token));return reply({ok:true},200,{'Set-Cookie':'hrm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
 const username=typeof b.username==='string'?b.username.trim().toLowerCase():'';
 if(b.action==='login'){
 const key='access/attempts/'+await digest(username);const obj=await env.BUCKET.get(key);const previous=obj?await obj.json<{count:number;until:number}>():{count:0,until:0};const attempts=previous.until>Date.now()?previous:{count:0,until:Date.now()+15*60000};if(attempts.count>=10)return reply({error:'Too many attempts. Try again in 15 minutes.'},429);attempts.count++;await env.BUCKET.put(key,JSON.stringify(attempts));
 const user=users.find(u=>u.username===username&&u.active);const hash=await passwordHash(typeof b.password==='string'?b.password.slice(0,129):'',user?.salt||'dummy-password-salt');if(!user||hash!==user.hash)return reply({error:'Incorrect username or password.'},401);await env.BUCKET.delete(key);return reply({user:publicUser(user)},200,{'Set-Cookie':await sessionCookie(user)});
 }
 if(b.action==='changePassword'){
 if(!actor)return reply({error:'Sign in required.'},401);if(await passwordHash(String(b.currentPassword||''),actor.salt)!==actor.hash)throw Error('Current password is incorrect.');validPassword(b.newPassword);const user=users.find(u=>u.id===actor.id)!;user.salt=crypto.randomUUID();user.hash=await passwordHash(b.newPassword,user.salt);user.version++;audit.push({at:new Date().toISOString(),by:actor.name,action:'Changed own password'});const saved=await env.BUCKET.put(USERS,JSON.stringify({users,audit:audit.slice(-1000)}),{onlyIf:{etagMatches:etag!}});if(!saved)return reply({error:'Account changed. Try again.'},409);return reply({user:publicUser(user)},200,{'Set-Cookie':await sessionCookie(user)});
 }
 if(b.action==='setup'&&users.length)return reply({error:'Administrator already exists.'},409);
 if(b.action!=='setup'&&actor?.role!=='Administrator')return reply({error:'Administrator access required.'},403);
 let result:User;
 if(b.action==='setup'||b.action==='create'){
 if(!/^[a-z0-9][a-z0-9._@-]{2,79}$/.test(username))throw Error('Username must be 3–80 letters, numbers, dots, @, underscores or hyphens.');
 if(users.some(u=>u.username===username))throw Error('This username already exists.');validPassword(b.password);
 const name=typeof b.name==='string'?b.name.trim():'';if(!name||name.length>120)throw Error('Enter a name (up to 120 characters).');
 const role=b.action==='setup'?'Administrator':b.role;const access=validateAccess({...b,role},null,await allEmployees(),users);
 const salt=crypto.randomUUID();result={id:crypto.randomUUID(),username,name,role,...access,active:b.action==='setup'?true:b.active!==false,salt,hash:await passwordHash(b.password,salt),version:1};users.push(result);
 }else if(b.action==='update'||b.action==='revokeSessions'){
 const user=users.find(u=>u.id===b.id);if(!user)throw Error('User not found.');
 if(b.version!==undefined&&b.version!==user.version)return reply({error:'This account changed. Refresh and try again.'},409);if(b.action==='revokeSessions'){user.version++;result=user;}else{
 if(typeof b.active!=='boolean')throw Error('Invalid account status.');const access=validateAccess(b,user,await allEmployees(),users);
 if(actor!.id===user.id&&(b.role!=='Administrator'||!b.active))throw Error('You cannot disable or demote your own administrator account.');
 const name=typeof b.name==='string'?b.name.trim():'';if(!name||name.length>120)throw Error('Enter a name.');
 const nextUsername=b.username===undefined?user.username:String(b.username).trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._@-]{2,79}$/.test(nextUsername)||users.some(u=>u.id!==user.id&&u.username===nextUsername))throw Error('Choose a valid unique username.');Object.assign(user,{name,username:nextUsername,role:b.role,...access,active:b.active,version:user.version+1});if(b.password){validPassword(b.password);user.salt=crypto.randomUUID();user.hash=await passwordHash(b.password,user.salt);}result=user;}
 }else throw Error('Unknown action.');
 audit.push({at:new Date().toISOString(),by:actor?.name||result.name,action:(b.action==='create'?'Created account':b.action==='revokeSessions'?'Revoked sessions':b.action==='setup'?'Created first administrator':'Updated account')+' · '+result.username});const saved=await env.BUCKET.put(USERS,JSON.stringify({users,audit:audit.slice(-1000)}),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});if(!saved)return reply({error:'Accounts changed. Refresh and try again.'},409);
 return reply({user:publicUser(result)},200,b.action==='setup'||actor?.id===result.id?{'Set-Cookie':await sessionCookie(result)}:{});
 }catch(e){return reply({error:e instanceof Error?e.message:'Unable to save account.'},400);}
}
