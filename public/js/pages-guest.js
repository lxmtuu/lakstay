/* ============================================================================
   Guest pages: Home, Rooms, Room detail, Experience, Reviews, Help, Profile
   ========================================================================== */
const G = (() => {

  /* ============================ HOME ============================ */
  async function home(params) {
    const main = document.getElementById('main');
    main.innerHTML = `
      <section class="hero">
        <div class="hero-bg" id="hero-bg" style="background-image:url('/img/hero.jpg')"></div>
        <div class="hero-scrim"></div>
        <div class="mist m1"></div><div class="mist m2"></div><div class="mist m3"></div>
        <div class="hero-inner">
          <span class="kicker center">${I18N.t('home.kicker')}</span>
          <h1 data-reveal>${I18N.t('home.title')}</h1>
          <p class="sub" data-reveal>${I18N.t('home.sub')}</p>
          <div id="hero-search"></div>
          <div class="hero-stats" data-reveal>
            <div><div class="n" data-count="35" data-suffix="">0</div><div class="l">Phòng &amp; biệt thự</div></div>
            <div><div class="n" data-count="4.9" data-dec="1">0</div><div class="l">Điểm đánh giá</div></div>
            <div><div class="n" data-count="12800" data-suffix="+">0</div><div class="l">Khách đã lưu trú</div></div>
            <div><div class="n" data-count="18">0</div><div class="l">Hecta rừng thông</div></div>
          </div>
        </div>
        <div class="scroll-hint">${UI.ICONS.arrow.replace('viewBox', 'style="transform:rotate(90deg)" viewBox')}</div>
      </section>

      <section class="section" style="background:var(--cream)">
        <div class="ticker"><div class="track" id="ticker"></div></div>
      </section>

      <section class="section">
        <div class="aurora"><i></i><i></i><i></i></div>
        <div class="wrap" style="position:relative">
          <div class="center">
            <span class="kicker center">${I18N.t('home.s1k')}</span>
            <h2 data-reveal>${I18N.t('home.s1t')}</h2>
            <p class="lead" data-reveal>Từ phòng Standard ấm cúng đến biệt thự tổng thống có hồ bơi nước ấm riêng —
              mỗi hạng phòng là một cách cảm nhận thành phố sương mù.</p>
          </div>
          <div class="room-grid" id="home-rooms">${UI.skeletonCards(6)}</div>
          <div class="center" style="margin-top:38px">
            <a class="btn btn-ghost" href="#/rooms">Xem tất cả phòng &amp; giá ${UI.ICONS.arrow}</a>
          </div>
        </div>
      </section>

      <section class="section" style="background:var(--pine);color:#fff;overflow:hidden">
        <div class="wrap">
          <div class="split">
            <div class="visual" data-reveal="left">
              <img src="/img/spa.jpg" alt="LakStay Spa" style="aspect-ratio:4/4.4;object-fit:cover">
              <div class="float-card" style="left:-16px;top:12%">
                <span class="badge badge-success" style="font-size:16px;padding:8px">${UI.ICONS.leaf}</span>
                <div><b>Spa &amp; Onsen</b><span class="muted tiny">Mở cửa 9:00 – 22:00</span></div>
              </div>
              <div class="float-card" style="right:-10px;bottom:10%;animation-delay:-2.4s">
                <span class="badge badge-gold" style="font-size:16px;padding:8px">${UI.ICONS.star}</span>
                <div><b>4.9 / 5.0</b><span class="muted tiny">2.847 đánh giá xác thực</span></div>
              </div>
            </div>
            <div data-reveal="right">
              <span class="kicker">${I18N.t('home.whyK')}</span>
              <h2 style="color:#fff">${I18N.t('home.whyT')}</h2>
              <div class="feat-list">
                ${[
                  ['shield', 'Đặt phòng an toàn tuyệt đối', 'Hệ thống chống đặt trùng phòng nhiều lớp, giá niêm yết minh bạch, không phí ẩn.'],
                  ['qr', 'Thanh toán 1 chạm', 'Quét VietQR / MoMo / VNPAY — phòng tự động xác nhận trong vài giây, kèm hoá đơn điện tử.'],
                  ['refund', 'Huỷ linh hoạt', 'Huỷ miễn phí trước 24–72 giờ tuỳ hạng phòng. Tiền hoàn về tài khoản theo đúng chính sách.'],
                  ['spark', 'Ưu đãi theo mùa', 'Giá tốt quanh năm cùng mã giảm giá cho khách quay lại và đặt sớm.'],
                ].map(([ic, t, d]) => `
                  <div class="feat">
                    <div class="ic" style="background:rgba(227,196,126,.14);color:var(--gold-2)">${UI.ICONS[ic]}</div>
                    <div><h4 style="color:#fff">${t}</h4><p style="color:rgba(255,255,255,.72)">${d}</p></div>
                  </div>`).join('')}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="center">
            <span class="kicker center">${I18N.t('home.revK')}</span>
            <h2 data-reveal>${I18N.t('home.revT')}</h2>
          </div>
          <div class="tst-grid" id="home-reviews"></div>
          <div class="center" style="margin-top:30px"><a class="btn btn-ghost btn-sm" href="#/reviews">Đọc tất cả đánh giá ${UI.ICONS.arrow}</a></div>
        </div>
      </section>

      <section class="section" style="background:var(--cream)">
        <div class="wrap center" data-reveal="zoom">
          <span class="kicker center">${I18N.t('home.ctaK')}</span>
          <h2 style="max-width:16ch;margin-inline:auto">${I18N.t('home.ctaT')}</h2>
          <p class="lead">Đặt hôm nay, nhận ngay mã <b class="mono" style="color:#8a6a1e">DALAT10</b> giảm 10% cho đơn từ 1 triệu.</p>
          <div class="row gap-12" style="justify-content:center;margin-top:26px;flex-wrap:wrap">
            <a class="btn btn-gold btn-lg" href="#/book">Bắt đầu đặt phòng</a>
            <a class="btn btn-ghost btn-lg" href="#/rooms">Khảo giá trước</a>
          </div>
        </div>
      </section>`;

    // ticker
    const words = ['Rừng thông trăm tuổi', 'Hồ Xuân Hương 5 phút', 'Spa & Onsen', 'Nhà hàng ẩm thực Đà Lạt', 'Xe đưa đón sân bay Liên Khương', 'Quầy cà phê đặc sản', 'Vườn cẩm tú cầu', 'Lửa trại mỗi tối thứ 7'];
    document.getElementById('ticker').innerHTML = [...words, ...words].map((w) => `<span>${w} ✦</span>`).join('');

    // hero search
    const sc = C.searchCard({ checkIn: params.in || '', checkOut: params.out || '', guests: params.guests || 2 }, {
      onSubmit: (d) => { location.hash = `#/rooms?in=${d.checkIn}&out=${d.checkOut}&guests=${d.guests}${d.maxPrice ? `&max=${d.maxPrice}` : ''}`; },
    });
    document.getElementById('hero-search').innerHTML = sc.html;
    sc.bind(document);

    // parallax hero
    const bg = document.getElementById('hero-bg');
    const onScroll = () => { const y = window.scrollY; if (y < window.innerHeight) bg.style.transform = `scale(1.08) translateY(${y * 0.22}px)`; };
    window.addEventListener('scroll', onScroll, { passive: true });
    G._cleanup.push(() => window.removeEventListener('scroll', onScroll));

    // rooms
    try {
      const ci = params.in || UI.addDays(UI.today(), 7);
      const co = params.out || UI.addDays(ci, 9);
      const d = await API.get('/api/rooms', { query: { checkIn: ci, checkOut: co, limit: 6 } });
      document.getElementById('home-rooms').innerHTML = d.items.map((r) => C.roomCard(r, { checkIn: ci, checkOut: co })).join('');
    } catch (e) {
      document.getElementById('home-rooms').innerHTML = `<p class="muted">Không tải được danh sách phòng.</p>`;
    }

    // reviews
    try {
      const d = await API.get('/api/reviews', { query: { limit: 3 } });
      document.getElementById('home-reviews').innerHTML = d.items.map((r, i) => `
        <div class="tst" data-reveal style="transition-delay:${i * 90}ms">
          <span class="q">”</span>
          <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
          <p style="margin-top:10px">“${UI.esc(r.content)}”</p>
          <div class="who"><div class="av">${UI.esc(r.full_name?.[0] || 'K')}</div>
            <div><b>${UI.esc(r.full_name)}</b><span> · ${UI.esc(r.room_type_name)} · ${UI.dmy(r.created_at)}</span></div></div>
        </div>`).join('') || '<p class="muted">Chưa có đánh giá.</p>';
    } catch { document.getElementById('home-reviews').innerHTML = ''; }

    C.decorate(main);
  }

  /* ============================ ROOMS LIST ============================ */
  async function rooms(params) {
    const main = document.getElementById('main');
    const ci = params.in || UI.addDays(UI.today(), 7);
    const co = params.out || UI.addDays(ci, 2);
    main.innerHTML = `
      <div style="height:var(--nav-h)"></div>
      <section class="section" style="padding-top:40px">
        <div class="aurora"><i></i><i></i></div>
        <div class="wrap" style="position:relative">
          <span class="kicker">${I18N.t('rooms.kicker')}</span>
          <h1 style="font-size:clamp(30px,4.4vw,48px)">${I18N.t('rooms.title')}</h1>
          <p class="muted" style="margin:8px 0 24px">${I18N.t('rooms.sub')}</p>
          <div id="sc"></div>
          <div class="row gap-12" style="margin:22px 0 0;flex-wrap:wrap">
            <label class="row gap-8 small">${I18N.t('rooms.sort')}
              <select class="select" id="sort" style="width:auto">
                <option value="price_asc">${I18N.t('rooms.sortAsc')}</option>
                <option value="price_desc">${I18N.t('rooms.sortDesc')}</option>
                <option value="rating">${I18N.t('rooms.sortRating')}</option>
                <option value="name">${I18N.t('rooms.sortName')}</option>
              </select></label>
            <label class="row gap-8 small">${I18N.t('rooms.minRating')}
              <select class="select" id="mr" style="width:auto">
                <option value="">${I18N.t('rooms.all')}</option><option value="4">4.0</option><option value="4.5">4.5</option><option value="4.8">4.8</option>
              </select></label>
            <span class="muted small" id="count"></span>
          </div>
          <div class="row gap-8" id="amen" style="flex-wrap:wrap;margin-top:12px"></div>
          <div class="row gap-8" id="cheapdays" style="flex-wrap:wrap;margin-top:10px;align-items:center"></div>
          <div class="room-grid" id="list">${UI.skeletonCards(6)}</div>
        </div>
      </section>`;

    const sc = C.searchCard({ checkIn: ci, checkOut: co, guests: params.guests || 2 }, {
      onSubmit: (d) => { location.hash = `#/rooms?in=${d.checkIn}&out=${d.checkOut}&guests=${d.guests}${d.maxPrice ? `&max=${d.maxPrice}` : ''}`; },
    });
    document.getElementById('sc').innerHTML = sc.html;
    sc.bind(document);
    document.getElementById('sort').value = params.sort || 'price_asc';

    // chip tiện nghi
    let chosenAmen = new Set();
    try {
      const am = await API.get('/api/rooms/meta/amenities');
      const top = (am.amenities || []).slice(0, 10);
      document.getElementById('amen').innerHTML = top.map((a) =>
        `<button class="chip" data-am="${UI.esc(a)}" style="cursor:pointer;padding:7px 13px;font-size:12.5px;border:1.5px solid transparent">${UI.esc(a)}</button>`).join('');
      document.querySelectorAll('[data-am]').forEach((b) => b.onclick = () => {
        const a = b.dataset.am;
        if (chosenAmen.has(a)) chosenAmen.delete(a); else chosenAmen.add(a);
        b.style.background = chosenAmen.has(a) ? 'var(--pine)' : 'var(--sand)';
        b.style.color = chosenAmen.has(a) ? '#fff' : '';
        load();
      });
    } catch { /* không có tiện nghi thì bỏ qua bộ lọc */ }

    // gợi ý NGÀY RẺ NHẤT trong tháng của kỳ ở (dựa price_rules + cuối tuần)
    try {
      const cal = await API.get('/api/rooms/meta/price-calendar', { query: { month: ci.slice(0, 7) } });
      const ch = cal.cheapest || [];
      if (ch.length) {
        const mNum = Number(ci.slice(5, 7));
        document.getElementById('cheapdays').innerHTML =
          `<span class="tiny muted" style="font-weight:700">${I18N.t('rooms.cheap', { m: mNum })}</span>` +
          ch.map((d) => `<button class="chip" data-cd="${d.date}" style="cursor:pointer;padding:6px 12px;font-size:12.5px;border:1.5px solid var(--sand)">
            <b>${d.date.slice(8, 10)}/${d.date.slice(5, 7)}</b> · ${UI.vnd(d.min_price)}</button>`).join('');
        document.querySelectorAll('[data-cd]').forEach((b) => b.onclick = () => {
          const inD = b.dataset.cd;
          location.hash = `#/rooms?in=${inD}&out=${UI.addDays(inD, 1)}&guests=${params.guests || 2}`;
        });
      }
    } catch { /* lịch giá là gợi ý, lỗi thì bỏ qua */ }

    async function load() {
      const d = await API.get('/api/rooms', {
        query: {
          checkIn: ci, checkOut: co, guests: params.guests || 2,
          maxPrice: params.max || '', sort: document.getElementById('sort').value, limit: 20,
          amenities: [...chosenAmen].join(','), minRating: document.getElementById('mr').value || '',
        },
      });
      document.getElementById('count').textContent =
        I18N.t('rooms.count', { n: d.items.length, a: UI.dmy(ci), b: UI.dmy(co), d: UI.nights(ci, co) });
      document.getElementById('list').innerHTML = d.items.map((r) => C.roomCard(r, { checkIn: ci, checkOut: co })).join('');
      C.decorate(main);
    }
    document.getElementById('sort').onchange = load;
    document.getElementById('mr').onchange = load;
    await load().catch(UI.errToast);
  }

  /* ============================ ROOM DETAIL ============================ */
  async function roomDetail(slug, params) {
    const main = document.getElementById('main');
    main.innerHTML = `<div style="height:var(--nav-h)"></div><section class="section" style="padding-top:40px"><div class="wrap">${UI.skeletonCards(1)}</div></section>`;
    let d;
    try { d = await API.get(`/api/rooms/${encodeURIComponent(slug)}`); }
    catch (e) { main.innerHTML = `<div style="height:var(--nav-h)"></div><section class="section"><div class="wrap center"><h2>${I18N.t('rooms.nf')}</h2><a class="btn btn-primary" href="#/rooms" style="margin-top:18px">${I18N.t('rooms.back')}</a></div></section>`; return; }
    const r = d.room_type;
    const imgs = (r.images || []).length ? r.images : ['/img/room-deluxe.jpg'];

    main.innerHTML = `
      <div style="height:var(--nav-h)"></div>
      <section class="section" style="padding-top:36px">
        <div class="wrap">
          <nav class="tiny muted" style="margin-bottom:16px"><a href="#/rooms">Phòng</a> / <span>${UI.esc(r.name_vi)}</span></nav>
          <div class="split" style="align-items:start;grid-template-columns:1.15fr .85fr;gap:40px">
            <div>
              <div class="media" style="border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--sh-2);position:relative">
                <img id="big" src="${UI.esc(imgs[0])}" alt="${UI.esc(r.name_vi)}" style="aspect-ratio:16/10;object-fit:cover;width:100%">
              </div>
              ${imgs.length > 1 ? `<div class="row gap-8" style="margin-top:10px">${imgs.map((im, i) => `<img src="${UI.esc(im)}" data-i="${i}" style="width:84px;height:60px;object-fit:cover;border-radius:10px;cursor:pointer;opacity:.75;transition:.2s" alt="ảnh ${i + 1}">`).join('')}</div>` : ''}

              <div style="margin-top:26px">
                <div class="row gap-12" style="flex-wrap:wrap">
                  <h1 style="font-size:clamp(26px,3.4vw,38px)">${UI.esc(I18N.roomName(r))}</h1>
                  ${r.rating ? `<span class="row gap-6"><span class="stars">${UI.ICONS.star}</span><b>${r.rating}</b><span class="muted small">(${I18N.t('card.reviews', { n: r.review_count })})</span></span>` : ''}
                </div>
                <div class="meta room-card" style="border:none;box-shadow:none;padding:10px 0;gap:18px">
                  <span data-ic="users">${I18N.t('card.guests', { n: r.capacity })}</span>
                  <span data-ic="bed">${UI.esc(r.bed_type)}</span>
                  <span data-ic="ruler">${r.size_m2} m²</span>
                  <span data-ic="pin">Tầng ${r.total_rooms > 0 ? '1–6' : '—'}</span>
                </div>
                <p style="color:var(--ink-2);max-width:62ch">${UI.esc(I18N.roomDesc(r))}</p>
                <h4 style="margin-top:24px;font-family:var(--f-body);font-size:15px">${I18N.t('rd.amen')}</h4>
                <div class="row gap-8" style="flex-wrap:wrap;margin-top:10px">
                  ${(r.amenities || []).map((a) => `<span class="chip" style="padding:7px 12px;font-size:12.5px">${UI.esc(I18N.amen(a))}</span>`).join('')}
                </div>

                <h4 style="margin-top:30px;font-family:var(--f-body);font-size:15px">${I18N.t('rd.inv30')}</h4>
                <div class="cal-legend" style="margin-top:10px">
                  <span><i style="background:var(--success-bg);border:1px solid var(--success)"></i>${I18N.t('rd.calMany')}</span>
                  <span><i style="background:var(--warn-bg);border:1px solid var(--warn)"></i>${I18N.t('rd.calFew')}</span>
                  <span><i style="background:var(--danger-bg);border:1px solid var(--danger)"></i>${I18N.t('rd.calOut')}</span>
                  <span><i style="background:#f1efe8"></i>${I18N.t('rd.calPast')}</span>
                </div>
                <div class="cal" id="cal"></div>

                <h4 style="margin-top:30px;font-family:var(--f-body);font-size:15px">${I18N.t('rd.policy')}</h4>
                <div class="tbl-wrap" style="margin-top:10px;min-width:0">
                  <table class="tbl" style="min-width:0">
                    <thead><tr><th>${I18N.t('rd.polWhen')}</th><th>${I18N.t('rd.polFee')}</th><th>${I18N.t('rd.polEx')}</th></tr></thead>
                    <tbody>
                      ${(r.cancellation_preview?.tiers || []).map((t) => `
                        <tr><td>${UI.esc(t.label)}</td>
                        <td>${t.refund_pct === null ? I18N.t('rd.polPenalty', { p: r.policy.cancel_penalty_pct }) : t.refund_pct === 100 ? I18N.t('rd.polFree') : I18N.t('rd.polFull')}</td>
                        <td class="num">${t.example ? UI.vnd(t.example.refund_amount) + ' ' + I18N.t('rd.polRefund') : ''}</td></tr>`).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <aside style="position:sticky;top:calc(var(--nav-h) + 16px)" id="book-box"></aside>
          </div>

          <div style="margin-top:64px">
            <h3 style="font-size:26px">${I18N.t('rd.revFrom')}</h3>
            <div class="tst-grid" id="revs">${UI.skeletonCards(3)}</div>
          </div>
        </div>
      </section>`;

    // thumbs
    main.querySelectorAll('[data-i]').forEach((im) => im.onclick = () => {
      document.getElementById('big').src = im.src;
      main.querySelectorAll('[data-i]').forEach((x) => x.style.opacity = '.75');
      im.style.opacity = '1';
    });

    // calendar
    const cal = document.getElementById('cal');
    const dows = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    let first = true;
    cal.innerHTML = dows.map((x) => `<div class="dow">${x}</div>`).join('') +
      (r.inventory_30d || []).map((day) => {
        const dt = new Date(day.date + 'T00:00:00Z');
        const lead = first ? (Array.from({ length: dt.getUTCDay() }, () => '<div class="day off"></div>').join('')) : '';
        first = false;
        const cls = day.available === 0 ? 'full' : day.available <= 2 ? 'low' : 'free';
        return `${lead}<div class="day ${cls}" title="${UI.dmy(day.date)}: còn ${day.available}/${day.total} phòng">
          ${Number(day.date.slice(8, 10))}<small>${day.available === 0 ? 'hết' : 'còn ' + day.available}</small></div>`;
      }).join('');

    // booking box
    const ci = params.in || UI.addDays(UI.today(), 7);
    const co = params.out || UI.addDays(ci, 2);
    document.getElementById('book-box').innerHTML = `
      <div style="background:#fff;border-radius:var(--r-lg);box-shadow:var(--sh-2);padding:24px;border:1px solid var(--sand)">
        <div class="row" style="justify-content:space-between;align-items:baseline">
          <div><b style="font-size:26px;font-family:var(--f-display)">${UI.vnd(r.base_price)}</b><span class="muted small">/đêm</span></div>
          ${r.rating ? `<span class="row gap-6 small"><span class="stars">${UI.ICONS.star}</span>${r.rating}</span>` : ''}
        </div>
        <form id="bf" style="display:grid;gap:12px;margin-top:16px">
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
            <div class="field"><label>Nhận phòng</label><input class="input" type="date" name="in" value="${ci}" min="${UI.today()}"></div>
            <div class="field"><label>Trả phòng</label><input class="input" type="date" name="out" value="${co}" min="${UI.addDays(ci, 1)}"></div>
          </div>
          <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
            <div class="field"><label>Khách</label><input class="input" type="number" name="guests" value="${params.guests || 2}" min="1" max="${r.capacity}"></div>
            <div class="field"><label>Số phòng</label><input class="input" type="number" name="qty" value="1" min="1" max="5"></div>
          </div>
          <div id="qout" class="small muted"></div>
          <button class="btn btn-gold btn-lg" type="submit">Kiểm tra giá &amp; đặt</button>
          <p class="tiny muted center" style="margin:0">Chưa bị trừ tiền ở bước này · Giữ chỗ 15 phút</p>
        </form>
      </div>`;
    const bf = document.getElementById('bf');
    const qout = document.getElementById('qout');
    const doQuote = UI.debounce(async () => {
      const f = Object.fromEntries(new FormData(bf));
      if (!f.in || !f.out || f.out <= f.in) { qout.textContent = ''; return; }
      try {
        const q = await API.post('/api/rooms/quote', {
          checkIn: f.in, checkOut: f.out, guests: +f.guests,
          lines: [{ roomTypeId: r.id, qty: +f.qty, guests: +f.guests }],
        });
        const av = q.quote.availability?.[0];
        qout.innerHTML = `<div class="row" style="justify-content:space-between"><span>Tạm tính ${q.quote.nights} đêm</span><b>${UI.vnd(q.quote.subtotal)}</b></div>
          <div class="row" style="justify-content:space-between"><span>Thuế &amp; phí</span><b>${UI.vnd(q.quote.tax + q.quote.service_fee)}</b></div>
          <div class="row" style="justify-content:space-between;font-size:15px;margin-top:4px"><span><b>Tổng cộng</b></span><b style="color:var(--pine)">${UI.vnd(q.quote.total_amount)}</b></div>
          ${av && av.available < +f.qty ? `<div class="badge badge-warning" style="margin-top:8px">Chỉ còn ${av.available} phòng trống</div>` : ''}`;
      } catch (e) { qout.innerHTML = `<span class="err-text">${UI.esc(e.message)}</span>`; }
    }, 400);
    bf.addEventListener('input', doQuote);
    bf.onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(bf));
      location.hash = `#/book?room=${r.id}&in=${f.in}&out=${f.out}&guests=${f.guests}&qty=${f.qty}`;
    };
    doQuote();

    // reviews
    try {
      const rv = await API.get('/api/reviews', { query: { roomTypeId: r.id, limit: 6 } });
      document.getElementById('revs').innerHTML = rv.items.length ? rv.items.map((x, i) => `
        <div class="tst" data-reveal style="transition-delay:${i * 70}ms">
          <span class="q">”</span><span class="stars">${'★'.repeat(x.rating)}${'☆'.repeat(5 - x.rating)}</span>
          ${x.title ? `<b style="display:block;margin-top:8px">${UI.esc(x.title)}</b>` : ''}
          <p style="margin-top:6px">${UI.esc(x.content)}</p>
          ${x.owner_reply ? `<div style="margin-top:12px;padding:10px 14px;background:var(--cream);border-radius:10px;font-size:13px"><b>LakStay phản hồi:</b> ${UI.esc(x.owner_reply)}</div>` : ''}
          <div class="who"><div class="av">${UI.esc(x.full_name?.[0] || 'K')}</div><div><b>${UI.esc(x.full_name)}</b><span> · ${UI.dmy(x.created_at)}</span></div></div>
        </div>`).join('') : `<p class="muted">Chưa có đánh giá cho hạng phòng này.</p>`;
    } catch { document.getElementById('revs').innerHTML = ''; }

    C.decorate(main);
  }

  /* ============================ EXPERIENCE ============================ */
  async function experience() {
    const main = document.getElementById('main');
    main.innerHTML = `
      <section class="hero" style="min-height:62vh">
        <div class="hero-bg" style="background-image:url('/img/spa.jpg')"></div><div class="hero-scrim"></div>
        <div class="mist m1"></div><div class="mist m3"></div>
        <div class="hero-inner" style="padding-bottom:60px">
          <span class="kicker center">${I18N.t('exp.k')}</span>
          <h1 data-reveal>${I18N.t('exp.t')}</h1>
        </div>
      </section>
      <section class="section">
        <div class="wrap">
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:22px">
            ${[
              ['06:30', 'Săn mây đồi thông', 'Đường mòn 2km xuyên rừng thông ba lá, hướng dẫn viên dẫn đoàn mỗi sáng.'],
              ['08:00', 'Buffet sáng đặc sản', 'Bánh mì xíu mại, bánh ướt lòng gà, cà phê rang tại chỗ từ cầu đất.'],
              ['10:00', 'Spa & onsen', 'Bồn ngâm nước nóng khoáng, massage đá nóng với tinh dầu thông.'],
              ['15:00', 'Tea break bên hồ', 'Trà atiso, bánh ngọt nhà làm ở lounge nhìn thẳng hồ Xuân Hương.'],
              ['18:30', 'Bếp lửa & BBQ', 'Set nướng rau củ Đà Lạt, thịt nướng lu, rượu vang nho Phan Rang.'],
              ['20:00', 'Lửa trại & acoustic', 'Thứ 7 hằng tuần: lửa trại, guitar mộc và những câu chuyện của khách tứ phương.'],
            ].map(([t, h, d], i) => `
              <div class="tst" data-reveal style="transition-delay:${i * 70}ms">
                <span class="badge badge-gold mono">${t}</span>
                <b style="display:block;margin:10px 0 4px;font-size:17px;font-family:var(--f-display)">${h}</b>
                <p class="muted small" style="margin:0">${d}</p>
              </div>`).join('')}
          </div>
        </div>
      </section>
      <section class="section" style="background:var(--cream)">
        <div class="wrap split">
          <div data-reveal="left">
            <span class="kicker">${I18N.t('exp.k2')}</span>
            <h2>${I18N.t('exp.t2')}</h2>
            <div class="row gap-8" style="flex-wrap:wrap;margin-top:22px">
              ${['Wifi tốc độ cao', 'Bãi đỗ xe miễn phí', 'Xe đưa đón sân bay', 'Giặt ủi trong ngày', 'Phòng gym 24/7', 'Khu vui chơi trẻ em', 'Quầy lưu niệm', 'Dịch vụ văn phòng', 'Thuê xe máy', 'Đặt tour trong ngày', 'Trông trẻ theo giờ', 'Bếp chung'].map((a) => `<span class="chip" style="padding:9px 14px;font-size:13px;background:#fff;box-shadow:var(--sh-1)">${UI.esc(a)}</span>`).join('')}
            </div>
          </div>
          <div class="visual" data-reveal="right"><img src="/img/room-villa.jpg" alt="Hồ bơi villa" style="aspect-ratio:4/3;object-fit:cover"></div>
        </div>
      </section>`;
    C.decorate(main);
  }

  /* ============================ REVIEWS LIST ============================ */
  async function reviewsPage(params) {
    const main = document.getElementById('main');
    main.innerHTML = `<div style="height:var(--nav-h)"></div>
      <section class="section" style="padding-top:40px"><div class="wrap">
        <span class="kicker">${I18N.t('home.revK')}</span><h1 style="font-size:clamp(28px,4vw,42px)">${I18N.t('rev.t')}</h1>
        <p class="muted small">Chỉ khách đã hoàn tất kỳ nghỉ mới được đánh giá — mọi nhận xét đều gắn với một mã đặt phòng thật.</p>
        <div class="row gap-12" style="margin:20px 0;flex-wrap:wrap" id="sum"></div>
        <div class="tst-grid" id="list">${UI.skeletonCards(6)}</div>
        <div class="center" style="margin-top:26px"><button class="btn btn-ghost" id="more">Tải thêm</button></div>
      </div></section>`;
    let page = 1;
    async function load(reset = false) {
      if (reset) { page = 1; document.getElementById('list').innerHTML = ''; }
      const d = await API.get('/api/reviews', { query: { page, limit: 9 } });
      if (page === 1) {
        const s = d.summary;
        document.getElementById('sum').innerHTML = `
          <div class="badge badge-gold" style="font-size:16px;padding:10px 16px">${UI.ICONS.star} ${s.average || '—'} / 5</div>
          <span class="muted small">${s.count} đánh giá</span>
          <span class="row gap-8 small">${[5, 4, 3, 2, 1].map((k) => `<span class="muted">${k}★ ${s.distribution[k]}</span>`).join(' · ')}</span>`;
      }
      document.getElementById('list').insertAdjacentHTML('beforeend', d.items.map((x, i) => `
        <div class="tst" data-reveal style="transition-delay:${(i % 3) * 70}ms"><span class="q">”</span>
          <span class="stars">${'★'.repeat(x.rating)}${'☆'.repeat(5 - x.rating)}</span>
          ${x.title ? `<b style="display:block;margin-top:8px">${UI.esc(x.title)}</b>` : ''}
          <p style="margin-top:6px">${UI.esc(x.content)}</p>
          <div class="who"><div class="av">${UI.esc(x.full_name?.[0] || 'K')}</div><div><b>${UI.esc(x.full_name)}</b><span> · ${UI.esc(x.room_type_name)} · ${UI.dmy(x.created_at)}</span></div></div>
        </div>`).join(''));
      page++;
      document.getElementById('more').style.display = page > d.meta.totalPages ? 'none' : '';
      C.decorate(main);
    }
    document.getElementById('more').onclick = () => load();
    await load(true).catch(UI.errToast);
  }

  /* ============================ HELP ============================ */
  async function help() {
    const main = document.getElementById('main');
    const faqs = [
      ['Tôi có thể huỷ phòng miễn phí không?', 'Có. Tuỳ hạng phòng, bạn được huỷ miễn phí trước 24–72 giờ so với giờ nhận phòng (14:00). Sau mốc này hệ thống tự tính phí theo chính sách và hiển thị số tiền hoàn TRƯỚC khi bạn xác nhận huỷ.'],
      ['Thanh toán bằng cách nào?', 'VietQR (mọi ngân hàng nội địa), MoMo, VNPAY, thẻ quốc tế hoặc tiền mặt tại quầy. Với VietQR, phòng tự xác nhận ngay khi ngân hàng báo có — thường trong 5–10 giây.'],
      ['Đặt phòng có bị tính phí ngay không?', 'Không. Bước đặt phòng chỉ GIỮ CHỖ trong 15 phút. Bạn thanh toán khi sẵn sàng; quá 15 phút giữ chỗ tự nhả để khách khác đặt.'],
      ['Tôi có thể đến sớm hơn giờ check-in?', 'Giờ nhận phòng chuẩn là 14:00. Nếu phòng trống, lễ tân hỗ trợ nhận sớm miễn phí; nếu không sẽ tính phí nửa đêm. Bạn có thể ghi yêu cầu ở ô "Yêu cầu đặc biệt".'],
      ['Trẻ em có tính phí không?', 'Trẻ dưới 6 tuổi ngủ chung giường miễn phí. Từ 6 tuổi hoặc cần giường phụ: 200.000₫/khách/đêm, hệ thống tự cộng vào báo giá.'],
      ['Tôi quên mất mã đặt phòng?', 'Vào "Đặt phòng của tôi" sau khi đăng nhập, hoặc gọi hotline 1900 6789 với số điện thoại đã đặt để được tra cứu.'],
    ];
    main.innerHTML = `<div style="height:var(--nav-h)"></div>
      <section class="section" style="padding-top:40px"><div class="wrap" style="max-width:820px">
        <span class="kicker">${I18N.t('foot.support')}</span><h1 style="font-size:clamp(28px,4vw,42px)">${I18N.t('help.t')}</h1>
        <div style="margin-top:26px;display:flex;flex-direction:column;gap:12px">
          ${faqs.map(([q, a], i) => `
            <details class="tst" data-reveal style="transition-delay:${i * 50}ms;padding:20px 22px">
              <summary style="cursor:pointer;font-weight:700;font-size:15.5px;list-style:none;display:flex;gap:10px;align-items:center">
                <span style="color:var(--gold);font-size:18px;transition:.3s" class="pl">+</span>${UI.esc(q)}</summary>
              <p class="muted" style="margin:12px 0 0 28px;font-size:14.5px">${UI.esc(a)}</p>
            </details>`).join('')}
        </div>
        <div class="tst" style="margin-top:30px;background:var(--pine);color:#fff">
          <b style="font-size:17px;font-family:var(--f-display)">Cần hỗ trợ ngay?</b>
          <p style="color:rgba(255,255,255,.8);margin:8px 0 16px">Đội lễ tân trực 24/7 qua điện thoại, Zalo và email.</p>
          <div class="row gap-12" style="flex-wrap:wrap">
            <a class="btn btn-gold btn-sm" href="tel:19006789">${UI.ICONS.phone} 1900 6789</a>
            <a class="btn btn-ghost-light btn-sm" href="mailto:booking@lakstay.vn">${UI.ICONS.mail} booking@lakstay.vn</a>
          </div>
        </div>
      </div></section>`;
    main.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', () => {
      d.querySelector('.pl').style.transform = d.open ? 'rotate(45deg)' : '';
    }));
    C.decorate(main);
  }

  /* ============================ PROFILE ============================ */
  async function profile() {
    const main = document.getElementById('main');
    if (!API.getUser()) { openAuth('login'); return; }
    const me = await API.get('/api/auth/me');
    const [sessions, loy] = await Promise.all([
      API.get('/api/auth/sessions').catch(() => ({ sessions: [] })),
      API.get('/api/loyalty/me').catch(() => null),
    ]);
    main.innerHTML = `<div style="height:var(--nav-h)"></div>
      <section class="section" style="padding-top:40px"><div class="wrap" style="max-width:900px">
        <span class="kicker">${I18N.t('pf.kicker')}</span><h1 style="font-size:clamp(28px,4vw,40px)">${I18N.t('pf.hello', { name: UI.esc(me.user.full_name) })}</h1>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin:24px 0">
          ${[[I18N.t('pf.total'), me.stats.total], [I18N.t('pf.up'), me.stats.upcoming], [I18N.t('pf.done'), me.stats.completed], [I18N.t('pf.spent'), UI.vnd(me.stats.total_spent)]]
            .map(([l, v]) => `<div class="tst" style="padding:18px"><div class="tiny muted">${l}</div><b style="font-size:24px;font-family:var(--f-display)">${v}</b></div>`).join('')}
        </div>
        ${loy ? (() => {
          const T = { MEMBER: ['#8a8f98','#e9ecef','Thành viên'], SILVER: ['#9aa5b1','linear-gradient(135deg,#e8ecf1,#c7d0d9)','Bạc'], GOLD: ['#b8860b','linear-gradient(135deg,#fdf3d7,#f0d98c)','Vàng'], PLATINUM: ['#5b6770','linear-gradient(135deg,#e5e9f0,#b8c2cc)','Bạch kim'] }[loy.tier.key] || ['#8a8f98','#e9ecef','Thành viên'];
          return `
        <div class="tst" style="padding:0;overflow:hidden;margin-bottom:22px;border:1px solid rgba(0,0,0,.06)">
          <div style="background:${T[1]};padding:20px 24px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between">
            <div>
              <div class="tiny" style="color:${T[0]};font-weight:800;letter-spacing:.12em">HẠNG THÀNH VIÊN</div>
              <div style="font-family:var(--f-display);font-size:26px;color:#2a2f36">${T[2]} ${loy.tier.key === 'PLATINUM' ? '💎' : loy.tier.key === 'GOLD' ? '🥇' : loy.tier.key === 'SILVER' ? '🥈' : '🌿'}</div>
              <div class="small" style="color:#4a5158;margin-top:2px">${loy.tier.discount_pct ? `Giảm ${loy.tier.discount_pct}% tiền phòng mọi đơn đặt` : 'Chi tiêu để lên hạng và nhận ưu đãi giảm giá'}</div>
            </div>
            <div style="text-align:right">
              <div class="tiny muted">${loy.point_rule}</div>
              <div style="font-family:var(--f-display);font-size:30px;color:var(--pine)">${loy.points.toLocaleString('vi-VN')} <span style="font-size:14px">điểm</span></div>
              <div class="tiny muted">Đã chi tiêu ${UI.vnd(loy.lifetime_spend)}</div>
            </div>
          </div>
          <div style="padding:16px 24px">
            ${loy.next_tier ? `
              <div class="row" style="justify-content:space-between;font-size:13px;margin-bottom:6px">
                <span class="muted">Tiến trình lên hạng <b>${loy.next_tier.name_vi}</b></span>
                <span><b>${loy.progress_pct}%</b> — còn ${UI.vnd(loy.next_tier.spend_needed)}</span>
              </div>
              <div style="height:8px;background:var(--cream);border-radius:99px;overflow:hidden">
                <div style="width:${loy.progress_pct}%;height:100%;background:linear-gradient(90deg,var(--pine),#7ea88e);border-radius:99px;transition:width .6s"></div>
              </div>` : `<div class="small" style="color:var(--pine);font-weight:700">🏆 Hạng cao nhất — cảm ơn bạn đã đồng hành cùng LakStay!</div>`}
            ${loy.transactions.length ? `
              <details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Lịch sử điểm gần đây (${loy.transactions.length})</summary>
                <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
                  ${loy.transactions.slice(0, 8).map((t) => `
                    <div class="row small" style="justify-content:space-between;padding:8px 10px;background:var(--cream);border-radius:8px">
                      <span>${t.type === 'EARN' ? '➕' : t.type === 'REVOKE' ? '➖' : '🛠️'} ${UI.esc(t.note || t.type)}${t.booking_code ? ` · <span class="mono tiny">${UI.esc(t.booking_code)}</span>` : ''}</span>
                      <b style="color:${t.points >= 0 ? 'var(--success,#2e7d32)' : '#c0392b'}">${t.points >= 0 ? '+' : ''}${t.points.toLocaleString('vi-VN')}</b>
                    </div>`).join('')}
                </div>
              </details>` : ''}
          </div>
        </div>`; })() : ''}
        <div class="split" style="grid-template-columns:1fr 1fr;gap:22px;align-items:start">
          <div class="tst" style="padding:24px">
            <b style="font-size:16px">${I18N.t('pf.pwd')}</b>
            <form id="pwf" style="display:grid;gap:12px;margin-top:14px">
              <div class="field"><label>Mật khẩu hiện tại</label><input class="input" type="password" name="currentPassword" required autocomplete="current-password"></div>
              <div class="field"><label>Mật khẩu mới</label><input class="input" type="password" name="newPassword" required minlength="8" autocomplete="new-password">
                <span class="field-hint">Tối thiểu 8 ký tự, có chữ hoa, chữ thường và số</span></div>
              <button class="btn btn-primary" type="submit">${I18N.t('pf.update')}</button>
            </form>
          </div>
          <div class="tst" style="padding:24px">
            <div class="row" style="justify-content:space-between"><b style="font-size:16px">${I18N.t('pf.sessions')}</b>
              <button class="btn btn-ghost btn-sm" id="revoke">${I18N.t('pf.revoke')}</button></div>
            <p class="tiny muted" style="margin:6px 0 12px">Mỗi thiết bị đang đăng nhập giữ một refresh token riêng. Thu hồi sẽ đăng xuất mọi thiết bị khác.</p>
            <div style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto">
              ${sessions.sessions.map((s) => `
                <div class="row gap-12 small" style="padding:10px;background:var(--cream);border-radius:10px">
                  <span>${UI.esc((s.user_agent || 'Thiết bị').slice(0, 46))}</span>
                  <span class="right ${s.revoked_at ? 'muted' : 'badge badge-success'}" style="${s.revoked_at ? '' : 'padding:3px 10px'}">${s.revoked_at ? 'đã thu hồi' : 'đang hoạt động'}</span>
                </div>`).join('') || '<p class="muted small">Không có phiên nào.</p>'}
            </div>
          </div>
        </div>
      </div></section>`;
    document.getElementById('pwf').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        await API.post('/api/auth/change-password', f);
        UI.toast('Mật khẩu đã đổi. Các thiết bị khác đã bị đăng xuất.', 'success');
        e.target.reset();
      } catch (err) { UI.errToast(err); }
    };
    document.getElementById('revoke').onclick = async () => {
      if (!await UI.confirmDialog({ title: 'Thu hồi phiên', message: 'Mọi thiết bị khác sẽ bị đăng xuất ngay lập tức. Tiếp tục?', confirmText: 'Thu hồi', danger: true })) return;
      await API.post('/api/auth/sessions/revoke-all');
      UI.toast('Đã thu hồi toàn bộ phiên khác.', 'success');
      setTimeout(() => location.reload(), 900);
    };
    C.decorate(main);
  }

  /* ============================ AUTH MODAL ============================ */
  function openAuth(mode = 'login', next = null) {
    const m = UI.modal({
      title: mode === 'login' ? 'Đăng nhập LakStay' : 'Tạo tài khoản',
      body: `
        <div class="row gap-8" style="margin-bottom:18px">
          <button class="btn btn-sm ${mode === 'login' ? 'btn-primary' : 'btn-ghost'}" data-m="login" style="flex:1">Đăng nhập</button>
          <button class="btn btn-sm ${mode === 'register' ? 'btn-primary' : 'btn-ghost'}" data-m="register" style="flex:1">Đăng ký</button>
        </div>
        <form id="af" style="display:grid;gap:13px">
          <div class="field hidden" data-only="register"><label>Họ và tên</label><input class="input" name="fullName" autocomplete="name"></div>
          <div class="field"><label>Email</label><input class="input" type="email" name="email" required autocomplete="email" placeholder="ban@email.com"></div>
          <div class="field hidden" data-only="register"><label>Số điện thoại</label><input class="input" name="phone" placeholder="09xxxxxxxx" autocomplete="tel"></div>
          <div class="field"><label>Mật khẩu</label><input class="input" type="password" name="password" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
          <div class="field hidden" data-only="register"><span class="field-hint">Mật khẩu ≥ 8 ký tự, gồm chữ hoa, chữ thường và số</span></div>
          <div class="err-text hidden" id="af-err"></div>
          <button class="btn btn-gold btn-lg" type="submit" id="af-btn">${mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
        </form>
        <div style="margin-top:16px;padding:12px 14px;background:var(--cream);border-radius:10px" class="tiny">
          <b>Tài khoản demo:</b><br>
          Khách: <span class="mono">khach@example.com</span> · Nhân viên: <span class="mono">staff@lakstay.vn</span> · Admin: <span class="mono">admin@lakstay.vn</span><br>
          Mật khẩu chung: <span class="mono">Lakstay@2026</span>
        </div>`,
    });
    let cur = mode;
    const apply = () => {
      m.$('[data-m="login"]').className = `btn btn-sm ${cur === 'login' ? 'btn-primary' : 'btn-ghost'}`;
      m.$('[data-m="register"]').className = `btn btn-sm ${cur === 'register' ? 'btn-primary' : 'btn-ghost'}`;
      m.$('[data-m="login"]').style.flex = m.$('[data-m="register"]').style.flex = '1';
      m.$$('[data-only]').forEach((el) => el.classList.toggle('hidden', cur !== el.dataset.only));
      m.$('h3') && (m.root.querySelector('h3').textContent = cur === 'login' ? 'Đăng nhập LakStay' : 'Tạo tài khoản');
      m.$('#af-btn').textContent = cur === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
    };
    m.$$('[data-m]').forEach((b) => b.onclick = () => { cur = b.dataset.m; apply(); });
    apply();

    m.$('#af').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const err = m.$('#af-err'); err.classList.add('hidden');
      const btn = m.$('#af-btn');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Đang xử lý…';
      try {
        if (cur === 'login') await API.post('/api/auth/login', { email: f.email, password: f.password });
        else await API.post('/api/auth/register', { email: f.email, password: f.password, fullName: f.fullName, phone: f.phone });
        await API.loadMe();
        C.renderAuthArea();
        m.close();
        UI.toast(cur === 'login' ? 'Chào mừng trở lại!' : 'Tạo tài khoản thành công!', 'success');
        if (next) location.hash = next;
      } catch (ex) {
        err.textContent = ex.details?.length ? ex.details.map((d) => d.message).join(', ') : ex.message;
        err.classList.remove('hidden');
      } finally { btn.disabled = false; btn.textContent = cur === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'; }
    };
  }

  /* route cho phép header trong suốt trên nền tối */
  const DARK_ROUTES = new Set(['', 'experience']);
  function routeAllowsDark() { return DARK_ROUTES.has(G.currentRoute || ''); }

  const _cleanup = [];
  let _cur = '';
  return { home, rooms, roomDetail, experience, reviewsPage, help, profile, openAuth, routeAllowsDark, _cleanup,
           get currentRoute() { return _cur; }, set currentRoute(v) { _cur = v; } };
})();

window.G = G;
