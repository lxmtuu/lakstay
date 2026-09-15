/* ============================================================================
   Router + bootstrap cho SPA khách
   ========================================================================== */
(() => {
  const ROUTES = {
    '':                (p) => G.home(p),
    'rooms':           (p) => G.rooms(p),
    'room':            (p, seg) => G.roomDetail(seg[0], p),
    'experience':      () => G.experience(),
    'reviews':         (p) => G.reviewsPage(p),
    'write-review':    () => B.reviewsEligible(),
    'help':            () => G.help(),
    'profile':         () => G.profile(),
    'book':            (p) => B.book(p),
    'my-bookings':     (p) => B.myBookings(p),
    'booking':         (p, seg) => B.bookingDetail(seg[0]),
  };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const seg = pathPart.split('/').filter(Boolean);
    const params = {};
    if (queryPart) for (const [k, v] of new URLSearchParams(queryPart)) params[k] = v;
    return { seg, params, key: seg[0] || '' };
  }

  function markNav(key) {
    document.querySelectorAll('#nav a').forEach((a) => {
      const r = a.dataset.route || '';
      const active = key === '' ? r === '' : r === key || (key === 'room' && r === 'rooms') || (key === 'booking' && r === 'my-bookings');
      a.classList.toggle('active', active);
    });
    const h = document.getElementById('header');
    const dark = new Set(['', 'experience']).has(key);
    h.classList.toggle('on-dark', dark && !h.classList.contains('scrolled'));
    G.currentRoute = key;
  }

  async function route() {
    // dọn listeners của trang trước
    while (G._cleanup.length) { const fn = G._cleanup.pop(); try { fn(); } catch {} }
    const { seg, params, key } = parseHash();
    markNav(key);
    const handler = ROUTES[key];
    const main = document.getElementById('main');
    if (!handler) {
      main.innerHTML = `<div style="height:var(--nav-h)"></div>
        <section class="section center"><div class="wrap">
          <h1 style="font-size:64px;color:var(--sand)">404</h1>
          <p class="kicker">${I18N.t('e404.t')}</p>
          <p class="muted">${I18N.t('e404.s')}</p>
          <a class="btn btn-primary" href="#/" style="margin-top:16px">${I18N.t('e404.home')}</a>
        </div></section>`;
      return;
    }
    try {
      await handler(params, seg);
    } catch (e) {
      console.error(e);
      UI.errToast(e);
    }
    C.renderFooter();
    window.scrollTo({ top: 0 });
  }

  /* ---------- đổi ngôn ngữ: dịch DOM tĩnh + vẽ lại trang hiện tại ---------- */
  function markLangBtn() {
    document.querySelectorAll('#lang-sw button').forEach((b) => {
      const on = b.dataset.l === I18N.lang();
      b.style.background = on ? 'var(--pine)' : 'transparent';
      b.style.color = on ? '#fff' : 'inherit';
    });
  }
  window.addEventListener('lang:change', () => { markLangBtn(); route(); });

  /* ---------- boot ---------- */
  async function boot() {
    I18N.applyStatic();
    document.querySelectorAll('#lang-sw button').forEach((b) => b.onclick = () => I18N.setLang(b.dataset.l));
    markLangBtn();
    document.querySelectorAll('#header [data-icon]').forEach((el) => el.innerHTML = UI.ICONS[el.dataset.icon] || '');
    C.initHeader();
    C.renderAuthArea();
    window.addEventListener('auth:change', () => C.renderAuthArea());
    await API.loadMe();
    C.renderAuthArea();
    window.addEventListener('hashchange', route);
    route();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
