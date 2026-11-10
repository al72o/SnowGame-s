// ---------------------------------------------------------------------------
// Тонкий клиент к серверному агенту. Никаких ключей и логики модели здесь нет —
// только HTTP-вызов к своему бэкенду (server/index.js -> server/providers/*).
// Если сервер недоступен или вернул ошибку — game.js откатывается на
// задокументированные детерминированные правила (см. AGENT.md).
// ---------------------------------------------------------------------------
const SnezhinkaAgent = (function () {
  // Script is served as /snow/agent-client.js or /agent-client.js.
  // Derive the public base from that URL so requests never hit the main site's /api.
  const publicBase = new URL('.', document.currentScript.src).pathname;
  let lastOk = null; // null = ещё не проверяли, true/false = известный статус

  async function call(task, input) {
    try {
      const res = await fetch(publicBase + 'api/agent', {
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
      const res = await fetch(publicBase + 'api/agent/health');
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
