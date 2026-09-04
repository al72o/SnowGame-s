// ---------------------------------------------------------------------------
// РРС «Снежинка» — личный прототип, самостоятельный хостинг.
// Экономика игры и рендеринг перенесены как есть из прототипа на Claude
// Artifacts. Единственное существенное отличие: вместо window.claude.use("sample")
// это игра ходит на свой сервер (POST /api/agent), который уже подключает
// живого AI-агента любого провайдера — см. AGENT.md.
// ---------------------------------------------------------------------------

// GAME_DATA приходит из data.js (подключён раньше этого файла в index.html)

const QUARTERS = GAME_DATA.quarters;
const QLABEL = {"1Q26":"1 кв. 2026","2Q26":"2 кв. 2026","3Q26":"3 кв. 2026","4Q26":"4 кв. 2026","1Q27":"1 кв. 2027","2Q27":"2 кв. 2027","3Q27":"3 кв. 2027","4Q27":"4 кв. 2027"};
const MALLS = ["Вавилон сити","Галерея","Звёздный базар","Престиж","Эдем Молл","Империя покупок"];
const MATERIALS = ["Лист белой бумаги","Лист цветной бумаги","Лист картона","Рулон скотча бумажного","Нитки"];
const TIERED = {"Лист белой бумаги":1,"Лист цветной бумаги":1,"Лист картона":1};
// оптовые тиры из закрытого прайс-листа поставщика (в физической игре они тоже не показываются командам)
const TIER_TABLE = {
  era1: {"Лист белой бумаги":[9,8], "Лист цветной бумаги":[18,16], "Лист картона":[27,24]},
  era2: {"Лист белой бумаги":[18,16], "Лист цветной бумаги":[36,32], "Лист картона":[54,48]},
  era3: {"Лист белой бумаги":[27,24], "Лист цветной бумаги":[54,48], "Лист картона":[81,72]},
};
function eraOf(q){ if(["1Q26","2Q26","3Q26"].includes(q)) return "era1"; if(["4Q27"].includes(q)) return "era3"; return "era2"; }

const RECIPES = {
  "Снежинки маленькие": {"Лист белой бумаги":1},
  "Снежинки средние": {"Лист цветной бумаги":1},
  "Снежинки большие": {"Лист картона":1},
  "Ёлочки": {"Лист картона":1, "Рулон скотча бумажного":0.1},
  "Шляпы бумажные": {"Лист цветной бумаги":1},
  "Шляпы картонные": {"Лист картона":1},
  "Кораблики": {"Лист белой бумаги":1, "Рулон скотча бумажного":0.1},
  "Самолёты классические": {"Лист белой бумаги":1},
  "Самолёты планеры": {"Лист картона":1},
  "Деды морозы": {"Лист картона":1, "Лист цветной бумаги":1, "Нитки":0.1},
};
const ALL_SKUS = Object.keys(RECIPES);

function fmt(n){ return Math.round(n).toLocaleString('ru-RU'); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }

// ---------- state ----------
let aiAvailable = false;

let S = null; // game state

function freshState(teamSize){
  return {
    teamSize,
    capacity: 8*teamSize,
    qIdx: 0,
    cash: 500,
    materials: {}, // owned raw material units
    inventory: {}, // produced goods carried over
    lastPrice: {}, // remembered storefront prices
    history: [], // per-quarter ledger for player/comp1/comp2/wildzone
    comp: { comp1:{cash:500,name:"Конкурент 1"}, comp2:{cash:500,name:"Конкурент 2"}, wild:{cash:0,name:"WildZone"} },
    phase: "shopping", // shopping | negotiate | results | done
    cart: {}, // material purchase qty inputs this quarter
    rentPicks: {}, // mall -> chairs this quarter
    prod: {}, // sku -> qty to produce this quarter
    price: {}, // sku -> storefront price this quarter
    negotiations: [], // pending negotiation prompts this quarter
    negLog: [],
    negBudget: 3,
    quarterResult: null,
    supplierNote: {},
    qLog: {purchases:[], production:[]}, // this quarter's raw actions, for the debrief
    pendingReflection: "",
    decisionLog: [], // one entry per closed quarter: actions + player's own reasoning + result
    debrief: { stage: 0, answers: {}, facts: null, analysis: null, factsLoading:false, analysisLoading:false },
  };
}

function currentQ(){ return QUARTERS[S.qIdx]; }
function commercial(){ return GAME_DATA.commercial[currentQ()]; }
function teamPrices(){ return GAME_DATA.teamPrices[currentQ()]; }
function rentRates(){ return GAME_DATA.rent[currentQ()]; }

function save(){
  try{ localStorage.setItem('snezhinka-ai-save', JSON.stringify(S)); }catch(e){}
}
function loadSave(){
  try{ const raw = localStorage.getItem('snezhinka-ai-save'); return raw?JSON.parse(raw):null; }catch(e){ return null; }
}

// ---------- AI helpers ----------
// Каждая функция сначала пытается сходить на свой сервер (SnezhinkaAgent.call,
// см. agent-client.js -> POST /api/agent -> server/providers/*). Если сервер
// недоступен, вернул ошибку, или ответ не прошёл валидацию — используется тот
// же детерминированный запасной вариант, что был в исходном прототипе.
// Контракты задач и промпты подробно задокументированы в AGENT.md.
async function ensureAI(){
  const h = await SnezhinkaAgent.health();
  aiAvailable = !!(h && h.ok && h.provider && h.provider !== 'none');
  return aiAvailable;
}

async function aiSupplierNegotiate(material, qty, basePrice){
  const era = eraOf(currentQ());
  const tiers = TIER_TABLE[era][material];
  const data = await SnezhinkaAgent.call('supplier_negotiate', {
    material, qty, basePrice,
    tierLow: tiers ? tiers[0] : null,
    tierHigh: tiers ? tiers[1] : null,
  });
  if(data && typeof data.pricePerUnit === "number") return data;
  // детерминированный запасной вариант, повторяющий задокументированные правила игры
  let price = basePrice;
  if(tiers){ if(qty>=51) price=tiers[1]; else if(qty>=20) price=tiers[0]; }
  else if(qty>=20) price = +(basePrice*0.95).toFixed(1);
  return {pricePerUnit:price, note:"(офлайн-режим: применены задокументированные оптовые условия)"};
}

