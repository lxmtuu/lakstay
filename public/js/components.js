/* ============================================================================
   Shared components: header auth area, footer, room card, search form,
   QR payment modal, booking wizard pieces
   ========================================================================== */
const C = (() => {

  /* ---------------- header auth ---------------- */
  function renderAuthArea() {
    const box = document.getElementById('auth-area');
    if (!box) return;
    const u = API.getUser();
    if (!u) {
      box.innerHTML = `
        <button class="btn btn-ghost-light btn-sm" id="btn-login" data-icon-l="user">${I18N.t('hdr.login')}</button>
        <a class="btn btn-gold btn-sm" href="#/book">${I18N.t('hdr.booknow')}</a>`;
      box.querySelector('#btn-login').onclick = () => G.openAuth('login');
      return;
    }
    const role = u.user.role;
    box.innerHTML = `
      ${role !== 'customer' ? `<a class="btn btn-gold btn-sm" href="/admin.html">${I18N.t('hdr.admin')}</a>` : ''}
      <div class="menu" id="user-menu">
        <button class="avatar-btn" aria-label="Tài khoản">${UI.initials(u.user.full_name)}</button>
        <div class="menu-pop">
          <div style="padding:8px 12px 10px">
            <b style="font-size:14px">${UI.esc(u.user.full_name)}</b>
            <div class="tiny muted">${UI.esc(u.user.email)}</div>
            <div style="margin-top:6px"><span class="badge badge-gold">${I18N.t(role === 'admin' ? 'hdr.role.admin' : role === 'staff' ? 'hdr.role.staff' : 'hdr.role.member')}</span></div>
          </div>
          <div class="sep"></div>
          <a href="#/my-bookings" data-ic="calendar">${I18N.t('hdr.menu.my')}</a>
          <a href="#/write-review" data-ic="star">${I18N.t('hdr.menu.review')}</a>
          <a href="#/profile" data-ic="user">${I18N.t('hdr.menu.account')}</a>
          ${role !== 'customer' ? `<a href="/admin.html" data-ic="settings">${I18N.t('hdr.menu.admin')}</a>` : ''}
          <div class="sep"></div>
          <button id="btn-logout" data-ic="logout">${I18N.t('hdr.menu.logout')}</button>
        </div>
      </div>`;
    box.querySelectorAll('[data-ic]').forEach((a) => a.insertAdjacentHTML('afterbegin', UI.ICONS[a.dataset.ic] || ''));
    const menu = box.querySelector('#user-menu');
    menu.querySelector('.avatar-btn').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    document.addEventListener('click', () => menu.classList.remove('open'), { once: true });
    box.querySelectorAll('[data-icon-l]').forEach((el) => { if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', UI.ICONS[el.dataset.iconL] || ''); });
    box.querySelectorAll('.menu-pop [data-ic]').forEach((el) => { if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', UI.ICONS[el.dataset.ic] || ''); });
    box.querySelectorAll('svg').forEach((sv) => { if (!sv.style.width) { sv.style.width = '16px'; sv.style.height = '16px'; } });
    box.querySelector('#btn-logout').onclick = async () => {
      await API.logout();
      UI.toast(I18N.t('hdr.bye'), 'success');
      location.hash = '#/';
    };
  }

  /* ---------------- header scroll ---------------- */
  function initHeader() {
    const h = document.getElementById('header');
    const onScroll = () => {
      h.classList.toggle('scrolled', window.scrollY > 24);
      h.classList.toggle('on-dark', !h.classList.contains('scrolled') && G.routeAllowsDark());
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.getElementById('burger').onclick = () => document.getElementById('nav').classList.toggle('open');
    document.querySelectorAll('#nav a').forEach((a) => a.addEventListener('click', () => document.getElementById('nav').classList.remove('open')));
    onScroll();
  }

  /* ---------------- footer ---------------- */
  async function renderFooter() {
    const f = document.getElementById('footer');
    if (f.dataset.done && f.dataset.lang === I18N.lang()) return;
    f.dataset.done = '1';
    f.dataset.lang = I18N.lang();
    let site = {};
    try { site = await API.loadSite(); } catch {}
    const socialIcon = {
      facebook: '<path d="M14 8h3V4h-3a5 5 0 0 0-5 5v3H6v4h3v8h4v-8h3l1-4h-4V9a1 1 0 0 1 1-1z"/>',
      instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none"/>',
      tiktok: '<path d="M15 4c.5 2.5 2.2 4 4.5 4.2V12c-2 0-3.7-.7-5-1.8V16a5.5 5.5 0 1 1-5.5-5.5c.4 0 .8 0 1.2.1v3.2a2.6 2.6 0 1 0 1.8 2.5V4z"/>',
      youtube: '<rect x="2.5" y="6" width="19" height="12.5" rx="3.5"/><path d="m10.5 9.5 5 2.9-5 2.9z" fill="currentColor" stroke="none"/>',
      zalo: '<path d="M4 5h9M4 5v5h8M4 12h10"/><circle cx="17.5" cy="15.5" r="4.5"/><path d="M15.5 15.5h4l-4 3h4"/>',
      twitter: '<path d="M4 4l7.5 9.5L4.5 20h2.6l5.6-5.2L17 20h4l-7.8-10L20.5 4h-2.6l-5 4.7L9 4z"/>',
    };
    f.innerHTML = `
      <div class="wrap">
        <div class="cols">
          <div>
            <a class="brand" href="#/" style="color:#fff"><span class="mark" data-icon="logo"></span><span>LakStay<small>Đà Lạt</small></span></a>
            <p class="small" style="margin-top:16px;max-width:34ch">${I18N.t('foot.tagline')}</p>
            <div class="socials" style="margin-top:20px">
              ${(site.socials || []).map((s) => `<a href="${UI.esc(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="${UI.esc(s.name)}" title="${UI.esc(s.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">${socialIcon[s.icon] || socialIcon.facebook}</svg></a>`).join('')}
            </div>
          </div>
          <div>
            <h5>${I18N.t('foot.explore')}</h5>
            <a href="#/rooms">${I18N.t('foot.allrooms')}</a>
            <a href="#/experience">${I18N.t('foot.experience')}</a>
            <a href="#/reviews">${I18N.t('foot.reviews')}</a>
            <a href="#/rooms?sort=rating">${I18N.t('foot.fav')}</a>
          </div>
          <div>
            <h5>${I18N.t('foot.support')}</h5>
            <a href="#/help">${I18N.t('foot.cancel')}</a>
            <a href="#/help">${I18N.t('foot.faq')}</a>
            <a href="#/my-bookings">${I18N.t('foot.manage')}</a>
            <a href="/admin.html">${I18N.t('foot.staff')}</a>
          </div>
          <div>
            <h5>${I18N.t('foot.contact')}</h5>
            <div class="small" style="display:flex;flex-direction:column;gap:9px">
              <span class="row gap-8">${UI.ICONS.pin}<span>${UI.esc(site.address || 'Đà Lạt, Lâm Đồng')}</span></span>
              <span class="row gap-8">${UI.ICONS.phone}<span>Hotline ${UI.esc(site.hotline || '1900 6789')}</span></span>
              <span class="row gap-8">${UI.ICONS.mail}<span>${UI.esc(site.email || 'booking@lakstay.vn')}</span></span>
              <span class="row gap-8">${UI.ICONS.clock}<span>Check-in ${site.checkin_time || '14:00'} · Check-out ${site.checkout_time || '12:00'}</span></span>
            </div>
            <h5 style="margin-top:22px">${I18N.t('foot.deals')}</h5>
            <form class="newsletter" id="nl">
              <input type="email" placeholder="${I18N.t('foot.newsPh')}" required aria-label="Email">
              <button class="btn btn-gold btn-sm" type="submit">${I18N.t('foot.send')}</button>
            </form>
          </div>
        </div>
        <div class="bottom">
          <span>© ${new Date().getFullYear()} LakStay Hotel JSC · MST 0123456789</span>
          <span class="row gap-12 tiny">
            <span class="row gap-6">${UI.ICONS.shield}${I18N.t('foot.secure')}</span>
            <span class="row gap-6">${UI.ICONS.qr}VietQR · MoMo · VNPAY</span>
          </span>
        </div>
      </div>`;
    f.querySelectorAll('[data-icon]').forEach((el) => el.innerHTML = UI.ICONS[el.dataset.icon] || '');
    f.querySelectorAll('.small svg, .row svg').forEach((s) => { s.style.width = '15px'; s.style.height = '15px'; s.style.color = 'var(--gold-2)'; s.style.flex = 'none'; });
    f.querySelector('#nl')?.addEventListener('submit', (e) => {
      e.preventDefault();
      UI.toast('Cảm ơn bạn! Ưu đãi sẽ được gửi qua email sớm nhất.', 'success', 'Đăng ký thành công');
      e.target.reset();
    });
  }

  /* ---------------- room card ---------------- */
  function roomCard(r, { checkIn, checkOut } = {}) {
    const img = (r.images && r.images[0]) || '/img/room-deluxe.jpg';
    const soldout = checkIn && r.available === 0;
    return `
    <article class="room-card" data-reveal>
      <a class="media" href="#/room/${UI.esc(r.slug)}">
        <img src="${UI.esc(img)}" alt="${UI.esc(I18N.roomName(r))}" loading="lazy">
        <span class="price-tag">${I18N.t('card.from')} <b>${UI.vnd(r.base_price)}</b>${I18N.t('card.night')}</span>
        ${checkIn ? `<span class="avail badge ${soldout ? 'badge-danger' : r.available <= 2 ? 'badge-warning' : 'badge-success'}">${soldout ? I18N.t('card.soldout') : I18N.t('card.left', { n: r.available })}</span>` : ''}
        ${soldout ? `<span class="soldout">${I18N.t('card.soldoutDay')}</span>` : ''}
      </a>
      <div class="body">
        <div class="row gap-12" style="justify-content:space-between">
          <h3>${UI.esc(I18N.roomName(r))}</h3>
          ${r.rating ? `<span class="row gap-6 small" title="${r.review_count} đánh giá"><span class="stars">${UI.ICONS.star}</span><b>${r.rating}</b><span class="muted">(${r.review_count})</span></span>` : ''}
        </div>
        <div class="meta">
          <span data-ic="users">${I18N.t('card.guests', { n: r.capacity })}</span>
          <span data-ic="bed">${UI.esc(r.bed_type)}</span>
          <span data-ic="ruler">${r.size_m2} m²</span>
        </div>
        <div class="amen">${(r.amenities || []).slice(0, 4).map((a) => `<span class="chip">${UI.esc(I18N.amen(a))}</span>`).join('')}${(r.amenities || []).length > 4 ? `<span class="chip">+${r.amenities.length - 4}</span>` : ''}</div>
        <div class="foot">
          <a class="btn btn-ghost btn-sm" href="#/room/${UI.esc(r.slug)}">${I18N.t('card.detail')}</a>
          <a class="btn btn-primary btn-sm right" href="#/book?room=${UI.esc(r.id)}${checkIn ? `&in=${checkIn}&out=${checkOut}` : ''}" ${soldout ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : ''}>${I18N.t('card.book')}</a>
        </div>
      </div>
    </article>`;
  }

  function decorate(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => { if (!el.childElementCount) el.innerHTML = UI.ICONS[el.dataset.icon] || ''; });
    root.querySelectorAll('[data-icon-l]').forEach((el) => { if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', UI.ICONS[el.dataset.iconL] || ''); });
    root.querySelectorAll('[data-ic]').forEach((el) => { if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', UI.ICONS[el.dataset.ic] || ''); });
    root.querySelectorAll('.meta svg, .row svg').forEach((s) => { if (!s.style.width) { s.style.width = '15px'; s.style.height = '15px'; } });
    UI.observeReveal(root);
    UI.autoCountUp(root);
  }

  /* ---------------- search bar ---------------- */
  function searchCard({ checkIn = '', checkOut = '', guests = 2 } = {}, { onSubmit } = {}) {
    const id = 'sc' + Math.random().toString(36).slice(2, 7);
    const html = `
      <form class="search-card" id="${id}" novalidate>
        <div class="field"><label data-ic="calendar">${I18N.t('sc.checkin')}</label>
          <input class="input" type="date" name="checkIn" value="${checkIn}" min="${UI.today()}"></div>
        <div class="field"><label data-ic="clock">${I18N.t('sc.checkout')}</label>
          <input class="input" type="date" name="checkOut" value="${checkOut}" min="${UI.addDays(UI.today(), 1)}"></div>
        <div class="field"><label data-ic="users">${I18N.t('sc.guests')}</label>
          <select class="select" name="guests">${[1,2,3,4,5,6,7,8,10,12].map((n) => `<option value="${n}" ${n == guests ? 'selected' : ''}>${I18N.t('sc.guestsN', { n })}</option>`).join('')}</select></div>
        <div class="field"><label data-ic="wallet">${I18N.t('sc.budget')}</label>
          <select class="select" name="maxPrice"><option value="">${I18N.t('sc.bAll')}</option><option value="1500000">${I18N.t('sc.b1')}</option><option value="2500000">${I18N.t('sc.b2')}</option><option value="4000000">${I18N.t('sc.b3')}</option></select></div>
        <button class="btn btn-gold btn-lg" type="submit" data-icon-l="search">${I18N.t('sc.submit')}</button>
      </form>`;
    return {
      html,
      bind(root) {
        const form = root.querySelector('#' + id);
        if (!form) return;
        form.onsubmit = (e) => {
          e.preventDefault();
          const d = Object.fromEntries(new FormData(form));
          if (!d.checkIn || !d.checkOut) { UI.toast(I18N.t('sc.errDates'), 'warning'); return; }
          if (d.checkOut <= d.checkIn) { UI.toast(I18N.t('sc.errOrder'), 'warning'); return; }
          onSubmit?.(d);
        };
      },
    };
  }

  return { renderAuthArea, initHeader, renderFooter, roomCard, decorate, searchCard };
})();

window.C = C;
