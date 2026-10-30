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
  if (req.url && req.url.startsWith('/api/index')) {
    const u = new URL(req.url, 'http://localhost');
    const orig = u.searchParams.get('__path');
    if (orig) {
      u.searchParams.delete('__path');
      const qs = u.searchParams.toString();
      req.url = orig + (qs ? `?${qs}` : '');
    }
  } else if (req.url && req.url.includes('__path=')) {
    const u = new URL(req.url, 'http://localhost');
    u.searchParams.delete('__path');
    const qs = u.searchParams.toString();
    req.url = u.pathname + (qs ? `?${qs}` : '');
  }

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
