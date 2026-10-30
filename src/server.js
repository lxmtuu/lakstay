import { createApp } from './app.js';
import { config } from './config/index.js';
import { db, initSchema } from './db.js';
import { startJobs } from './jobs.js';
import { logger } from './utils/logger.js';

// Fail-fast: thiếu secret ở production thì KHÔNG được khởi động
if (config.isProd) {
  for (const [name, val] of Object.entries({
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET,
  })) {
    if (!val || val.startsWith('dev-')) {
      logger.error(`Refusing to start: ${name} chưa được cấu hình cho production`);
      process.exit(1);
    }
  }
}

initSchema();
if (config.isVercel && db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  const { seedDatabase } = await import('../db/seed.js');
  await seedDatabase({ silent: true });
}

const app = createApp();

if (!config.isVercel) {
  const server = app.listen(config.port, config.host, () => {
    logger.info(`${config.app.name} API sẵn sàng`, {
      url: `http://localhost:${config.port}`,
      env: config.env,
      db: config.db.file,
    });
  });

  const jobs = startJobs();

  /* Graceful shutdown — tránh mất dữ liệu / kết nối treo khi deploy lại */
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down`);
    jobs.stop();
    server.close(() => {
      try { db.close(); } catch { /* ignore */ }
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  ['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
  process.on('unhandledRejection', (reason) => logger.error('unhandledRejection', { reason: String(reason) }));
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { err: err.stack || err.message });
    shutdown('uncaughtException');
  });
}

export default app;
