// Registry of interchangeable AI providers.

const stub = require('./stub');
const openai = require('./openai');
const gigachat = require('./gigachat');
const yandexgpt = require('./yandexgpt');

const providers = { stub, openai, gigachat, yandexgpt };

function activeName() {
  return process.env.AGENT_PROVIDER || 'stub';
}

function activeProvider() {
  const name = activeName();
  const provider = providers[name];

  if (!provider) {
    throw new Error(
      `Неизвестный AGENT_PROVIDER="${name}". Доступные провайдеры: ${Object.keys(providers).join(', ')}`
    );
  }

  return provider;
}

function activeInfo() {
  const name = activeName();
  const provider = providers[name];

  if (!provider) {
    return { provider: name, configured: false, error: 'unknown_provider' };
  }

  const extra = typeof provider.info === 'function' ? provider.info() : {};
  return { provider: name, ...extra };
}

async function runTask(task, input) {
  return activeProvider().run(task, input);
}

module.exports = { runTask, activeName, activeInfo, providers };
