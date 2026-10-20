export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function readDevice(manifest,id,get,previous) {
  if(previous?.revision===manifest.revision)return{...previous,name:manifest.name||previous.name};
  const dailyStats={};
  for(const [date,spec]of Object.entries(manifest.days||{})){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('云端日期格式无效');
    if(previous?.manifest?.days?.[date]?.hash===spec.hash){dailyStats[date]=previous.dailyStats[date];continue;}
    if(!Number.isSafeInteger(spec.count)||spec.count<1||spec.count>256||!/^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(spec.hash))throw Error('云端分块清单无效');
    const parts=await Promise.all(Array.from({length:spec.count},(_,i)=>get('day-'+date+'-'+spec.hash+'-'+i)));
    if(parts.some(p=>typeof p!=='string'))throw Error('云端数据尚未完整同步，请稍后刷新。');
    const data=JSON.parse(parts.join(''));
    if((await digest(data)).slice(0,spec.hash.length)!==spec.hash)throw Error('云端数据校验失败，请稍后刷新。');
    dailyStats[date]=data;
  }
  return{name:manifest.name||id,revision:manifest.revision,manifest,dailyStats,reports:[]};
}
