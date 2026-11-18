import {fromURL,resolveState,toURL,aggregate,jstDay} from './model.mjs';
const $=id=>document.getElementById(id),names={ryukyu_status:'琉球の地位・帰属',japan_militarism:'日本の軍国主義',taiwan_japan:'台湾と日本',historical_order:'歴史認識・戦後秩序',china_threat_narrative:'中国脅威論'};
const labels={continuous:'継続収集対象',hold:'取得停止・保留',trial_only:'単発試験のみ',stopped:'継続設定あり・停止中',unverified:'稼働未確認'};
const fmt=n=>n===null||n===undefined?'未確認':Number(n).toLocaleString('ja-JP'),pct=n=>n===null?'未確認':n.toFixed(1)+'%';
const date=s=>s?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'medium'}).format(new Date(s)):'不明';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function table(target,heads,rows){const t=el('table'),thead=el('thead'),tr=el('tr');for(const h of heads)tr.append(el('th',h));thead.append(tr);t.append(thead);const body=el('tbody');for(const row of rows){const tr=el('tr');for(const value of row)tr.append(el('td',String(value)));body.append(tr);}t.append(body);$(target).replaceChildren(t);}
function chart(rows, metric) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 1100 290');
  const key = metric === 'articles' ? 'matched' : 'occurrences';
  const maximum = Math.max(1, ...rows.map(row => row[key]));
  const ticks = Math.min(4, maximum);
  const step = Math.ceil(maximum / ticks);
  const xAt = i => 80 + i * 990 / Math.max(1, rows.length - 1);
  const yAt = value => 240 - 208 * value / (ticks * step);
  function node(tag, attrs, text) {
    const n = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
    if (text !== undefined) n.textContent = text;
    svg.append(n);
    return n;
  }
  for (let i = 0; i <= ticks; i++) {
    const y = yAt(i * step);
    node('line', {x1:80, y1:y, x2:1070, y2:y, stroke:'#d8dfd7'});
    node('text', {x:4, y:y+4}, fmt(i * step));
  }
  let segment = [];
  function flush() {
    if (segment.length > 1) node('polyline', {
      points:segment.join(' '), fill:'none', stroke:'#006b59', 'stroke-width':3,
    });
    segment = [];
  }
  rows.forEach((row, index) => {
    if (['no_run','failed'].includes(row.collectionState)) flush();
    else segment.push(`${xAt(index)},${yAt(row[key])}`);
  });
  flush();
  const dateIndices = new Set(Array.from({length:5}, (_, i) => Math.round(i * (rows.length - 1) / 4)));
  rows.forEach((row, index) => {
    const x = xAt(index);
    if (dateIndices.has(index)) {
      const first = index === 0, last = index === rows.length - 1;
      node('text', {x, y:275, class:first || last ? 'end-date' : 'intermediate-date',
        'text-anchor':first ? 'start' : last ? 'end' : 'middle'}, row.date);
    }
    if (['no_run','failed'].includes(row.collectionState)) return;
    const circle = node('circle', {cx:x, cy:yAt(row[key]), r:rows.length > 100 ? 2 : 4, fill:'#006b59'});
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${row.date}: ${row[key]}`;
    circle.append(title);
  });
  $('chart').replaceChildren(svg);
}
function comparison(target, items, label) {
  const metric = state.metric === 'articles' ? 'matched' : 'occurrences';
  const maximum = Math.max(1, ...items.map(row => row[metric]));
  const ns = 'http://www.w3.org/2000/svg';
  $(target).replaceChildren(...items.map(row => {
    const entry = el('div', undefined, 'rank-row');
    const bar = document.createElementNS(ns, 'svg');
    bar.setAttribute('viewBox', '0 0 100 8');
    bar.setAttribute('preserveAspectRatio', 'none');
    bar.setAttribute('aria-hidden', 'true');
    const fill = document.createElementNS(ns, 'rect');
    fill.setAttribute('width', 100 * row[metric] / maximum);
    fill.setAttribute('height', 8);
    bar.append(fill);
    entry.append(el('span', label(row)), el('small', `${fmt(row.matched)}記事 / ${fmt(row.occurrences)}回`), bar);
    return entry;
  }));
}

const articlePageSize = 10;
let dataset, state, articles, articlePage;
function renderArticles() {
  const offset = articlePage * articlePageSize;
  const end = Math.min(offset + articlePageSize, articles.length);
  $('article-count').textContent = articles.length ? `${fmt(offset + 1)}–${fmt(end)}件 / 全${fmt(articles.length)}件` : '0件';
  $('article-pages').hidden = articles.length <= articlePageSize;
  $('previous').disabled = articlePage === 0;
  $('next').disabled = end === articles.length;
  $('articles').replaceChildren(...(articles.length ? articles.slice(offset, end).map(a=>{
const n=el('article',undefined,'article'),site=dataset.sites.find(s=>s.id===a.site);n.append(el('small',site?.label||a.site));const h=el('h3'),link=el('a',a.title);const url=new URL(a.url);if(['http:','https:'].includes(url.protocol)){link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';}h.append(link);n.append(h);
const ids=[...new Set(a.matches.map(m=>m.term_id))];for(const tid of ids)n.append(el('span',dataset.terms.find(t=>t.id===tid).phrase,'tag'));
const places=[...new Set(a.matches.flatMap(m=>m.places))].map(p=>({'listing:title':'一覧タイトル','listing:summary':'一覧概要','page:title':'記事タイトル','page:summary':'記事概要','page:body':'本文','rss:title':'RSSタイトル','rss:summary':'RSS概要','legacy:title':'タイトル（経路未確認）','legacy:summary':'概要（経路未確認）','legacy:body':'本文（経路未確認）'}[p]||p));n.append(el('p','一致箇所: '+places.join('、')),
el('p',`記載公開日時: ${date(a.published_at)}${a.publication_timezone_assumed?'（タイムゾーン仮定あり）':''}${!a.published_at&&a.published_raw?' ／保存原文: '+a.published_raw:''}`),el('p','初回観測日時: '+date(a.first_seen_at)));return n;}):[el('p','選択条件に一致する保存済み記事は0件です。未取得本文の一致なしを意味しません。','empty')]));
}
function render(){const result=aggregate(dataset,state);$('error').hidden=true;$('loading').hidden=true;$('content').hidden=false;
for(const k of ['start','end','site','term','topic','grain','metric','axis'])$(k).value=state[k];
for(const b of $('presets').children)b.setAttribute('aria-pressed',String(b.dataset.preset===state.preset));
$('updated').textContent=date(dataset.metadata.generated_at_jst);$('latest').textContent='選択媒体・期間終端までの最新収集成功: '+date(result.latestSuccess);
$('period-note').textContent = `${state.start} 〜 ${state.end}（JST）`;
const selectedLabel = id => $(id).selectedOptions[0].textContent;
$('print-filters').textContent = [
  $('period-note').textContent,
  selectedLabel('site'), selectedLabel('term'), selectedLabel('topic'),
  selectedLabel('axis'), selectedLabel('grain'), selectedLabel('metric'),
].join(' ／ ');
$('axis-note').textContent = state.axis === 'published'
  ? '記載公開日時が分かる保存記事を集計します。'
  : '初回観測日で集計します。遡及収集した記事も発見日に計上されます。';
const monthly = new Map();
for (const row of [...dataset.cohorts, ...dataset.articles]) {
  if (!row.published_day || row.published_day < state.start || row.published_day > state.end
      || (state.site !== 'all' && row.site !== state.site)) continue;
  const key = row.published_day.slice(0, 7) + ' ' + row.site;
  monthly.set(key, (monthly.get(key) || 0) + row.count);
}
const backfill = new Map((dataset.backfill_months || []).map(row => [row.month + ' ' + row.site, row]));
const progressCells = progress => [
  progress?.candidates ?? '—', progress?.pending ?? '—', progress?.extracted ?? '—',
  progress?.forbidden ?? '—',
  progress?.attempted ? pct(100 * progress.extracted / progress.attempted) : '—',
];
const months = [];
for (const month = new Date(state.start.slice(0, 7) + '-01T00:00Z');
     month.toISOString().slice(0,7) <= state.end.slice(0,7);
     month.setUTCMonth(month.getUTCMonth() + 1)) {
  const label = month.toISOString().slice(0,7);
  for (const site of result.sites) {
    const key = label + ' ' + site.id;
    const progress = backfill.get(key);
    months.push([label, site.label, monthly.get(key) ?? '保存未確認',
      ...progressCells(progress)]);
  }
}
for (const row of (dataset.backfill_months || []).filter(row => row.month === null)) {
  if (state.site !== 'all' && row.site !== state.site) continue;
  months.push(['日付不明', result.sites.find(site => site.id === row.site)?.label || row.site,
    '—', ...progressCells(row)]);
}
table('monthly-coverage', ['月（JST）', '媒体', '公開月別の保存記事', '遡及候補', '未処理・再試行', '本文成功', '取得禁止', '本文成功率'], months);
const s = result.summary;
const activeSites = result.sites.filter(site => site.latestPeriodSuccess && jstDay(new Date(site.latestPeriodSuccess)) >= state.start);
$('metrics').replaceChildren(...[
  ['一致記事数', s.matched], ['出現回数', s.occurrences], ['観測記事数', s.observed],
  ['本文未判定数', s.unjudged], ['収集成功媒体数', activeSites.length],
].map(([label, n]) => {
  const box = el('div', undefined, 'metric');
  box.append(el('span', label), el('strong', fmt(n)));
  return box;
}));
$('scope').textContent=`${dataset.metadata.state_definition} ${state.term!=='all'||state.topic!=='all'?'語句・テーマ指定中の観測母数は、その条件で一致が確認できた記事に限定します。':''} 公開日時不明: ${fmt(result.unknownPublication)}記事（選択媒体・語句条件、期間には帰属できません）。HTTP取得成功率 ${pct(s.httpRate)} ／ 抽出成功率 ${pct(s.extractRate)} ／ 累積取得試行 ${fmt(s.attempts)}件。本文対象外 ${fmt(s.bodyNA)}記事。`;
$('chart-label').textContent=(state.metric==='articles'?'一致記事数':'出現回数')+' · '+({day:'日別',week:'週別',month:'月別'}[state.grain]);chart(result.series,state.metric);
table('series-table',['JST期間開始','保存観測状態','一致記事数','出現回数'],result.series.map(r=>[r.date,({saved:'保存記事あり',observed_zero:'保存確認・観測0',failed:'収集失敗',no_run:'runなし／欠測未確認'}[r.collectionState]),['no_run','failed'].includes(r.collectionState)?'未確認':fmt(r.matched),['no_run','failed'].includes(r.collectionState)?'未確認':fmt(r.occurrences)]));
table('sites',['媒体','現在の対象状態','初回保存run','期間内収集','観測記事','抽出成功記事','本文未判定','一致記事','出現回数','HTTP成功率','抽出成功率'],result.sites.map(r=>[r.label,labels[r.status]+(r.interval_hours?` / ${r.interval_hours}時間以上`:''),date(r.first_run_at),r.coverage,fmt(r.observed),fmt(r.bodyOK),fmt(r.unjudged),fmt(r.matched),fmt(r.occurrences),pct(r.httpRate),pct(r.extractRate)]));
$('comparison-metric').textContent = state.metric === 'articles' ? '棒の長さ：一致記事数' : '棒の長さ：出現回数';
comparison('site-comparison', result.sites, row => row.label);
comparison('terms', result.terms, row => row.phrase);
comparison('topics', result.topics, row => names[row.topic] || row.topic);
articles = result.articles;
articlePage = 0;
renderArticles();
$('limits').replaceChildren(...[dataset.metadata.time_definition,dataset.metadata.occurrence_definition,...dataset.metadata.limitations].map(s=>el('li',s)));$('version').textContent=dataset.metadata.dictionary_version;$('dictionary').textContent=dataset.terms.map(t=>t.phrase).join(' ／ ');
history.replaceState(null,'',toURL(state));
$('print-url').textContent = new URL(toURL({...state, preset:'custom'}), location.href).href;
}
function apply(input){try{state=resolveState(input,dataset);render();}catch(e){$('error').hidden=false;$('error').textContent=e.message;}}
export async function start(){try{const response=await fetch(new URL('./data.json',import.meta.url),{cache:'no-cache'});if(!response.ok)throw Error('公開データの読込に失敗しました。');dataset=await response.json();if(dataset.metadata.schema_version!==1)throw Error('未対応のデータ形式です。');
for(const [id,rows] of [['site',dataset.sites.map(s=>[s.id,s.label])],['term',dataset.terms.map(t=>[String(t.id),t.phrase])],['topic',[...new Set(dataset.terms.map(t=>t.topic))].map(t=>[t,names[t]||t])]])for(const [value,label] of rows){const o=el('option',label);o.value=value;$(id).append(o);}
for(const [value,label] of [['7','直近7日'],['30','直近30日'],['90','直近90日'],['6mo','直近6か月'],['365','直近1年間'],['all','全期間'],['custom','任意期間']]){const b=el('button',label);b.type='button';b.dataset.preset=value;b.addEventListener('click', () => {
  if (value === 'custom') $('start').closest('details').open = true;
  apply({...state, preset:value, grain:undefined});
});$('presets').append(b);}
$('filters').addEventListener('submit',event=>{event.preventDefault();apply({...state,...Object.fromEntries(['start','end','site','term','topic','grain','metric','axis'].map(k=>[k,$(k).value]))});});
for(const id of ['start','end'])$(id).addEventListener('change',()=>apply({...state,preset:'custom',start:$('start').value,end:$('end').value,grain:undefined}));
for(const id of ['site','term','topic','grain','metric','axis'])$(id).addEventListener('change',()=>apply({...state,[id]:$(id).value}));
$('previous').addEventListener('click', () => { articlePage--; renderArticles(); });
$('next').addEventListener('click', () => { articlePage++; renderArticles(); });
$('fixed-link').addEventListener('click',()=>apply({...state,preset:'custom'}));window.addEventListener('popstate',()=>{try{apply(fromURL(location.search,dataset));}catch(e){$('error').hidden=false;$('error').textContent=e.message;}});
try{state=fromURL(location.search,dataset);}catch(e){state=resolveState({},dataset);render();$('error').hidden=false;$('error').textContent='URLの条件が不正なため初期表示に戻しました。 '+e.message;return;}render();
}catch(e){$('loading').textContent='データを表示できません。';$('error').hidden=false;$('error').textContent=e.message;}}
window.addEventListener('beforeprint', () => {
  $('printed-at').textContent = '印刷日時（JST） ' + date(new Date());
});
start();
