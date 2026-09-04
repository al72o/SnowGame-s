// ---------------------------------------------------------------------------
// Тонкий клиент к серверному агенту. Никаких ключей и логики модели здесь нет —
// только HTTP-вызов к своему бэкенду (server/index.js -> server/providers/*).
// Если сервер недоступен или вернул ошибку — game.js откатывается на
// задокументированные детерминированные правила (см. AGENT.md).
// ---------------------------------------------------------------------------
const SnezhinkaAgent = (function () {
  let lastOk = null; // null = ещё не проверяли, true/false = известный статус

  async function call(task, input) {
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, input }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.ok !== true) {
        lastOk = false;
        return null;
      }
      lastOk = true;
      return body.data;
    } catch (e) {
      lastOk = false;
      return null;
    }
  }

  async function health() {
    try {
      const res = await fetch('/api/agent/health');
      const body = await res.json().catch(() => null);
      lastOk = !!(body && body.ok);
      return body;
    } catch (e) {
      lastOk = false;
      return null;
    }
  }

  return {
    call,
    health,
    isAvailable: () => lastOk === true,
  };
})();
