(function(root){
  'use strict';
  const Core=root.TimeLensCore;
  // Same verified Tanshan staff reporting / rotation boundaries as SoftTrace; end exclusive.
  const calendar=[['2024-08-29','2025-01-18','autumn'],['2025-01-18','2025-02-13','winter'],
    ['2025-02-13','2025-07-05','spring'],['2025-07-05','2025-08-27','summer'],
    ['2025-08-27','2026-01-17','autumn'],['2026-01-17','2026-02-25','winter'],
    ['2026-02-25','2026-07-10','spring'],['2026-07-10','2026-08-26','summer'],
    ['2026-08-26','2027-01-25','autumn'],['2027-01-25','2027-02-17','winter'],['2027-02-17','2027-07-19','spring']];
  const classify=date=>calendar.find(([start,end])=>date>=start&&date<end)?.[2]||'unknown';
  const monthly=(type,count)=>type==='yearly'||(type==='all'&&count>100);
  function timeline(stats,start,end,today,type,now=new Date()){
    if(type==='daily'&&Object.values(stats[start]||{}).some(site=>Array.isArray(site.hourlyMs))){
      return Array.from({length:24},(_,hour)=>{
        const sites=Object.entries(stats[start]||{}).map(([host,site])=>({host,durationMs:site.hourlyMs?.[hour]||0,visits:0})).filter(site=>site.durationMs>0).sort((a,b)=>b.durationMs-a.durationMs);
        const future=start>today||(start===today&&hour>now.getHours());
        return {date:start,hour,durationMs:sites.reduce((n,s)=>n+s.durationMs,0),visits:0,recordedDays:Number(sites.length>0),future,missing:!future&&!sites.length,sites};
      });
    }
    const dates=Core.enumerateDates(start,end),byMonth=monthly(type,dates.length),groups=new Map();
    for(const date of dates){
      const key=byMonth?date.slice(0,7):date;
      if(!groups.has(key))groups.set(key,{date:key,durationMs:0,visits:0,recordedDays:0,future:date>today,siteMap:new Map()});
      const bucket=groups.get(key);
      if(date>today)continue;
      bucket.future=false;
      const sites=stats[date];
      if(sites&&Object.keys(sites).length)bucket.recordedDays++;
      for(const [host,record] of Object.entries(sites||{})){
        const site=bucket.siteMap.get(host)||{host,durationMs:0,visits:0};
        site.durationMs+=record.durationMs;site.visits+=record.visits;
        bucket.durationMs+=record.durationMs;bucket.visits+=record.visits;bucket.siteMap.set(host,site);
      }
    }
    return [...groups.values()].map(({siteMap,...bucket})=>({...bucket,missing:!bucket.future&&!bucket.recordedDays,
      sites:[...siteMap.values()].sort((a,b)=>b.durationMs-a.durationMs)}));
  }
  function patterns(stats,start,end,type){
    const dates=Core.enumerateDates(start,end),days=dates.filter(date=>Object.keys(stats[date]||{}).length).map(date=>{
      const sites=Object.values(stats[date]),hourly=sites.filter(site=>Array.isArray(site.hourlyMs));
      return {date,durationMs:sites.reduce((n,s)=>n+s.durationMs,0),hourlyMs:Array.from({length:24},(_,h)=>hourly.reduce((n,s)=>n+(s.hourlyMs[h]||0),0)),hasHourly:hourly.length>0};
    });
    const group=matches=>({recordedDays:matches.length,averageMs:matches.length?matches.reduce((n,d)=>n+d.durationMs,0)/matches.length:null});
    const weekdays=Array.from({length:7},(_,index)=>({index,...group(days.filter(d=>(Core.parseDate(d.date).getDay()+6)%7===index))}));
    const academic=['spring','autumn','winter','summer','unknown'].map(kind=>({kind,...group(days.filter(d=>classify(d.date)===kind))}));
    const hourlyDays=days.filter(d=>d.hasHourly);
    const hours=Array.from({length:24},(_,hour)=>({hour,averageMs:hourlyDays.length?hourlyDays.reduce((n,d)=>n+d.hourlyMs[hour],0)/hourlyDays.length:null}));
    const available=[];
    if(dates.length>=2&&days.length>=2){
      if(hourlyDays.length>=2)available.push('hourly');
      if(dates.length>=7&&weekdays.filter(d=>d.recordedDays).length>=2)available.push('weekday');
      if((type==='yearly'||(type==='all'&&dates.length>=365))&&academic.filter(d=>d.kind!=='unknown'&&d.recordedDays).length>=2)available.push('academic');
      available.push('sites');
    }
    return {available,weekdays,academic,hours,hourlyDays:hourlyDays.length,recordedDays:days.length,missingDays:dates.length-days.length};
  }
  root.TimeLensAnalytics={timeline,patterns,classify,monthly};
})(typeof self==='undefined'?globalThis:self);
