# Развёртывание SnowGame-s: Docker + существующий Nginx

Инструкция относится к ветке `feat/docker-domain-ai-agent`.

## Production-схема

```text
Интернет
   │
   ▼
Nginx на хосте :80/:443
   │
   ▼
127.0.0.1:3000
   │
   ▼
Docker: SnowGame-s
   │
   └── https://ru.cheapvibecode.ru/v1
       model: gpt-6-luna
```

Приложение **не публикует порт 3000 в интернет**: Docker привязывает его только к
`127.0.0.1`. Публичной точкой остаётся установленный на сервере Nginx.

Дополнительно сама игра защищена логином/паролем. После успешного входа сервер
выдаёт подписанную `HttpOnly + Secure + SameSite=Lax` cookie-сессию.
Без неё закрыты и интерфейс игры, и `/api/agent`.

## 1. Получить ветку

```bash
git clone git@github.com:al72o/SnowGame-s.git
cd SnowGame-s
git checkout feat/docker-domain-ai-agent
```

## 2. Создать .env

```bash
cp .env.example .env
```

Сгенерируйте секрет сессий:

```bash
openssl rand -hex 32
```

Заполните минимум:

```dotenv
DOMAIN=game.example.com

AUTH_ENABLED=true
AUTH_USERNAME=admin
AUTH_PASSWORD=ЗДЕСЬ_СИЛЬНЫЙ_ПАРОЛЬ
AUTH_SECRET=ЗДЕСЬ_РЕЗУЛЬТАТ_openssl_rand_hex_32
AUTH_COOKIE_SECURE=true

AGENT_PROVIDER=openai
OPENAI_API_KEY=ВАШ_API_КЛЮЧ
OPENAI_MODEL=gpt-6-luna
OPENAI_BASE_URL=https://ru.cheapvibecode.ru/v1
```

`.env` не коммитить.

## 3. Запустить Docker

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

Порт должен быть виден только локально:

```bash
ss -lntp | grep 3000
```

Ожидается привязка к `127.0.0.1:3000`, а не `0.0.0.0:3000`.

Локальный healthcheck:

```bash
curl http://127.0.0.1:3000/healthz
```

## 4. Подключить существующий Nginx

В репозитории лежит шаблон:

`deploy/nginx-snowgame.conf.example`

Скопируйте его:

```bash
sudo cp deploy/nginx-snowgame.conf.example /etc/nginx/sites-available/snowgame.conf
sudo nano /etc/nginx/sites-available/snowgame.conf
```

Замените:

```nginx
server_name game.example.com;
```

на ваш домен.

Активируйте сайт:

```bash
sudo ln -s /etc/nginx/sites-available/snowgame.conf /etc/nginx/sites-enabled/snowgame.conf
sudo nginx -t
sudo systemctl reload nginx
```

Если симлинк уже существует, повторно создавать его не нужно.

## 5. HTTPS через Certbot

Если сертификата для домена ещё нет:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d game.example.com --redirect
```

Certbot добавит HTTPS в существующий server block и настроит редирект HTTP → HTTPS.

Проверка:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -I https://game.example.com/
```

Без cookie корень должен отправить пользователя на `/login`.

## 6. Проверка авторизации

Откройте:

`https://game.example.com`

Должна появиться отдельная страница входа.

После правильного логина открывается игра. Неверный пароль даёт 401, а после
нескольких неудачных попыток с одного IP начинает действовать временный rate limit.

### Защита сейчас

- порт приложения доступен только через `127.0.0.1`;
- Nginx — единственная публичная точка;
- логин/пароль обязательны;
- пароль не хранится в браузере;
- cookie подписана `AUTH_SECRET`;
- cookie `HttpOnly`, `Secure`, `SameSite=Lax`;
- сессия по умолчанию живёт 12 часов;
- форма входа ограничена по числу попыток;
- `/api/agent` требует авторизацию и имеет отдельный rate limit;
- API-ключ AI остаётся только в server-side `.env`;
- публичный Nginx не отдаёт `/healthz`.

## 7. Диагностика AI

После входа браузер использует:

`/api/agent/health`

Сервер возвращает состояние примерно такого вида:

```json
{
  "ok": true,
  "provider": "openai",
  "model": "gpt-6-luna",
  "baseUrl": "https://ru.cheapvibecode.ru/v1",
  "configured": true,
  "timeoutMs": 45000,
  "jsonMode": "auto"
}
```

Сам `OPENAI_API_KEY` никогда не возвращается клиенту.

## 8. Обновление

```bash
git pull
docker compose up -d --build
```

## 9. Остановка

```bash
docker compose down
```

## Важное про агента

Проект уже был архитектурно подготовлен под OpenAI-compatible Chat Completions API.
Модель обслуживает пять игровых ролей/задач:

- переговоры с поставщиком;
- решение покупателя;
- решения двух конкурентов;
- фактологический дебрифинг;
- аналитический дебрифинг.

`gpt-6-luna` задаётся через `OPENAI_MODEL`, а
`https://ru.cheapvibecode.ru/v1` — через `OPENAI_BASE_URL`.

Для шлюзов, которые не принимают `response_format`, режим
`OPENAI_JSON_MODE=auto` повторяет JSON-запрос без этой опции.


## GitHub Actions через WSL self-hosted runner

CI этой ветки не использует GitHub-hosted минуты. Workflow запускается только на runner с метками:

```text
self-hosted
Linux
X64
snowgame-wsl
```

Runner регистрируется для репозитория `al72o/SnowGame-s` и должен работать внутри WSL.
Для полного CI на runner должны быть доступны `node`, `curl`, `docker` и `docker compose`.
