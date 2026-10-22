import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSecurityScan,securityInventory,securityLock,securityMatches} from '../src/security-scan.js';
import {securityScreen} from '../src/security-ui.js';
import {createAdminController,adminScreen} from '../src/admin.js';
import {PermissionFlagsBits as P} from 'discord.js';
const lock=(extra={})=>JSON.stringify({lockfileVersion:3,packages:{'':{version:'4.5.0',name:'PRIVATE_PROJECT',dependencies:{example:'1.0.0'},devDependencies:{tool:'2.0.0'},token:'SECRET_TOKEN'},'node_modules/example':{version:'1.0.0',resolved:'https://registry.npmjs.org/example/-/example-1.0.0.tgz',...extra},'node_modules/nested/node_modules/example':{version:'1.0.0',resolved:'https://registry.npmjs.org/example/-/example-1.0.0.tgz'},'node_modules/tool':{version:'2.0.0',resolved:'https://registry.npmjs.org/tool/-/tool-2.0.0.tgz',dev:true},'node_modules/custom':{version:'1.0.0',resolved:'https://private.example/SECRET'}}});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const report=(id='GHSA-aaaa-bbbb-cccc')=>({id,database_specific:{severity:'HIGH'},summary:'@everyone SECRET_BODY',references:[{url:'https://evil.invalid/SECRET'}],affected:[{package:{ecosystem:'npm',name:'example'},ranges:[{events:[{introduced:'0'},{fixed:'1.0.1'}]}]}]});
const matches={results:[{vulns:[{id:'GHSA-aaaa-bbbb-cccc'}]},{}]};
const wait=()=>new Promise(resolve=>setImmediate(resolve));
test('inventory uses exact public-registry versions, deduplicates nested copies and excludes project fields and custom sources',()=>{
  const d=securityInventory(lock());assert.equal(d.packages.length,2);assert.equal(d.skipped,1);assert.deepEqual(d.packages,[{name:'example',version:'1.0.0',dev:false,direct:true},{name:'tool',version:'2.0.0',dev:true,direct:true}]);assert.equal(d.lockHash.length,64);assert.ok(!JSON.stringify(d).includes('PRIVATE_PROJECT'));assert.ok(!JSON.stringify(d).includes('SECRET'));
  const value=JSON.parse(lock());value.packages[''].dependencies.alias='npm:real-name@1.2.3';value.packages['node_modules/alias']={name:'real-name',version:'1.2.3',resolved:'https://registry.npmjs.org/real-name/-/real-name-1.2.3.tgz'};assert.equal(securityInventory(JSON.stringify(value)).packages.at(-1).name,'real-name');assert.equal(securityInventory(JSON.stringify(value)).packages.at(-1).direct,true);
});
test('inventory refuses malformed and unbounded locks; unsupported private, local and git entries are counted, not transmitted',()=>{
  for(const source of ['',null,'{}',JSON.stringify({lockfileVersion:1}), ' '.repeat(1024*1024+1)])assert.throws(()=>securityInventory(source));
  for(const extra of [{link:true},{private:true},{version:'git+SECRET'},{version:'latest'},{resolved:'https://registry.npmjs.org.evil/a'},{resolved:'https://SECRET@registry.npmjs.org/a'}]){const d=securityInventory(lock(extra));assert.equal(d.skipped,2);}
  const value=JSON.parse(lock());value.packages=Array.from({length:1002},(_,n)=>n);assert.throws(()=>securityInventory(JSON.stringify(value)));
});
test('lock file reading is bounded, regular-file only, and refuses symlinks',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'astral-security-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'lock.json');await writeFile(path,lock());assert.equal(await securityLock(path),lock());await symlink(path,join(dir,'link'));await assert.rejects(securityLock(join(dir,'link')));await assert.rejects(securityLock(dir));await writeFile(path,Buffer.alloc(1024*1024+1));await assert.rejects(securityLock(path));await writeFile(path,Buffer.from([255]));await assert.rejects(securityLock(path));
});
test('batch validation never interprets partial, malformed or oversized result sets as clean',()=>{
  const inventory=securityInventory(lock());for(const value of [{},{results:[{},{}],error:'SECRET'},{results:[]},{results:[{},null]},{results:[{vulns:{}},{}]},{results:[{error:'SECRET'},{}]},{results:[{next_page_token:'more'},{}]},{results:[{vulns:[{id:'@everyone'}]},{}]},{results:[{vulns:Array(5001).fill({id:'CVE-2026-1234'})},{}]}])assert.throws(()=>securityMatches(value,inventory));
  const d=securityMatches({results:[{vulns:[{id:'CVE-2026-1234'},{id:'CVE-2026-1234'}]},{vulns:[{id:'CVE-2026-1234'}]}]},inventory);assert.equal(d.length,1);assert.equal(d[0].packages.length,2);
});
test('explicit scan sends only npm names and exact versions to fixed endpoints and keeps sanitized details',async()=>{
  const requests=[],scan=createSecurityScan({read:async()=>lock(),fetcher:async(url,options)=>{requests.push({url,options});return response(url.endsWith('querybatch')?matches:report());}});
  assert.equal(scan.snapshot(),null);assert.equal(requests.length,0);const result=await scan.run();assert.equal(result.status,'complete');assert.equal(result.findings[0].severity,'high');assert.deepEqual(result.findings[0].fixed,[{name:'example',version:'1.0.1'}]);assert.equal(result.packageCount,2);assert.equal(result.runtimeCount,1);assert.equal(result.devCount,1);assert.equal(result.skipped,1);
  assert.deepEqual(JSON.parse(requests[0].options.body),{queries:[{package:{name:'example',ecosystem:'npm'},version:'1.0.0'},{package:{name:'tool',ecosystem:'npm'},version:'2.0.0'}]});for(const r of requests){assert.ok(r.url.startsWith('https://api.osv.dev/v1/'));assert.equal(r.options.redirect,'error');assert.ok(r.options.signal instanceof AbortSignal);assert.deepEqual(Object.keys(r.options.headers).sort(),['Accept','Content-Type']);}
  const serialized=JSON.stringify(result);for(const secret of ['SECRET','PRIVATE_PROJECT','evil.invalid','references','summary'])assert.ok(!serialized.includes(secret));
});
test('one in-flight scan and bounded cache prevent request storms, return independent snapshots and expire',async()=>{
  let time=1000,reads=0,calls=0,release;const scan=createSecurityScan({read:async()=>{reads++;return lock();},now:()=>time,fetcher:async()=>{calls++;await new Promise(resolve=>release=resolve);return response({results:[{},{}]});}});
  const first=scan.run(),second=scan.run();await wait();assert.equal(calls,1);release();const [a,b]=await Promise.all([first,second]);assert.equal(reads,1);a.status='poison';b.findings.push({id:'bad'});assert.equal(scan.snapshot().status,'complete');assert.equal((await scan.run()).findings.length,0);assert.equal(calls,1);time+=300000;const next=scan.run();await wait();release();await next;assert.equal(calls,2);assert.equal(reads,2);
});
test('lookup errors and invalid response bodies are unconfirmed, cached briefly and cannot leak raw errors',async()=>{
  for(const make of [()=>new Response('SECRET_TOKEN',{status:429}),()=>new Response('{SECRET_TOKEN'),()=>new Response(Buffer.from([255])),()=>new Response('{}',{headers:{'content-length':'1048577'}}),()=>new Response(Buffer.alloc(1048577)),()=>response({results:[{}]}),()=>{throw new Error('SECRET_TOKEN');}]){
    let now=1,calls=0;const scan=createSecurityScan({now:()=>now,read:async()=>lock(),fetcher:async()=>{calls++;return make();}}),a=await scan.run();assert.equal(a.status,'failed');assert.equal(a.code,'LOOKUP_UNAVAILABLE');assert.ok(!JSON.stringify(a).includes('SECRET'));await scan.run();assert.equal(calls,1);now+=30000;await scan.run();assert.equal(calls,2);
  }
  const failed=await createSecurityScan({read:async()=>{throw new Error('SECRET_PATH');},fetcher:()=>assert.fail()}).run();assert.equal(failed.code,'LOCK_UNAVAILABLE');assert.ok(!JSON.stringify(failed).includes('SECRET'));
});
test('a stalled response body is cancelled at the deadline instead of hanging or becoming clean',async()=>{
  const keep=setInterval(()=>{},1000);let cancelled=false;
  try{const scan=createSecurityScan({read:async()=>lock(),timeout:20,fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});const d=await scan.run();assert.equal(d.code,'LOOKUP_TIMEOUT');assert.equal(d.status,'failed');assert.equal(cancelled,true);}finally{clearInterval(keep);}
});
test('detail lookup failures retain known findings with unknown severity and no remote data',async()=>{
  for(const make of [()=>new Response('SECRET',{status:500}),()=>response({...report(),id:'OTHER'}),()=>response({...report(),withdrawn:'2026-01-01T00:00:00Z'})]){
    const d=await createSecurityScan({read:async()=>lock(),fetcher:async url=>url.endsWith('querybatch')?response(matches):make()}).run();assert.equal(d.status,'complete');assert.equal(d.findings.length,1);assert.equal(d.findings[0].severity,'unknown');assert.equal(d.detailMissing,1);assert.deepEqual(d.findings[0].fixed,[]);assert.ok(!JSON.stringify(d).includes('SECRET'));
  }
});
test('details have a twenty-advisory budget and concurrency of two even with hundreds of findings',async()=>{
  let active=0,peak=0,requests=0;const ids=Array.from({length:100},(_,n)=>`GHSA-${String(n).padStart(4,'0')}`);
  const d=await createSecurityScan({read:async()=>lock(),fetcher:async url=>{if(url.endsWith('querybatch'))return response({results:[{vulns:ids.map(id=>({id}))},{}]});requests++;peak=Math.max(peak,++active);await wait();active--;return response(report(decodeURIComponent(url.split('/').at(-1))));}}).run();assert.equal(d.findings.length,100);assert.equal(requests,20);assert.equal(peak,2);assert.equal(d.detailMissing,80);
});
test('the actual shipped lock can be scanned without reading or sending configuration files',async()=>{
  const actual=await securityLock();assert.equal(actual,await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));const inventory=securityInventory(actual);assert.ok(inventory.packages.length>20);assert.ok(inventory.packages.some(p=>p.name==='discord.js'&&!p.dev));assert.ok(inventory.packages.some(p=>p.name==='acorn'&&p.dev));
});
const config={lobbyId:'lobby',targetIds:['target'],seconds:5,volume:30,voice:true,enforce:true,words:[]};
function uiFixture({scan,access=async()=>true}={}){
  const controller=createAdminController({settings:{get:()=>config,update:()=>assert.fail('read-only')},guild:{},pendingCount:()=>0,changed:()=>assert.fail('read-only'),securityScan:scan,access});
  const click=(action,s)=>({customId:s?`admin:${s.id}:${action}`:'admin:open',user:{id:'owner'},channelId:'channel',isChatInputCommand:()=>false,isModalSubmit:()=>false,message:{},async deferReply(){this.deferred=true;},async deferUpdate(){this.deferred=true;},async editReply(m){this.result=m;},async reply(m){this.result=m;}});
  return {controller,click,async open(){const i=click();await controller.handle(i);const s=[...controller.sessions.sessions.values()][0];const start=click('open-security',s);await controller.handle(start);return {s,i:start};}};
}
test('opening the private diagnostic discloses the service and performs no lookup; run requires the current diagnostic view',async()=>{
  let calls=0;const f=uiFixture({scan:{snapshot:()=>null,async run(){calls++;return {status:'failed',code:'LOOKUP_UNAVAILABLE',checkedAt:1};}}}),{s,i}=await f.open();assert.equal(calls,0);assert.ok(JSON.stringify(i.result).includes('OSV'));assert.ok(JSON.stringify(i.result).includes('診断を開始'));assert.deepEqual(i.result.allowedMentions,{parse:[]});await f.controller.handle(f.click('security-run',s));assert.equal(calls,1);await f.controller.handle(f.click('home',s));await f.controller.handle(f.click('security-run',s));assert.equal(calls,1);
});
test('foreign owners, other channels, expired and replaced sessions cannot initiate lookups',async()=>{
  let calls=0;const f=uiFixture({scan:{snapshot:()=>null,run:async()=>{calls++;assert.fail();}}}),{s}=await f.open();for(const mutation of [{user:{id:'other'}},{channelId:'other'}])await f.controller.handle({...f.click('security-run',s),...mutation});s.expires=0;await f.controller.handle(f.click('security-run',s));f.controller.sessions.create('owner');await f.controller.handle(f.click('security-run',s));assert.equal(calls,0);
});
test('results are suppressed after revoked access or expiry during lookup and during final permission check',async()=>{
  for(const kind of ['revoke','expire','replace','expire-in-access']){
    let allowed=true,after=false;const f=uiFixture({access:async()=>{if(after&&kind==='expire-in-access')session.expires=0;return allowed;},scan:{snapshot:()=>null,async run(){after=true;if(kind==='revoke')allowed=false;if(kind==='expire')session.expires=0;if(kind==='replace')f.controller.sessions.create('owner');return {status:'failed',code:'LOCK_UNAVAILABLE',version:'PRIVATE_SCAN_RESULT',checkedAt:1};}}});const {s:session}=await f.open();const i=f.click('security-run',session);await f.controller.handle(i);assert.ok(!JSON.stringify(i.result).includes('PRIVATE_SCAN_RESULT'));assert.equal(session.security,null);
  }
});
test('busy diagnostics reject duplicate runs without cancelling the authorized first result',async()=>{
  let finish,calls=0;const f=uiFixture({scan:{snapshot:()=>null,async run(){calls++;await new Promise(resolve=>finish=resolve);return {status:'failed',code:'LOOKUP_UNAVAILABLE',checkedAt:1};}}}),{s}=await f.open(),i=f.click('security-run',s),run=f.controller.handle(i);await wait();const second=f.click('security-run',s);await f.controller.handle(second);assert.equal(calls,1);assert.ok(JSON.stringify(second.result).includes('処理中'));finish();await run;assert.equal(s.security.status,'failed');assert.equal(s.busy,false);
});
test('security reports paginate within Discord limits, keep mentions disabled and link only to fixed advisory URLs',()=>{
  const pkg={name:'@scope/'+'a'.repeat(200),version:'1.0.0-'+'a'.repeat(80),dev:false,direct:false},finding={id:'GHSA-'+'a'.repeat(110),severity:'high',packages:Array(5).fill(pkg),fixed:[{name:pkg.name,version:pkg.version},{name:pkg.name,version:pkg.version}],detail:true};
  const d={status:'complete',checkedAt:1,version:'4.5.0',lockHash:'a'.repeat(64),packageCount:1000,runtimeCount:999,devCount:1,skipped:3,detailMissing:980,findings:Array.from({length:1000},()=>finding)};
  for(const page of [0,333,999]){const s={id:'test',security:d,page},p=securityScreen(s),out=JSON.stringify(p);assert.ok(p.embeds[0].toJSON().description.length<=4096);assert.ok(p.components.length<=5);for(const r of p.components)assert.ok(r.toJSON().components.length<=5);assert.deepEqual(p.allowedMentions,{parse:[]});assert.ok(!out.includes('SECRET'));assert.ok(out.includes('osv.dev/vulnerability/'));assert.equal(s.page,Math.min(page,333));}
  const empty=securityScreen({id:'test',security:{...d,findings:[],skipped:0,detailMissing:0}});assert.ok(JSON.stringify(empty).includes('見つかりませんでした'));const failed=securityScreen({id:'test',security:{status:'failed',checkedAt:1,code:'LOOKUP_TIMEOUT'}});assert.ok(JSON.stringify(failed).includes('該当なしとは判定していません'));
  const ops=adminScreen({id:'test',view:'category-operations'},config);assert.ok(ops.components.length<=5);assert.ok(JSON.stringify(ops).includes('open-security'));
});
test('default authorization fetches current admin and channel visibility rather than trusting interaction permissions',async()=>{
  let scans=0,visible=false;const calls=[],c=createAdminController({settings:{get:()=>config},securityScan:{snapshot(){scans++;return null;}},guild:{members:{fetch:async o=>{calls.push(o);return {permissions:{has:p=>p===P.Administrator}};}},channels:{fetch:async(id,o)=>{calls.push({id,...o});return {permissionsFor:()=>({has:()=>visible})};}}}});
  const f=uiFixture(),i=f.click();i.customId='admin:open-feature:open-security';await c.handle(i);assert.equal(scans,0);visible=true;  const valid=f.click();valid.customId='admin:open-feature:open-security';await c.handle(valid);assert.equal(scans,1);assert.ok(calls.every(o=>o.force===true));
});

