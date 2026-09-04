// -----------------------------------------------------------------------------
// Реестр провайдеров агента + выбор активного через переменную окружения
// AGENT_PROVIDER. Это единственное место, которое знает про существование
// нескольких провайдеров — сервер (server/index.js) и клиент (web/*.js)
// про конкретного провайдера ничего не знают.
//
// Чтобы "подключить другого агента на другой машине" (как просил пользователь):
// поменяйте AGENT_PROVIDER в .env и, если нужно, соответствующие ключи —
// код трогать не нужно, если провайдер уже реализован (stub, openai).
// Для gigachat/yandexgpt код трогать придётся — см. TODO в соответствующих файлах.
// -----------------------------------------------------------------------------

const stub = require('./stub');
const openai = require('./openai');
const gigachat = require('./gigachat');
const yandexgpt = require('./yandexgpt');

const providers = { stub, openai, gigachat, yandexgpt };

function activeName() {
  return process.env.AGENT_PROVIDER || 'stub';
}

async function runTask(task, input) {
  const name = activeName();
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Неизвестный AGENT_PROVIDER="${name}". Доступные провайдеры: ${Object.keys(providers).join(', ')}`
    );
  }
  return provider.run(task, input);
}

module.exports = { runTask, activeName, providers };
