// -----------------------------------------------------------------------------
// openai — "живой" провайдер поверх Chat Completions API.
// Работает не только с api.openai.com: любой OpenAI-совместимый эндпоинт
// (self-hosted vLLM/Ollama/LM Studio, OpenRouter и т.п.) подходит — просто
// смените OPENAI_BASE_URL. Это самый быстрый способ "подключить другого
// агента на другой машине", о котором просил пользователь: конкретная модель
// или прокси меняются через .env, код здесь трогать не нужно.
//
// Промпты ниже — те же самые (дословно), что были в клиентском прототипе на
// Claude Artifacts (window.claude.use("sample")). Подробное описание каждой
// задачи, её входа/выхода и то, как писать провайдер под другую модель —
// см. AGENT.md в корне проекта.
// -----------------------------------------------------------------------------

const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\\/+$/, '');
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const API_KEY = process.env.OPENAI_API_KEY || '';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS || '45000', 10);
const JSON_MODE = (process.env.OPENAI_JSON_MODE || 'auto').toLowerCase();
const TEMPERATURE = Number.parseFloat(process.env.OPENAI_TEMPERATURE || '0.7');

async function requestChat(messages, { useResponseFormat = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: Number.isFinite(TEMPERATURE) ? TEMPERATURE : 0.7,
        ...(useResponseFormat ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`AI API не ответил за ${REQUEST_TIMEOUT_MS} мс`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readContent(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI-совместимый API ответил ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  let content = data?.choices?.[0]?.message?.content;

  if (Array.isArray(content)) {
    content = content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  }

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Пустой ответ модели');
  }

  return content.trim();
}

async function chat(messages, { json = false } = {}) {
  if (!API_KEY) {
    throw new Error('OPENAI_API_KEY не задан (см. .env.example)');
  }

  const wantsResponseFormat = json && JSON_MODE !== 'off';
  let res = await requestChat(messages, { useResponseFormat: wantsResponseFormat });

  if (
    wantsResponseFormat &&
    JSON_MODE === 'auto' &&
    (res.status === 400 || res.status === 422)
  ) {
    // Не все OpenAI-compatible прокси/модели поддерживают response_format.
    // В auto-режиме повторяем тот же запрос без этой опции.
    res = await requestChat(messages, { useResponseFormat: false });
  }

  return readContent(res);
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch (_) {
    const withoutFence = content
      .replace(/^\`\`\`(?:json)?\\s*/i, '')
      .replace(/\\s*\`\`\`$/i, '')
      .trim();

    try {
      return JSON.parse(withoutFence);
    } catch (_) {
      const start = withoutFence.indexOf('{');
      const end = withoutFence.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(withoutFence.slice(start, end + 1));
      }
      throw new Error('Модель вернула невалидный JSON');
    }
  }
}

async function chatJson(prompt) {
  const content = await chat(
    [
      { role: 'system', content: 'Ты отвечаешь строго валидным JSON-объектом, без markdown-разметки и пояснений вне JSON.' },
      { role: 'user', content: prompt },
    ],
    { json: true }
  );
  return parseJsonObject(content);
}

async function chatText(prompt) {
  return chat([{ role: 'user', content: prompt }], { json: false });
}

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
      throw new Error(`openai: неизвестная задача "${task}"`);
  }
}

async function supplierNegotiate({ material, qty, basePrice, tierLow, tierHigh }) {
  const prompt = `Ты — поставщик материалов для команд в деловой игре «Снежинка». Правила твоей роли:
Сами никогда не предлагай скидку первым. Если участник команды просит скидку — в первую очередь предложи закупиться оптом по своему прайс-листу. В особых случаях можешь дать дополнительную скидку до 5%.
Твой закрытый (не показывается командам) прайс-лист на "${material}" в этом квартале: розница ${basePrice} у.е./шт, опт от 20 до 50 шт — ${tierLow != null ? tierLow : 'нет тиража'} у.е./шт, опт от 51 шт — ${tierHigh != null ? tierHigh : 'нет тиража'} у.е./шт.
Команда хочет купить ${qty} шт. "${material}". Реши цену за штуку по своим правилам (примени опт, если объём подходит; иначе можешь дать не более 5% скидки, если объём внушительный, иначе не давай скидку).
Ответь JSON: {"pricePerUnit": число, "note": "короткая реплика поставщика игроку, по-русски, 1 фраза"}`;
  const res = await chatJson(prompt);
  if (typeof res.pricePerUnit !== 'number') throw new Error('supplier_negotiate: нет pricePerUnit в ответе');
  return res;
}

async function buyerDecision({ buyerNum, item, maxPrice, askPrice, pitch }) {
  const prompt = `Ты играешь роль Покупателя №${buyerNum} в деловой игре «Снежинка». Твои правила поведения:
Ты обычный покупатель, приобретаешь товары для личного пользования или в подарок. Твоя задача — удовлетворить свою потребность в товарах с наилучшим соотношением цены и качества.
Если магазин пытается продать товар по цене выше максимальной, это должно быть обосновано чем-то, что имеет для тебя значение: качество товара, персонализация (надписи/изображения по заказу), индивидуальный подход и т.д. Если цена завышена без веских оснований — ты отказываешься и ссылаешься на то, что купишь такой же товар на маркетплейсе Wildzone по рыночной цене.
Твоя максимальная цена на "${item}" в этом квартале — ${maxPrice} у.е. (это твоя внутренняя информация, никогда не называй её продавцу напрямую в поле note).
Продавец предлагает тебе "${item}" за ${askPrice} у.е. и говорит: "${pitch}"
Прими решение и ответь JSON: {"accept": true/false, "note": "твоя короткая устная реплика продавцу, по-русски, 1-2 фразы, не называй точную максимальную цену"}`;
  const res = await chatJson(prompt);
  if (typeof res.accept !== 'boolean') throw new Error('buyer_decision: нет accept в ответе');
  return res;
}

async function competitors({ quarterLabel, capacity, skuLines }) {
  const prompt = `Ты моделируешь решения ДВУХ конкурирующих команд в деловой игре «Снежинка» на квартал ${quarterLabel}. Каждая команда — производственно-торговая компания, продаёт снежинки/ёлочки/шляпы/кораблики/самолёты, конкурирует за тех же покупателей. Ориентировочная ёмкость рынка в этом квартале: ${capacity} у.е. Рыночные цены-ориентиры: ${skuLines}.
Для каждой из двух команд реши: какие 2-4 товара она выставит на витрину и по какой цене (обычно около рыночной цены, немного выше или ниже — по своей стратегии), и сколько стульев (0-3) она арендует в одном торговом центре.
Ответь JSON: {"competitors":[{"name":"Конкурент 1","prices":{"товар":цена,...},"rentChairs":число},{"name":"Конкурент 2","prices":{...},"rentChairs":число}]}`;
  const res = await chatJson(prompt);
  if (!res.competitors || res.competitors.length !== 2) throw new Error('competitors: неверная форма ответа');
  return res;
}

async function debriefFacts({ log }) {
  const prompt = `Ты помогаешь провести дебрифинг после деловой игры «Снежинка» (бизнес-симуляция для руководителей). Ниже — фактический лог решений одного участника по кварталам. Составь нейтральное, короткое фактологическое изложение того, что происходило — только события, без оценок, советов и подбадриваний. Пиши по-русски, по кварталам, пунктами.

${log}`;
  const text = await chatText(prompt);
  return { text };
}

async function debriefAnalysis({ log, addedFacts }) {
  const prompt = `Ты — HR-фасилитатор дебрифинга деловой игры «Снежинка» для топ-менеджеров ДНС. На основе лога решений участника ниже сформулируй наблюдения о его проявлениях в трёх зонах: (1) отношение к риску и планированию, (2) переговорная позиция и работа с возражениями/отказами, (3) адаптивность при изменении рыночных условий (например, ввод нового SKU «Дед Мороз» в 4 квартале). Для каждой зоны — 2-3 предложения, с опорой на то, что конкретно произошло в игре, без общих фраз и без оценки «хорошо/плохо» — фиксируй наблюдаемое поведение и на что стоит обратить внимание в реальной работе. Пиши по-русски.

Лог решений:
${log}

${addedFacts ? 'Дополнение участника к фактам: ' + addedFacts : ''}`;
  const text = await chatText(prompt);
  return { text };
}

function info() {
  return {
    model: MODEL,
    baseUrl: BASE_URL,
    configured: Boolean(API_KEY),
    timeoutMs: REQUEST_TIMEOUT_MS,
    jsonMode: JSON_MODE,
  };
}

module.exports = { run, info };