async function aiBuyerDecision(buyerNum, item, maxPrice, askPrice, pitch){
  const data = await SnezhinkaAgent.call('buyer_decision', { buyerNum, item, maxPrice, askPrice, pitch });
  if(data && typeof data.accept === "boolean") return data;
  const ok = askPrice <= maxPrice*1.12 && pitch && pitch.trim().length>3;
  return {accept:ok, note: ok?"(офлайн-режим) Ладно, уговорили, беру.":"(офлайн-режим) Нет, это неоправданно дорого, куплю на Wildzone."};
}

async function aiCompetitors(){
  const c = commercial();
  const skuLines = ALL_SKUS.filter(s=>c.marketPrices[s]).map(s=>`${s}: рыночная цена ${c.marketPrices[s]} у.е.`).join("; ");
  const data = await SnezhinkaAgent.call('competitors', {
    quarterLabel: QLABEL[currentQ()], capacity: c.capacity, skuLines,
  });
  if(data && data.competitors && data.competitors.length===2) return data.competitors;
  return [1,2].map(i=>{
    const skus = ALL_SKUS.filter(s=>c.marketPrices[s]).sort(()=>Math.random()-0.5).slice(0,3);
    const prices = {};
    skus.forEach(s=> prices[s] = Math.round(c.marketPrices[s]*(0.9+Math.random()*0.22)));
    return {name:`Конкурент ${i}`, prices, rentChairs:2};
  });
}

function logSummaryText(){
  return S.decisionLog.map(e=>{
    const purch = e.purchases.length ? e.purchases.map(p=>`${p.material} ×${p.qty} по ${p.price}${p.negotiated?` (выторговано: «${p.note}»)`:''}`).join('; ') : 'ничего не закупали';
    const prod = e.production.length ? e.production.map(p=>`${p.sku} ×${p.qty}`).join(', ') : 'ничего не производили';
    const rent = Object.entries(e.rent).filter(([,n])=>n>0).map(([m,n])=>`${m}: ${n} стул.`).join(', ') || 'без аренды';
    const prices = Object.entries(e.prices).map(([s,p])=>`${s}=${p}`).join(', ') || '—';
    const negs = e.negotiations.length ? e.negotiations.map(n=>`с покупателем ${n.buyer} по «${n.item}»: ${n.accepted?'убедил(а)':'не убедил(а)'}`).join('; ') : 'переговоров с покупателями не было';
    const reflection = e.reflection ? `Пояснение участника: «${e.reflection}»` : 'участник не оставил пояснения';
    return `## ${QLABEL[e.q]}\nЗакупки: ${purch}\nАренда: ${rent}\nПроизводство: ${prod}\nЦены на витрине: ${prices}\nПереговоры с покупателями: ${negs}\nФинансовый результат: оборот ${fmt(e.result.player.revenue)}, прибыль ${fmt(e.result.player.profit)}, касса на конец квартала ${fmt(e.result.player.cash)}.\n${reflection}`;
  }).join('\n\n');
}

async function aiDebriefFacts(){
  const log = logSummaryText();
  const data = await SnezhinkaAgent.call('debrief_facts', { log });
  if(data && data.text) return data.text;
  return S.decisionLog.map(e=>`${QLABEL[e.q]}: закуплено ${e.purchases.length} позиций материалов, произведено ${e.production.reduce((a,p)=>a+p.qty,0)} изделий, прибыль ${fmt(e.result.player.profit)} у.е.`).join('\n') + '\n\n(офлайн-режим: краткая сводка без ИИ-обобщения)';
}

async function aiDebriefAnalysis(factsText, addedFacts){
  const log = logSummaryText();
  const data = await SnezhinkaAgent.call('debrief_analysis', { log, addedFacts: addedFacts||'' });
  if(data && data.text) return data.text;
  return 'AI недоступен в этом просмотре — офлайн-режим не формирует поведенческий анализ автоматически. Обсудите лог решений выше вживую по той же структуре: риск/планирование, переговоры, адаптивность.';
}

// ---------- rendering ----------
const app = document.getElementById('app');

function renderProgress(){
  const el = document.getElementById('progress');
  el.innerHTML = QUARTERS.map((q,i)=>{
    const cls = i<S.qIdx ? "done" : (i===S.qIdx ? "now":"");
    return `<span class="dot ${cls}" title="${QLABEL[q]}"></span>`;
  }).join("");
}
function renderTopbar(){
  document.getElementById('topbar').style.display = S ? 'flex' : 'none';
  if(!S) return;
  document.getElementById('statQ').textContent = QLABEL[currentQ()] + ` (${S.qIdx+1}/8)`;
  document.getElementById('statCash').textContent = fmt(S.cash) + ' у.е.';
  renderProgress();
  const tbtn = document.getElementById('topbarDebriefBtn');
  if(tbtn){
    if(S.decisionLog && S.decisionLog.length>0){
      tbtn.classList.remove('hidden');
      tbtn.onclick = ()=>{ S.phase='debrief'; renderDebrief(); };
    } else {
      tbtn.classList.add('hidden');
    }
  }
}

function setup(){
  app.innerHTML = `
  <div class="setup">
    <h2>Снежинка AI</h2>
    <p class="lede">Та же экономика деловой игры «Снежинка» — реальные цены, аренда, потребности покупателей по всем 8 кварталам 2026&ndash;2027 — но без живых ведущих и живых оппонентов. Покупателей, поставщика и двух конкурентов ведёт AI-агент, подключённый на вашем сервере (см. AGENT.md).</p>
    <div class="field">
      <label>Размер вашей команды</label>
      <div class="range-row">
        <input type="range" id="teamSize" min="1" max="7" value="1">
        <div class="range-val" id="teamSizeVal">1</div>
      </div>
      <div class="hint">Определяет производственную мощность (8 изделий за квартал на человека). Роли внутри команды не разделены — это упрощение прототипа.</div>
    </div>
    <button class="primary" id="startBtn">Начать бизнес-симуляцию →</button>
    <div class="hint" style="margin-top:14px;">Стартовый капитал 500 у.е., 8 раундов по кварталу. Прогресс сохраняется локально в этом браузере. ${aiAvailable? '<span class="tag good">агент подключён</span>' : '<span class="tag">агент недоступен — офлайн-правила</span>'}</div>
  </div>`;
  const range = document.getElementById('teamSize');
  const val = document.getElementById('teamSizeVal');
  range.oninput = ()=> val.textContent = range.value;
  document.getElementById('startBtn').onclick = ()=>{
    S = freshState(parseInt(range.value,10));
    save();
    renderTopbar();
    renderQuarter();
  };
}

