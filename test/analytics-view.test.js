const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
require('../lib.js');require('../analytics.js');
const source=fs.readFileSync(path.join(__dirname,'../dashboard.js'),'utf8');
const stats={'2026-06-30':{'example.com':{durationMs:3600000,visits:2}},'2026-07-01':{'example.com':{durationMs:7200000,visits:1}}};
for(const locale of ['zh-CN','en']){
  const messages=JSON.parse(fs.readFileSync(path.join(__dirname,`../_locales/${locale==='en'?'en':'zh_CN'}/messages.json`),'utf8'));
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,innerHTML:'',textContent:'',events:{},addEventListener(key,fn){this.events[key]=fn;},setAttribute(){},focus(){}});return nodes.get(id);};
  const context=vm.createContext({self:{TimeLensAnalytics:global.TimeLensAnalytics},Core:global.TimeLensCore,
    I18n:{localeTag:()=>locale,t:(key,...args)=>{assert.ok(messages[key],`Missing translation: ${key}`);return messages[key].message.replace(/\$(\d+)/g,(_,i)=>args[+i-1]??'');}},
    document:{getElementById:get},appState:{dailyStats:stats,periodType:'yearly'},Date,
    displayDuration:ms=>Math.round(ms/60000)+'m',escapeHtml:s=>String(s).replaceAll('<','&lt;')});
  vm.runInContext(source.slice(source.indexOf("let patternMode = ''"),source.indexOf('function durationLines(')),context);
  const range={start:'2026-01-01',end:'2026-10-19'};
  context.resolvePeriod=()=>range;context.appState.summary=global.TimeLensCore.aggregate(stats,range.start,range.end);
  context.renderPatterns(range,context.appState.summary);
  assert.equal(get('usagePatterns').hidden,false);
  assert.match(get('patternTabs').innerHTML,/data-pattern-kind="academic"/);
  get('patternTabs').events.click({target:{closest:()=>({dataset:{patternKind:'academic'}})}});
  assert.doesNotMatch(get('patternContent').innerHTML,/xynu|信阳|Official calendars/);
  assert.match(get('patternContent').innerHTML,/2 月|February/);
  if(locale==='en')assert.ok(!/[\u4e00-\u9fff]/.test(get('patternContent').innerHTML));
  get('patternTabs').events.click({target:{closest:()=>({dataset:{patternKind:'sites'}})}});
  assert.match(get('patternContent').innerHTML,/example.com/);
  const texts=[],bars=[];
  const ctx={clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},setLineDash(){},fillText:(text)=>texts.push(text),fillRect:(...args)=>bars.push(args)};
  Object.assign(context,{setupCanvas:()=>({ctx,width:900,height:300}),trend:{hoverIndex:null},appState:{periodType:'weekly'}});
  vm.runInContext(source.slice(source.indexOf('function drawTrend(canvas, days)'),source.indexOf('function drawTrendMarker(')),context);
  const week=global.TimeLensAnalytics.timeline({'2026-10-19':{'example.com':{durationMs:60000,visits:1}}},'2026-10-19','2026-10-25','2026-10-19','weekly');
  context.drawTrend({},week);
  assert.equal(bars.length,1);assert.equal(texts.filter(text=>/10\//.test(text)).length,7);
  assert.equal(context.trend.layout.count,7);
}
console.log('analytics-view.test.js: bilingual analysis tabs and seven calendar positions with future days passed');
