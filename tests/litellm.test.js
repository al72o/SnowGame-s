'use strict';

// Offline tests: never call the real corporate gateway or use a real key.
process.env.AGENT_PROVIDER = 'litellm';
process.env.OPENAI_API_KEY = 'sk-unit-test-not-real';
process.env.OPENAI_BASE_URL = 'https://litellm.dns-shop.ru/v1';
process.env.OPENAI_MODEL = 'qwen3.8-flash-next';
process.env.OPENAI_JSON_MODE = 'auto';
process.env.OPENAI_TEMPERATURE = 'omit';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activeName, activeInfo, runTask, providers } = require('../server/providers');

test('DNS LiteLLM provider is registered and does not expose its key', () => {
  assert.equal(activeName(), 'litellm');
  assert.strictEqual(providers.litellm, providers.openai);
  const info = activeInfo();
  assert.equal(info.provider, 'litellm');
  assert.equal(info.model, 'qwen3.8-flash-next');
  assert.equal(info.baseUrl, 'https://litellm.dns-shop.ru/v1');
  assert.equal(info.configured, true);
  assert.equal(JSON.stringify(info).includes(process.env.OPENAI_API_KEY), false);
});

const examples = [
  ['supplier_negotiate',
    { material: 'Бумага', qty: 25, basePrice: 10, tierLow: 9, tierHigh: 8 },
    { pricePerUnit: 9, note: 'Оптовая цена' }],
  ['buyer_decision',
    { buyerNum: 2, item: 'Ёлочки', maxPrice: 165, askPrice: 180, pitch: 'Именная надпись' },
    { accept: true, note: 'Беру' }],
  ['competitors',
    { quarterLabel: '1 кв. 2026', capacity: '2000', skuLines: 'Ёлочки: 165' },
    { competitors: [
      { name: 'Конкурент 1', prices: { 'Ёлочки': 160 }, rentChairs: 1 },
      { name: 'Конкурент 2', prices: { 'Ёлочки': 170 }, rentChairs: 2 },
    ] }],
  ['debrief_facts',
    { log: 'Продажи: 8 штук' },
    { text: 'В квартале продали 8 штук.' }],
  ['debrief_analysis',
    { log: 'Снизили цену', addedFacts: 'Проверяли спрос' },
    { text: 'Команда проверила спрос и адаптировала цены.' }],
];

for (const [task, input, expected] of examples) {
  test(`offline LiteLLM adapter: ${task}`, async () => {
    let calls = 0;
    global.fetch = async (url, options) => {
      calls++;
      assert.equal(url, 'https://litellm.dns-shop.ru/v1/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer sk-unit-test-not-real');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'qwen3.8-flash-next');
      assert.equal(Object.hasOwn(body, 'temperature'), false);
      assert.ok(Array.isArray(body.messages));
      const content = task.startsWith('debrief_') ? expected.text : JSON.stringify(expected);
      return { ok: true, status: 200, json: async () => ({
        choices: [{ message: { content } }],
      }) };
    };
    assert.deepEqual(await runTask(task, input), expected);
    assert.equal(calls, 1);
  });
}

test('JSON response_format automatically retries if LiteLLM returns 400', async () => {
  let calls = 0;
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls++;
    if (calls === 1) {
      assert.deepEqual(body.response_format, { type: 'json_object' });
      return { ok: false, status: 400, text: async () => 'unsupported' };
    }
    assert.equal(Object.hasOwn(body, 'response_format'), false);
    return { ok: true, status: 200, json: async () => ({
      choices: [{ message: { content: '{"pricePerUnit":9,"note":"Опт"}' } }],
    }) };
  };
  const result = await runTask('supplier_negotiate',
    { material: 'Бумага', qty: 25, basePrice: 10, tierLow: 9, tierHigh: 8 });
  assert.equal(result.pricePerUnit, 9);
  assert.equal(calls, 2);
});
