'use strict';

// Offline verification of /snow/ routing. The live server sees stripped URLs
// (/login, /api/agent) while generated redirects/cookies target /snow/.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
async function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const port = listener.address().port;
      listener.close(() => resolve(port));
    });
  });
}

async function startWithPrefix(prefix) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      AGENT_PROVIDER: 'stub',
      AUTH_ENABLED: 'true',
      AUTH_USERNAME: 'test-admin',
      AUTH_PASSWORD: 'a-very-strong-test-password',
      AUTH_SECRET: '1'.repeat(64),
      AUTH_COOKIE_SECURE: 'true',
      PUBLIC_BASE_PATH: prefix,
    },
  });
  let errors = '';
  child.stderr.on('data', b => { errors += b.toString(); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('Server exited: ' + errors);
    try {
      const res = await fetch(base + '/healthz');
      if (res.ok) return { child, base };
    } catch (_) { /* not ready yet */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error('Server failed to start: ' + errors);
}

for (const prefix of ['', '/snow']) {
  test(`server authentication and cookie paths for ${prefix || '/'}`, async t => {
    const { child, base } = await startWithPrefix(prefix);
    t.after(() => child.kill());

    const home = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get('location'), prefix + '/login');

    const loginPage = await (await fetch(base + '/login')).text();
    assert.ok(loginPage.includes(`action="${prefix}/login"`));

    const login = await fetch(base + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=test-admin&password=a-very-strong-test-password',
      redirect: 'manual',
    });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), prefix + '/');
    const cookie = login.headers.get('set-cookie');
    assert.ok(cookie?.includes(`Path=${prefix ? prefix + '/' : '/'}`));
    assert.ok(cookie?.includes('HttpOnly'));
    assert.ok(cookie?.includes('Secure'));

    const agent = await fetch(base + '/api/agent/health', {
      headers: { cookie: cookie.split(';')[0] },
    });
    assert.equal(agent.status, 200);
    assert.equal((await agent.json()).provider, 'stub');

    const dashboard = await fetch(base + '/game-flow-dashboard.html', {
      headers: { cookie: cookie.split(';')[0] },
    });
    assert.equal(dashboard.status, 200);
    assert.ok((await dashboard.text()).includes('href="./"'));
  });
}

test('browser agent client resolves requests within /snow/ rather than domain root', async () => {
  const js = fs.readFileSync(path.join(root, 'web/agent-client.js'), 'utf8');
  const called = [];
  const context = {
    URL,
    document: { currentScript: { src: 'https://existing.example/snow/agent-client.js' } },
    fetch: async (url) => {
      called.push(url);
      return { ok: true, json: async () => ({ ok: true, data: { accept: true } }) };
    },
  };
  const client = vm.runInNewContext(js + '\nSnezhinkaAgent;', context);
  const reply = await client.call('buyer_decision', {});
  assert.equal(reply.accept, true);
  await client.health();
  assert.deepEqual(called, ['/snow/api/agent', '/snow/api/agent/health']);
});
