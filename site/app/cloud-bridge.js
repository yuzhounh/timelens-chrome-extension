'use strict';
(() => {
  const listeners=new Set(),dataModule=import('./data.mjs');
  const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
  let owner='',generation=0,queue=Promise.resolve(),registryAt=0,manifests=[];
  let activeRange={start:today(),end:today()};
  const loadedAt=new Map(),requests=new Map();
  let stored={dailyStats:{},reports:[],settings:{uiLocale:'zh-CN'},cloudCache:{},cloudDevices:[],viewScope:'all',deviceId:'cloud-view'};
  const emit=changes=>{for(const cb of listeners)cb(changes,'local');};
  const local={async get(keys){await CloudAuth.ready;return keys===null?{...stored}:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,stored[k]]));},
    async set(values){const changes={};for(const[k,v]of Object.entries(values)){changes[k]={oldValue:stored[k],newValue:v};stored[k]=v;if(k==='viewScope'&&CloudAuth.user)localStorage.setItem('time-lens-web-scope-'+CloudAuth.user.uid,v);}emit(changes);}};
  async function refresh(force=false,range=activeRange){
    await CloudAuth.ready;const user=CloudAuth.requireUser();
    range={start:range.start||null,end:range.end};
    if((range.start&&!/^\d{4}-\d{2}-\d{2}$/.test(range.start))||!/^\d{4}-\d{2}-\d{2}$/.test(range.end)||range.start>range.end)throw Error('日期范围无效');
    const uid=user.uid,epoch=generation,key=JSON.stringify([uid,range.start,range.end]);
    if(requests.has(key))return requests.get(key);
    if(!force&&Date.now()-(loadedAt.get(key)||0)<60000)return{ok:true};
    const checkOwner=()=>{if(CloudAuth.user?.uid!==uid||generation!==epoch)throw Error('账户已切换，请重新加载。');};
    const pending=queue.catch(()=>{}).then(async()=>{
      checkOwner();
      const notice=document.getElementById('cloud-read-status');if(notice)notice.textContent='正在读取云端记录…';const failure=document.getElementById('cloud-read-error');if(failure)failure.hidden=true;
      await local.set({cloudStatus:{state:'syncing'}});
      if(force||Date.now()-registryAt>=60000){
        const docs=await CloudAuth.collection('users/'+uid+'/devices'),next=[];
        for(const doc of docs){const id=doc.name.split('/').at(-1),base='users/'+uid+'/devices/'+id+'/chunks/',manifest=JSON.parse(doc.fields.payload.stringValue);
          const nameDoc=await CloudAuth.firestore(base+'device-name',{optional:true});
          next.push({id,base,manifest,name:nameDoc?JSON.parse(nameDoc.fields.payload.stringValue).name:manifest.name});
        }
        checkOwner();manifests=next;registryAt=Date.now();loadedAt.clear();
      }
      const cache={},registry=[],{readDevice}=await dataModule;
      for(const {id,base,manifest,name}of manifests){
        checkOwner();
        const result=await readDevice(manifest,id,async key=>{checkOwner();return(await CloudAuth.firestore(base+key,{optional:true}))?.fields?.payload?.stringValue;},stored.cloudCache[id],range);
        result.name=name||result.name;cache[id]=result;registry.push({id,name:result.name});
      }
      checkOwner();
      stored.settings={...stored.settings,uiLocale:localStorage.getItem('time-lens-web-locale-'+uid)||'zh-CN'};
      await local.set({cloudCache:cache,cloudDevices:registry,cloudAuth:{uid,email:user.email,displayName:user.displayName,photoURL:user.photoURL},cloudStatus:{state:'synced',lastSyncAt:Date.now()}});
      loadedAt.set(key,Date.now());if(notice)notice.textContent=registry.length?'云端记录已更新':'当前账号尚无扩展同步记录';return{ok:true};
    }).catch(async error=>{if(CloudAuth.user?.uid===uid&&generation===epoch){const notice=document.getElementById('cloud-read-status');if(notice)notice.textContent=error.message;const failure=document.getElementById('cloud-read-error');if(failure){failure.textContent=error.message;failure.hidden=false;}await local.set({cloudStatus:{state:'error',error:error.message}});}throw error;});
    requests.set(key,pending);queue=pending;
    try{return await pending;}finally{if(requests.get(key)===pending)requests.delete(key);}
  }
  async function dispatch(message){
    if(message.type==='get-summary'){if(message.range)activeRange={...message.range};return refresh(false);}
    if(message.type==='cloud-sync-now')return refresh(true);
    if(message.type==='cloud-sign-in'){await CloudAuth.login();return refresh(true);}
    if(message.type==='cloud-sign-out'){await CloudAuth.logout();return{ok:true};}
    if(message.type==='save-settings'){const settings={...stored.settings,uiLocale:message.settings.uiLocale||'zh-CN'};localStorage.setItem('time-lens-web-locale-'+CloudAuth.requireUser().uid,settings.uiLocale);await local.set({settings});return{ok:true,settings};}
    throw Error('请在 Time Lens 扩展中管理设备名称、采集规则和原始数据。');
  }
  window.chrome={...(window.chrome||{}),storage:{local,onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}},
    i18n:{getUILanguage:()=>navigator.language,getMessage:()=>''},
    runtime:{getURL:path=>new URL(path,location.href).href,getManifest:()=>({version:'网页查看版'}),
      sendMessage(message,callback){dispatch(message).then(result=>callback(result)).catch(error=>callback({ok:false,error:error.message}));}}};
  CloudAuth.onUser(user=>{if(owner!==(user?.uid||'')){owner=user?.uid||'';generation++;loadedAt.clear();requests.clear();queue=Promise.resolve();manifests=[];registryAt=0;activeRange={start:today(),end:today()};stored={dailyStats:{},reports:[],settings:{uiLocale:'zh-CN'},cloudCache:{},cloudDevices:[],viewScope:'all',deviceId:'cloud-view'};if(user)stored.viewScope=localStorage.getItem('time-lens-web-scope-'+user.uid)||'all';}if(user){stored.cloudAuth={uid:user.uid,email:user.email,displayName:user.displayName,photoURL:user.photoURL};emit({cloudAuth:{newValue:stored.cloudAuth}});void refresh().then(()=>window.loadState?.()).catch(()=>{});}});
  setInterval(()=>{if(!document.hidden&&CloudAuth.user)void refresh(true).catch(()=>{});},120000);
})();
