#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "❌ Ошибка установки на строке $LINENO" >&2' ERR

SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/snowgame"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
AUTH_USERNAME="${AUTH_USERNAME:-admin}"
AUTH_PASSWORD="${AUTH_PASSWORD:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
APP_BIND_PORT="${APP_BIND_PORT:-3000}"
SKIP_CERTBOT=false
SKIP_AI_TEST=false
SKIP_PACKAGES=false

usage() {
  cat <<'EOF'
SnowGame-s production installer

Запуск:
  sudo bash install.sh [опции]

Опции:
  --domain DOMAIN         Домен игры, например snowgame.example.com
  --email EMAIL           Email для Let's Encrypt / Certbot
  --install-dir PATH      Каталог установки (по умолчанию /opt/snowgame)
  --auth-user USER        Логин игры (по умолчанию admin)
  --port PORT             Локальный порт приложения (по умолчанию 3000)
  --skip-certbot          Не получать HTTPS-сертификат автоматически
  --skip-ai-test          Не выполнять live-запрос к gpt-6-luna после запуска
  --skip-packages         Не устанавливать системные пакеты
  -h, --help              Показать справку

Секреты можно передать через окружение:
  AUTH_PASSWORD
  OPENAI_API_KEY

Если они не заданы, установщик запросит их скрытым вводом.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --auth-user)
      AUTH_USERNAME="${2:-}"
      shift 2
      ;;
    --port)
      APP_BIND_PORT="${2:-}"
      shift 2
      ;;
    --skip-certbot)
      SKIP_CERTBOT=true
      shift
      ;;
    --skip-ai-test)
      SKIP_AI_TEST=true
      shift
      ;;
    --skip-packages)
      SKIP_PACKAGES=true
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

if [[ "${EUID}" -ne 0 ]]; then
  echo "Запусти установщик через sudo: sudo bash install.sh" >&2
  exit 1
fi

if [[ -z "$DOMAIN" ]]; then
  read -r -p "Домен игры (например snowgame.example.com): " DOMAIN
fi

