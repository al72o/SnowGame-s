// -----------------------------------------------------------------------------
// gigachat — TODO, не реализовано.
//
// Это заготовка для тех, кто должен подключить GigaChat (Сбер) вместо openai.js,
// например при переносе прототипа в контур DNS/Simulacia Claude, где выбор
// провайдера ещё предстоит сравнить (см. AGENT.md).
//
// Что нужно доделать:
// 1. Аутентификация — GigaChat API использует OAuth2 client_credentials:
//    POST https://ngw.devices.sberbank.ru:9443/api/v2/oauth
//    Заголовки: Authorization: Basic <base64(client_id:client_secret)>,
//               RqUID: <uuid каждого запроса>, Content-Type: application/x-www-form-urlencoded
//    Тело: scope=GIGACHAT_API_PERS (или B2B/CORP в зависимости от тарифа)
//    В ответ приходит access_token с ограниченным сроком жизни (обычно 30 мин) —
//    его нужно кэшировать и обновлять, а не запрашивать на каждый вызов.
// 2. Российская сертифицированная цепочка TLS — для прод-контура понадобится
//    либо системный набор сертификатов Минцифры, либо NODE_EXTRA_CA_CERTS.
// 3. Сам чат — POST https://gigachat.devices.sberbank.ru/api/v1/chat/completions,
//    тело в целом совместимо с форматом OpenAI Chat Completions (messages/model/temperature),
//    но собственный список моделей (GigaChat, GigaChat-Pro, ...) и свои лимиты.
// 4. JSON-режим у GigaChat работает иначе, чем response_format у OpenAI — на
//    момент написания этого файла нужно явно просить модель вернуть JSON в
//    промпте и парсить ответ с fallback на regex/try-catch (что уже сделано
//    в openai.js для промптов — переиспользуйте chatJson-подобную обвязку).
//
// Задачи (task) и контракты входа/выхода — те же пять, что в openai.js:
// supplier_negotiate, buyer_decision, competitors, debrief_facts, debrief_analysis.
// Скопируйте промпты дословно из openai.js — они уже написаны и проверены на практике,
// нужно просто сменить транспорт и аутентификацию.
//
// Когда провайдер будет готов: добавьте `gigachat: require('./gigachat')` в
// server/providers/index.js и выставьте AGENT_PROVIDER=gigachat в .env.
// -----------------------------------------------------------------------------

async function run(task) {
  throw new Error(
    `Провайдер "gigachat" ещё не реализован (см. комментарий в server/providers/gigachat.js). Задача была: ${task}`
  );
}

module.exports = { run };
