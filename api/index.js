import { db, initSchema } from '../src/db.js';
import { seedDatabase } from '../db/seed.js';
import { createApp } from '../src/app.js';
import { expireStaleHolds, autoCompletePastBookings, markNoShows } from '../src/services/booking.service.js';
import { expireStalePayments } from '../src/services/payment.service.js';

initSchema();
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  await seedDatabase({ silent: true });
}

const app = createApp();
let lastSweepAt = 0;

export default function handler(req, res) {
  const now = Date.now();
  if (now - lastSweepAt > 30_000) {
    lastSweepAt = now;
    try {
      expireStaleHolds();
      expireStalePayments();
      autoCompletePastBookings();
      markNoShows();
    } catch {}
  }
  return app(req, res);
}
