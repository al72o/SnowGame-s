// -----------------------------------------------------------------------------
// stub — детерминированный провайдер без обращения к какой-либо модели.
// Это провайдер по умолчанию (AGENT_PROVIDER=stub или переменная не задана),
// так что `npm start` работает "из коробки" без единого ключа — ровно то же
// поведение офлайн-режима, что было зашито в клиент прототипа на Claude Artifacts.
// Полезен для разработки, для демонстраций без интернета и как safety net,
// если "живой" провайдер недоступен.
// -----------------------------------------------------------------------------

async function run(task, input) {
  switch (task) {
    case 'supplier_negotiate':
      return supplierNegotiate(input);
    case 'buyer_decision':
      return buyerDecision(input);
    case 'competitors':
      return competitors(input);
    case 'debrief_facts':
      return debriefFacts(input);
    case 'debrief_analysis':
      return debriefAnalysis(input);
    default:
      throw new Error(`stub: неизвестная задача "${task}"`);
  }
}

function supplierNegotiate({ material, qty, basePrice, tierLow, tierHigh }) {
  let price = basePrice;
  if (tierLow != null && tierHigh != null) {
    if (qty >= 51) price = tierHigh;
    else if (qty >= 20) price = tierLow;
  } else if (qty >= 20) {
    price = +(basePrice * 0.95).toFixed(1);
  }
  return {
    pricePerUnit: price,
    note: '(офлайн-режим: применены задокументированные оптовые условия)',
  };
}

function buyerDecision({ maxPrice, askPrice, pitch }) {
  const ok = askPrice <= maxPrice * 1.12 && pitch && pitch.trim().length > 3;
  return {
    accept: ok,
    note: ok
      ? '(офлайн-режим) Ладно, уговорили, беру.'
      : '(офлайн-режим) Нет, это неоправданно дорого, куплю на Wildzone.',
  };
}

function competitors({ skuLines }) {
  const skus = String(skuLines || '')
    .split(';')
    .map((s) => s.split(':')[0].trim())
    .filter(Boolean);
  const priceOf = (name) => {
    const m = String(skuLines).match(new RegExp(`${escapeRe(name)}: рыночная цена ([\\d.]+)`));
    return m ? parseFloat(m[1]) : 20;
  };
  const out = [1, 2].map((i) => {
    const chosen = shuffle(skus.slice()).slice(0, 3);
    const prices = {};
    chosen.forEach((s) => {
      prices[s] = Math.round(priceOf(s) * (0.9 + Math.random() * 0.22));
    });
    return { name: `Конкурент ${i}`, prices, rentChairs: 2 };
  });
  return { competitors: out };
}

function debriefFacts() {
  return {
    text:
      '(офлайн-режим: провайдер stub не формирует ИИ-обобщение) ' +
      'Пересмотрите лог решений на предыдущем экране квартал за кварталом — там уже есть все факты по закупкам, аренде, производству и переговорам.',
  };
}

function debriefAnalysis() {
  return {
    text:
      'AI недоступен (провайдер stub) — офлайн-режим не формирует поведенческий анализ автоматически. ' +
      'Обсудите лог решений вживую по той же структуре: риск и планирование, переговорная позиция, адаптивность при изменении рыночных условий.',
  };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { run };
