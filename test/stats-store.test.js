const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
const clone=value=>value===undefined?undefined:structuredClone(value);
function fixture(legacy={},roundTrip=clone){
 const values={dailyStats:clone(legacy),deviceId:'keep-device',settings:{deviceName:'Keep'},cloudAuth:{uid:'keep-user'},reports:[{id:'keep-report'}]};
 const calls={gets:[],sets:[],digests:[]};let failIndex=false,failCleanup=false,corruptRead=false;
 const local={
  async get(keys){keys=Array.isArray(keys)?keys:[keys];calls.gets.push(keys);const result=Object.fromEntries(keys.map(k=>[k,roundTrip(values[k])]));if(corruptRead)for(const k of keys)if(k.startsWith('dailyStats:v2:'))result[k]={};return result;},
  async set(data){calls.sets.push(clone(data));if(failIndex&&data.dailyStatsIndex)throw Error('fixture index write failed');Object.assign(values,clone(data));},
  async remove(keys){if(failCleanup)throw Error('fixture cleanup failed');for(const k of Array.isArray(keys)?keys:[keys])delete values[k];}
 };
 const context=vm.createContext({chrome:{storage:{local}},TextEncoder,crypto:{subtle:{digest(...args){calls.digests.push(args[1].byteLength);return crypto.subtle.digest(...args);}}}});context.self=context;
 for(const file of ['lib.js','sync-core.js','stats-store.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
 return{values,calls,stats:context.TimeLensStats,setFailIndex:v=>failIndex=v,setFailCleanup:v=>failCleanup=v,setCorruptRead:v=>corruptRead=v,clearCalls(){calls.gets=[];calls.sets=[];calls.digests=[];}};
}
const day=value=>({'example.com':{durationMs:value,visits:2,title:'Example',url:'https://example.com',hourlyMs:Array.from({length:24},(_,h)=>h===9?value:0)}});
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
 ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;

test('migration accepts storage property reordering without changing any history values',async()=>{
 const original={'2026-10-20':{...day(1000),'another.example':{durationMs:500,visits:1,title:'Another',url:'https://another.example'}}};
 const f=fixture(original,ordered);
 await f.stats.initialize();
 assert.deepEqual(clone(await f.stats.read()),original);
 assert.equal(f.values.dailyStats,undefined);
});
test('migration preserves complete normalized history, identity, reports and settings',async()=>{
 const original={'2026-10-20':day(1000),'2026-10-21':day(2000)},f=fixture(original);
 await f.stats.initialize();assert.deepEqual(clone(await f.stats.read()),original);assert.equal(f.values.dailyStats,undefined);
 assert.equal(f.values.deviceId,'keep-device');assert.deepEqual(f.values.reports,[{id:'keep-report'}]);assert.equal(f.values.cloudAuth.uid,'keep-user');assert.equal(f.values.settings.deviceName,'Keep');
});
test('a failed migration verification retains legacy data and can retry',async()=>{
 const original={'2026-10-20':day(1000)},f=fixture(original);f.setCorruptRead(true);
 await assert.rejects(f.stats.initialize(),/verification/);assert.deepEqual(f.values.dailyStats,original);assert.equal(f.values.dailyStatsIndex,undefined);
 f.setCorruptRead(false);await f.stats.initialize();assert.deepEqual(clone(await f.stats.read()),original);
});

test('stored ordering and in-memory ordering yield the same day digest without a redundant write',async()=>{
 const f=fixture({'2026-10-20':day(1000)},ordered);await f.stats.initialize();
 const snapshot=await f.stats.changedSnapshot();
 const spec=snapshot.index.days['2026-10-20'];
 const bytes=new TextEncoder().encode(JSON.stringify(snapshot.dailyStats['2026-10-20']));
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex').slice(0,32);
 assert.equal(hash,spec.hash);
 f.clearCalls();await f.stats.writeDays({'2026-10-20':day(1000)});
 assert.equal(f.calls.sets.length,0);
});

test('an existing v2 index is upgraded without losing its days; failed upgrade leaves it readable',async()=>{
 const original={'2026-10-20':day(1000)},f=fixture(original,ordered);
 const oldHash='a'.repeat(32),oldKey=`dailyStats:v2:2026-10-20:${oldHash}`;
 delete f.values.dailyStats;f.values[oldKey]=clone(original['2026-10-20']);
 f.values.dailyStatsIndex={version:2,generation:7,days:{'2026-10-20':{hash:oldHash,count:1}}};
 f.setFailIndex(true);await assert.rejects(f.stats.initialize(),/index write/);
 assert.equal(f.values.dailyStatsIndex.generation,7);assert.ok(f.values[oldKey]);
 assert.deepEqual(clone(await f.stats.read()),original);
 f.setFailIndex(false);await f.stats.initialize();
 assert.equal(f.values.dailyStatsIndex.hashFormat,'canonical-1');
 assert.deepEqual(clone(await f.stats.read()),original);
 assert.equal(f.values[oldKey],undefined);
});
test('one activity day reads and writes only that day and a small index; cloud reuses all other hashes',async()=>{
 const original={};for(let i=0;i<365;i++){const d=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);original[d]=day(1000+i);}
 const f=fixture(original);await f.stats.initialize();const previous=clone(f.values.dailyStatsIndex.days);f.clearCalls();
 const date='2025-12-31';const selected=await f.stats.read({dates:[date]});selected[date]['example.com'].durationMs+=100;
 await f.stats.writeDays(selected);
 assert.equal(f.calls.digests.length,1);assert.equal(f.calls.gets.flat().filter(k=>k.startsWith('dailyStats:v2:')).length,1);
 assert.equal(f.calls.sets.flatMap(x=>Object.keys(x)).filter(k=>k.startsWith('dailyStats:v2:')).length,1);
 assert.ok(f.calls.sets.every(x=>!Object.hasOwn(x,'dailyStats')));
 assert.ok(Buffer.byteLength(JSON.stringify(f.calls.sets))<Buffer.byteLength(JSON.stringify(original))/2);
 f.clearCalls();const changed=await f.stats.changedSnapshot(previous);assert.deepEqual(Object.keys(changed.dailyStats),[date]);assert.equal(f.calls.digests.length,0);
 f.clearCalls();await f.stats.changedSnapshot(clone(f.values.dailyStatsIndex.days));assert.equal(f.calls.gets.flat().filter(k=>k.startsWith('dailyStats:v2:')).length,0);assert.equal(f.calls.digests.length,0);
});
test('failure before index commit keeps the prior day readable and retry does not double count',async()=>{
 const f=fixture({'2026-10-20':day(1000)});await f.stats.initialize();f.setFailIndex(true);
 await assert.rejects(f.stats.writeDays({'2026-10-20':day(1500)}),/index write/);
 assert.equal((await f.stats.read())['2026-10-20']['example.com'].durationMs,1000);
 f.setFailIndex(false);await f.stats.writeDays({'2026-10-20':day(1500)});
 assert.equal((await f.stats.read())['2026-10-20']['example.com'].durationMs,1500);assert.equal(f.values.dailyStatsPending,undefined);
 assert.equal(Object.keys(f.values).filter(k=>k.startsWith('dailyStats:v2:')).length,1);
});
test('cleanup failure after commit stays successful; replace and clear preserve unrelated data',async()=>{
 const f=fixture({'2026-10-20':day(1000)});await f.stats.initialize();f.setFailCleanup(true);
 await f.stats.writeDays({'2026-10-20':day(1500)});assert.equal((await f.stats.read())['2026-10-20']['example.com'].durationMs,1500);
 f.setFailCleanup(false);await f.stats.replaceAll({'2026-10-21':day(2000)},{reports:[]});
 assert.deepEqual(Object.keys(await f.stats.read()),['2026-10-21']);await f.stats.replaceAll({},{reports:[]});
 assert.deepEqual(Object.keys(await f.stats.read()),[]);assert.equal(f.values.deviceId,'keep-device');assert.equal(f.values.cloudAuth.uid,'keep-user');
});