function materialsCard(){
  const tp = teamPrices();
  const rows = MATERIALS.map(m=>{
    const price = tp[m];
    const owned = S.materials[m]||0;
    const cartQty = S.cart[m]||0;
    const negotiated = S.supplierNote[m];
    return `<tr>
      <td>${m}${TIERED[m]?' <span class="tag gold">опт</span>':''}</td>
      <td class="num muted">на складе: ${owned.toFixed(1)}</td>
      <td class="num num">${negotiated? negotiated.pricePerUnit.toFixed(1) : price} у.е./шт</td>
      <td class="num"><input type="number" min="0" step="1" value="${cartQty}" data-mat="${m}" class="cartInput"></td>
      <td>${TIERED[m] ? `<button class="ghost small negBtn" data-mat="${m}">Запросить опт</button>` : ''}</td>
    </tr>${negotiated?`<tr><td colspan="5" class="muted" style="padding-top:0;">💬 «${negotiated.note}»</td></tr>`:''}`;
  }).join("");
  return `
  <div class="card">
    <h3>Закупка материалов</h3>
    <div class="sub">Цены — открытый прайс-лист поставщика на ${QLABEL[currentQ()]}. Оптовые условия не публикуются — их нужно выпросить.</div>
    <div class="tblwrap"><table>
      <tr><th>Материал</th><th></th><th class="num">Цена</th><th class="num">Купить, шт</th><th></th></tr>
      ${rows}
    </table></div>
    <div class="rowfoot">
      <span class="muted">Сумма закупки в корзине: <b class="num" id="cartSum">0</b> у.е.</span>
      <button class="primary small" id="buyBtn">Оплатить поставщику</button>
    </div>
  </div>`;
}

function rentCard(){
  const rr = rentRates();
  const totalChairs = Object.values(S.rentPicks).reduce((a,b)=>a+b,0);
  const mallsHtml = MALLS.map(m=>{
    const n = S.rentPicks[m]||0;
    return `<div class="mall">
      <div class="name">${m}</div>
      <div class="price num">${rr[m]} у.е./стул</div>
      <div class="stepper">
        <button class="rentMinus" data-mall="${m}">–</button>
        <span class="n">${n}</span>
        <button class="rentPlus" data-mall="${m}">+</button>
      </div>
    </div>`;
  }).join("");
  const discountHint = totalChairs>=3 ? `<span class="tag good">скидка за объём применена</span>` : `<span class="muted">3+ стула суммарно → поставщик обычно снижает ставку</span>`;
  return `
  <div class="card">
    <h3>Аренда торговых площадей</h3>
    <div class="sub">1 помещение = 1 стул, до 2 на торговый центр. Оплата — каждый квартал по текущей ставке.</div>
    <div class="mallgrid">${mallsHtml}</div>
    <div class="rowfoot">${discountHint}<span class="muted">Стульев выбрано: <b class="num">${totalChairs}</b></span></div>
  </div>`;
}

function prodCard(){
  const c = commercial();
  const rows = ALL_SKUS.filter(s=>c.marketPrices[s]).map(s=>{
    const recipe = RECIPES[s];
    const n = S.prod[s]||0;
    const recipeStr = Object.entries(recipe).map(([m,q])=>`${q}× ${m}`).join(', ');
    return `<tr>
      <td>${s}<div class="muted">${recipeStr}</div></td>
      <td class="num muted">запас: ${(S.inventory[s]||0)}</td>
      <td class="num"><input type="number" min="0" step="1" value="${n}" data-sku="${s}" class="prodInput"></td>
    </tr>`;
  }).join("");
  const used = Object.values(S.prod).reduce((a,b)=>a+(b||0),0);
  return `
  <div class="card">
    <h3>Производство</h3>
    <div class="sub">Мощность команды: <b class="num">${used}/${S.capacity}</b> изделий за квартал. Стандарт размеров и качество — как в оригинальной игре, здесь предполагаются выполненными автоматически.</div>
    <div class="tblwrap"><table>
      <tr><th>Изделие</th><th></th><th class="num">Произвести, шт</th></tr>
      ${rows}
    </table></div>
    <div class="rowfoot"><span class="muted" id="prodWarn"></span><button class="primary small" id="prodBtn">Списать в производство</button></div>
  </div>`;
}

function priceCard(){
  const c = commercial();
  const skusInStock = ALL_SKUS.filter(s=> (S.inventory[s]||0) + (S.prod[s]||0) > 0);
  if(skusInStock.length===0) return `<div class="card"><h3>Витрина</h3><div class="sub">Произведите товар, чтобы выставить цену.</div></div>`;
  const rows = skusInStock.map(s=>{
    const mkt = c.marketPrices[s]||0;
    const p = S.price[s] ?? S.lastPrice[s] ?? mkt;
    return `<tr>
      <td>${s}</td>
      <td class="num muted">ориентир рынка: ${mkt||'—'}</td>
      <td class="num"><input type="number" min="0" step="1" value="${p}" data-sku="${s}" class="priceInput"></td>
    </tr>`;
  }).join("");
  return `
  <div class="card">
    <h3>Витрина</h3>
    <div class="sub">Цена, которую увидят покупатели. Покупатели не показывают вам свой список покупок и максимальную цену заранее.</div>
    <div class="tblwrap"><table><tr><th>Изделие</th><th></th><th class="num">Цена</th></tr>${rows}</table></div>
  </div>`;
}

