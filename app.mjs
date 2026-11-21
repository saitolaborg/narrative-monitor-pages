import {includesRoute,fromURL,resolveState,toURL,aggregate,drillPeriod,articleURL} from './model.mjs';
const $=id=>document.getElementById(id);
const labels={continuous:'継続収集対象',hold:'取得停止・保留',trial_only:'通常の定期設定なし',stopped:'継続設定あり・停止中',unverified:'稼働未確認'};
const fmt=n=>n===null||n===undefined?'未確認':Number(n).toLocaleString('ja-JP'),pct=n=>n===null?'未確認':n.toFixed(1)+'%';
const date=s=>s?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'medium'}).format(new Date(s)):'不明';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function table(target,heads,rows){const t=el('table'),thead=el('thead'),tr=el('tr');for(const h of heads)tr.append(el('th',h));thead.append(tr);t.append(thead);const body=el('tbody');for(const row of rows){const tr=el('tr');for(const value of row){const cell=el('td');cell.append(value instanceof Node ? value : String(value));tr.append(cell);};body.append(tr);}t.append(body);$(target).replaceChildren(t);}
function action(label, handler) {
  const button = el('button', label, 'text-button');
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}
function drill(changes) {
  apply({...state,...changes});
  $('results-heading').focus();
}
function periodDrill(period) {
  drill({...drillPeriod(period, state),axis:'published'});
}
const unknownStates = new Set(['no_run','failed','unjudged']);
function external(text, value) {
  const url = articleURL(value);
  if (!url) return el('span', text);
  const link = el('a', text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
const publicationBasis = {
  publisher_explicit:'原文・タイムゾーン明記', publisher_calendar:'原文の記載日',
  meltwater_api:'Meltwater API提供日時・JST', meltwater_manual_calendar:'CSV記載日・タイムゾーン未確認',
  rss_explicit:'RSS掲載日時', sitemap_explicit:'サイトマップ掲載日時', unknown:'根拠なし', conflict:'証拠の不一致',
};

let chartRows, chartWidth;
const chartContainer = $('chart');
const measuredChartWidth = () => Math.max(240, chartContainer.clientWidth || 960);

function chart(rows) {
  chartRows = rows;
  const width = chartWidth = measuredChartWidth();
  const height = width < 500 ? 236 : 290;
  const top = 22, bottom = height - 34, right = width - 14;
  const maximum = rows.reduce((largest, row) => Math.max(largest, row.occurrences), 1);
  const ticks = Math.min(4, maximum);
  const step = Math.ceil(maximum / ticks);
  const left = Math.max(35, fmt(ticks * step).length * 8 + 12);
  const xAt = i => rows.length <= 1 ? (left + right) / 2 : left + i * (right - left) / (rows.length - 1);
  const yAt = value => bottom - (bottom - top) * value / (ticks * step);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', '記事掲載日基準の語句出現回数');
  function node(tag, attrs, text, parent = svg) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value);
    if (text !== undefined) n.textContent = text;
    parent.append(n);
    return n;
  }

  for (let i = 0; i <= ticks; i++) {
    const y = yAt(i * step);
    node('line', {x1:left, y1:y, x2:right, y2:y, class:'chart-grid'});
    node('text', {x:left-7, y:y+4, 'text-anchor':'end'}, fmt(i * step));
  }
  const last = rows.length - 1;
  const tickStride = Math.max(1, Math.ceil(135 * Math.max(1,last) / (right-left)));
  const dateTicks = last >= 0 ? [0] : [];
  for (let index = tickStride; index <= last-tickStride; index += tickStride) dateTicks.push(index);
  if (last > 0) dateTicks.push(last);
  for (const index of dateTicks) {
    const x = xAt(index);
    const anchor = last === 0 ? 'middle' : index === 0 ? 'start' : index === last ? 'end' : 'middle';
    node('line', {x1:x, y1:top, x2:x, y2:bottom+5, class:'chart-grid chart-date-grid'});
    node('text', {x, y:bottom+21, 'text-anchor':anchor, class:'chart-date-label'}, rows[index].date);
  }

  const points = rows.flatMap((row, index) => unknownStates.has(row.collectionState) ? [] :
    [{row, index, x:xAt(index), y:yAt(row.occurrences)}]);
  let segment = [];
  function drawSegment() {
    if (segment.length > 1) node('polyline', {
      points:segment.map(({x,y})=>`${x},${y}`).join(' '), class:'chart-series',
    });
    segment = [];
  }
  for (const point of points) {
    if (segment.length && point.index !== segment.at(-1).index + 1) drawSegment();
    segment.push(point);
  }
  drawSegment();
  const guides = node('g', {class:'chart-guides', visibility:'hidden', 'aria-hidden':'true'});
  const vertical = node('line', {}, undefined, guides);
  const horizontal = node('line', {}, undefined, guides);
  const markers = node('g', {class:'chart-markers', 'aria-hidden':'true'});
  const targets = node('g', {});
  const tooltip = el('div', undefined, 'chart-tooltip');
  tooltip.id = 'publication-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;

  const terms = dataset.terms.filter(t=>(state.term==='all' || String(t.id)===state.term)
                                   && (state.topic==='all' || t.topic===state.topic));
  const termLabel = terms.length===1 ? terms[0].phrase : state.topic==='all' ?
    '正式17語の合計' : dataset.themes.find(t=>t.id===state.topic).label+'の合計';
  const siteLabel = state.site==='all' ? null : dataset.sites.find(s=>s.id===state.site).label;
  const dateLabel = state.grain==='day' ? '記事掲載日' : '記事掲載日（集計期間開始）';
  const dayOf = row => row.date.length === 7 ? row.date+'-01' : row.date;
  let active, pinned;
  function hide() {
    if (active) {
      active.marker.classList.remove('active');
      active.target.removeAttribute('aria-describedby');
    }
    active = null;
    tooltip.hidden = true;
    guides.setAttribute('visibility','hidden');
  }
  function show(point) {
    if (active===point) return;
    hide();
    active = point;
    const {row,x,y,marker,target} = point;
    marker.classList.add('active');
    for (const [line, attrs] of [[vertical,{x1:x,x2:x,y1:top,y2:bottom}],
                                 [horizontal,{x1:left,x2:right,y1:y,y2:y}]]) {
      for (const [key,value] of Object.entries(attrs)) line.setAttribute(key,value);
    }
    guides.setAttribute('visibility','visible');
    const details = [
      el('strong', `${dateLabel}：${dayOf(row)}`),
      el('div', `監視語句：${termLabel}`),
      el('div', `出現回数：${fmt(row.occurrences)}回`),
    ];
    if (siteLabel) details.push(el('div', `媒体：${siteLabel}`));
    if (terms.length > 1) {
      const hits = terms.filter(t=>row.termOccurrences[t.id] > 0);
      if (hits.length) {
        const list = el('ul');
        for (const term of hits) list.append(el('li', `${term.phrase}：${fmt(row.termOccurrences[term.id])}回`));
        details.push(list);
      }
    }
    tooltip.replaceChildren(...details);
    tooltip.hidden = false;
    const maxLeft = width - 4 - tooltip.offsetWidth;
    const nextToPoint = x+13 <= maxLeft ? x+13 : x-tooltip.offsetWidth-13;
    tooltip.style.left = `${Math.max(4, Math.min(maxLeft,nextToPoint))}px`;
    tooltip.style.top = `${Math.max(4, Math.min(height-tooltip.offsetHeight-4, y-25))}px`;
    target.setAttribute('aria-describedby', tooltip.id);
  }

  function toggle(point) {
    if (pinned===point) {pinned=null; hide();}
    else {pinned=point; show(point);}
  }
  svg.addEventListener('touchend',event=>{
    const touch = event.changedTouches[0];
    const bounds = svg.getBoundingClientRect();
    const x = (touch.clientX - bounds.left) * width / bounds.width;
    const y = (touch.clientY - bounds.top) * height / bounds.height;
    if (y < top-10 || y > bottom+10) return;
    const point = points.find(p=>x >= p.xStart && x <= p.xEnd);
    if (!point) return;
    event.preventDefault();
    toggle(point);
  }, {passive:false});

  for (const [i,point] of points.entries()) {
    const {row,index,x,y} = point;
    point.marker = node('circle', {cx:x,cy:y,r:4.5,class:'chart-marker'}, undefined, markers);
    const target = point.target = node('g', {
      class:'chart-point', role:'button', tabindex:i===0 ? 0 : -1,
      'aria-label':`${dateLabel} ${dayOf(row)}、${termLabel}、${fmt(row.occurrences)}回${siteLabel ? '、'+siteLabel : ''}`,
    }, undefined, targets);
    const xStart = point.xStart = index===0 ? left-12 : (xAt(index-1)+x)/2;
    const xEnd = point.xEnd = index===rows.length-1 ? right+12 : (x+xAt(index+1))/2;
    node('rect', {x:xStart,y:top-10,width:xEnd-xStart,height:bottom-top+20,fill:'transparent'}, undefined,target);
    target.addEventListener('pointerenter',event=>{
      if (event.pointerType==='touch') return;
      if (pinned!==point) pinned=null;
      show(point);
    });
    target.addEventListener('pointerleave',()=>{if (!pinned && document.activeElement!==target) hide();});
    target.addEventListener('focus',()=>{pinned=null; show(point);});
    target.addEventListener('blur',()=>{if (!pinned) hide();});
    target.addEventListener('click',event=>{
      if (event.pointerType!=='touch') toggle(point);
    });
    target.addEventListener('keydown',event=>{
      const keys = ['ArrowLeft','ArrowRight','Home','End','Escape','Enter',' '];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      if (event.key==='Escape') {pinned=null; hide(); return;}
      if (event.key==='Enter' || event.key===' ') {show(point); return;}
      const next = {ArrowLeft:Math.max(0,i-1),ArrowRight:Math.min(points.length-1,i+1),
                    Home:0,End:points.length-1}[event.key];
      target.setAttribute('tabindex',-1);
      points[next].target.setAttribute('tabindex',0);
      points[next].target.focus();
    });
  }
  chartContainer.replaceChildren(svg,tooltip);
}
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (chartRows && measuredChartWidth()!==chartWidth) chart(chartRows);
  }).observe(chartContainer);
}
const overviewSource = {
  rss_description:'RSS配信概要',html_meta_description:'HTMLメタ概要',
  body_excerpt:'保存済み本文抜粋',listing_description:'公開一覧の概要',match_context:'一致語句周辺の抜粋',
};
const articlePageSize = 10;
let dataset, state, articles, articlePage, printGroups = [];
function articleCard(article) {
  const card = el('article', undefined, 'article');
  const site = dataset.sites.find(s=>s.id===article.site);
  const heading = el('h3');
  heading.append(external(article.title, article.url));
  card.append(el('small', site.label),heading);
  for (const id of new Set(article.matches.map(match=>match.term_id))) {
    card.append(el('span',dataset.terms.find(term=>term.id===id).phrase,'tag'));
  }
  card.append(
    el('p',article.meltwater_manual && !article.body_ok && !article.matches.length
      ? '本文一致未確認'
      : `出現 ${article.matches.reduce((sum,match)=>sum+match.occurrences,0)}回`),
    el('p',`記事掲載日 ${article.published_day || '未確認'}${article.publication_basis ? '（' + publicationBasis[article.publication_basis] + '）' : ''} ／ 初回観測 ${date(article.first_seen_at)}`),
    el('p',`${article.meltwater_manual ? 'Meltwater手動CSV' : ({openai:'OpenAI補完',openai_multiple:'複数経路（OpenAIで初回発見）',multiple:'複数経路',meltwater:'Meltwaterで初回発見'})[article.discovery] || '通常収集'} ／ ${article.body_ok?'本文抽出済み':article.body_received?'部分テキスト':article.attempted?'本文取得・抽出未完了':'本文未確認'}`),
    el('p',article.overview?.text || '概要未取得'),
  );
  if (article.body_fetched_at) card.append(el('p',`直近の本文取得成功 ${date(article.body_fetched_at)}`));
  if (!article.published_at && article.published_raw) {
    card.append(el('small','保存された日時の表記 '+article.published_raw));
  }
  if (article.overview?.text) card.append(el('small',overviewSource[article.overview.source]));
  const original = external('原文を開く',article.url);
  original.className = 'original-link';
  card.append(original);
  const source = external(article.url,article.url);
  source.className = 'print-source';
  card.append(source);
  return card;
}
function renderArticles(print = false) {
  const offset = print ? 0 : articlePage * articlePageSize;
  const end = print ? articles.length : Math.min(offset + articlePageSize, articles.length);
  $('article-count').textContent = articles.length ? `${fmt(offset+1)}–${fmt(end)}件 / 全${fmt(articles.length)}件` : '';
  $('article-pages').hidden = print || articles.length <= articlePageSize;
  $('previous').disabled = articlePage === 0;
  $('next').disabled = end === articles.length;
  $('articles').replaceChildren(...(articles.length ? articles.slice(offset,end).map(articleCard)
    : [el('p','選択条件で一致を確認できた記事はありません。','empty')]));
}
function renderThemes() {
  const open = new Set([...$('theme-groups').querySelectorAll('details[open]')].map(group=>group.dataset.theme));
  $('theme-groups').replaceChildren(...dataset.themes.map(theme => {
    const terms = dataset.terms.filter(term=>term.topic===theme.id);
    const group = el('div',undefined,'theme-group');
    const details = el('details');
    details.dataset.theme = theme.id;
    details.open = open.has(theme.id) || state.topic===theme.id;
    details.append(el('summary',`${theme.label}（${terms.length}語）`));
    const keywords = el('div',undefined,'theme-keywords');
    for (const term of terms) {
      const selected = state.term===String(term.id);
      const button = action(term.phrase,()=>drill({topic:selected?'all':theme.id,term:selected?'all':String(term.id)}));
      button.setAttribute('aria-pressed',String(selected));
      keywords.append(button);
    }
    details.append(keywords);
    const selected = state.topic===theme.id && state.term==='all';
    const filter = action('テーマで絞る',()=>drill({topic:selected?'all':theme.id,term:'all'}));
    filter.setAttribute('aria-pressed',String(selected));
    group.append(details, filter);
    return group;
  }));
  $('clear-theme').disabled = state.topic==='all' && state.term==='all';
}
function matrixButton(site,cell) {
  const keyword = dataset.themes.find(theme=>theme.id===cell.theme);
  const button = action(fmt(cell.count),()=>drill({site:site.id,topic:cell.theme}));
  button.setAttribute('aria-label',`${site.label}、${keyword.label}、${fmt(cell.count)}件の記事`);
  return button;
}
function render(){const result=aggregate(dataset,state);$('error').hidden=true;$('loading').hidden=true;$('content').hidden=false;
for(const k of ['start','end','site','term','topic','grain','axis','route','sort'])$(k).value=state[k];
for(const b of $('presets').children)b.setAttribute('aria-pressed',String(b.dataset.preset===state.preset));
$('updated').textContent=date(dataset.metadata.generated_at_jst);$('latest').textContent='選択媒体・期間終端までの最新収集成功: '+date(result.latestSuccess);
$('period-note').textContent = `${state.start} 〜 ${state.end}（${state.axis==='published'?'記事掲載日':'初回観測日・JST'}）`;
$('clear-filters').disabled = ['site','term','topic','route'].every(key=>state[key]==='all');
const selectedLabel = id => $(id).selectedOptions[0].textContent;
$('print-filters').textContent = [
  $('period-note').textContent,
  selectedLabel('site'), selectedLabel('term'), selectedLabel('topic'),
  selectedLabel('route'), selectedLabel('axis'), selectedLabel('grain'),
].join(' ／ ');
$('axis-note').textContent = '記事掲載日基準で、保存済みの正式17語の出現回数を集計しています。掲載日不明・矛盾の記事はグラフに含めません。';
const monthly = new Map();
for (const row of [...dataset.cohorts, ...dataset.articles]) {
  if (!includesRoute(row,state.route) || !row.published_day || row.published_day < state.start || row.published_day > state.end
      || (state.site !== 'all' && row.site !== state.site)) continue;
  const key = row.published_day.slice(0, 7) + ' ' + row.site;
  monthly.set(key, (monthly.get(key) || 0) + row.count);
}
const progressRows = ['openai','meltwater'].includes(state.route) ? [] : dataset.backfill_months || [];
const backfill = new Map(progressRows.map(row => [row.month + ' ' + row.site, row]));
const progressCells = progress => [
  progress?.candidates ?? '—', progress?.pending ?? '—', progress?.extracted ?? '—',
  progress?.failed ?? '—', progress?.forbidden ?? '—',
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
for (const row of progressRows.filter(row => row.month === null)) {
  if (state.site !== 'all' && row.site !== state.site) continue;
  months.push(['日付不明', result.sites.find(site => site.id === row.site)?.label || row.site,
    '—', ...progressCells(row)]);
}
table('monthly-coverage', ['月（JST）', '媒体', '公開月別の保存記事', '遡及候補', '未処理・再試行', '本文成功', '未成功', '取得禁止', '本文成功率'], months);
const s = result.summary;
const matchValue = n => n || result.matchingKnown ? n : null;
$('metrics').replaceChildren(...[
  ['発見・観測記事数', s.observed, '同じURLは1記事'],
  ['一致確認済み記事数', matchValue(s.matched), '保存した一致証拠がある記事'],
  ['確認済み出現回数', matchValue(s.occurrences), '記事・語句・照合箇所ごとの集計'],
  ['本文未確認記事数', s.unjudged, `未試行 ${fmt(s.unattempted)} ／ 試行済み・未成功 ${fmt(s.attemptedUnresolved)}`],
].map(([label, n, definition]) => {
  const box = el('div', undefined, 'metric');
  box.append(el('span', label), el('strong', fmt(n)), el('small', definition));
  return box;
}));
$('scope').textContent=`${dataset.metadata.state_definition} ${state.term!=='all'||state.topic!=='all'?'語句・テーマ指定中の観測母数は、その条件で一致が確認できた記事に限定します。':''} HTTP取得成功率 ${pct(s.httpRate)} ／ 抽出成功率 ${pct(s.extractRate)} ／ 累積取得試行 ${fmt(s.attempts)}件。本文対象外 ${fmt(s.bodyNA)}記事。`;
$('chart-label').textContent='記事掲載日基準 · 出現回数 · '+({day:'日別',week:'週別',month:'月別'}[state.grain]);
chart(result.publicationSeries);
const undated = result.unassignedPublication;
$('publication-unassigned').textContent = `掲載日不明・矛盾 ${fmt(undated.observed)}記事 ／ 保存済み一致 ${fmt(undated.matched)}記事・${fmt(undated.occurrences)}回（選択中の媒体・語句・発見経路。期間に割り当てられません）`;
table('series-table',['掲載日・集計期間開始','保存記事の状態','出現回数'],result.publicationSeries.map(r=>[
  action(r.date,()=>periodDrill(r.date)),
  ({saved:'保存記事あり',no_run:'掲載記事の保存未確認',unjudged:'発見済み・一致未確認'})[r.collectionState],
  unknownStates.has(r.collectionState)?'未確認':fmt(r.occurrences),
]));
renderThemes();
table('matrix',['媒体',...dataset.themes.map(theme=>theme.label)],result.matrix.map(({site,cells})=>[
  action(site.label,()=>drill({site:site.id})),
  ...cells.map(cell=>cell.count === null ? (cell.active ? '—' : '対象外') :
    matrixButton(site,cell)),
]));
const backfillLabels = {scheduled:'定期探索・取得',restricted:'取得制限',inactive:'稼働未確認',not_configured:'設定なし'};
const discoveryLabels = {allowed:'探索許可',discovered:'候補を発見',sampled:'少量試験',unavailable:'入口応答未確認',forbidden:'入口制限'};
table('sites',['媒体','種別','通常収集','バックフィル','最終成功（通常）','最終本文成功（遡及）','観測状況'],result.sites.map(site=>[
  action(site.label,()=>drill({site:site.id})),
  site.collection?.kind==='rss' ? 'RSS' : 'Web',
  labels[site.status],
  [backfillLabels[site.collection?.backfill_status],discoveryLabels[site.collection?.discovery_status]].filter(Boolean).join(' ／ '),
  date(site.latest_success_at),date(site.collection?.latest_backfill_success_at),
  site.collection?.official_url ? external(site.coverage+' ／ 公式サイト',site.collection.official_url) : site.coverage,
]));
articles = result.articles;
articlePage = 0;
renderArticles();
$('limits').replaceChildren(...[dataset.metadata.time_definition,dataset.metadata.occurrence_definition,...dataset.metadata.limitations].map(s=>el('li',s)));$('version').textContent=dataset.metadata.dictionary_version;$('dictionary').textContent=dataset.terms.map(t=>t.phrase).join(' ／ ');
history.replaceState(null,'',toURL(state));
$('print-url').textContent = new URL(toURL({...state, preset:'custom'}), location.href).href;
}
function apply(input){try{state=resolveState(input,dataset);render();}catch(e){$('error').hidden=false;$('error').textContent=e.message;}}
export async function start(){try{const response=await fetch(new URL('./data.json',import.meta.url),{cache:'no-cache'});if(!response.ok)throw Error('公開データの読込に失敗しました。');dataset=await response.json();dataset.themes ||= [...new Set(dataset.terms.map(t=>t.topic))].map(id=>({id,label:id}));if(dataset.metadata.schema_version!==1)throw Error('未対応のデータ形式です。');
for(const [id,rows] of [['site',dataset.sites.map(s=>[s.id,s.label])],['term',dataset.terms.map(t=>[String(t.id),t.phrase])],['topic',dataset.themes.map(t=>[t.id,t.label])]])for(const [value,label] of rows){const o=el('option',label);o.value=value;$(id).append(o);}
for(const [value,label] of [['7','直近7日'],['30','直近30日'],['90','直近90日'],['6mo','直近6か月'],['365','直近1年間'],['all','全期間'],['custom','任意期間']]){const b=el('button',label);b.type='button';b.dataset.preset=value;b.addEventListener('click', () => {
  if (value === 'custom') $('start').closest('details').open = true;
  apply({...state, preset:value, grain:undefined});
});$('presets').append(b);}
$('filters').addEventListener('submit',event=>{event.preventDefault();apply({...state,...Object.fromEntries(['start','end','site','term','topic','grain','axis','route'].map(k=>[k,$(k).value]))});});
for(const id of ['start','end'])$(id).addEventListener('change',()=>apply({...state,preset:'custom',start:$('start').value,end:$('end').value,grain:undefined}));
for(const id of ['site','term','topic','grain','axis','route','sort'])$(id).addEventListener('change',()=>apply({...state,[id]:$(id).value}));
$('clear-filters').addEventListener('click',()=>apply({...state,site:'all',term:'all',topic:'all',route:'all'}));
$('previous').addEventListener('click', () => { articlePage--; renderArticles(); });
$('next').addEventListener('click', () => { articlePage++; renderArticles(); });
$('clear-theme').addEventListener('click',()=>apply({...state,term:'all',topic:'all'}));
$('fixed-link').addEventListener('click',()=>apply({...state,preset:'custom'}));window.addEventListener('popstate',()=>{try{apply(fromURL(location.search,dataset));}catch(e){$('error').hidden=false;$('error').textContent=e.message;}});
try{state=fromURL(location.search,dataset);}catch(e){state=resolveState({},dataset);render();$('error').hidden=false;$('error').textContent='URLの条件が不正なため初期表示に戻しました。 '+e.message;return;}render();
}catch(e){$('loading').textContent='データを表示できません。';$('error').hidden=false;$('error').textContent=e.message;}}
window.addEventListener('beforeprint', () => {
  if (articles) renderArticles(true);
  printGroups = [...$('theme-groups').querySelectorAll('details:not([open])')];
  for (const group of printGroups) group.open = true;
  $('printed-at').textContent = '印刷日時（JST） ' + date(new Date());
});
window.addEventListener('afterprint',()=>{
  for (const group of printGroups) group.open = false;
  printGroups = [];
  if (articles) renderArticles();
});
start();
