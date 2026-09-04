// -----------------------------------------------------------------------------
// yandexgpt — TODO, не реализовано.
//
// Заготовка для подключения YandexGPT (Yandex Cloud) вместо openai.js.
//
// Что нужно доделать:
// 1. Аутентификация — два варианта:
//    а) IAM-токен: обменять OAuth-токен или ключ сервисного аккаунта на
//       краткоживущий IAM-токен через POST https://iam.api.cloud.yandex.net/iam/v1/tokens,
//       кэшировать и обновлять (токен живёт ~12 часов).
//    б) Статический API-ключ сервисного аккаунта — проще для прототипа,
//       передаётся как заголовок Authorization: Api-Key <ключ>.
// 2. Также понадобится folder_id (идентификатор каталога в Yandex Cloud) —
//    он передаётся в теле запроса, не только в заголовках.
// 3. Сам чат — POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion,
//    формат тела ДРУГОЙ, чем у OpenAI: {modelUri, completionOptions:{temperature,maxTokens},
//    messages:[{role,text}]} — потребуется отдельная функция сборки запроса,
//    нельзя просто переиспользовать chat() из openai.js.
// 4. JSON-режим — как и у GigaChat, нет прямого аналога response_format;
//    просите JSON в самом промпте и парсите ответ с обработкой ошибок.
//
// Задачи (task) и контракты входа/выхода — те же пять, что в openai.js:
// supplier_negotiate, buyer_decision, competitors, debrief_facts, debrief_analysis.
// Промпты копируйте дословно из openai.js.
//
// Когда провайдер будет готов: добавьте `yandexgpt: require('./yandexgpt')` в
// server/providers/index.js и выставьте AGENT_PROVIDER=yandexgpt в .env.
// -----------------------------------------------------------------------------

async function run(task) {
  throw new Error(
    `Провайдер "yandexgpt" ещё не реализован (см. комментарий в server/providers/yandexgpt.js). Задача была: ${task}`
  );
}

module.exports = { run };
