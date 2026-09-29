#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FULL=false

usage() {
  cat <<'EOF'
Live AI smoke-test SnowGame-s

Использование:
  bash scripts/live-ai-smoke.sh [--project-dir PATH] [--full]

По умолчанию выполняется один реальный запрос supplier_negotiate.
--full дополнительно проверяет buyer_decision, competitors,
debrief_facts и debrief_analysis.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir)
      PROJECT_DIR="${2:-}"
      shift 2
      ;;
    --full)
      FULL=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Неизвестная опция: $1" >&2
      usage
      exit 2
      ;;
  esac
done

cd "$PROJECT_DIR"

if [[ -z "${APP_BIND_PORT:-}" && -f .env ]]; then
  APP_BIND_PORT="$(grep -E '^APP_BIND_PORT=[0-9]+ --status running app | grep -q app; then
  echo "Контейнер app не запущен." >&2
  docker compose ps >&2 || true
  exit 1
fi

echo "=== Local service health ==="
curl -fsS "http://127.0.0.1:${APP_BIND_PORT}/healthz"
echo
echo

if $FULL; then
  TEST_MODE=full
else
  TEST_MODE=quick
fi

echo "=== Real provider test: $TEST_MODE ==="

docker compose exec -T -e SNOWGAME_TEST_MODE="$TEST_MODE" app node <<'NODE'
const provider = require('./server/providers/openai');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, input, validate) {
  const started = Date.now();
  const result = await provider.run(name, input);
  validate(result);
  console.log(`✅ ${name} (${Date.now() - started} ms)`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

(async () => {
  const info = provider.info();

  console.log(JSON.stringify({
    provider: 'openai',
    model: info.model,
    baseUrl: info.baseUrl,
    configured: info.configured,
    timeoutMs: info.timeoutMs,
    jsonMode: info.jsonMode,
  }, null, 2));

  assert(info.configured, 'OPENAI_API_KEY не настроен внутри контейнера');
  assert(info.model === 'gpt-6-luna', `Ожидалась модель gpt-6-luna, получено: ${info.model}`);
  assert(
    info.baseUrl === 'https://ru.cheapvibecode.ru/v1',
    `Неожиданный OPENAI_BASE_URL: ${info.baseUrl}`
  );

  await test(
    'supplier_negotiate',
    {
      material: 'Лист белой бумаги',
      qty: 25,
      basePrice: 10,
      tierLow: 9,
      tierHigh: 8,
    },
    (r) => {
      assert(Number.isFinite(r?.pricePerUnit), 'supplier_negotiate: pricePerUnit не число');
      assert(typeof r?.note === 'string' && r.note.length > 0, 'supplier_negotiate: нет note');
    }
  );

  if (process.env.SNOWGAME_TEST_MODE !== 'full') {
    console.log('✅ QUICK AI SMOKE PASS');
    return;
  }

  await test(
    'buyer_decision',
    {
      buyerNum: 2,
      item: 'Ёлочки',
      maxPrice: 165,
      askPrice: 180,
      pitch: 'Именная надпись бесплатно',
    },
    (r) => {
      assert(typeof r?.accept === 'boolean', 'buyer_decision: accept не boolean');
      assert(typeof r?.note === 'string' && r.note.length > 0, 'buyer_decision: нет note');
    }
  );

  await test(
    'competitors',
    {
      quarterLabel: '4 кв. 2026',
      capacity: '1900-2800 у.е.',
      skuLines: 'Снежинки маленькие: 19 у.е.; Ёлочки: 165 у.е.; Шляпы бумажные: 30 у.е.',
    },
    (r) => {
      assert(Array.isArray(r?.competitors), 'competitors: нет массива competitors');
      assert(r.competitors.length === 2, 'competitors: ожидалось ровно 2 конкурента');
    }
  );

  await test(
    'debrief_facts',
    {
      log: '## 1 кв. 2026\nЗакупили бумагу и картон. Арендовали 1 стул. Продали 8 ёлочек. Квартал завершили с прибылью.',
    },
    (r) => {
      assert(typeof r?.text === 'string' && r.text.length > 10, 'debrief_facts: нет текста');
    }
  );

  await test(
    'debrief_analysis',
    {
      log: '## 1 кв. 2026\nЗакупили большой запас материалов. Цены держали выше рынка. После отказов покупателя снизили цену во втором раунде.',
      addedFacts: 'Высокую стартовую цену выбрали намеренно для проверки спроса.',
    },
    (r) => {
      assert(typeof r?.text === 'string' && r.text.length > 20, 'debrief_analysis: нет текста');
    }
  );

  console.log('✅ FULL AI ACCEPTANCE PASS');
})().catch((error) => {
  console.error('❌ AI SMOKE FAILED');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
NODE
 .env | tail -1 | cut -d= -f2 || true)"
fi
APP_BIND_PORT="${APP_BIND_PORT:-3000}"

if ! docker compose ps --status running app | grep -q app; then
  echo "Контейнер app не запущен." >&2
  docker compose ps >&2 || true
  exit 1
fi

echo "=== Local service health ==="
curl -fsS http://127.0.0.1:3000/healthz
echo
echo

if $FULL; then
  TEST_MODE=full
else
  TEST_MODE=quick
fi

echo "=== Real provider test: $TEST_MODE ==="

docker compose exec -T -e SNOWGAME_TEST_MODE="$TEST_MODE" app node <<'NODE'
const provider = require('./server/providers/openai');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, input, validate) {
  const started = Date.now();
  const result = await provider.run(name, input);
  validate(result);
  console.log(`✅ ${name} (${Date.now() - started} ms)`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

(async () => {
  const info = provider.info();

  console.log(JSON.stringify({
    provider: 'openai',
    model: info.model,
    baseUrl: info.baseUrl,
    configured: info.configured,
    timeoutMs: info.timeoutMs,
    jsonMode: info.jsonMode,
  }, null, 2));

  assert(info.configured, 'OPENAI_API_KEY не настроен внутри контейнера');
  assert(info.model === 'gpt-6-luna', `Ожидалась модель gpt-6-luna, получено: ${info.model}`);
  assert(
    info.baseUrl === 'https://ru.cheapvibecode.ru/v1',
    `Неожиданный OPENAI_BASE_URL: ${info.baseUrl}`
  );

  await test(
    'supplier_negotiate',
    {
      material: 'Лист белой бумаги',
      qty: 25,
      basePrice: 10,
      tierLow: 9,
      tierHigh: 8,
    },
    (r) => {
      assert(Number.isFinite(r?.pricePerUnit), 'supplier_negotiate: pricePerUnit не число');
      assert(typeof r?.note === 'string' && r.note.length > 0, 'supplier_negotiate: нет note');
    }
  );

  if (process.env.SNOWGAME_TEST_MODE !== 'full') {
    console.log('✅ QUICK AI SMOKE PASS');
    return;
  }

  await test(
    'buyer_decision',
    {
      buyerNum: 2,
      item: 'Ёлочки',
      maxPrice: 165,
      askPrice: 180,
      pitch: 'Именная надпись бесплатно',
    },
    (r) => {
      assert(typeof r?.accept === 'boolean', 'buyer_decision: accept не boolean');
      assert(typeof r?.note === 'string' && r.note.length > 0, 'buyer_decision: нет note');
    }
  );

  await test(
    'competitors',
    {
      quarterLabel: '4 кв. 2026',
      capacity: '1900-2800 у.е.',
      skuLines: 'Снежинки маленькие: 19 у.е.; Ёлочки: 165 у.е.; Шляпы бумажные: 30 у.е.',
    },
    (r) => {
      assert(Array.isArray(r?.competitors), 'competitors: нет массива competitors');
      assert(r.competitors.length === 2, 'competitors: ожидалось ровно 2 конкурента');
    }
  );

  await test(
    'debrief_facts',
    {
      log: '## 1 кв. 2026\nЗакупили бумагу и картон. Арендовали 1 стул. Продали 8 ёлочек. Квартал завершили с прибылью.',
    },
    (r) => {
      assert(typeof r?.text === 'string' && r.text.length > 10, 'debrief_facts: нет текста');
    }
  );

  await test(
    'debrief_analysis',
    {
      log: '## 1 кв. 2026\nЗакупили большой запас материалов. Цены держали выше рынка. После отказов покупателя снизили цену во втором раунде.',
      addedFacts: 'Высокую стартовую цену выбрали намеренно для проверки спроса.',
    },
    (r) => {
      assert(typeof r?.text === 'string' && r.text.length > 20, 'debrief_analysis: нет текста');
    }
  );

  console.log('✅ FULL AI ACCEPTANCE PASS');
})().catch((error) => {
  console.error('❌ AI SMOKE FAILED');
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
NODE
