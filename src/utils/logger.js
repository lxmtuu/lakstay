/* Logger tối giản có level + JSON (prod) / pretty (dev). Không kéo dependency. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const current = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 20;

const ts = () => new Date().toISOString();

function emit(level, msg, meta) {
  if (LEVELS[level] < current) return;
  const line = process.env.NODE_ENV === 'production'
    ? JSON.stringify({ ts: ts(), level, msg, ...meta })
    : `${ts()} [${level.toUpperCase().padEnd(5)}] ${msg}${meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`;
  const stream = level === 'error' ? console.error : console.log;
  stream(line);
}

export const logger = {
  debug: (m, meta) => emit('debug', m, meta),
  info:  (m, meta) => emit('info', m, meta),
  warn:  (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
  child(bindings) {
    return {
      debug: (m, meta) => emit('debug', m, { ...bindings, ...meta }),
      info:  (m, meta) => emit('info', m, { ...bindings, ...meta }),
      warn:  (m, meta) => emit('warn', m, { ...bindings, ...meta }),
      error: (m, meta) => emit('error', m, { ...bindings, ...meta }),
    };
  },
};
