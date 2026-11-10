#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Configure an already installed SnowGame-s without resetting its domain,
# login/password, session secret, TLS or other production settings.
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/snowgame"
SKIP_TEST=false

usage() {
  cat <<'HELP'
SnowGame-s setup2: switch an existing installation to DNS LiteLLM Qwen.

  sudo bash setup2.sh [--install-dir /opt/snowgame] [--skip-test]

The DNS LiteLLM personal API key is entered privately in the terminal.
It is never passed on the command line, committed, or printed.
The existing site domain, login/password, AUTH_SECRET and HTTPS are preserved.
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --skip-test) SKIP_TEST=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестная опция: $1" >&2; usage; exit 2 ;;
  esac
done

if (( EUID != 0 )); then
  echo "Запусти через sudo: sudo bash setup2.sh" >&2
  exit 1
fi

INSTALL_DIR="$(readlink -f -- "$INSTALL_DIR")"
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" || ! -f "$INSTALL_DIR/compose.yaml" ]]; then
  echo "В $INSTALL_DIR нет установленной игры (.env и compose.yaml)." >&2
  echo "Для первой установки запусти: sudo bash install.sh" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Нужен Docker Compose v2." >&2
  exit 1
fi
if [[ ! -r /dev/tty ]]; then
  echo "Для безопасного ввода ключа нужен интерактивный терминал (/dev/tty)." >&2
  exit 1
fi

printf '%s\n' "Настройка DNS LiteLLM: https://litellm.dns-shop.ru/v1"
printf '%s\n' "Модель: qwen3.8-flash-next"
read -r -s -p "Личный API-ключ LiteLLM (ввод скрыт): " API_KEY < /dev/tty
echo

# LiteLLM keys use URL-safe characters. Reject newlines, shell metacharacters
# and Docker Compose interpolation characters rather than risking secret leaks.
if [[ ${#API_KEY} -lt 8 || ! "$API_KEY" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
  echo "Некорректный формат ключа: допустимы латинские буквы, цифры и . _ ~ + / = -" >&2
  unset API_KEY
  exit 1
fi

# Lock to avoid overlapping reconfiguration attempts.
exec 9>"$INSTALL_DIR/.setup2.lock"
if ! flock -n 9; then
  echo "Другая настройка уже выполняется." >&2
  unset API_KEY
  exit 1
fi

TMP="$(mktemp "$INSTALL_DIR/.env.setup2.XXXXXX")"
BACKUP="$(mktemp "$INSTALL_DIR/.env.rollback.XXXXXX")"
cleanup() { rm -f -- "$TMP" "$BACKUP"; unset API_KEY; }
trap cleanup EXIT

cp -- "$ENV_FILE" "$BACKUP"
cp -- "$ENV_FILE" "$TMP"

sed -i \
  -e '/^AGENT_PROVIDER=/d' \
  -e '/^OPENAI_API_KEY=/d' \
  -e '/^OPENAI_BASE_URL=/d' \
  -e '/^OPENAI_MODEL=/d' \
  -e '/^OPENAI_JSON_MODE=/d' \
  -e '/^OPENAI_TEMPERATURE=/d' \
  -e '/^OPENAI_REQUEST_TIMEOUT_MS=/d' "$TMP"

cat >> "$TMP" <<EOF

# DNS LiteLLM; settings updated by setup2.sh.
AGENT_PROVIDER=litellm
OPENAI_API_KEY="$API_KEY"
OPENAI_BASE_URL=https://litellm.dns-shop.ru/v1
OPENAI_MODEL=qwen3.8-flash-next
OPENAI_REQUEST_TIMEOUT_MS=90000
OPENAI_JSON_MODE=auto
OPENAI_TEMPERATURE=omit
EOF
chmod 600 "$TMP"
unset API_KEY

# Keep the deployed implementation in sync even when setup2 is launched
# from a separate Git checkout, not /opt/snowgame.
if [[ "$(readlink -f "$SOURCE_DIR")" != "$INSTALL_DIR" ]]; then
  for file in server/providers/openai.js server/providers/index.js scripts/live-ai-smoke.sh; do
    if [[ ! -f "$SOURCE_DIR/$file" ]]; then
      echo "Не найден файл новой версии: $SOURCE_DIR/$file" >&2
      exit 1
    fi
    cp -- "$SOURCE_DIR/$file" "$INSTALL_DIR/$file"
  done
fi

mv -f -- "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

rollback() {
  echo "Возвращаю предыдущий .env и конфигурацию контейнера." >&2
  cp -- "$BACKUP" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  (cd "$INSTALL_DIR" && docker compose up -d --build --force-recreate app) >/dev/null || true
}

echo "Обновляю контейнер игры..."
if ! (cd "$INSTALL_DIR" && docker compose up -d --build --force-recreate app); then
  rollback
  exit 1
fi

# Compose may return while the new container is still starting.
APP_BIND_PORT="$(grep -E '^APP_BIND_PORT=[0-9]+
  if ! (cd "$INSTALL_DIR" && bash scripts/live-ai-smoke.sh --project-dir "$INSTALL_DIR"); then
    echo "Проверка не пройдена. Возможные причины: нет прав на модель или VPS не видит корпоративный шлюз." >&2
    rollback
    exit 1
  fi
else
  echo "Live-проверка пропущена: --skip-test. Подключение к шлюзу не подтверждено."
fi

echo "Готово. SnowGame-s теперь использует qwen3.8-flash-next через DNS LiteLLM."
echo "Домен, пароль пользователя и HTTPS не изменены."
 "$ENV_FILE" | tail -1 | cut -d= -f2 || true)"
APP_BIND_PORT="${APP_BIND_PORT:-3000}"
HEALTHY=false
for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:${APP_BIND_PORT}/healthz" >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 1
done
if ! $HEALTHY; then
  echo "Игра не прошла healthcheck после перезапуска." >&2
  rollback
  exit 1
fi

if ! $SKIP_TEST; then
  echo "Проверяю модель на игровой роли поставщика..."
  if ! (cd "$INSTALL_DIR" && bash scripts/live-ai-smoke.sh --project-dir "$INSTALL_DIR"); then
    echo "Проверка не пройдена. Возможные причины: нет прав на модель или VPS не видит корпоративный шлюз." >&2
    rollback
    exit 1
  fi
else
  echo "Live-проверка пропущена: --skip-test. Подключение к шлюзу не подтверждено."
fi

echo "Готово. SnowGame-s теперь использует qwen3.8-flash-next через DNS LiteLLM."
echo "Домен, пароль пользователя и HTTPS не изменены."
