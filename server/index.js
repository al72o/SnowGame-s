// -----------------------------------------------------------------------------
// Production server for "Снежинка AI":
// - serves the static browser game;
// - protects the game and AI gateway with signed cookie authentication;
// - keeps provider keys out of the browser;
// - provides health checks while Nginx handles login brute-force protection.
// -----------------------------------------------------------------------------

const crypto = require('crypto');
const path = require('path');
const express = require('express');
require('dotenv').config();

const { runTask, activeName, activeInfo } = require('./providers');

const app = express();

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY_HOPS = Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);

const AUTH_ENABLED =
  process.env.AUTH_ENABLED == null
    ? process.env.NODE_ENV === 'production'
    : String(process.env.AUTH_ENABLED).toLowerCase() !== 'false';
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const AUTH_SECRET = process.env.AUTH_SECRET || '';
const AUTH_SESSION_HOURS = Number.parseInt(process.env.AUTH_SESSION_HOURS || '12', 10);
const AUTH_COOKIE_SECURE = String(process.env.AUTH_COOKIE_SECURE || 'true').toLowerCase() !== 'false';

if (AUTH_ENABLED) {
  if (!AUTH_PASSWORD) {
    throw new Error('AUTH_PASSWORD обязателен при AUTH_ENABLED=true');
  }
  if (AUTH_SECRET.length < 32) {
    throw new Error('AUTH_SECRET должен содержать минимум 32 символа');
  }
}

app.disable('x-powered-by');
app.set('trust proxy', Number.isFinite(TRUST_PROXY_HOPS) ? TRUST_PROXY_HOPS : 1);
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(left, right) {
  return crypto.timingSafeEqual(hash(left), hash(right));
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (_) {
      cookies[key] = value;
    }
  }

  return cookies;
}

function signSession(username, expiresAt) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: expiresAt })).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token) {
  if (!AUTH_ENABLED) return true;
  if (!token || typeof token !== 'string') return false;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');

  if (!safeEqual(signature, expected)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.u === AUTH_USERNAME && Number.isFinite(data.exp) && Date.now() < data.exp;
  } catch (_) {
    return false;
  }
}

function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `snowgame_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (AUTH_COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

function loginPage(error = '') {
  const errorBlock = error
    ? `<div class="error">${escapeHtml(error)}</div>`
    : '';

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Вход — Снежинка AI</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top, #253354 0, #111827 44%, #080c14 100%);
      color: #f8fafc;
    }
    .card {
      width: min(420px, calc(100vw - 32px)); padding: 32px; border-radius: 22px;
      background: rgba(15, 23, 42, .88); border: 1px solid rgba(148, 163, 184, .18);
      box-shadow: 0 24px 80px rgba(0,0,0,.45); backdrop-filter: blur(12px);
    }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0 0 24px; color: #aebbd0; line-height: 1.5; }
    label { display: block; margin: 14px 0 7px; font-size: 13px; color: #cbd5e1; }
    input {
      width: 100%; border: 1px solid #334155; border-radius: 12px; padding: 12px 14px;
      background: #0f172a; color: #fff; outline: none; font: inherit;
    }
    input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(96,165,250,.15); }
    button {
      width: 100%; margin-top: 20px; padding: 13px 16px; border: 0; border-radius: 12px;
      background: #e2e8f0; color: #0f172a; font: inherit; font-weight: 700; cursor: pointer;
    }
    .error {
      padding: 10px 12px; border-radius: 10px; background: rgba(239,68,68,.12);
      border: 1px solid rgba(239,68,68,.3); color: #fecaca; font-size: 14px;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Снежинка AI</h1>
    <p>Доступ к игре закрыт. Войдите, чтобы продолжить.</p>
    ${errorBlock}
    <form method="post" action="/login" autocomplete="on">
      <label for="username">Логин</label>
      <input id="username" name="username" type="text" autocomplete="username" required autofocus>
      <label for="password">Пароль</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Войти</button>
    </form>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();

  const token = parseCookies(req).snowgame_session;
  if (verifySession(token)) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ ok: false, error: 'Требуется авторизация' });
  }

  return res.redirect(302, '/login');
}

// Docker healthcheck. Host Nginx config deliberately blocks this path externally.
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    service: 'snezhinka-ai',
    provider: activeName(),
    auth: AUTH_ENABLED,
  });
});

app.get('/login', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect(302, '/');

  const token = parseCookies(req).snowgame_session;
  if (verifySession(token)) return res.redirect(302, '/');

  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(loginPage());
});

app.post('/login', (req, res) => {
  if (!AUTH_ENABLED) return res.redirect(302, '/');

  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');

  if (!safeEqual(username, AUTH_USERNAME) || !safeEqual(password, AUTH_PASSWORD)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).type('html').send(loginPage('Неверный логин или пароль.'));
  }

  const ttlSeconds = Math.max(1, AUTH_SESSION_HOURS) * 60 * 60;
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const token = signSession(AUTH_USERNAME, expiresAt);

  res.setHeader('Set-Cookie', sessionCookie(token, ttlSeconds));
  res.redirect(302, '/');
});

app.post('/logout', requireAuth, (req, res) => {
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  res.redirect(302, '/login');
});

app.use(requireAuth);

app.get('/api/agent/health', (req, res) => {
  res.json({
    ok: true,
    ...activeInfo(),
  });
});

app.post('/api/agent', async (req, res) => {
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
  console.log(`Авторизация: ${AUTH_ENABLED ? 'включена' : 'выключена'}`);
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
