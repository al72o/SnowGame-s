# Развёртывание SnowGame-s в Docker

Эта инструкция относится к ветке `feat/docker-domain-ai-agent`.

## Что входит в production-схему

- Node.js-приложение `app` обслуживает игру и `/api/agent`.
- Caddy принимает 80/443, автоматически получает и продлевает TLS-сертификат.
- API-ключ модели остаётся только в `.env` на сервере и не попадает в браузер или Git.
- Для `/api/agent` включён простой per-IP rate limit.
- Для запросов к модели есть таймаут.
- При недоступности AI сама игра сохраняет существующий детерминированный fallback.

## 1. DNS и сервер

Для выбранного домена создайте DNS A-запись на публичный IPv4 сервера.
Если используете IPv6 — добавьте AAAA.

На сервере должны быть доступны входящие TCP 80/443.
Для HTTP/3 также можно открыть UDP 443.

## 2. Получить ветку

```bash
git clone https://github.com/al72o/SnowGame-s.git
cd SnowGame-s
git checkout feat/docker-domain-ai-agent
```

Если репозиторий приватный, используйте SSH или авторизацию GitHub.

## 3. Создать .env

```bash
cp .env.example .env
```

Минимально заполните:

```dotenv
DOMAIN=game.example.com
AGENT_PROVIDER=openai
OPENAI_API_KEY=YOUR_SECRET_KEY
OPENAI_MODEL=gpt-6-luna
OPENAI_BASE_URL=https://ru.cheapvibecode.ru/v1
```

Не добавляйте `.env` в Git.

## 4. Запуск

```bash
docker compose up -d --build
```

Проверить:

```bash
docker compose ps
docker compose logs -f app
docker compose logs -f caddy
```

## 5. Проверка

После выпуска TLS:

```bash
curl https://game.example.com/healthz
curl https://game.example.com/api/agent/health
```

Ожидаемая диагностика для AI примерно такая:

```json
{
  "ok": true,
  "provider": "openai",
  "model": "gpt-6-luna",
  "baseUrl": "https://ru.cheapvibecode.ru/v1",
  "configured": true
}
```

Поле `configured` показывает только наличие ключа. Сам ключ никогда не возвращается.

## Обновление

```bash
git pull
docker compose up -d --build
```

## Остановка

```bash
docker compose down
```

Данные Caddy с TLS-сертификатами остаются в Docker volumes.
Для полного удаления volumes используйте `docker compose down -v` только осознанно.

## Важное про AI

Текущая архитектура проекта — специализированный игровой AI-агент, а не произвольный автономный coding-agent.
Модель получает одну из пяти игровых задач: поставщик, покупатель, два конкурента, факты дебрифинга и анализ дебрифинга.

`gpt-6-luna` подключается как OpenAI-compatible модель через `/v1/chat/completions`.
Если конкретный шлюз не поддерживает `response_format`, режим
`OPENAI_JSON_MODE=auto` автоматически повторяет JSON-запрос без этой опции.

Для проверки реального ответа модели нужен действующий `OPENAI_API_KEY`.
