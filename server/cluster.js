// Multi-process launcher for production.
const cluster = require('cluster');
const os = require('os');
require('dotenv').config();

function resolveWorkerCount() {
  const raw = String(process.env.WEB_CONCURRENCY || 'auto').trim().toLowerCase();
  if (raw === 'auto') {
    const cpuCount = typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : os.cpus().length;
    return Math.max(1, Math.min(cpuCount, 4));
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 32);
}

const workers = resolveWorkerCount();

if (cluster.isPrimary && workers > 1) {
  let shuttingDown = false;

  console.log(`SnowGame master ${process.pid}: запускаем ${workers} worker-процесс(а)`);

  for (let i = 0; i < workers; i += 1) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.error(
      `SnowGame worker ${worker.process.pid} завершён (code=${code}, signal=${signal || 'none'})`
    );
    if (!shuttingDown) cluster.fork();
  });

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: останавливаем worker-процессы...`);

    for (const worker of Object.values(cluster.workers)) {
      if (worker) worker.process.kill('SIGTERM');
    }

    setTimeout(() => process.exit(0), 12000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} else {
  require('./index');
}
