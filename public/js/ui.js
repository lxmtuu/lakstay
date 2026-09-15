/* ============================================================================
   UI helpers: toast, modal, reveal, counter, format, icons
   ========================================================================== */
const UI = (() => {
  /* ---------- format ---------- */
  const vnd = (n) => (Number(n) || 0).toLocaleString('vi-VN') + '₫';
  const vndShort = (n) => {
    n = Number(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'tr';
    if (n >= 1_000) return Math.round(n / 1000) + 'k';
    return String(n);
  };
  const dmy = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const dmyShort = (iso) => { if (!iso) return ''; const [, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}`; };
  const dtVN = (s) => s ? s.replace('T', ' ').slice(0, 16).replace(/(\d{4})-(\d{2})-(\d{2}) /, '$3/$2/$1 ') : '';
  const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
  const addDays = (isoStr, n) => { const d = new Date(isoStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const today = () => iso(new Date());
  const nights = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();

  /* ---------- icons (inline SVG, không cần mạng) ---------- */
  const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const ICONS = {
    logo: P('<path d="M3 21h18M5 21V9l7-6 7 6v12M9 21v-6h6v6"/><path d="M12 3v3"/>'),
    search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    calendar: P('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
    users: P('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 5a3.5 3.5 0 0 1 0 7M21.5 20c0-2.9-1.8-5-4.5-5.7"/>'),
    bed: P('<path d="M3 18v-8M3 14h18v4M3 14V7"/><path d="M7 11h4a2 2 0 0 1 2 2v1"/><circle cx="7" cy="9" r="1.6"/>'),
    ruler: P('<path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v3M15 8v3M19 8v3"/>'),
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>',
    check: P('<path d="m4 12.5 5 5L20 6.5"/>'),
    x: P('<path d="M6 6l12 12M18 6 6 18"/>'),
    clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>'),
    shield: P('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
    qr: P('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M20 20h1"/>'),
    wallet: P('<path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="16.5" cy="13" r="1.3"/>'),
    refund: P('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>'),
    key: P('<circle cx="8" cy="14" r="4"/><path d="m11 11 8-8M17 5l2 2M14 8l2 2"/>'),
    chart: P('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    settings: P('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
    logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
    user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
    phone: P('<path d="M5 3h4l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2"/>'),
    pin: P('<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
    mail: P('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    copy: P('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    arrow: P('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    arrowL: P('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
    edit: P('<path d="M4 20h4L20 8l-4-4L4 16z"/>'),
    trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>'),
    eye: P('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
    download: P('<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>'),
    print: P('<path d="M7 8V3h10v5"/><rect x="4" y="8" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
    spark: P('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
    bell: P('<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>'),
    menu: P('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    leaf: P('<path d="M4 20c8 0 16-4 16-16-10 0-16 6-16 12"/><path d="M4 20c2-6 6-10 12-12"/>'),
    wifi: P('<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1.2" fill="currentColor"/>'),
    coffee: P('<path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 9h2a2.5 2.5 0 0 1 0 5h-2M7 4v2M11 4v2"/>'),
    pool: P('<path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/><path d="M7 15V6a2 2 0 0 1 4 0M15 15V6a2 2 0 0 1 4 0M7 10h8"/>'),
  };
  const icon = (name, cls = '') => `<span class="icn ${cls}">${ICONS[name] || ''}</span>`;

  /* ---------- toast ---------- */
  let toastWrap;
  function ensureToasts() {
    if (!toastWrap) {
      toastWrap = document.createElement('div');
      toastWrap.className = 'toasts';
      document.body.appendChild(toastWrap);
    }
    return toastWrap;
  }
  function toast(msg, type = 'info', title = null, timeout = 4200) {
    const w = ensureToasts();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const glyph = { success: '✓', error: '!', warning: '!', info: 'i' }[type] || 'i';
    el.innerHTML = `<div class="ic">${glyph}</div><div>${title ? `<b>${esc(title)}</b>` : ''}${esc(msg)}</div>`;
    w.appendChild(el);
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); };
    el.addEventListener('click', close);
    setTimeout(close, timeout);
    return el;
  }
  const errToast = (e) => {
    const msg = e?.details?.length
      ? `${e.message}: ${e.details.map((d) => d.message).join(', ')}`
      : e.message;
    toast(msg, 'error', 'Có lỗi xảy ra');
    console.error('[API error]', e);
  };

  /* ---------- modal ---------- */
  let modalRoot;
  function modal({ title, body, footer = '', wide = false, onClose }) {
    if (!modalRoot) {
      modalRoot = document.createElement('div');
      modalRoot.className = 'modal-backdrop';
      modalRoot.innerHTML = `<div class="modal"><div class="modal-hd"><h3></h3><button class="modal-x" aria-label="Đóng"></button></div><div class="modal-bd"></div><div class="modal-ft"></div></div>`;
      document.body.appendChild(modalRoot);
    }
    const box = modalRoot.querySelector('.modal');
    box.classList.toggle('wide', wide);
    modalRoot.querySelector('h3').textContent = title || '';
    modalRoot.querySelector('.modal-bd').innerHTML = body;
    const ft = modalRoot.querySelector('.modal-ft');
    ft.innerHTML = footer;
    ft.style.display = footer ? '' : 'none';
    modalRoot.querySelector('.modal-x').innerHTML = ICONS.x;

    const close = () => {
      modalRoot.classList.remove('open');
      document.body.style.overflow = '';
      onClose?.();
    };
    modalRoot.classList.add('open');
    document.body.style.overflow = 'hidden';
    modalRoot.querySelector('.modal-x').onclick = close;
    modalRoot.onclick = (e) => { if (e.target === modalRoot) close(); };
    document.onkeydown = (e) => { if (e.key === 'Escape' && modalRoot.classList.contains('open')) close(); };
    return { root: modalRoot, box, close, $: (sel) => box.querySelector(sel), $$: (sel) => [...box.querySelectorAll(sel)] };
  }
  const confirmDialog = ({ title = 'Xác nhận', message, confirmText = 'Đồng ý', danger = false }) =>
    new Promise((resolve) => {
      const m = modal({
        title,
        body: `<p style="margin:0;color:var(--ink-2)">${esc(message)}</p>`,
        footer: `<button class="btn btn-ghost" data-no>Huỷ</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmText)}</button>`,
        onClose: () => resolve(false),
      });
      m.$('[data-no]').onclick = () => m.close();
      m.$('[data-yes]').onclick = () => { m.onClose = null; m.close(); resolve(true); };
    });

  /* ---------- scroll reveal ---------- */
  let revealObserver;
  function observeReveal(root = document) {
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); }
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    }
    root.querySelectorAll('[data-reveal]:not(.in)').forEach((el) => revealObserver.observe(el));
  }

  /* ---------- count-up ---------- */
  function countUp(el, target, { duration = 1400, formatter = (n) => Math.round(n).toLocaleString('vi-VN') } = {}) {
    const start = performance.now();
    const from = 0;
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatter(from + (target - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function autoCountUp(root = document) {
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) {
        const dec = e.target.dataset.dec ? Number(e.target.dataset.dec) : 0;
        const fmt = (n) => {
          const base = dec ? n.toFixed(dec).replace('.', ',') : Math.round(n).toLocaleString('vi-VN');
          return e.target.dataset.suffix ? base + e.target.dataset.suffix : base;
        };
        countUp(e.target, Number(e.target.dataset.count), { formatter: fmt });
        io.unobserve(e.target);
      }
    }, { threshold: 0.5 });
    root.querySelectorAll('[data-count]').forEach((el) => io.observe(el));
  }

  /* ---------- skeleton ---------- */
  const skeletonCards = (n = 6) => Array.from({ length: n }, () => `
    <div class="skel-card"><div class="m skel"></div><div class="b">
      <div class="skel" style="height:18px;width:70%"></div>
      <div class="skel" style="height:12px;width:45%"></div>
      <div class="skel" style="height:12px;width:90%"></div>
      <div class="skel" style="height:34px;width:50%;margin-top:6px"></div>
    </div></div>`).join('');
  const skeletonRows = (n = 6) => Array.from({ length: n }, () => `<tr><td colspan="8"><div class="skel" style="height:22px"></div></td></tr>`).join('');

  /* ---------- copy ---------- */
  async function copy(text, label = 'Đã sao chép') {
    try {
      await navigator.clipboard.writeText(text);
      toast(label, 'success');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      toast(label, 'success');
    }
  }

  /* ---------- debounce ---------- */
  const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- status ---------- */
  const STATUS_BADGE = {
    PENDING: 'warning', CONFIRMED: 'success', CHECKED_IN: 'info', COMPLETED: 'muted',
    CANCELLED: 'danger', NO_SHOW: 'danger', EXPIRED: 'muted', REFUNDED: 'success',
  };
  const STATUS_VI = {
    PENDING: 'Chờ thanh toán', CONFIRMED: 'Đã xác nhận', CHECKED_IN: 'Đang lưu trú', COMPLETED: 'Hoàn tất',
    CANCELLED: 'Đã huỷ', NO_SHOW: 'Không nhận phòng', EXPIRED: 'Hết hạn giữ chỗ', REFUNDED: 'Đã hoàn tiền',
  };
  const statusBadge = (s) => `<span class="badge badge-${STATUS_BADGE[s] || 'muted'}"><i class="dot"></i>${(window.I18N ? I18N.status(s) : STATUS_VI[s]) || s}</span>`;

  return { vnd, vndShort, dmy, dmyShort, dtVN, iso, addDays, today, nights, esc, initials, icon, ICONS,
           toast, errToast, modal, confirmDialog, observeReveal, countUp, autoCountUp,
           skeletonCards, skeletonRows, copy, debounce, statusBadge, STATUS_VI };
})();

window.UI = UI;

/* class nhỏ cho icon */
document.head.insertAdjacentHTML('beforeend', `<style>
.icn{display:inline-flex;width:1em;height:1em;vertical-align:-.15em}
.icn svg{width:100%;height:100%}
</style>`);
