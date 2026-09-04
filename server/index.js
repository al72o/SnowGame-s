// -----------------------------------------------------------------------------
// Сервер прототипа «Снежинка AI». Две задачи:
// 1) отдаёт статику из web/ (сама игра — чистый HTML/CSS/JS, без сборки);
// 2) единственная точка входа к AI-агенту: POST /api/agent.
//
// Почему это вообще отдельный сервер, а не прямой вызов модели из браузера:
// ключ провайдера (OPENAI_API_KEY и т.п.) не должен попадать в код, который
// уходит в браузер — иначе любой открывший страницу может его увидеть
// и использовать от вашего имени. Сервер — единственное место, где ключ
// живёт (в .env, никогда не в git — см. .gitignore).
// -----------------------------------------------------------------------------

const path = require('path');
const express = require('express');
require('dotenv').config();

const { runTask, activeName } = require('./providers');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'web')));

app.get('/api/agent/health', (req, res) => {
  res.json({ ok: true, provider: activeName() });
});

app.post('/api/agent', async (req, res) => {
  const { task, input } = req.body || {};
  if (!task || typeof task !== 'string') {
    return res.status(400).json({ ok: false, error: 'Не указано поле "task"' });
  }
  try {
    const data = await runTask(task, input || {});
    res.json({ ok: true, data });
  } catch (e) {
    // Провайдер недоступен/ошибся — клиент (web/game.js) сам откатится на
    // задокументированные детерминированные правила. Ошибку логируем на
    // сервере, чтобы было видно в консоли, но не роняем игру у пользователя.
    console.error(`[agent:${task}]`, e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Снежинка AI слушает на http://localhost:${PORT}`);
  console.log(`Активный провайдер агента: ${activeName()}`);
});
