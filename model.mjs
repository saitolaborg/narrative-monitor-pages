// Pure JST aggregation and URL state, shared by UI and node:test. No dependencies.
export const presets=['7','30','90','6mo','365','all','custom'];
export const jstDay=(date=new Date())=>new Date(date.getTime()+9*3600000).toISOString().slice(0,10);
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function validDay(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
export function autoGrain(start,end){const days=(Date.parse(end)-Date.parse(start))/86400000+1;return days<=60?'day':days<=180?'week':'month';}
export function resolveState(input,data,now=new Date()){
 const preset=presets.includes(input.preset)?input.preset:'30',today=jstDay(now);
 let start=input.start,end=input.end;
 if(preset==='all'){start=data.metadata.range_start||today;end=data.metadata.range_end>today?data.metadata.range_end:today;}
 else if(preset==='6mo'){
  end=today;
  const d=new Date(today+'T00:00Z'), day=d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth()-6);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(day,last));
  start=d.toISOString().slice(0,10);
 }
 else if(preset!=='custom'){end=today;start=addDays(today,1-Number(preset));}
 if(!validDay(start||'')||!validDay(end||''))throw Error('開始日と終了日を正しい日付で指定してください。');
 if(start>end)throw Error('開始日は終了日以前にしてください。');
 const site=data.sites.some(s=>s.id===input.site)?input.site:'all';
 const term=data.terms.some(t=>String(t.id)===input.term)?input.term:'all';
 const topic=data.terms.some(t=>t.topic===input.topic)?input.topic:'all';
 return {preset,start,end,site,term,topic,grain:['day','week','month'].includes(input.grain)?input.grain:autoGrain(start,end),metric:input.metric==='occurrences'?'occurrences':'articles',axis:input.axis==='published'?'published':'first_seen'};
}
export function fromURL(search,data,now){return resolveState(Object.fromEntries(new URLSearchParams(search)),data,now);}
export function toURL(state){return '?'+new URLSearchParams(state).toString();}
export function bucket(day,grain){if(grain==='month')return day.slice(0,7);if(grain==='week'){let n=new Date(day+'T00:00:00Z').getUTCDay();return addDays(day,-((n+6)%7));}return day;}
export function aggregate(data,state){
 const selectedTerms=new Set(data.terms.filter(t=>(state.term==='all'||String(t.id)===state.term)&&(state.topic==='all'||t.topic===state.topic)).map(t=>t.id));
 const filterMatch=state.term!=='all'||state.topic!=='all';
 const matching=(a)=>(a.matches||[]).filter(m=>selectedTerms.has(m.term_id));
 const population=[...data.cohorts,...data.articles].filter(a=>(state.site==='all'||a.site===state.site)&&(!filterMatch||matching(a).length));
 const axis=state.axis==='published'?'published_day':'first_seen_day';
 const unknown=population.filter(a=>!a.published_day).reduce((n,a)=>n+a.count,0);
 const rows=population.filter(a=>a[axis]&&a[axis]>=state.start&&a[axis]<=state.end);
 function counts(items){
  const sum=(test)=>items.filter(test).reduce((n,a)=>n+a.count,0), attempts=items.reduce((n,a)=>n+a.attempts*a.count,0);
  const successes=items.reduce((n,a)=>n+a.success_attempts*a.count,0),known=items.reduce((n,a)=>n+a.http_known_attempts*a.count,0);
  const http=items.reduce((n,a)=>n+a.http_ok_attempts*a.count,0);
  return {observed:sum(()=>true),bodyOK:sum(a=>a.body_ok),unjudged:sum(a=>a.body_applicable&&!a.body_ok),received:sum(a=>a.body_received),
   matched:sum(a=>matching(a).length>0),occurrences:items.reduce((n,a)=>n+matching(a).reduce((x,m)=>x+m.occurrences,0),0),
   attempts,successes,failures:items.reduce((n,a)=>n+a.failure_attempts*a.count,0),httpRate:attempts&&known===attempts?100*http/attempts:null,extractRate:attempts?100*successes/attempts:null,
   checked:sum(a=>a.checked),bodyNA:sum(a=>!a.body_applicable)};
 }
 const time=new Map();
 // Fill zeroes only within the selected range; accompanying run coverage disambiguates missing data.
 for(let day=state.start;day<=state.end;day=addDays(day,1))time.set(bucket(day,state.grain),[]);
 for(const a of rows)time.get(bucket(a[axis],state.grain))?.push(a);
 const selectedRuns=data.sites.filter(s=>state.site==='all'||s.id===state.site).flatMap(s=>s.runs).filter(r=>{const day=jstDay(new Date(r.started_at));return day>=state.start&&day<=state.end;});
 const series=[...time].map(([date,items])=>{const runs=selectedRuns.filter(r=>bucket(jstDay(new Date(r.started_at)),state.grain)===date);
 const collectionState=items.length?'saved':axis==='first_seen_day' && runs.some(r=>r.confirmed&&r.matching_observed)?'observed_zero':runs.some(r=>r.status==='failed')?'failed':'no_run';
 return {date,collectionState,...counts(items)};});
 const sites=data.sites.filter(s=>state.site==='all'||s.id===state.site).map(s=>{
  const items=rows.filter(a=>a.site===s.id),runs=s.runs.filter(r=>jstDay(new Date(r.started_at))>=state.start&&jstDay(new Date(r.started_at))<=state.end);
  const saved=runs.filter(r=>r.confirmed),latest=s.runs.filter(r=>r.confirmed&&r.status==='complete'&&r.finished_at&&jstDay(new Date(r.finished_at))<=state.end).map(r=>r.finished_at).sort().at(-1)||null;
  const observationState=runs.some(r=>r.status==='failed')?'収集失敗あり':runs.length&&!saved.length?'保存未確認':saved.length?(items.length?'保存観測あり':'観測0件（保存確認あり）'):'対象期間のrunなし／欠測未確認';
  return {...s,...counts(items),periodRuns:runs.length,coverage:observationState,latestPeriodSuccess:latest};
 });
 const terms=data.terms.filter(t=>selectedTerms.has(t.id)).map(t=>({...t,...counts(rows.map(a=>({...a,matches:(a.matches||[]).filter(m=>m.term_id===t.id)})))}));
 const topics=[...new Set(data.terms.filter(t=>selectedTerms.has(t.id)).map(t=>t.topic))].map(topic=>{
  const tids=new Set(data.terms.filter(t=>t.topic===topic).map(t=>t.id));
  return {topic,...counts(rows.map(a=>({...a,matches:(a.matches||[]).filter(m=>tids.has(m.term_id)&&selectedTerms.has(m.term_id))})))};
 });
 return {summary:counts(rows),unknownPublication:unknown,series,sites,terms,topics,
  articles:rows.filter(a=>a.matches&&matching(a).length).map(a=>({...a,matches:matching(a)})).sort((a,b)=>b[axis].localeCompare(a[axis])),
  latestSuccess:sites.map(s=>s.latestPeriodSuccess).filter(Boolean).sort().at(-1)||null};
}
