const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
for(const file of ['dashboard.js','site/app/dashboard.js'])test(`${file}: hidden changes are bounded and replay as one visible refresh`,async()=>{
 const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const start=source.indexOf('let dataViewRefresh'),end=source.indexOf('function deviceEntries',start);
 const listenerStart=source.indexOf('let deferredStorageChanges'),listenerEnd=source.indexOf('loadState().catch',listenerStart);
 let reads=0,renders=0,listener,visible;
 const context=vm.createContext({periodLoading:false,settingsSaveInFlight:false,appState:{settings:{}},readViewStats:async()=>({}),document:{hidden:true,addEventListener(name,fn){if(name==='visibilitychange')visible=fn;}},chrome:{storage:{local:{get:async()=>{reads++;return{};}},onChanged:{addListener(fn){listener=fn;}}}},self:{TimeLensStats:{read:async()=>({})}},renderDeviceScope(){},applyDataView(){},renderOverview(){renders++;},renderDevices(){},renderCloud(){},renderImportFile(){},renderAppVersion(){},fillSettings(){},I18n:{init:async()=>{},apply(){}}});
 vm.runInContext(source.slice(start,end)+source.slice(listenerStart,listenerEnd),context);
 for(let i=0;i<100;i++)listener({cloudCache:{newValue:{revision:i}},['dailyStats:v2:2026-10-20:'+i]:{newValue:{large:'ignored'}}},'local');
 assert.equal(reads,0);assert.equal(renders,0);
 assert.equal(vm.runInContext('Object.keys(deferredStorageChanges).length',context),1);
 context.document.hidden=false;visible();await new Promise(setImmediate);
 assert.equal(reads,1);assert.equal(renders,1);
});
