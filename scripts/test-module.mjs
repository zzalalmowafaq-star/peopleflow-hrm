import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
// Resolve newly shared policy/store helpers in the existing isolated-storage
// tests. The test's explicit auth replacements remain authoritative.
export function rewriteTestImports(source){
 const env=globalThis.securityEnv||globalThis.acctEnv||globalThis.hrEnv||globalThis.hrmEnv||globalThis.profileEnv||globalThis.reportEnv||globalThis.payrollEnv||globalThis.workflowEnv||globalThis.activityEnv||globalThis.redesignEnv;
 if(env)globalThis.testDependencyEnv=env;
 const encode=code=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(code)).toString('base64');
 return source.replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g,(match,quote,specifier)=>{const name=specifier.split('/').at(-1);if(!['access-policy','access-store','overtime','hr-calculations','attendance-device','leave-accrual'].includes(name))return match;let code=readFileSync('app/'+name+'.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.testDependencyEnv;');code=rewriteTestImports(code);return 'from '+JSON.stringify(encode(code));});
}
