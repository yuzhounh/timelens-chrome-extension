export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function readDevice(manifest,id,get,previous,range=null) {
  // Keep validated days for later navigation, including when the revision is unchanged.
  const dailyStats=Object.fromEntries(Object.entries(previous?.dailyStats||{}).filter(([date])=>{
    const current=manifest.days?.[date],old=previous?.manifest?.days?.[date];
    return current&&current.hash===old?.hash&&current.count===old?.count;
  }));
  for(const [date,spec]of Object.entries(manifest.days||{})){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('云端日期格式无效');
    if(range&&((range.start&&date<range.start)||date>range.end))continue;
    if(Object.hasOwn(dailyStats,date))continue;
    if(!Number.isSafeInteger(spec.count)||spec.count<1||spec.count>256||!/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(spec.hash))throw Error('云端分块清单无效');
    const parts=Array(spec.count);let cursor=0,failed=false;
    await Promise.all(Array.from({length:Math.min(4,spec.count)},async()=>{
      while(!failed&&cursor<spec.count){const i=cursor++;try{parts[i]=await get('day-'+date+'-'+spec.hash+'-'+i);}catch(error){failed=true;throw error;}}
    }));
    if(parts.some(p=>typeof p!=='string'))throw Error('云端数据尚未完整同步，请稍后刷新。');
    const data=JSON.parse(parts.join(''));
    if((await digest(data)).slice(0,spec.hash.length)!==spec.hash)throw Error('云端数据校验失败，请稍后刷新。');
    dailyStats[date]=data;
  }
  return{name:manifest.name||id,revision:manifest.revision,manifest,dailyStats,reports:[]};
}