test('oversized detail responses remain unconfirmed without discarding the known advisory',async()=>{
  const d=await createSecurityScan({read:async()=>lock(),fetcher:async url=>url.endsWith('querybatch')?response(matches):new Response(Buffer.alloc(65537))}).run();assert.equal(d.status,'complete');assert.equal(d.findings.length,1);assert.equal(d.detailMissing,1);assert.equal(d.findings[0].severity,'unknown');
});
test('the report page controls navigate the existing result without re-querying or starting updates',async()=>{
  let calls=0;const result={status:'complete',checkedAt:1,version:'4.5.0',lockHash:'a'.repeat(64),packageCount:2,runtimeCount:1,devCount:1,skipped:0,detailMissing:4,findings:Array.from({length:4},(_,n)=>({id:`CVE-2026-123${n}`,packages:[{name:'example',version:'1.0.0',dev:false,direct:true}],fixed:[],detail:false,severity:'unknown'}))};
  const f=uiFixture({scan:{snapshot:()=>null,async run(){calls++;return result;}}}),{s}=await f.open();await f.controller.handle(f.click('security-run',s));await f.controller.handle(f.click('security-next',s));assert.equal(s.page,1);await f.controller.handle(f.click('security-next',s));assert.equal(s.page,1);await f.controller.handle(f.click('security-prev',s));assert.equal(s.page,0);assert.equal(calls,1);
});
