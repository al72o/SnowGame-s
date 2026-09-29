// -----------------------------------------------------------------------------
// Production server for "Снежинка AI":
// - serves the static browser game;
// - exposes the server-side AI gateway;
// - keeps provider keys out of the browser;
// - provides health checks and a lightweight per-IP rate limit.
// -----------------------------------------------------------------------------

const path = require('path');
const express = require('express');
require('dotenv').config();

const { runTask, activeName, activeInfo } = require('./providers');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY_HOPS = Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
const RATE_LIMIT_WINDOW_MS = Number.parseInt(process.env.AGENT_RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = Number.parseInt(process.env.AGENT_RATE_LIMIT_MAX || '60', 10);

app.disable('x-powered-by');
app.set('trust proxy', Number.isFinite(TRUST_PROXY_HOPS) ? TRUST_PROXY_HOPS : 1);
app.use(express.json({ limit: '256kb' }));

const rateBuckets = new Map();

function agentRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let bucket = rateBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(key, bucket);
  }

  bucket.count += 1;
  const remaining = Math.max(0, RATE_LIMIT_MAX - bucket.count);

  res.setHeader('RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('RateLimit-Remaining', String(remaining));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      ok: false,
      error: 'Слишком много запросов к AI. Повторите попытку позже.',
    });
  }

  // Не даём Map бесконечно расти при сканировании множеством IP.
  if (rateBuckets.size > 10000) {
    for (const [ip, value] of rateBuckets) {
      if (now >= value.resetAt) rateBuckets.delete(ip);
    }
  }

  next();
}

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    service: 'snezhinka-ai',
    provider: activeName(),
  });
});

app.get('/api/agent/health', (req, res) => {
  res.json({
    ok: true,
    ...activeInfo(),
  });
});

app.post('/api/agent', agentRateLimit, async (req, res) => {
  const { task, input } = req.body || {};

  if (!task || typeof task !== 'string') {
    return res.status(400).json({ ok: false, error: 'Не указано поле "task"' });
  }

  if (input != null && (typeof input !== 'object' || Array.isArray(input))) {
    return res.status(400).json({ ok: false, error: 'Поле "input" должно быть объектом' });
  }

  try {
    const data = await runTask(task, input || {});
    res.json({ ok: true, data });
  } catch (error) {
    console.error(`[agent:${task}]`, error.message);
    res.status(502).json({ ok: false, error: error.message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'web')));

const server = app.listen(PORT, HOST, () => {
  console.log(`Снежинка AI слушает на http://${HOST}:${PORT}`);
  console.log(`Активный провайдер агента: ${activeName()}`);
  const info = activeInfo();
  if (info.model) console.log(`Модель: ${info.model}`);
});

function shutdown(signal) {
  console.log(`${signal}: завершаем HTTP-сервер...`);
  server.close((error) => {
    if (error) {
      console.error('Ошибка при остановке сервера:', error);
      process.exit(1);
    }
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
