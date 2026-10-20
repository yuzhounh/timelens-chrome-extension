import {test} from 'node:test';
import assert from 'node:assert/strict';
import {digest,readDevice} from '../site/app/data.mjs';
test('chunk reads preserve hourly statistics and reject corrupt or incomplete payloads',async()=>{
 const day={'example.com':{durationMs:3600000,visits:3,hourlyMs:Array(24).fill(150000),title:'测试🙂'}};
 const text=JSON.stringify(day),hash=(await digest(day)).slice(0,32),manifest={name:'Laptop',revision:'r1',days:{'2026-10-20':{hash,count:2}}};
 const half=Math.floor(text.length/2),parts=[text.slice(0,half),text.slice(half)];
 const result=await readDevice(manifest,'device',async key=>parts[Number(key.split('-').at(-1))]);
 assert.deepEqual(result.dailyStats['2026-10-20'],day);
 await assert.rejects(readDevice(manifest,'device',async()=>undefined),/未完整/);
 await assert.rejects(readDevice({...manifest,days:{'2026-10-20':{hash,count:1}}},'device',async()=>'{}'),/校验失败/);
});

test('range navigation reads only requested days and reuses partial caches with the same revision',async()=>{
 const days={'2026-09-30':{'old.test':{durationMs:1}},'2026-10-19':{'yesterday.test':{durationMs:2}},'2026-10-20':{'today.test':{durationMs:3}},'2026-10-21':{'future.test':{durationMs:4}}};
 const manifest={revision:'same',days:{}},parts=new Map(),reads=[];
 for(const[date,data]of Object.entries(days)){const hash=(await digest(data)).slice(0,32);manifest.days[date]={hash,count:1};parts.set('day-'+date+'-'+hash+'-0',JSON.stringify(data));}
 const get=async key=>{reads.push(key);return parts.get(key);};
 let cache=await readDevice(manifest,'d',get,null,{start:'2026-10-20',end:'2026-10-20'});
 assert.deepEqual(Object.keys(cache.dailyStats),['2026-10-20']);assert.equal(reads.length,1);
 cache=await readDevice(manifest,'d',get,cache,{start:'2026-10-19',end:'2026-10-20'});
 assert.deepEqual(Object.keys(cache.dailyStats).sort(),['2026-10-19','2026-10-20']);assert.equal(reads.length,2);
 await readDevice(manifest,'d',get,cache,{start:'2026-10-20',end:'2026-10-20'});assert.equal(reads.length,2);
 cache=await readDevice(manifest,'d',get,cache,{start:null,end:'2026-10-20'});
 assert.equal(reads.length,3);assert.ok(cache.dailyStats['2026-09-30']);assert.ok(!cache.dailyStats['2026-10-21']);
 const updated={'today.test':{durationMs:8}},hash=(await digest(updated)).slice(0,32);
 const next={revision:'changed',days:{...manifest.days,'2026-10-20':{hash,count:1}}};parts.set('day-2026-10-20-'+hash+'-0',JSON.stringify(updated));
 cache=await readDevice(next,'d',get,cache,{start:'2026-10-20',end:'2026-10-20'});
 assert.equal(reads.length,4);assert.deepEqual(cache.dailyStats['2026-10-20'],updated);
 delete next.days['2026-10-19'];
 cache=await readDevice(next,'d',get,cache,{start:'2026-10-20',end:'2026-10-20'});
 assert.ok(!cache.dailyStats['2026-10-19']);
});