function forecastCard(){
  const c = commercial();
  const splitChips = Object.entries(c.split).map(([k,v])=>`<span class="chip ${c.splitPatched?'patched':''}">${k} ${v}%</span>`).join("");
  return `
  <div class="card">
    <h3>Прогноз рынка — ${QLABEL[currentQ()]}</h3>
    <div class="sub">Раунд ${S.qIdx+1} из 8</div>
    <div class="bignum">${c.capacity}</div>
    <div class="muted">ёмкость рынка, у.е.</div>
    <div class="chiprow">${splitChips}</div>
    ${c.splitPatched? `<div class="muted" style="margin-top:8px;">⚠ Сплит продаж на этот квартал в исходных материалах ФО повреждён (те же «??%», что и в присланной презентации) — здесь подставлено значение по аналогии с 4Q26.</div>`:''}
  </div>`;
}

function sidebarCard(){
  const rows = ["player","comp1","comp2","wild"].map(k=>{
    const label = k==="player"?"Вы":k==="comp1"?"Конкурент 1":k==="comp2"?"Конкурент 2":"WildZone";
    const color = k==="player"?"var(--accent)":k==="comp1"?"var(--gold)":k==="comp2"?"#8a6fd1":"var(--ink-faint)";
    const cash = k==="player"?S.cash:(k==="comp1"?S.comp.comp1.cash:k==="comp2"?S.comp.comp2.cash:S.comp.wild.cash);
    return `<div class="row"><span class="sw" style="background:${color}"></span>${label}<span class="v">${fmt(cash)}</span></div>`;
  }).join("");
  return `
  <div class="card sticky">
    <h3>Рынок сейчас</h3>
    <div class="sub">Касса участников на конец последнего завершённого квартала</div>
    <div class="legend">${rows}</div>
    ${chartSvg()}
    ${S.history.length ? historyTable() : `<div class="muted" style="margin-top:12px;">Дашборд появится после первого квартала.</div>`}
  </div>`;
}

