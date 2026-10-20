import {test} from 'node:test';
import assert from 'node:assert/strict';
import {digest,readDevice} from '../site/app/data.mjs';
test('chunk reads preserve hourly statistics and reject corrupt or incomplete payloads',async()=>{
 const day={'example.com':{durationMs:3600000,visits:3,hourlyMs:Array(24).fill(150000),title:'测试🙂'}};
 const text=JSON.stringify(day),hash=await digest(day),manifest={name:'Laptop',revision:'r1',days:{'2026-10-20':{hash,count:2}}};
 const half=Math.floor(text.length/2),parts=[text.slice(0,half),text.slice(half)];
 const result=await readDevice(manifest,'device',async key=>parts[Number(key.split('-').at(-1))]);
 assert.deepEqual(result.dailyStats['2026-10-20'],day);
 await assert.rejects(readDevice(manifest,'device',async()=>undefined),/未完整/);
 await assert.rejects(readDevice({...manifest,days:{'2026-10-20':{hash,count:1}}},'device',async()=>'{}'),/校验失败/);
});
