import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as dataModule from '../site/app/data.mjs';

async function client(){
 const key=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const today=key(new Date()),prior=new Date();prior.setDate(prior.getDate()-2);const old=key(prior);
 const days={[old]:{'old.test':{durationMs:100,visits:1}},[today]:{'today.test':{durationMs:200,visits:2}}};
 const manifest={revision:'r1',days:{}},parts=new Map(),reads=[];let metadataReads=0,interval,notify;
 for(const[date,payload]of Object.entries(days)){const hash=(await dataModule.digest(payload)).slice(0,32);manifest.days[date]={hash,count:1};parts.set('day-'+date+'-'+hash+'-0',JSON.stringify(payload));}
 const CloudAuth={ready:Promise.resolve(),user:{uid:'owner'},requireUser(){return this.user;},onUser(fn){notify=fn;},
   collection:async()=>{metadataReads++;return[{name:'users/owner/devices/laptop',fields:{payload:{stringValue:JSON.stringify(manifest)}}}];},
   firestore:async path=>{const chunk=path.split('/').at(-1);if(chunk==='device-name')return null;reads.push(chunk);return{fields:{payload:{stringValue:parts.get(chunk)}}};}};
 const context=vm.createContext({window:{},document:{hidden:false,getElementById(){return null;}},CloudAuth,dataModule,URL,Date,Map,Set,Promise,localStorage:{getItem(){return null;},setItem(){}},navigator:{language:'zh-CN'},setInterval:fn=>{interval=fn;}});
 const source=(await readFile(new URL('../site/app/cloud-bridge.js',import.meta.url),'utf8')).replace("import('./data.mjs')",'Promise.resolve(globalThis.dataModule)');
 vm.runInContext(source,context);
 const send=message=>new Promise((resolve,reject)=>context.window.chrome.runtime.sendMessage(message,r=>r.ok?resolve(r):reject(Error(r.error))));
 return{today,old,reads,send,interval:()=>interval(),notify:()=>notify(CloudAuth.user),state:()=>context.window.chrome.storage.local.get(null),metadataReads:()=>metadataReads};
}

test('online startup defaults to today; concurrent range switches and refresh fetch only missing or changed chunks',async()=>{
 const c=await client();c.notify();await c.send({type:'get-summary'});
 assert.equal(c.reads.length,1);assert.ok(c.reads[0].startsWith('day-'+c.today+'-'));
 // A new range must not get swallowed by the in-flight request for a different range.
 await Promise.all([c.send({type:'cloud-sync-now'}),c.send({type:'get-summary',range:{start:c.old,end:c.today}})]);
 assert.equal(c.reads.length,2);assert.ok(c.reads[1].startsWith('day-'+c.old+'-'));
 await c.send({type:'get-summary',range:{start:c.today,end:c.today}});assert.equal(c.reads.length,2);
 const metadata=c.metadataReads();
 await c.send({type:'get-summary',range:{start:c.old,end:c.old}});assert.equal(c.metadataReads(),metadata);
 c.interval();await c.send({type:'cloud-sync-now'});assert.equal(c.reads.length,2);
 assert.deepEqual(Object.keys((await c.state()).cloudCache.laptop.dailyStats).sort(),[c.old,c.today]);
});

test('all-time is explicit and malformed ranges do not perform reads',async()=>{
 const c=await client();await c.send({type:'get-summary'});assert.equal(c.reads.length,1);
 await assert.rejects(c.send({type:'get-summary',range:{start:'wrong',end:c.today}}),/日期范围/);
 assert.equal(c.reads.length,1);
 await c.send({type:'get-summary',range:{start:null,end:c.today}});assert.equal(c.reads.length,2);
});

test('website period controls request their date range, including navigation and chart drill-down',async()=>{
 const source=await readFile(new URL('../site/app/dashboard.js',import.meta.url),'utf8'),messages=[],nodes=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',events:{},addEventListener(type,fn){this.events[type]=fn;}});return nodes.get(id);};
 const context=vm.createContext({self:{},Date,document:{getElementById:get},sendMessage:async message=>{messages.push(message);return{ok:true};},refreshDataView:async()=>{},I18n:{errorMessage:String},showToast:message=>{throw Error(message);},trend:{days:[{date:'2026-09-01'}]}});
 vm.runInContext(await readFile(new URL('../site/app/lib.js',import.meta.url),'utf8'),context);context.Core=context.self.TimeLensCore;
 vm.runInContext(source.slice(source.indexOf('let appState ='),source.indexOf('function sendMessage(')),context);
 vm.runInContext(source.slice(source.indexOf('function resolvePeriod()'),source.indexOf('function topSlices(')),context);
 vm.runInContext(source.slice(source.indexOf('function requestedRange()'),source.indexOf('async function loadState()')),context);
 const controlsStart=source.indexOf('function shiftPeriod('),drillStart=source.indexOf('function openTrendBucket(');
 vm.runInContext(source.slice(controlsStart,source.indexOf('document.getElementById("siteSearch")',controlsStart)),context);
 vm.runInContext(source.slice(drillStart,source.indexOf("document.getElementById('trendChart').addEventListener",drillStart)),context);
 const today=context.Core.dateKey(new Date());await context.loadPeriod();assert.equal(messages.at(-1).range.start,today);assert.equal(messages.at(-1).range.end,today);
 get('periodAnchor').events.change({target:{value:'2026-09-10'}});assert.equal(messages.at(-1).range.start,'2026-09-10');
 get('previousPeriod').events.click();assert.equal(messages.at(-1).range.start,'2026-09-09');
 get('nextPeriod').events.click();assert.equal(messages.at(-1).range.start,'2026-09-10');
 get('periodType').events.change({target:{value:'monthly'}});assert.equal(messages.at(-1).range.start,'2026-09-01');assert.equal(messages.at(-1).range.end,'2026-09-30');
 get('periodType').events.change({target:{value:'all'}});assert.equal(messages.at(-1).range.start,null);
 context.openTrendBucket(0);assert.equal(messages.at(-1).range.start,'2026-09-01');assert.equal(messages.at(-1).range.end,'2026-09-01');
 get('resetPeriod').events.click();assert.equal(messages.at(-1).range.start,today);
 await new Promise(setImmediate);
});