function chartSvg(){
  if(S.history.length<1) return "";
  const w=290,h=110,pad=8;
  const series = {
    player: S.history.map(h=>h.player.cash),
    comp1: S.history.map(h=>h.comp1.cash),
    comp2: S.history.map(h=>h.comp2.cash),
  };
  const all = [500, ...Object.values(series).flat()];
  const max = Math.max(...all), min = Math.min(0,...all);
  const n = S.history.length;
  const x = i => n<=1 ? pad : pad + (w-2*pad) * i/(n-1<1?1:n-1);
  const y = v => h-pad - (h-2*pad) * (v-min)/((max-min)||1);
  function path(arr){
    if(arr.length===1) return `M${x(0)},${y(500)} L${x(0)},${y(arr[0])}`;
    return arr.map((v,i)=> (i===0?'M':'L') + x(i) + ',' + y(v)).join(' ');
  }
  const colors = {player:"var(--accent)", comp1:"var(--gold)", comp2:"#8a6fd1"};
  const lines = Object.entries(series).map(([k,arr])=>`<path d="${path(arr)}" fill="none" stroke="${colors[k]}" stroke-width="2"/>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="margin-top:14px;">
    <line x1="${pad}" y1="${y(0)}" x2="${w-pad}" y2="${y(0)}" stroke="var(--line)" stroke-dasharray="3,3"/>
    ${lines}
  </svg>`;
}

function historyTable(){
  const rows = S.history.map(h=>`<tr><td>${QLABEL[h.q]}</td><td class="num">${fmt(h.player.profit)}</td></tr>`).join("");
  return `<div class="tblwrap" style="margin-top:12px;"><table><tr><th>Квартал</th><th class="num">Ваша прибыль</th></tr>${rows}</table></div>`;
}

function actionBar(){
  return `<div class="card">
    <h3>Пояснение к решениям этого квартала</h3>
    <div class="sub">Необязательно, но это единственный материал для будущего дебрифинга — почему вы закупили, арендовали и оценили товар именно так.</div>
    <textarea id="reflectionInput" placeholder="Например: сделали ставку на снежинки, потому что сплит рынка их выделял; аренду взяли в дешёвом ТЦ, чтобы сберечь кассу...">${S.pendingReflection||''}</textarea>
    <div class="rowfoot"><span></span><button class="primary" id="closeQuarterBtn">Открыть магазин и завершить квартал →</button></div>
  </div>`;
}

function infoNote(){
  return `<div class="infobar">Упрощения прототипа: производственная механика абстрагирована в квоту «изделий за квартал» (реальная физическая резка/сборка не моделируется); аренда переоформляется каждый квартал по текущей ставке; конкуренты ведут упрощённую экономику (прибыль оценивается по марже, а не по полному P&L).</div>`;
}

function renderQuarter(){
  save();
  renderTopbar();
  app.innerHTML = `
    ${infoNote()}
    <div class="grid">
      <div class="col-main">
        ${forecastCard()}
        ${materialsCard()}
        ${rentCard()}
        ${prodCard()}
        ${priceCard()}
        ${actionBar()}
      </div>
      <div>${sidebarCard()}</div>
    </div>`;
  wireQuarterEvents();
}

function wireQuarterEvents(){
  document.querySelectorAll('.cartInput').forEach(inp=>{
    inp.oninput = ()=>{ S.cart[inp.dataset.mat] = parseInt(inp.value||0,10); updateCartSum(); };
  });
  updateCartSum();
  document.querySelectorAll('.negBtn').forEach(btn=>{
    btn.onclick = async ()=>{
      const m = btn.dataset.mat;
      const qty = S.cart[m]||0;
      if(qty<1){ alert('Сначала укажите желаемое количество для закупки.'); return; }
      btn.disabled = true; btn.textContent = 'Договариваемся…';
      const price = teamPrices()[m];
      const res = await aiSupplierNegotiate(m, qty, price);
      S.supplierNote[m] = res;
      renderQuarter();
    };
  });
  document.getElementById('buyBtn').onclick = ()=>{
    const tp = teamPrices();
    let total = 0;
    const lines = [];
    for(const m of MATERIALS){
      const qty = S.cart[m]||0;
      if(qty<=0) continue;
      const negotiated = S.supplierNote[m];
      const price = negotiated ? negotiated.pricePerUnit : tp[m];
      total += qty*price;
      lines.push([m,qty,price,negotiated]);
    }
    if(total<=0){ return; }
    if(total > S.cash){ alert('Недостаточно средств в кассе.'); return; }
    S.cash -= total;
    S.quarterSpend = (S.quarterSpend||0) + total;
    lines.forEach(([m,qty,price,negotiated])=>{
      S.materials[m] = (S.materials[m]||0) + qty;
      S.qLog.purchases.push({material:m, qty, price, negotiated: !!negotiated, note: negotiated?negotiated.note:''});
    });
    S.cart = {}; S.supplierNote = {};
    renderQuarter();
  };
  document.querySelectorAll('.rentPlus').forEach(b=> b.onclick=()=>{ const m=b.dataset.mall; S.rentPicks[m]=Math.min(2,(S.rentPicks[m]||0)+1); renderQuarter(); });
  document.querySelectorAll('.rentMinus').forEach(b=> b.onclick=()=>{ const m=b.dataset.mall; S.rentPicks[m]=Math.max(0,(S.rentPicks[m]||0)-1); renderQuarter(); });

  document.querySelectorAll('.prodInput').forEach(inp=>{
    inp.oninput = ()=>{ S.prod[inp.dataset.sku] = parseInt(inp.value||0,10); refreshProdWarn(); };
  });
  refreshProdWarn();
  document.getElementById('prodBtn').onclick = ()=>{
    const used = Object.values(S.prod).reduce((a,b)=>a+(b||0),0);
    if(used > S.capacity){ alert('Превышена производственная мощность команды.'); return; }
    for(const [sku,qty] of Object.entries(S.prod)){
      if(!qty) continue;
      for(const [mat,per] of Object.entries(RECIPES[sku])){
        const need = per*qty;
        if((S.materials[mat]||0) < need){ alert(`Не хватает материала «${mat}» для «${sku}».`); return; }
      }
    }
    for(const [sku,qty] of Object.entries(S.prod)){
      if(!qty) continue;
      for(const [mat,per] of Object.entries(RECIPES[sku])){
        S.materials[mat] -= per*qty;
      }
      S.inventory[sku] = (S.inventory[sku]||0) + qty;
      S.qLog.production.push({sku, qty});
    }
    S.prod = {};
    renderQuarter();
  };

  document.querySelectorAll('.priceInput').forEach(inp=>{
    inp.oninput = ()=>{ S.price[inp.dataset.sku] = parseFloat(inp.value||0); S.lastPrice[inp.dataset.sku]=S.price[inp.dataset.sku]; };
  });

  const refInput = document.getElementById('reflectionInput');
  if(refInput) refInput.oninput = ()=>{ S.pendingReflection = refInput.value; };
  document.getElementById('closeQuarterBtn').onclick = startResolution;
}

function updateCartSum(){
  const tp = teamPrices();
  let total = 0;
  for(const m of MATERIALS){
    const qty = S.cart[m]||0;
    const price = S.supplierNote[m] ? S.supplierNote[m].pricePerUnit : tp[m];
    total += qty*price;
  }
  const el = document.getElementById('cartSum');
  if(el) el.textContent = fmt(total);
}
function refreshProdWarn(){
  const used = Object.values(S.prod).reduce((a,b)=>a+(b||0),0);
  const el = document.getElementById('prodWarn');
  if(el) el.textContent = used>S.capacity ? `Превышение мощности на ${used-S.capacity}` : '';
}

// ---------- resolution ----------
async function startResolution(){
  S.phase = "negotiate";
  app.innerHTML = `<div class="card"><h3>Открываем магазины…</h3><div class="sub">Агент решает, что предложат два конкурента, и покупатели идут по торговому центру.</div></div>`;
  const competitors = await aiCompetitors();
  S._competitors = competitors;

  // rent cost + chair count
  const rr = rentRates();
  let rentTotal = 0, chairs = 0;
  for(const [m,n] of Object.entries(S.rentPicks)){ rentTotal += (rr[m]||0)*n; chairs += n; }
  if(chairs>=3) rentTotal = Math.round(rentTotal*0.9); // documented bulk-rent discount
  if(rentTotal > S.cash){ rentTotal = S.cash; }
  S.cash -= rentTotal;
  S.quarterRent = rentTotal;

  // build buyer queue
  const needBuyers = [1,2,3,4];
  const c = commercial();
  const ledger = { player:{revenue:0}, comp1:{revenue:0}, comp2:{revenue:0}, wild:{revenue:0} };
  const stock = Object.assign({}, S.inventory);
  const pendingNegotiations = [];

  for(const b of needBuyers){
    const need = GAME_DATA.buyersNeeds[String(b)][currentQ()] || [];
    let budget = GAME_DATA.salaries[`Покупатель ${b}`][currentQ()];
    for(const item of need){
      const wildPrice = c.marketPrices[item.name] ?? item.maxPrice;
      const offers = [];
      const playerPrice = S.price[item.name];
      const playerHas = (stock[item.name]||0) > 0;
      if(playerHas && playerPrice!=null) offers.push({seller:'player', price:playerPrice});
      for(const compKey of ['comp1','comp2']){
        const comp = competitors[compKey==='comp1'?0:1];
        if(comp.prices && comp.prices[item.name]!=null) offers.push({seller:compKey, price:comp.prices[item.name]});
      }
      offers.push({seller:'wild', price:wildPrice});
      const affordable = offers.filter(o=> o.price<=item.maxPrice && o.price<=budget);
      affordable.sort((a,b2)=>a.price-b2.price);
      if(affordable.length){
        const win = affordable[0];
        if(win.seller==='player'){ stock[item.name] = (stock[item.name]||0)-1; }
        ledger[win.seller].revenue += win.price;
        budget -= win.price;
        continue;
      }
      // no offer within max price: is player's price a "close miss" worth negotiating?
      if(playerHas && playerPrice!=null && playerPrice<=item.maxPrice*1.25 && playerPrice<=budget*1.25 && pendingNegotiations.length<S.negBudget){
        pendingNegotiations.push({buyer:b, item:item.name, maxPrice:item.maxPrice, askPrice:playerPrice, budget});
      }
      // otherwise: buyer simply doesn't get this item this round (budget constrained or nobody in range)
    }
  }

  S._resolveState = {ledger, stock, budgetsLeft:{}, rentTotal};
  if(pendingNegotiations.length){
    S.negotiations = pendingNegotiations;
    renderNegotiations();
  }else{
    finishResolution();
  }
}

function renderNegotiations(){
  const items = S.negotiations.map((n,i)=>`
    <div class="pitchbox" id="pitch-${i}">
      <div class="who">Покупатель ${n.buyer} присматривается к «${n.item}»</div>
      <div class="what">Ваша цена ${n.askPrice} у.е. выше того, что он готов заплатить без причины. Можете обосновать цену (качество, персонализация, индивидуальный подход) — или пропустить.</div>
      <div class="pitchrow">
        <input type="text" placeholder="например: сделаем именную надпись бесплатно" id="pitchText-${i}">
        <button class="primary small" id="pitchBtn-${i}">Убедить</button>
        <button class="ghost small" id="skipBtn-${i}">Пропустить</button>
      </div>
      <div id="pitchReply-${i}"></div>
    </div>`).join("");
  app.innerHTML = `<div class="card"><h3>Переговоры с покупателями</h3><div class="sub">Покупатель по умолчанию не раскрывает вам свой бюджет и список — только реагирует на ваше предложение.</div>${items}
    <div class="rowfoot"><span></span><button class="primary" id="finishNegBtn" disabled>Продолжить →</button></div>
  </div>`;
  S.negotiations.forEach((n,i)=>{
    document.getElementById(`pitchBtn-${i}`).onclick = async ()=>{
      const text = document.getElementById(`pitchText-${i}`).value || "Обычная цена без скидки.";
      document.getElementById(`pitchBtn-${i}`).disabled = true;
      document.getElementById(`skipBtn-${i}`).disabled = true;
      const res = await aiBuyerDecision(n.buyer, n.item, n.maxPrice, n.askPrice, text);
      n.resolved = true; n.accepted = res.accept;
      const el = document.getElementById(`pitchReply-${i}`);
      el.innerHTML = `<div class="reply ${res.accept?'ok':'no'}">${res.accept?'✓ Согласился: ':'✗ Отказался: '}«${res.note}»</div>`;
      checkNegDone();
    };
    document.getElementById(`skipBtn-${i}`).onclick = ()=>{
      n.resolved = true; n.accepted = false;
      document.getElementById(`pitchReply-${i}`).innerHTML = `<div class="reply no">Пропущено</div>`;
      document.getElementById(`pitchBtn-${i}`).disabled = true;
      document.getElementById(`skipBtn-${i}`).disabled = true;
      checkNegDone();
    };
  });
  checkNegDone();
}
function checkNegDone(){
  const btn = document.getElementById('finishNegBtn');
  const allDone = S.negotiations.every(n=>n.resolved);
  if(btn){ btn.disabled = !allDone; btn.onclick = allDone ? applyNegotiationsAndFinish : null; }
}
function applyNegotiationsAndFinish(){
  const {ledger, stock} = S._resolveState;
  S.negotiations.forEach(n=>{
    if(n.accepted){
      ledger.player.revenue += n.askPrice;
      stock[n.item] = (stock[n.item]||0)-1;
    }
  });
  finishResolution();
}

function finishResolution(){
  const {ledger, rentTotal} = S._resolveState;
  const stock = S._resolveState.stock;
  // clamp stock at 0
  Object.keys(stock).forEach(k=> stock[k]=Math.max(0,stock[k]));
  S.inventory = stock;

  const playerRevenue = ledger.player.revenue;
  const materialsSpend = S.quarterSpend||0;
  const playerProfit = playerRevenue - materialsSpend - rentTotal;
  S.cash += playerRevenue;

  const comp1Revenue = ledger.comp1.revenue, comp2Revenue = ledger.comp2.revenue;
  const comp1Profit = Math.round(comp1Revenue*0.45), comp2Profit = Math.round(comp2Revenue*0.45);
  S.comp.comp1.cash += comp1Profit;
  S.comp.comp2.cash += comp2Profit;

  const wildRevenue = ledger.wild.revenue;
  const wildCost = Math.ceil(wildRevenue*0.9);
  const wildProfit = wildRevenue - wildCost;
  S.comp.wild.cash += wildProfit;

  const record = {
    q: currentQ(),
    player: {revenue:playerRevenue, cost:materialsSpend+rentTotal, profit:playerProfit, cash:S.cash},
    comp1: {revenue:comp1Revenue, profit:comp1Profit, cash:S.comp.comp1.cash},
    comp2: {revenue:comp2Revenue, profit:comp2Profit, cash:S.comp.comp2.cash},
    wild: {revenue:wildRevenue, profit:wildProfit, cash:S.comp.wild.cash},
  };
  S.history.push(record);

  S.decisionLog.push({
    q: currentQ(),
    purchases: S.qLog.purchases,
    production: S.qLog.production,
    rent: Object.assign({}, S.rentPicks),
    prices: Object.assign({}, S.price),
    negotiations: S.negotiations.map(n=>({buyer:n.buyer, item:n.item, askPrice:n.askPrice, accepted:!!n.accepted})),
    reflection: (S.pendingReflection||'').trim(),
    result: record,
  });
  S.qLog = {purchases:[], production:[]};
  S.pendingReflection = "";

  S.quarterSpend = 0; S.quarterRent = 0; S.negotiations = [];
  S.phase = "results";
  renderResults(record);
}

function renderResults(record){
  save();
  renderTopbar();
  const last = S.qIdx===QUARTERS.length-1;
  app.innerHTML = `
  <div class="card">
    <h3>Итоги квартала — ${QLABEL[record.q]}</h3>
    <div class="resultgrid">
      <div class="rtile"><div class="l">Оборот</div><div class="v num">${fmt(record.player.revenue)}</div></div>
      <div class="rtile"><div class="l">Затраты</div><div class="v num">${fmt(record.player.cost)}</div></div>
      <div class="rtile"><div class="l">Прибыль</div><div class="v num" style="color:${record.player.profit>=0?'var(--good)':'var(--bad)'}">${fmt(record.player.profit)}</div></div>
      <div class="rtile"><div class="l">Касса</div><div class="v num">${fmt(record.player.cash)}</div></div>
    </div>
    <div class="tblwrap"><table>
      <tr><th></th><th class="num">Оборот</th><th class="num">Прибыль</th><th class="num">Касса</th></tr>
      <tr><td>Конкурент 1 <span class="badge-ai">AI</span></td><td class="num">${fmt(record.comp1.revenue)}</td><td class="num">${fmt(record.comp1.profit)}</td><td class="num">${fmt(record.comp1.cash)}</td></tr>
      <tr><td>Конкурент 2 <span class="badge-ai">AI</span></td><td class="num">${fmt(record.comp2.revenue)}</td><td class="num">${fmt(record.comp2.profit)}</td><td class="num">${fmt(record.comp2.cash)}</td></tr>
      <tr><td>WildZone</td><td class="num">${fmt(record.wild.revenue)}</td><td class="num">${fmt(record.wild.profit)}</td><td class="num">${fmt(record.wild.cash)}</td></tr>
    </table></div>
    <div class="rowfoot">
      <span class="muted">${aiAvailable? 'Решения покупателей/поставщика/конкурентов — от подключённого агента.' : 'Агент недоступен в этом просмотре — использованы задокументированные запасные правила.'}</span>
      <div style="display:flex; gap:8px;">
        <button class="ghost" id="debriefBtn">Открыть дебрифинг</button>
        <button class="primary" id="nextBtn">${last? 'Подвести итог симуляции →' : 'Следующий квартал →'}</button>
      </div>
    </div>
  </div>`;
  document.getElementById('nextBtn').onclick = ()=>{
    if(last){ renderFinal(); return; }
    S.qIdx += 1;
    S.phase = "shopping";
    renderTopbar();
    renderQuarter();
  };
  document.getElementById('debriefBtn').onclick = ()=>{ S.phase="debrief"; renderDebrief(); };
}

function renderFinal(){
  S.phase = 'done';
  save();
  renderTopbar();
  const finalRow = S.history[S.history.length-1];
  const board = [
    {name:'Вы', cash:finalRow.player.cash, ai:false},
    {name:'Конкурент 1', cash:finalRow.comp1.cash, ai:true},
    {name:'Конкурент 2', cash:finalRow.comp2.cash, ai:true},
    {name:'WildZone', cash:finalRow.wild.cash, ai:true},
  ].sort((a,b)=>b.cash-a.cash);
  const rows = board.map((r,i)=>`<tr><td>${i+1}</td><td>${r.name}${r.ai?' <span class="badge-ai">AI</span>':''}</td><td class="num">${fmt(r.cash)}</td></tr>`).join("");
  app.innerHTML = `<div class="card">
    <h3>Симуляция завершена — 8 кварталов</h3>
    <div class="sub">Итоговая касса участников рынка</div>
    <div class="tblwrap"><table><tr><th>#</th><th>Участник</th><th class="num">Касса</th></tr>${rows}</table></div>
    <div class="rowfoot">
      <span class="muted">Итог по кассе — не главный результат этой игры.</span>
      <div style="display:flex; gap:8px;">
        <button class="ghost" id="debriefBtn">Открыть дебрифинг</button>
        <button class="primary" id="restartBtn">Новая игра</button>
      </div>
    </div>
  </div>`;
  document.getElementById('restartBtn').onclick = ()=>{
    try{ localStorage.removeItem('snezhinka-ai-save'); }catch(e){}
    S = null; renderTopbar(); setup();
  };
  document.getElementById('debriefBtn').onclick = ()=>{ S.phase="debrief"; renderDebrief(); };
}

// ---------- debrief: реакция → факты → анализ → выводы и планы ----------
function debriefStageBar(stage){
  const labels = ['Реакция','Факты','Анализ','Выводы и планы'];
  return `<div class="stagebar">${labels.map((l,i)=>`<span class="seg ${i<stage?'done':(i===stage?'on':'')}" title="${l}"></span>`).join('')}</div>
  <div class="chiprow" style="margin-bottom:14px;">${labels.map((l,i)=>`<span class="chip" style="${i===stage?'':'opacity:.45'}">${i+1}. ${l}</span>`).join('')}</div>`;
}

function renderDebrief(){
  save();
  renderTopbar();
  const st = S.debrief.stage;
  if(st===0) return renderDebriefEmotions();
  if(st===1) return renderDebriefFacts();
  if(st===2) return renderDebriefAnalysis();
  return renderDebriefConclusions();
}

function renderDebriefEmotions(){
  app.innerHTML = `<div class="card">
    <div class="eyebrow">Дебрифинг · шаг 1 из 4</div>
    ${debriefStageBar(0)}
    <h3>Первая реакция на итог</h3>
    <div class="sub">Не разбор, не «почему» — коротко, одним-двумя словами. По методике этот шаг нужен, только если реакция была реально сильной (азарт, досада на упущенный квартал); если отношение ровное — смело нажимайте «Далее» пустым.</div>
    <textarea id="emoInput" placeholder="Например: азарт; досада из-за упущенного квартала; ровно, без сильной реакции">${S.debrief.answers.emotions||''}</textarea>
    <div class="rowfoot"><span class="muted">${S.decisionLog.length} квартал(ов) в логе решений</span><button class="primary" id="emoNext">Далее: факты →</button></div>
  </div>`;
  document.getElementById('emoNext').onclick = ()=>{
    S.debrief.answers.emotions = document.getElementById('emoInput').value;
    S.debrief.stage = 1;
    renderDebrief();
  };
}

async function renderDebriefFacts(){
  if(S.debrief.facts===null){
    app.innerHTML = `<div class="card"><div class="eyebrow">Дебрифинг · шаг 2 из 4</div>${debriefStageBar(1)}<h3>Восстанавливаем факты…</h3><div class="prose loading">Агент собирает нейтральную хронику по вашему логу решений.</div></div>`;
    S.debrief.facts = await aiDebriefFacts();
  }
  app.innerHTML = `<div class="card">
    <div class="eyebrow">Дебрифинг · шаг 2 из 4</div>
    ${debriefStageBar(1)}
    <h3>Что происходило — по фактам</h3>
    <div class="sub">Собрано из вашего лога решений, без оценок. Максимально вспомните детали: что было дальше, что происходило с точки зрения Покупателей? Поставщиков?</div>
    <div class="prose">${S.debrief.facts}</div>
    <div class="field" style="margin-top:16px;">
      <label>Что бы вы добавили к фактам?</label>
      <textarea id="factsAddInput" placeholder="Необязательно">${S.debrief.answers.factsAdd||''}</textarea>
    </div>
    <div class="rowfoot"><button class="ghost" id="factsBack">← Назад</button><button class="primary" id="factsNext">Далее: анализ →</button></div>
  </div>`;
  document.getElementById('factsBack').onclick = ()=>{ S.debrief.stage=0; renderDebrief(); };
  document.getElementById('factsNext').onclick = ()=>{
    S.debrief.answers.factsAdd = document.getElementById('factsAddInput').value;
    S.debrief.stage = 2;
    renderDebrief();
  };
}

async function renderDebriefAnalysis(){
  if(S.debrief.analysis===null){
    app.innerHTML = `<div class="card"><div class="eyebrow">Дебрифинг · шаг 3 из 4</div>${debriefStageBar(2)}<h3>Анализируем проявления…</h3><div class="prose loading">Агент сопоставляет решения и результаты по трём зонам: риск и планирование, переговоры, адаптивность.</div></div>`;
    S.debrief.analysis = await aiDebriefAnalysis(S.debrief.facts, S.debrief.answers.factsAdd);
  }
  app.innerHTML = `<div class="card">
    <div class="eyebrow">Дебрифинг · шаг 3 из 4</div>
    ${debriefStageBar(2)}
    <h3>Что получилось, что нет — и почему</h3>
    <div class="sub">Что этому способствовало? Что препятствовало? В чём был основной успех, в чём главная ошибка?</div>
    <div class="prose">${S.debrief.analysis}</div>
    <div class="rowfoot"><button class="ghost" id="anBack">← Назад</button><button class="primary" id="anNext">Далее: выводы →</button></div>
  </div>`;
  document.getElementById('anBack').onclick = ()=>{ S.debrief.stage=1; renderDebrief(); };
  document.getElementById('anNext').onclick = ()=>{ S.debrief.stage=3; renderDebrief(); };
}

function renderDebriefConclusions(){
  app.innerHTML = `<div class="card">
    <div class="eyebrow">Дебрифинг · шаг 4 из 4</div>
    ${debriefStageBar(3)}
    <h3>Выводы и первые шаги</h3>
    <div class="field">
      <label>Что произошедшее в игре напоминает из вашей реальной работы?</label>
      <textarea id="likeInput" placeholder="Где вы видели похожие явления или решения?">${S.debrief.answers.lessons||''}</textarea>
    </div>
    <div class="field">
      <label>Что вы намерены с этим делать? Какие первые шаги?</label>
      <textarea id="stepsInput" placeholder="Один-два конкретных следующих шага">${S.debrief.answers.nextSteps||''}</textarea>
    </div>
    <div class="rowfoot"><button class="ghost" id="conBack">← Назад</button><button class="primary" id="conDone">Завершить дебрифинг</button></div>
  </div>`;
  document.getElementById('conBack').onclick = ()=>{ S.debrief.stage=2; renderDebrief(); };
  document.getElementById('conDone').onclick = ()=>{
    S.debrief.answers.lessons = document.getElementById('likeInput').value;
    S.debrief.answers.nextSteps = document.getElementById('stepsInput').value;
    renderDebriefSummary();
  };
}

function renderDebriefSummary(){
  save();
  app.innerHTML = `<div class="card">
    <h3>Дебрифинг — резюме</h3>
    <div class="qblock"><div class="qh">Первая реакция</div><div class="prose">${S.debrief.answers.emotions||'—'}</div></div>
    <div class="qblock"><div class="qh">Факты</div><div class="prose">${S.debrief.facts||'—'}</div></div>
    <div class="qblock"><div class="qh">Анализ проявлений</div><div class="prose">${S.debrief.analysis||'—'}</div></div>
    <div class="qblock"><div class="qh">Похоже на реальную работу</div><div class="prose">${S.debrief.answers.lessons||'—'}</div></div>
    <div class="qblock"><div class="qh">Первые шаги</div><div class="prose">${S.debrief.answers.nextSteps||'—'}</div></div>
    <div class="rowfoot"><span class="muted">Сохранено в этом браузере вместе с игрой.</span><button class="primary" id="backBtn">Вернуться к игре</button></div>
  </div>`;
  document.getElementById('backBtn').onclick = ()=>{
    S.phase = S.qIdx>=QUARTERS.length-1 && S.history.length===QUARTERS.length ? 'done' : 'results';
    if(S.phase==='done'){ renderFinal(); } else { renderResults(S.history[S.history.length-1]); }
  };
}

// ---------- boot ----------
(async function init(){
  await ensureAI();
  const saved = loadSave();
  if(saved && saved.qIdx!=null){
    S = saved;
    if(!S.decisionLog) S.decisionLog = [];
    if(!S.qLog) S.qLog = {purchases:[], production:[]};
    if(S.pendingReflection==null) S.pendingReflection = "";
    if(!S.debrief) S.debrief = {stage:0, answers:{}, facts:null, analysis:null};
    renderTopbar();
    if(S.phase==='debrief'){ renderDebrief(); }
    else if(S.phase==='results' && S.history.length){ renderResults(S.history[S.history.length-1]); }
    else if(S.phase==='done'){ renderFinal(); }
    else { S.phase='shopping'; renderQuarter(); }
  } else {
    setup();
  }
  document.getElementById('footNote').textContent = 'Личный прототип на реальных данных РРС «Снежинка» (ФО, версия 3). Не является официальным цифровым продуктом ДНС.';
})();