if [[ ! "$DOMAIN" =~ ^([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$ ]]; then
  echo "Некорректный домен: $DOMAIN" >&2
  exit 1
fi

if [[ ! "$APP_BIND_PORT" =~ ^[0-9]+$ ]] || (( APP_BIND_PORT < 1024 || APP_BIND_PORT > 65535 )); then
  echo "Некорректный локальный порт: $APP_BIND_PORT" >&2
  exit 1
fi

if [[ -z "$AUTH_USERNAME" ]]; then
  read -r -p "Логин игры [admin]: " AUTH_USERNAME
  AUTH_USERNAME="${AUTH_USERNAME:-admin}"
fi

if [[ -z "$AUTH_PASSWORD" ]]; then
  read -r -s -p "Пароль для входа в игру: " AUTH_PASSWORD
  echo
  read -r -s -p "Повтори пароль: " AUTH_PASSWORD_CONFIRM
  echo
  if [[ "$AUTH_PASSWORD" != "$AUTH_PASSWORD_CONFIRM" ]]; then
    echo "Пароли не совпадают." >&2
    exit 1
  fi
fi

if [[ ${#AUTH_PASSWORD} -lt 12 ]]; then
  echo "Пароль должен быть не короче 12 символов." >&2
  exit 1
fi

if [[ -z "$OPENAI_API_KEY" ]]; then
  read -r -s -p "API key для https://ru.cheapvibecode.ru/v1: " OPENAI_API_KEY
  echo
fi

if [[ -z "$OPENAI_API_KEY" ]]; then
  echo "OPENAI_API_KEY не может быть пустым." >&2
  exit 1
fi

for secret_name in AUTH_USERNAME AUTH_PASSWORD OPENAI_API_KEY; do
  value="${!secret_name}"
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "$secret_name не должен содержать переносы строк." >&2
    exit 1
  fi
done

if ! $SKIP_CERTBOT && [[ -z "$EMAIL" ]]; then
  read -r -p "Email для Let's Encrypt: " EMAIL
fi

if ! $SKIP_CERTBOT && [[ ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Некорректный email для Certbot: $EMAIL" >&2
  exit 1
fi

echo
echo "=== SnowGame-s production install ==="
echo "Домен:       $DOMAIN"
echo "Каталог:     $INSTALL_DIR"
echo "Логин:       $AUTH_USERNAME"
echo "Local port:  $APP_BIND_PORT"
echo "AI endpoint: https://ru.cheapvibecode.ru/v1"
echo "AI model:    gpt-6-luna"
echo

export DEBIAN_FRONTEND=noninteractive

if ! $SKIP_PACKAGES; then
  echo "==> Проверка системных пакетов"
  apt-get update
  apt-get install -y ca-certificates curl openssl tar nginx

  if ! command -v docker >/dev/null 2>&1; then
    apt-get install -y docker.io
  fi

  if ! docker compose version >/dev/null 2>&1; then
    apt-get install -y docker-compose-v2 2>/dev/null || \
      apt-get install -y docker-compose-plugin 2>/dev/null || true
  fi

  if ! $SKIP_CERTBOT; then
    apt-get install -y certbot python3-certbot-nginx
  fi
fi

for cmd in curl openssl nginx docker tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Не найдена обязательная команда: $cmd" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 недоступен. Нужна команда: docker compose" >&2
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now docker >/dev/null 2>&1 || true
  systemctl enable --now nginx >/dev/null 2>&1 || true
fi

echo "==> Копирование приложения в $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

SOURCE_REAL="$(readlink -f "$SOURCE_DIR")"
INSTALL_REAL="$(readlink -f "$INSTALL_DIR")"

if [[ "$SOURCE_REAL" != "$INSTALL_REAL" ]]; then
  tar \
    --exclude='./.git' \
    --exclude='./.env' \
    --exclude='./node_modules' \
    --exclude='./actions-runner*' \
    -C "$SOURCE_DIR" -cf - . | tar -C "$INSTALL_DIR" -xf -
fi

dotenv_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

AUTH_SECRET="$(openssl rand -hex 32)"

cat > "$INSTALL_DIR/.env" <<EOF
DOMAIN="$(dotenv_escape "$DOMAIN")"

HOST=0.0.0.0
PORT=3000
APP_BIND_PORT=$APP_BIND_PORT
NODE_ENV=production

AUTH_ENABLED=true
AUTH_USERNAME="$(dotenv_escape "$AUTH_USERNAME")"
AUTH_PASSWORD="$(dotenv_escape "$AUTH_PASSWORD")"
AUTH_SECRET="$AUTH_SECRET"
AUTH_SESSION_HOURS=12
AUTH_COOKIE_SECURE=true

LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX=10

AGENT_PROVIDER=openai

OPENAI_API_KEY="$(dotenv_escape "$OPENAI_API_KEY")"
OPENAI_MODEL=gpt-6-luna
OPENAI_BASE_URL=https://ru.cheapvibecode.ru/v1
OPENAI_REQUEST_TIMEOUT_MS=45000
OPENAI_JSON_MODE=auto
OPENAI_TEMPERATURE=0.7

AGENT_RATE_LIMIT_WINDOW_MS=60000
AGENT_RATE_LIMIT_MAX=60

TRUST_PROXY_HOPS=1
EOF

chmod 600 "$INSTALL_DIR/.env"

echo "==> Сборка и запуск Docker"
cd "$INSTALL_DIR"
docker compose config >/dev/null
docker compose up -d --build --remove-orphans

echo "==> Ожидание healthcheck приложения"
healthy=false
for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:${APP_BIND_PORT}/healthz" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 1
done

if ! $healthy; then
  echo "Приложение не прошло healthcheck. Последние логи:" >&2
  docker compose logs --tail=120 app >&2 || true
  exit 1
fi

echo "==> Настройка host Nginx"
NGINX_SITE="/etc/nginx/sites-available/snowgame.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/snowgame.conf"

if [[ -f "$NGINX_SITE" ]]; then
  cp -a "$NGINX_SITE" "${NGINX_SITE}.bak.$(date +%Y%m%d-%H%M%S)"
fi

sed "s/server_name game\.example\.com;/server_name $DOMAIN;/" \
  "$INSTALL_DIR/deploy/nginx-snowgame.conf.example" > "$NGINX_SITE"

ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"
nginx -t

if command -v systemctl >/dev/null 2>&1; then
  systemctl reload nginx
else
  nginx -s reload
fi

TLS_OK=false
if ! $SKIP_CERTBOT; then
  echo "==> Получение/обновление HTTPS-сертификата"
  if certbot --nginx \
      -d "$DOMAIN" \
      --redirect \
      --non-interactive \
      --agree-tos \
      --email "$EMAIL"; then
    TLS_OK=true
  else
    echo "⚠️ Certbot не смог выпустить сертификат." >&2
    echo "Проверь DNS домена и затем выполни:" >&2
    echo "  sudo certbot --nginx -d $DOMAIN --redirect" >&2
  fi
else
  echo "==> Certbot пропущен по --skip-certbot"
fi

if ! $SKIP_AI_TEST; then
  echo "==> Live smoke-test gpt-6-luna"
  if ! APP_BIND_PORT="$APP_BIND_PORT" bash "$INSTALL_DIR/scripts/live-ai-smoke.sh" --project-dir "$INSTALL_DIR"; then
    echo "⚠️ Приложение запущено, но live AI smoke-test не прошёл." >&2
    echo "Смотри диагностику выше; установка Docker/Nginx сохранена." >&2
  fi
fi

echo
echo "✅ SnowGame-s установлен"
echo "Каталог: $INSTALL_DIR"
echo "Локальный healthcheck: http://127.0.0.1:${APP_BIND_PORT}/healthz"
if $TLS_OK; then
  echo "Открыть: https://$DOMAIN"
elif $SKIP_CERTBOT; then
  echo "HTTPS пропущен. Перед боевым использованием настрой сертификат для $DOMAIN."
else
  echo "HTTPS ещё не подтверждён. Исправь DNS/Certbot перед входом в игру."
fi
echo
echo "Полезные команды:"
echo "  cd $INSTALL_DIR && docker compose ps"
echo "  cd $INSTALL_DIR && docker compose logs -f app"
echo "  cd $INSTALL_DIR && bash scripts/live-ai-smoke.sh --full"
