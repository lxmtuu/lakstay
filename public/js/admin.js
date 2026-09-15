/* ============================================================================
   LakStay Admin SPA
   ========================================================================== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const NAV = [
    { grp: 'Vận hành' },
    { k: 'dashboard', t: 'Bảng điều khiển', ic: 'chart' },
    { k: 'bookings', t: 'Đặt phòng', ic: 'calendar' },
    { k: 'frontdesk', t: 'Lễ tân hôm nay', ic: 'key' },
    { grp: 'Danh mục' },
    { k: 'rooms', t: 'Phòng & tồn kho', ic: 'bed' },
    { k: 'pricing', t: 'Bảng giá theo mùa', ic: 'spark' },
    { k: 'coupons', t: 'Mã giảm giá', ic: 'wallet' },
    { grp: 'Khách hàng' },
    { k: 'users', t: 'Người dùng', ic: 'users' },
    { k: 'reviews', t: 'Đánh giá', ic: 'star' },
    { grp: 'Tài chính & hệ thống' },
    { k: 'payments', t: 'Giao dịch', ic: 'qr' },
    { k: 'loyalty', t: 'Thành viên', ic: 'star', admin: true },
    { k: 'outbox', t: 'Email đã gửi', ic: 'mail', admin: true },
    { k: 'reports', t: 'Báo cáo', ic: 'download' },
    { k: 'audit', t: 'Nhật ký hoạt động', ic: 'eye', admin: true },
    { k: 'security', t: 'An ninh', ic: 'shield', admin: true },
  ];

  let ME = null;
  let curPage = 'dashboard';

  /* ---------------- boot ---------------- */
  async function boot() {
    $$('#side [data-icon]').forEach((el) => el.innerHTML = UI.ICONS[el.dataset.icon] || '');
    ME = await API.loadMe();
    if (!ME || !['staff', 'admin'].includes(ME.user.role)) {
      document.getElementById('main').innerHTML = `
        <div class="panel center" style="padding:60px">
          <h2>Bạn cần quyền nhân viên</h2>
          <p class="muted">Trang quản trị chỉ dành cho vai trò <b>staff</b> hoặc <b>admin</b>.</p>
          <button class="btn btn-primary" id="lg" style="margin-top:16px">Đăng nhập bằng tài khoản khác</button>
        </div>`;
      document.getElementById('lg').onclick = async () => { await API.logout(); location.href = '/'; };
      return;
    }
    renderSide();
    $('#who').innerHTML = `<b style="color:#fff">${UI.esc(ME.user.full_name)}</b><br><span class="tag ${ME.user.role === 'admin' ? 'warn' : 'info'}">${ME.user.role.toUpperCase()}</span>`;
    $('#out').onclick = async () => { await API.logout(); location.href = '/'; };
    $('#tg').onclick = () => $('#side').classList.toggle('open');
    $('#refresh').onclick = () => route(true);
    window.addEventListener('hashchange', () => route());
    route();
    // auto refresh dashboard mỗi 30s
    setInterval(() => { if (curPage === 'dashboard' && !document.hidden) route(true); }, 30000);
  }

  function renderSide() {
    $('#side-nav').innerHTML = NAV.map((n) => {
      if (n.grp) return `<div class="grp">${n.grp}</div>`;
      if (n.admin && ME.user.role !== 'admin') return '';
      return `<a href="#/${n.k}" data-k="${n.k}">${UI.ICONS[n.ic]}${n.t}</a>`;
    }).join('');
  }

  function parse() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [p, q] = raw.split('?');
    const seg = p.split('/').filter(Boolean);
    const params = {};
    if (q) for (const [k, v] of new URLSearchParams(q)) params[k] = v;
    return { seg, params };
  }

  const PAGES = {
    dashboard: pgDashboard, bookings: pgBookings, frontdesk: pgFrontdesk, rooms: pgRooms,
    pricing: pgPricing, coupons: pgCoupons, users: pgUsers, reviews: pgReviews,
    payments: pgPayments, reports: pgReports, audit: pgAudit, security: pgSecurity,
    outbox: pgOutbox, loyalty: pgLoyalty,
  };

  async function route(force = false) {
    const { seg, params } = parse();
    curPage = seg[0] || 'dashboard';
    const page = PAGES[curPage];
    if (!page) { curPage = 'dashboard'; }
    $$('#side-nav a').forEach((a) => a.classList.toggle('on', a.dataset.k === curPage));
    const nav = NAV.find((n) => n.k === curPage);
    $('#title').textContent = nav ? nav.t : 'Bảng điều khiển';
    $('#side').classList.remove('open');
    const main = $('#main');
    if (!force) main.innerHTML = `<div class="cards">${[0,1,2,3].map(() => '<div class="kpi"><div class="skel" style="height:14px;width:60%"></div><div class="skel" style="height:30px;width:45%;margin-top:10px"></div></div>').join('')}</div><div class="panel"><div class="skel" style="height:220px"></div></div>`;
    try { await (PAGES[curPage] || pgDashboard)(main, params, seg); }
    catch (e) { main.innerHTML = `<div class="panel"><span class="err-text">${UI.esc(e.message)}</span></div>`; console.error(e); }
  }

  const pager = (meta, onPage) => `
    <div class="pager">
      <button data-p="${meta.page - 1}" ${meta.page <= 1 ? 'disabled' : ''}>‹</button>
      <span class="small muted">Trang ${meta.page}/${meta.totalPages} · ${meta.total} bản ghi</span>
      <button data-p="${meta.page + 1}" ${meta.page >= meta.totalPages ? 'disabled' : ''}>›</button>
    </div>`;
  const bindPager = (meta, go) => {
    $$('.pager button').forEach((b) => b.onclick = () => go(+b.dataset.p));
  };

  /* ================= DASHBOARD ================= */
  async function pgDashboard(main, params) {
    const d = await API.get('/api/admin/dashboard', { query: { days: params.days || 30 } });
    const s = d.stats;
    const maxRev = Math.max(1, ...s.daily.map((x) => x.revenue));
    main.innerHTML = `
      <div class="cards">
        <div class="kpi accent"><div class="lb">${UI.ICONS.wallet}Doanh thu ${s.period_days} ngày</div>
          <div class="v">${UI.vnd(s.revenue)}</div><div class="d">Hoàn trả: ${UI.vnd(s.refunds)} · Thực thu ${UI.vnd(s.net_revenue)}</div></div>
        <div class="kpi"><div class="lb">${UI.ICONS.calendar}Đặt phòng mới</div><div class="v">${s.bookings}</div>
          <div class="d">${s.pending_expiring} đơn chờ thanh toán sắp hết hạn</div></div>
        <div class="kpi"><div class="lb">${UI.ICONS.key}Hôm nay</div>
          <div class="v">${s.today.arrivals}<span style="font-size:15px;color:var(--muted)"> đến</span></div>
          <div class="d">${s.today.departures} trả phòng · ${s.today.in_house} đang ở</div></div>
        <div class="kpi"><div class="lb">${UI.ICONS.chart}Công suất</div>
          <div class="v">${d.calendar.dates.length ? Math.round(d.calendar.dates.reduce((a, b) => a + b.occupancy_pct, 0) / d.calendar.dates.length) : 0}%</div>
          <div class="d">trung bình 14 ngày tới</div></div>
      </div>

      <div class="grid" style="grid-template-columns:1.5fr 1fr;gap:20px;align-items:start" id="dz">
        <div class="panel">
          <div class="panel-hd"><h3>Doanh thu theo ngày nhận phòng</h3>
            <select class="select" id="days" style="width:auto">
              ${[7, 30, 90].map((x) => `<option value="${x}" ${x == (params.days || 30) ? 'selected' : ''}>${x} ngày</option>`).join('')}
            </select></div>
          <div class="bars">${s.daily.length ? s.daily.map((x) => `
            <div class="b ${x.revenue ? '' : 'zero'}" style="height:${Math.max(3, (x.revenue / maxRev) * 100)}%"
              data-tip="${UI.dmy(x.d)} · ${x.bookings} đơn · ${UI.vnd(x.revenue)}"></div>`).join('') : '<p class="muted small">Chưa có dữ liệu</p>'}</div>
        </div>
        <div class="panel">
          <div class="panel-hd"><h3>Cảnh báo</h3></div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${alertRow('warn', d.alerts.pending_holds, 'đơn giữ chỗ sắp hết hạn', '#/bookings?status=PENDING')}
            ${alertRow('info', d.alerts.low_stock_days, 'ngày sắp hết phòng (≤2)', '#/rooms')}
            ${alertRow('crit', d.alerts.full_days, 'ngày đã kín phòng', '#/rooms')}
            ${alertRow('warn', d.alerts.unapproved_reviews, 'đánh giá chờ duyệt', '#/reviews')}
            ${alertRow('crit', d.alerts.critical_security, 'sự cố an ninh 7 ngày', ME.user.role === 'admin' ? '#/security' : null)}
          </div>
          <div class="panel-hd" style="margin:20px 0 10px"><h3>Phòng bán chạy</h3></div>
          ${s.top_rooms.map((t, i) => `
            <div class="row small" style="justify-content:space-between;padding:7px 0;border-bottom:1px dashed var(--sand)">
              <span>${i + 1}. ${UI.esc(t.name_vi)}</span><b>${UI.vndShort(t.revenue)}</b></div>`).join('') || '<p class="muted small">Chưa có</p>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel-hd"><h3>Lịch công suất 14 ngày</h3>
          <div class="cal-legend"><span><i style="background:#e6f4ec"></i>Trống nhiều</span><span><i style="background:#fdf3dc"></i>Sắp kín</span><span><i style="background:#fdecea"></i>Kín</span></div></div>
        <div class="heat">${d.calendar.dates.map((x) => {
          const pct = x.occupancy_pct;
          const bg = pct >= 100 ? '#fdecea' : pct >= 75 ? '#fdf3dc' : '#e6f4ec';
          const fg = pct >= 100 ? 'var(--danger)' : pct >= 75 ? 'var(--warn)' : 'var(--success)';
          return `<div class="c" style="background:${bg};color:${fg}" title="${UI.dmy(x.date)}: ${x.occupied}/${x.total_rooms} phòng">
            ${UI.dmyShort(x.date)}<small>${pct}%</small></div>`;
        }).join('')}</div>
      </div>

      <div class="panel">
        <div class="panel-hd"><h3>Đặt phòng gần đây</h3><a class="btn btn-ghost btn-sm" href="#/bookings">Xem tất cả</a></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mã</th><th>Khách</th><th>Trạng thái</th><th>Nhận phòng</th><th class="num">Tổng</th></tr></thead>
        <tbody>${d.recent_bookings.map((b) => `
          <tr style="cursor:pointer" data-b="${b.id}"><td class="mono">${UI.esc(b.code)}</td><td>${UI.esc(b.guest_name)}</td>
          <td>${UI.statusBadge(b.status)}</td><td>${UI.dmy(b.check_in)}</td><td class="num">${UI.vnd(b.total_amount)}</td></tr>`).join('')}</tbody></table></div>
      </div>`;

    $('#days').onchange = (e) => { location.hash = `#/dashboard?days=${e.target.value}`; };
    $$('[data-b]').forEach((tr) => tr.onclick = () => openBookingDrawer(tr.dataset.b));
  }
  const alertRow = (sev, n, label, href) => `
    <div class="row small" style="justify-content:space-between;background:${sev === 'crit' ? 'var(--danger-bg)' : sev === 'warn' ? 'var(--warn-bg)' : 'var(--info-bg)'};padding:10px 14px;border-radius:10px">
      <span><span class="tag ${sev}">${n}</span> ${label}</span>
      ${href ? `<a href="${href}" class="tiny" style="font-weight:700">Xem →</a>` : ''}</div>`;

  /* ================= BOOKINGS ================= */
  async function pgBookings(main, params) {
    const page = +params.page || 1;
    const d = await API.get('/api/admin/bookings', {
      query: { status: params.status || '', q: params.q || '', sort: params.sort || 'created_at', page, limit: 20 },
    });
    main.innerHTML = `
      <div class="panel">
        <div class="filters">
          <input class="input" id="q" placeholder="Tìm mã / tên / SĐT / email…" value="${UI.esc(params.q || '')}">
          <select class="select" id="st">
            <option value="">Mọi trạng thái</option>
            ${Object.entries(UI.STATUS_VI).map(([k, v]) => `<option value="${k}" ${params.status === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <select class="select" id="so">
            <option value="created_at">Mới tạo</option><option value="check_in" ${params.sort === 'check_in' ? 'selected' : ''}>Ngày nhận</option>
            <option value="total" ${params.sort === 'total' ? 'selected' : ''}>Giá trị</option>
          </select>
          <button class="btn btn-primary btn-sm" id="go">Lọc</button>
          <span class="right muted small">${d.meta.total} kết quả</span>
        </div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr>
          <th>Mã</th><th>Khách</th><th>Kỳ nghỉ</th><th>Phòng</th><th>Trạng thái</th><th class="num">Đã trả</th><th class="num">Tổng</th><th></th>
        </tr></thead><tbody>${d.items.length ? d.items.map((b) => `
          <tr><td class="mono">${UI.esc(b.code)}</td>
          <td>${UI.esc(b.guest_name)}<div class="tiny muted">${UI.esc(b.booker_email || '')}</div></td>
          <td>${UI.dmy(b.check_in)} → ${UI.dmy(b.check_out)}<div class="tiny muted">${b.nights} đêm</div></td>
          <td class="small">${(b.lines || []).map((l) => `${l.qty}× ${UI.esc(l.name_vi)}`).join('<br>')}</td>
          <td>${UI.statusBadge(b.status)}</td>
          <td class="num">${UI.vnd(b.paid_amount || 0)}</td>
          <td class="num"><b>${UI.vnd(b.total_amount)}</b></td>
          <td><button class="btn btn-ghost btn-sm" data-b="${b.id}">Mở</button></td></tr>`).join('') : `<tr><td colspan="8" class="center muted" style="padding:30px">Không có dữ liệu</td></tr>`}</tbody></table></div>
        ${pager(d.meta)}
      </div>`;
    const go = (p = 1) => {
      const q = new URLSearchParams();
      if ($('#q').value) q.set('q', $('#q').value);
      if ($('#st').value) q.set('status', $('#st').value);
      if ($('#so').value !== 'created_at') q.set('sort', $('#so').value);
      if (p > 1) q.set('page', p);
      location.hash = '#/bookings' + (q.toString() ? '?' + q : '');
    };
    $('#go').onclick = () => go(1);
    $('#q').onkeydown = (e) => { if (e.key === 'Enter') go(1); };
    $('#st').onchange = () => go(1); $('#so').onchange = () => go(1);
    bindPager(d.meta, go);
    $$('[data-b]').forEach((b) => b.onclick = () => openBookingDrawer(b.dataset.b));
  }

  /* ---------- drawer chi tiết booking ---------- */
  async function openBookingDrawer(id) {
    const dr = $('#drawer');
    dr.innerHTML = `<div class="drawer-hd"><b>Đang tải…</b></div>`;
    dr.classList.add('open'); $('#dbk').classList.add('open');
    const close = () => { dr.classList.remove('open'); $('#dbk').classList.remove('open'); };
    $('#dbk').onclick = close;

    const d = await API.get(`/api/admin/bookings/${id}`);
    const b = d.booking;
    const paid = (b.payments || []).filter((p) => p.type === 'CHARGE' && p.status === 'PAID').reduce((s, p) => s + p.amount, 0);

    dr.innerHTML = `
      <div class="drawer-hd">
        <div style="flex:1"><b class="mono" style="font-size:17px">${UI.esc(b.code)}</b> ${UI.statusBadge(b.status)}</div>
        <button class="modal-x" id="dx">${UI.ICONS.x}</button>
      </div>
      <div class="drawer-bd">
        <dl class="kv">
          <dt>Khách</dt><dd>${UI.esc(b.guest_name)} · ${UI.esc(b.guest_phone)}</dd>
          <dt>Email</dt><dd>${UI.esc(b.guest_email)}</dd>
          <dt>Kỳ nghỉ</dt><dd>${UI.dmy(b.check_in)} → ${UI.dmy(b.check_out)} (${b.nights} đêm, ${b.guests} khách)</dd>
          <dt>Phòng</dt><dd>${(b.lines || []).map((l) => `${l.qty}× ${UI.esc(l.room_type_name || l.name_vi)}`).join(', ')}</dd>
          <dt>Phòng xếp</dt><dd>${[...new Set((b.assigned_rooms || []).map((r) => r.room_number))].join(', ') || '—'}</dd>
          <dt>Tiền</dt><dd>Tổng ${UI.vnd(b.total_amount)} · Đã trả ${UI.vnd(paid)} · Còn ${UI.vnd(Math.max(0, b.total_amount - paid))}</dd>
          ${b.special_request ? `<dt>Yêu cầu</dt><dd>${UI.esc(b.special_request)}</dd>` : ''}
          ${b.cancel_reason ? `<dt>Lý do huỷ</dt><dd>${UI.esc(b.cancel_reason)}</dd>` : ''}
        </dl>

        <div class="panel-hd" style="margin:20px 0 10px"><h3>Thao tác</h3></div>
        <div class="row gap-8" style="flex-wrap:wrap" id="acts">
          ${b.status === 'PENDING' && paid > 0 ? `<button class="btn btn-gold btn-sm" data-a="CONFIRMED">Xác nhận</button>` : ''}
          ${b.status === 'CONFIRMED' ? `<button class="btn btn-primary btn-sm" data-a="CHECKED_IN">Check-in</button>` : ''}
          ${b.status === 'CHECKED_IN' ? `<button class="btn btn-primary btn-sm" data-a="COMPLETED">Check-out</button>` : ''}
          ${['PENDING', 'CONFIRMED'].includes(b.status) ? `<button class="btn btn-ghost btn-sm" data-a="CANCELLED">Huỷ</button><button class="btn btn-ghost btn-sm" data-a="NO_SHOW">No-show</button>` : ''}
          ${paid > 0 && ['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(b.status) && ME.user.role === 'admin' ? `<button class="btn btn-danger btn-sm" data-a="REFUND">Hoàn tiền</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-a="PAY">Tạo mã thu tiền</button>
        </div>

        <div class="panel-hd" style="margin:22px 0 10px"><h3>Giao dịch</h3></div>
        <div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr><th>Loại</th><th>Cổng</th><th>Trạng thái</th><th class="num">Số tiền</th></tr></thead>
        <tbody>${(b.payments || []).map((p) => `<tr><td>${p.type === 'REFUND' ? 'Hoàn' : 'Thu'}</td><td>${p.provider}</td>
          <td>${UI.statusBadge(p.status === 'PAID' ? 'COMPLETED' : p.status === 'PENDING' ? 'PENDING' : 'CANCELLED')}</td>
          <td class="num">${UI.vnd(p.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted center">Chưa có</td></tr>'}</tbody></table></div>

        <div class="panel-hd" style="margin:22px 0 10px"><h3>Lịch sử thao tác</h3></div>
        <div class="timeline">
          ${(d.history || []).slice(0, 14).map((h) => `
            <div class="t"><b>${UI.esc(h.action)}</b>
              <div class="tm">${UI.dtVN(h.created_at)} · bởi ${UI.esc(h.actor_role || '?')}</div>
              ${h.after_data ? `<div class="tiny muted mono" style="word-break:break-all">${UI.esc(h.after_data).slice(0, 160)}</div>` : ''}
            </div>`).join('') || '<p class="muted small">Chưa có</p>'}
        </div>
      </div>`;
    $('#dx').onclick = close;
    $$('#acts [data-a]', dr).forEach((btn) => btn.onclick = async () => {
      const a = btn.dataset.a;
      if (a === 'PAY') {
        close();
        // mở modal QR bằng cách dùng lại hàm của customer? admin tự render
        return openAdminPay(b.id);
      }
      if (a === 'REFUND') {
        const reason = prompt('Lý do hoàn tiền?'); if (!reason) return;
        try { const r = await API.post(`/api/admin/bookings/${b.id}/refund`, { reason }); UI.toast(`Đã hoàn ${UI.vnd(r.amount)}`, 'success'); openBookingDrawer(b.id); route(true); }
        catch (e) { UI.errToast(e); }
        return;
      }
      const labels = { CONFIRMED: 'xác nhận', CHECKED_IN: 'check-in', COMPLETED: 'check-out', CANCELLED: 'huỷ', NO_SHOW: 'no-show' };
      if (!await UI.confirmDialog({ title: 'Đổi trạng thái', message: `Chuyển đơn ${b.code} sang "${labels[a]}"?`, confirmText: 'Thực hiện', danger: ['CANCELLED', 'NO_SHOW'].includes(a) })) return;
      try {
        await API.post(`/api/admin/bookings/${b.id}/transition`, { to: a, note: 'Thao tác từ trang quản trị' });
        UI.toast('Đã cập nhật trạng thái', 'success');
        openBookingDrawer(b.id); route(true);
      } catch (e) { UI.errToast(e); }
    });
  }

  async function openAdminPay(bookingId) {
    const m = UI.modal({ title: 'Tạo mã thu tiền', wide: true, body: '<div id="ap" class="center muted">Đang tạo…</div>' });
    try {
      const r = await API.post('/api/payments', { bookingId, provider: 'VIETQR' });
      const p = r.payment;
      m.$('#ap').innerHTML = `
        <div class="qr-box">
          <div class="qr-frame" style="box-shadow:var(--sh-1)"><img src="${p.qr_image}" alt="QR"></div>
          <div class="bank-line" style="max-width:380px;margin:10px auto">${UI.ICONS.wallet}<div style="text-align:left"><b>${UI.vnd(p.amount)}</b><br><span class="mono tiny">${UI.esc(p.transfer_content)}</span></div>
            <button class="copy-btn" id="cp">Copy</button></div>
          <p class="tiny muted">Gửi mã này cho khách hoặc in ra quầy lễ tân.</p>
          <button class="btn btn-primary btn-sm" id="mk">Đánh dấu đã thu tiền mặt</button>
        </div>`;
      m.$('#cp').onclick = () => UI.copy(p.transfer_content);
      m.$('#mk').onclick = async () => {
        if (!await UI.confirmDialog({ title: 'Xác nhận thu tiền', message: `Xác nhận đã nhận ${UI.vnd(p.amount)} từ khách?`, confirmText: 'Xác nhận' })) return;
        await API.post(`/api/payments/${p.id}/confirm-manual`, { note: 'Thu tại quầy' });
        m.close(); UI.toast('Đã ghi nhận thanh toán', 'success'); route(true);
      };
    } catch (e) { m.$('#ap').innerHTML = `<span class="err-text">${UI.esc(e.message)}</span>`; }
  }

  /* ================= FRONT DESK ================= */
  async function pgFrontdesk(main, params) {
    const date = params.date || UI.today();
    const d = await API.get('/api/admin/front-desk', { query: { date } });
    main.innerHTML = `
      <div class="panel">
        <div class="filters"><input class="input" type="date" id="fd" value="${date}" style="width:auto">
          <span class="badge badge-info">${d.counts.arrivals} đến</span>
          <span class="badge badge-warning">${d.counts.departures} đi</span>
          <span class="badge badge-success">${d.counts.in_house} đang ở</span></div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;align-items:start">
        ${fdCol('Khách đến hôm nay', d.arrivals, (a) => `
          <div class="row" style="justify-content:space-between;gap:10px">
            <div><b>${UI.esc(a.guest_name)}</b><div class="tiny muted">${UI.esc(a.code)} · ${UI.esc(a.rooms || '')} · ${UI.esc(a.guest_phone)}</div></div>
            ${a.status === 'CONFIRMED' ? `<button class="btn btn-primary btn-sm" data-ci="${a.id}">Check-in</button>` : UI.statusBadge(a.status)}
          </div>`)}
        ${fdCol('Khách trả phòng', d.departures, (x) => `
          <div class="row" style="justify-content:space-between;gap:10px">
            <div><b>${UI.esc(x.guest_name)}</b><div class="tiny muted">${UI.esc(x.code)} · ${UI.vnd(x.total_amount)}</div></div>
            ${x.status === 'CHECKED_IN' ? `<button class="btn btn-ghost btn-sm" data-co="${x.id}">Check-out</button>` : UI.statusBadge(x.status)}
          </div>`)}
        ${fdCol('Đang lưu trú', d.in_house, (x) => `
          <div class="row" style="justify-content:space-between">
            <div><b>${UI.esc(x.guest_name)}</b><div class="tiny muted">${UI.esc(x.code)}</div></div>
            <span class="chip">P.${UI.esc(x.room_number)}</span>
          </div>`)}
      </div>`;
    $('#fd').onchange = (e) => location.hash = `#/frontdesk?date=${e.target.value}`;
    $$('[data-ci]').forEach((b) => b.onclick = async () => {
      await API.post(`/api/admin/bookings/${b.dataset.ci}/transition`, { to: 'CHECKED_IN', note: 'Front desk' });
      UI.toast('Đã check-in', 'success'); route(true);
    });
    $$('[data-co]').forEach((b) => b.onclick = async () => {
      await API.post(`/api/admin/bookings/${b.dataset.co}/transition`, { to: 'COMPLETED', note: 'Front desk' });
      UI.toast('Đã check-out', 'success'); route(true);
    });
  }
  const fdCol = (title, items, render) => `
    <div class="panel"><div class="panel-hd"><h3>${title}</h3><span class="badge badge-muted">${items.length}</span></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${items.length ? items.map((x) => `<div style="border:1px solid var(--sand);border-radius:12px;padding:12px">${render(x)}</div>`).join('') : '<p class="muted small">Trống</p>'}
    </div></div>`;

  /* ================= ROOMS ================= */
  async function pgRooms(main) {
    const [types, rooms, blocks] = await Promise.all([
      API.get('/api/admin/room-types'), API.get('/api/admin/rooms'),
      API.get('/api/admin/blocks', { query: { from: UI.today(), to: UI.addDays(UI.today(), 30) } }),
    ]);
    main.innerHTML = `
      <div class="panel">
        <div class="panel-hd"><h3>Hạng phòng</h3>${ME.user.role === 'admin' ? '<button class="btn btn-primary btn-sm" id="new-rt">+ Thêm hạng phòng</button>' : ''}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Phòng</th><th class="num">Giá gốc</th><th class="num">Tổng</th><th class="num">Bán được</th><th>Chính sách huỷ</th><th class="num">Đã bán</th><th class="num">Doanh thu</th><th></th></tr></thead>
        <tbody>${types.items.map((t) => `
          <tr><td><b>${UI.esc(t.name_vi)}</b><div class="tiny muted">${UI.esc(t.slug)} · ${t.capacity} khách · ${t.size_m2}m²</div></td>
          <td class="num">${UI.vnd(t.base_price)}</td><td class="num">${t.total_rooms}</td>
          <td class="num">${t.is_active ? '<span class="tag info">đang bán</span>' : '<span class="tag crit">tạm dừng</span>'}</td>
          <td class="tiny">free ${t.cancel_free_hours}h · phạt ${t.cancel_penalty_pct}% · chặn ${t.cancel_no_refund_hours}h</td>
          <td class="num">${t.stats.bookings}</td><td class="num">${UI.vndShort(t.stats.revenue)}</td>
          <td>${ME.user.role === 'admin' ? `<button class="btn btn-ghost btn-sm" data-e="${t.id}">Sửa</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      </div>

      <div class="grid" style="grid-template-columns:1.4fr 1fr;gap:18px;align-items:start">
        <div class="panel">
          <div class="panel-hd"><h3>Phòng vật lý</h3>
            <select class="select" id="rf" style="width:auto"><option value="">Tất cả hạng</option>${types.items.map((t) => `<option value="${t.id}">${UI.esc(t.name_vi)}</option>`).join('')}</select>
            ${ME.user.role === 'admin' ? '<button class="btn btn-primary btn-sm" id="new-r">+ Thêm phòng</button>' : ''}</div>
          <div class="tbl-wrap" style="max-height:420px;overflow:auto"><table class="tbl"><thead><tr><th>Số phòng</th><th>Hạng</th><th>Tầng</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody id="rtb">${roomRows(rooms.items)}</tbody></table></div>
        </div>
        <div class="panel">
          <div class="panel-hd"><h3>Chặn phòng (bảo trì / đoàn)</h3>${ME.user.role === 'admin' ? '<button class="btn btn-primary btn-sm" id="new-b">+ Chặn</button>' : ''}</div>
          <div style="display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto">
            ${blocks.items.length ? blocks.items.map((b) => `
              <div class="row small" style="justify-content:space-between;background:var(--warn-bg);padding:9px 12px;border-radius:10px">
                <span><b>P.${UI.esc(b.room_number)}</b> · ${UI.dmy(b.block_date)}<div class="tiny muted">${UI.esc(b.reason)}</div></span>
                ${ME.user.role === 'admin' ? `<button class="btn btn-ghost btn-sm" data-ub="${b.room_id}|${b.block_date}">Bỏ</button>` : ''}
              </div>`).join('') : '<p class="muted small">Không có phòng bị chặn trong 30 ngày tới.</p>'}
          </div>
        </div>
      </div>`;

    function roomRows(list) {
      return list.map((r) => `
        <tr><td class="mono"><b>${UI.esc(r.room_number)}</b></td><td class="small">${UI.esc(r.name_vi)}</td><td>${r.floor}</td>
        <td><span class="tag ${r.status === 'available' ? 'info' : 'crit'}">${r.status}</span></td>
        <td><select class="select" data-rs="${r.id}" style="width:auto;padding:5px 8px;font-size:12px">
          ${['available', 'maintenance', 'blocked'].map((s) => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></td></tr>`).join('');
    }
    $('#rf').onchange = async (e) => {
      const d2 = await API.get('/api/admin/rooms', { query: { roomTypeId: e.target.value } });
      $('#rtb').innerHTML = roomRows(d2.items);
      bindRoomStatus();
    };
    function bindRoomStatus() {
      $$('[data-rs]').forEach((sel) => sel.onchange = async () => {
        try { await API.patch(`/api/admin/rooms/${sel.dataset.rs}`, { status: sel.value }); UI.toast('Đã đổi trạng thái phòng', 'success'); }
        catch (e) { UI.errToast(e); route(true); }
      });
    }
    bindRoomStatus();

    $('#new-r')?.addEventListener('click', () => {
      const m = UI.modal({ title: 'Thêm phòng vật lý', body: `<form id="f" style="display:grid;gap:12px">
        <div class="field"><label>Hạng phòng</label><select class="select" name="roomTypeId">${types.items.map((t) => `<option value="${t.id}">${UI.esc(t.name_vi)}</option>`).join('')}</select></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>Số phòng</label><input class="input" name="roomNumber" required placeholder="VD: 305"></div>
        <div class="field"><label>Tầng</label><input class="input" type="number" name="floor" value="1"></div></div>
        <button class="btn btn-primary">Lưu</button></form>` });
      m.$('#f').onsubmit = async (e) => { e.preventDefault();
        try { await API.post('/api/admin/rooms', Object.fromEntries(new FormData(e.target))); m.close(); UI.toast('Đã thêm phòng', 'success'); route(true); } catch (er) { UI.errToast(er); } };
    });

    $('#new-b')?.addEventListener('click', () => {
      const m = UI.modal({ title: 'Chặn phòng theo ngày', body: `<form id="f" style="display:grid;gap:12px">
        <div class="field"><label>Hạng phòng</label><select class="select" name="roomTypeId">${types.items.map((t) => `<option value="${t.id}">${UI.esc(t.name_vi)} (${t.total_rooms})</option>`).join('')}</select></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
        <div class="field"><label>Từ ngày</label><input class="input" type="date" name="from" value="${UI.today()}" required></div>
        <div class="field"><label>Đến ngày</label><input class="input" type="date" name="to" value="${UI.addDays(UI.today(), 2)}" required></div></div>
        <div class="grid" style="grid-template-columns:1fr;gap:12px">
        <div class="field"><label>Số phòng chặn mỗi đêm</label><input class="input" type="number" name="qty" value="1" min="1"></div>
        <div class="field"><label>Lý do</label><input class="input" name="reason" required placeholder="VD: bảo trì điều hoà"></div></div>
        <button class="btn btn-primary">Chặn phòng</button></form>` });
      m.$('#f').onsubmit = async (e) => { e.preventDefault();
        try { const r = await API.post('/api/admin/blocks', Object.fromEntries(new FormData(e.target))); m.close(); UI.toast(`Đã chặn ${r.room_nights} phòng-đêm`, 'success'); route(true); } catch (er) { UI.errToast(er); } };
    });
    $$('[data-ub]').forEach((b) => b.onclick = async () => {
      const [roomId, date] = b.dataset.ub.split('|');
      await API.del(`/api/admin/blocks?roomId=${roomId}&from=${date}&to=${UI.addDays(date, 1)}`);
      UI.toast('Đã bỏ chặn', 'success'); route(true);
    });

    const rtForm = (raw = null) => {
      // hàng thô từ API có amenities/images là chuỗi JSON -> parse ra mảng
      let t = raw;
      if (t) {
        t = { ...t };
        try { t.amenities = typeof t.amenities === 'string' ? JSON.parse(t.amenities || '[]') : (t.amenities || []); } catch { t.amenities = []; }
        try { t.images = typeof t.images === 'string' ? JSON.parse(t.images || '[]') : (t.images || []); } catch { t.images = []; }
      }
      const m = UI.modal({ title: t ? 'Sửa hạng phòng' : 'Thêm hạng phòng', wide: true, body: `<form id="f" style="display:grid;gap:12px">
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Tên (EN)</label><input class="input" name="name" value="${UI.esc(t?.name || '')}" required></div>
          <div class="field"><label>Tên (VI)</label><input class="input" name="nameVi" value="${UI.esc(t?.name_vi || '')}" required></div></div>
        <div class="field"><label>Mô tả</label><textarea class="input" name="description" rows="3">${UI.esc(t?.description || '')}</textarea></div>
        <div class="grid" style="grid-template-columns:repeat(4,1fr);gap:12px">
          <div class="field"><label>Khách</label><input class="input" type="number" name="capacity" value="${t?.capacity || 2}"></div>
          <div class="field"><label>m²</label><input class="input" type="number" name="sizeM2" value="${t?.size_m2 || 25}"></div>
          <div class="field"><label>Giá/đêm</label><input class="input" type="number" name="basePrice" value="${t?.base_price || 1000000}"></div>
          <div class="field"><label>Giường</label><input class="input" name="bedType" value="${UI.esc(t?.bed_type || '1 giường đôi')}"></div></div>
        <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:12px">
          <div class="field"><label>Huỷ free (giờ)</label><input class="input" type="number" name="cancelFreeHours" value="${t?.cancel_free_hours ?? 48}"></div>
          <div class="field"><label>Phạt (%)</label><input class="input" type="number" name="cancelPenaltyPct" value="${t?.cancel_penalty_pct ?? 50}"></div>
          <div class="field"><label>Chặn hoàn (giờ)</label><input class="input" type="number" name="cancelNoRefundHours" value="${t?.cancel_no_refund_hours ?? 24}"></div></div>
        <div class="field"><label>Tiện ích (phân cách bởi dấu phẩy)</label><input class="input" name="amen" value="${UI.esc((t?.amenities || []).join(', '))}"></div>
        <div class="field"><label>Ảnh (đường dẫn, phân cách bởi dấu phẩy)</label><input class="input" name="imgs" value="${UI.esc((t?.images || []).join(', '))}"></div>
        <label class="row gap-8 small"><input type="checkbox" name="isActive" ${t ? (t.is_active ? 'checked' : '') : 'checked'}> Đang mở bán</label>
        <button class="btn btn-primary">Lưu hạng phòng</button></form>` });
      m.$('#f').onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const body = {
          name: f.name, nameVi: f.nameVi, description: f.description, capacity: +f.capacity,
          sizeM2: +f.sizeM2, basePrice: +f.basePrice, bedType: f.bedType,
          cancelFreeHours: +f.cancelFreeHours, cancelPenaltyPct: +f.cancelPenaltyPct, cancelNoRefundHours: +f.cancelNoRefundHours,
          amenities: f.amen.split(',').map((x) => x.trim()).filter(Boolean),
          images: f.imgs.split(',').map((x) => x.trim()).filter(Boolean),
          isActive: !!f.isActive,
        };
        try {
          if (t) await API.put(`/api/admin/room-types/${t.id}`, body); else await API.post('/api/admin/room-types', body);
          m.close(); UI.toast('Đã lưu', 'success'); route(true);
        } catch (er) { UI.errToast(er); }
      };
    };
    $('#new-rt')?.addEventListener('click', () => rtForm());
    $$('[data-e]').forEach((b) => b.onclick = () => rtForm(types.items.find((x) => x.id === b.dataset.e)));
  }

  /* ================= PRICING ================= */
  async function pgPricing(main) {
    const [rules, types] = await Promise.all([API.get('/api/admin/price-rules'), API.get('/api/admin/room-types')]);
    main.innerHTML = `
      <div class="panel">
        <div class="panel-hd"><h3>Quy tắc giá theo mùa / ngày</h3>${ME.user.role === 'admin' ? '<button class="btn btn-primary btn-sm" id="new">+ Thêm rule</button>' : ''}</div>
        <p class="tiny muted" style="margin:-8px 0 14px">Giá đêm = giá gốc × hệ số mùa × phụ thu cuối tuần (${15}%). Rule có priority cao hơn thắng.</p>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tên</th><th>Hạng phòng</th><th>Khoảng áp dụng</th><th>Ngày trong tuần</th><th class="num">Hệ số</th><th class="num">Ưu tiên</th><th></th></tr></thead>
        <tbody>${rules.items.map((r) => `
          <tr><td><b>${UI.esc(r.name)}</b></td><td class="small">${UI.esc(r.name_vi)}</td>
          <td class="small">${UI.dmy(r.start_date)} → ${UI.dmy(r.end_date)}</td>
          <td class="tiny">${r.days_of_week ? JSON.parse(r.days_of_week).map((x) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][x]).join(',') : 'mọi ngày'}</td>
          <td class="num"><b>×${r.multiplier}</b></td><td class="num">${r.priority}</td>
          <td>${ME.user.role === 'admin' ? `<button class="btn btn-ghost btn-sm" data-d="${r.id}">Xoá</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      </div>`;
    $('#new')?.addEventListener('click', () => {
      const m = UI.modal({ title: 'Thêm rule giá', body: `<form id="f" style="display:grid;gap:12px">
        <div class="field"><label>Tên</label><input class="input" name="name" required placeholder="VD: Lễ 30/4"></div>
        <div class="field"><label>Hạng phòng</label><select class="select" name="roomTypeId">${types.items.map((t) => `<option value="${t.id}">${UI.esc(t.name_vi)}</option>`).join('')}</select></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Từ</label><input class="input" type="date" name="startDate" required></div>
          <div class="field"><label>Đến</label><input class="input" type="date" name="startDate2" required></div></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Hệ số (1.2 = +20%)</label><input class="input" type="number" step="0.05" name="multiplier" value="1.2"></div>
          <div class="field"><label>Ưu tiên</label><input class="input" type="number" name="priority" value="10"></div></div>
        <button class="btn btn-primary">Lưu</button></form>` });
      m.$('#f').onsubmit = async (e) => { e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try { await API.post('/api/admin/price-rules', { roomTypeId: f.roomTypeId, name: f.name, startDate: f.startDate, endDate: f.startDate2, multiplier: +f.multiplier, priority: +f.priority }); m.close(); UI.toast('Đã thêm rule', 'success'); route(true); } catch (er) { UI.errToast(er); } };
    });
    $$('[data-d]').forEach((b) => b.onclick = async () => {
      if (!await UI.confirmDialog({ title: 'Xoá rule', message: 'Xoá rule giá này? Booking đã tạo không bị ảnh hưởng.', confirmText: 'Xoá', danger: true })) return;
      await API.del(`/api/admin/price-rules/${b.dataset.d}`); UI.toast('Đã xoá', 'success'); route(true);
    });
  }

  /* ================= COUPONS ================= */
  async function pgCoupons(main) {
    const d = await API.get('/api/admin/coupons');
    main.innerHTML = `
      <div class="panel">
        <div class="panel-hd"><h3>Mã giảm giá</h3>${ME.user.role === 'admin' ? '<button class="btn btn-primary btn-sm" id="new">+ Tạo mã</button>' : ''}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mã</th><th>Giảm</th><th>Điều kiện</th><th>Hạn dùng</th><th class="num">Đã dùng</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>${d.items.map((c) => `
          <tr><td class="mono"><b>${UI.esc(c.code)}</b></td>
          <td>${c.type === 'PERCENT' ? c.value + '%' + (c.max_discount ? ` (tối đa ${UI.vndShort(c.max_discount)})` : '') : UI.vnd(c.value)}</td>
          <td class="tiny">đơn ≥ ${UI.vnd(c.min_amount)} · ${c.per_user_limit}/người${c.usage_limit ? ' · tổng ' + c.usage_limit : ''}</td>
          <td class="small">${UI.dmy(c.starts_at)} → ${UI.dmy(c.ends_at)}</td>
          <td class="num">${c.used_count}</td>
          <td>${c.is_active ? '<span class="tag info">bật</span>' : '<span class="tag crit">tắt</span>'}</td>
          <td>${ME.user.role === 'admin' ? `<button class="btn btn-ghost btn-sm" data-t="${c.id}|${c.is_active}">${c.is_active ? 'Tắt' : 'Bật'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      </div>`;
    $('#new')?.addEventListener('click', () => {
      const m = UI.modal({ title: 'Tạo mã giảm giá', body: `<form id="f" style="display:grid;gap:12px">
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Mã</label><input class="input" name="code" required placeholder="HE2026" style="text-transform:uppercase"></div>
          <div class="field"><label>Loại</label><select class="select" name="type"><option value="PERCENT">%</option><option value="FIXED">Số tiền</option></select></div></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Giá trị</label><input class="input" type="number" name="value" value="10" required></div>
          <div class="field"><label>Trần giảm (cho %)</label><input class="input" type="number" name="maxDiscount" placeholder="500000"></div></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Đơn tối thiểu</label><input class="input" type="number" name="minAmount" value="0"></div>
          <div class="field"><label>Giới hạn tổng lượt</label><input class="input" type="number" name="usageLimit" placeholder="để trống = ∞"></div></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Từ</label><input class="input" type="date" name="s" value="${UI.today()}" required></div>
          <div class="field"><label>Đến</label><input class="input" type="date" name="e" value="${UI.addDays(UI.today(), 60)}" required></div></div>
        <button class="btn btn-primary">Tạo mã</button></form>` });
      m.$('#f').onsubmit = async (e) => { e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try {
          await API.post('/api/admin/coupons', {
            code: f.code.toUpperCase(), type: f.type, value: +f.value,
            maxDiscount: f.maxDiscount ? +f.maxDiscount : undefined, minAmount: +f.minAmount,
            usageLimit: f.usageLimit ? +f.usageLimit : null,
            startsAt: f.s + ' 00:00:00', endsAt: f.e + ' 23:59:59',
          });
          m.close(); UI.toast('Đã tạo mã', 'success'); route(true);
        } catch (er) { UI.errToast(er); } };
    });
    $$('[data-t]').forEach((b) => b.onclick = async () => {
      const [id, on] = b.dataset.t.split('|');
      await API.patch(`/api/admin/coupons/${id}`, { isActive: on === '0' });
      UI.toast('Đã đổi trạng thái', 'success'); route(true);
    });
  }

  /* ================= USERS ================= */
  async function pgUsers(main, params) {
    if (ME.user.role !== 'admin') { main.innerHTML = '<div class="panel">Cần quyền admin.</div>'; return; }
    const page = +params.page || 1;
    const d = await API.get('/api/admin/users', { query: { q: params.q || '', role: params.role || '', page, limit: 20 } });
    main.innerHTML = `
      <div class="panel">
        <div class="filters"><input class="input" id="q" placeholder="Tìm email / tên / SĐT…" value="${UI.esc(params.q || '')}">
          <select class="select" id="rl"><option value="">Mọi vai trò</option>${['customer', 'staff', 'admin'].map((r) => `<option ${params.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <button class="btn btn-primary btn-sm" id="go">Lọc</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Trạng thái</th><th class="num">Đặt phòng</th><th>Đăng nhập cuối</th><th></th></tr></thead>
        <tbody>${d.items.map((u) => `
          <tr><td><b>${UI.esc(u.full_name)}</b><div class="tiny muted">${UI.esc(u.email)} · ${UI.esc(u.phone || '')}</div></td>
          <td><span class="tag ${u.role === 'admin' ? 'warn' : u.role === 'staff' ? 'info' : ''}">${u.role}</span></td>
          <td>${u.status === 'active' ? '<span class="tag info">active</span>' : '<span class="tag crit">suspended</span>'}</td>
          <td class="num">${u.bookings_count}</td>
          <td class="tiny">${u.last_login_at ? UI.dtVN(u.last_login_at) + '<br>' + UI.esc(u.last_login_ip || '') : '—'}</td>
          <td><button class="btn btn-ghost btn-sm" data-u="${u.id}">Quyền</button></td></tr>`).join('')}</tbody></table></div>
        ${pager(d.meta)}
      </div>`;
    const go = (p = 1) => {
      const q = new URLSearchParams();
      if ($('#q').value) q.set('q', $('#q').value);
      if ($('#rl').value) q.set('role', $('#rl').value);
      if (p > 1) q.set('page', p);
      location.hash = '#/users' + (q.toString() ? '?' + q : '');
    };
    $('#go').onclick = () => go(1); $('#q').onkeydown = (e) => e.key === 'Enter' && go(1); $('#rl').onchange = () => go(1);
    bindPager(d.meta, go);
    $$('[data-u]').forEach((b) => b.onclick = () => {
      const u = d.items.find((x) => x.id === b.dataset.u);
      const m = UI.modal({ title: `Quyền của ${u.full_name}`, body: `<form id="f" style="display:grid;gap:14px">
        <div class="field"><label>Vai trò</label><select class="select" name="role">${['customer', 'staff', 'admin'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <div class="field"><label>Trạng thái</label><select class="select" name="status">${['active', 'suspended'].map((r) => `<option ${u.status === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <p class="tiny muted">Khoá tài khoản sẽ thu hồi toàn bộ phiên đang đăng nhập.</p>
        <button class="btn btn-primary">Lưu</button></form>` });
      m.$('#f').onsubmit = async (e) => { e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try { await API.patch(`/api/admin/users/${u.id}`, f); m.close(); UI.toast('Đã cập nhật', 'success'); route(true); } catch (er) { UI.errToast(er); } };
    });
  }

  /* ================= REVIEWS ================= */
  async function pgReviews(main) {
    const d = await API.get('/api/reviews', { query: { limit: 30 } });
    const pending = await API.get('/api/admin/audit-logs', { query: { limit: 1 } }).catch(() => null);
    main.innerHTML = `
      <div class="panel">
        <div class="panel-hd"><h3>Đánh giá đã duyệt</h3><span class="badge badge-muted">${d.summary.count} · TB ${d.summary.average}</span></div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${d.items.map((r) => `
            <div style="border:1px solid var(--sand);border-radius:12px;padding:14px">
              <div class="row" style="justify-content:space-between;gap:10px">
                <b>${UI.esc(r.full_name)} <span class="stars">${'★'.repeat(r.rating)}</span></b>
                <span class="tiny muted">${UI.dmy(r.created_at)} · ${UI.esc(r.room_type_name)}</span></div>
              <p class="small" style="margin:6px 0">${UI.esc(r.content)}</p>
              ${r.owner_reply ? `<div class="tiny" style="background:var(--cream);padding:8px 12px;border-radius:8px"><b>Phản hồi:</b> ${UI.esc(r.owner_reply)}</div>` : `<button class="btn btn-ghost btn-sm" data-rp="${r.id}">Phản hồi</button>`}
            </div>`).join('')}
        </div>
      </div>`;
    $$('[data-rp]').forEach((b) => b.onclick = () => {
      const m = UI.modal({ title: 'Phản hồi đánh giá', body: `<form id="f"><div class="field"><label>Nội dung</label><textarea class="input" name="reply" rows="3" required></textarea></div><button class="btn btn-primary" style="margin-top:12px">Gửi</button></form>` });
      m.$('#f').onsubmit = async (e) => { e.preventDefault();
        await API.post(`/api/reviews/${b.dataset.rp}/reply`, { reply: m.$('[name=reply]').value });
        m.close(); UI.toast('Đã gửi phản hồi', 'success'); route(true); };
    });
  }

  /* ================= PAYMENTS ================= */
  async function pgPayments(main, params) {
    const page = +params.page || 1;
    const d = await API.get('/api/admin/payments', { query: { status: params.status || '', page, limit: 25 } });
    main.innerHTML = `
      <div class="panel">
        <div class="filters"><select class="select" id="st"><option value="">Mọi trạng thái</option>
          ${['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'].map((s) => `<option ${params.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" id="rec">${UI.ICONS.spark} Đối soát bằng nội dung CK</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mã GD</th><th>Booking</th><th>Cổng</th><th>Loại</th><th>Trạng thái</th><th class="num">Số tiền</th><th>Thời gian</th></tr></thead>
        <tbody>${d.items.map((p) => `
          <tr><td class="mono tiny">${UI.esc(p.txn_ref)}</td><td class="mono tiny">${UI.esc(p.booking_code)}</td><td>${p.provider}</td>
          <td>${p.type === 'REFUND' ? '<span class="tag warn">hoàn</span>' : 'thu'}</td>
          <td>${UI.statusBadge(p.status === 'PAID' ? 'COMPLETED' : p.status === 'PENDING' ? 'PENDING' : 'CANCELLED')} <span class="tiny muted">${p.status}</span></td>
          <td class="num"><b>${UI.vnd(p.amount)}</b></td><td class="tiny">${p.paid_at ? UI.dtVN(p.paid_at) : UI.dtVN(p.created_at)}</td></tr>`).join('')}</tbody></table></div>
        ${pager(d.meta)}
      </div>`;
    $('#st').onchange = () => location.hash = '#/payments' + ($('#st').value ? `?status=${$('#st').value}` : '');
    bindPager(d.meta, (p) => location.hash = `#/payments?page=${p}${params.status ? `&status=${params.status}` : ''}`);
    $('#rec').onclick = () => {
      const m = UI.modal({ title: 'Đối soát chuyển khoản', body: `<form id="f" style="display:grid;gap:12px">
        <div class="field"><label>Dán nội dung chuyển khoản từ sao kê ngân hàng</label>
        <input class="input" name="content" required placeholder="VD: LAKSTAY LKS8F3K2Q1A2B3C"></div>
        <p class="tiny muted">Hệ thống tự tách mã giao dịch và đối chiếu với đơn đang chờ.</p>
        <button class="btn btn-primary">Đối soát</button></form>` });
      m.$('#f').onsubmit = async (e) => { e.preventDefault();
        try { const r = await API.post('/api/payments/reconcile', { content: m.$('[name=content]').value }); m.close(); UI.toast(`Khớp đơn ${r.booking?.code || ''} — ${UI.vnd(r.payment.amount)}`, 'success'); route(true); } catch (er) { UI.errToast(er); } };
    };
  }

  /* ================= REPORTS ================= */
  /* ================= SVG CHARTS — tự vẽ, KHÔNG thư viện ngoài ================= */
  function chArea(series, { w = 640, h = 210, color = '#2f6f4f', fmt = (v) => v } = {}) {
    if (!series.length) return '<p class="muted small">Chưa có dữ liệu.</p>';
    const max = Math.max(...series.map((p) => p.v), 1);
    const px = (i) => 10 + (i * (w - 20)) / Math.max(1, series.length - 1);
    const py = (v) => h - 30 - (v / max) * (h - 52);
    const pts = series.map((p, i) => `${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ');
    const area = `${px(0).toFixed(1)},${h - 30} ${pts} ${px(series.length - 1).toFixed(1)},${h - 30}`;
    const li = [0, Math.floor((series.length - 1) / 2), series.length - 1];
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto" role="img" aria-label="chart">
      <line x1="10" y1="${h - 30}" x2="${w - 10}" y2="${h - 30}" stroke="#e3e1da" stroke-width="1"/>
      <polygon points="${area}" fill="${color}" opacity=".13"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${series.map((p, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="2.6" fill="${color}"><title>${UI.esc(p.label)}: ${UI.esc(fmt(p.v))}</title></circle>`).join('')}
      <text x="10" y="14" font-size="10" fill="#8a8f98">cao nhất: ${UI.esc(fmt(max))}</text>
      ${li.map((i) => `<text x="${px(i).toFixed(1)}" y="${h - 10}" font-size="10" fill="#8a8f98" text-anchor="middle">${UI.esc(series[i].label)}</text>`).join('')}
    </svg>`;
  }

  function chBars(parts, { w = 340, h = 210, fmt = (v) => v } = {}) {
    if (!parts.length) return '<p class="muted small">Chưa có dữ liệu.</p>';
    const max = Math.max(...parts.map((p) => p.v), 1);
    const bw = (w - 20) / parts.length;
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto" role="img" aria-label="chart">
      ${parts.map((p, i) => {
        const bh = Math.max(2, (p.v / max) * (h - 62));
        const x = 10 + i * bw + bw * 0.16, y = h - 30 - bh;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.68).toFixed(1)}" height="${bh.toFixed(1)}" rx="5" fill="${p.color || '#2f6f4f'}" opacity=".88"><title>${UI.esc(p.label)}: ${UI.esc(fmt(p.v))}</title></rect>
          <text x="${(x + bw * 0.34).toFixed(1)}" y="${h - 16}" font-size="9" fill="#6b7076" text-anchor="middle">${UI.esc(String(p.label).slice(0, 10))}</text>
          <text x="${(x + bw * 0.34).toFixed(1)}" y="${(y - 5).toFixed(1)}" font-size="10" fill="#3a3f45" text-anchor="middle" font-weight="700">${UI.esc(fmt(p.v))}</text>`;
      }).join('')}</svg>`;
  }

  function chDonut(parts, { size = 180, fmt = (v) => v, centerLabel = 'tổng' } = {}) {
    const total = parts.reduce((s2, p) => s2 + p.v, 0);
    if (!total) return '<p class="muted small">Chưa có dữ liệu.</p>';
    const R = 58, CIRC = 2 * Math.PI * R;
    const cols = ['#2f6f4f', '#7ea88e', '#c9a227', '#b8764a', '#5b6770', '#7d3c98'];
    let off = 0;
    return `<div class="row gap-16" style="flex-wrap:wrap;align-items:center">
      <svg viewBox="0 0 160 160" style="width:${size}px;max-width:44%" role="img" aria-label="chart">
        <circle cx="80" cy="80" r="${R}" fill="none" stroke="#edebe5" stroke-width="21"/>
        ${parts.map((p, i) => {
          const frac = p.v / total;
          const el = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${p.color || cols[i % cols.length]}" stroke-width="21"
            stroke-dasharray="${(frac * CIRC).toFixed(2)} ${CIRC.toFixed(2)}" stroke-dashoffset="${(-off * CIRC).toFixed(2)}"
            transform="rotate(-90 80 80)"><title>${UI.esc(p.label)}: ${UI.esc(fmt(p.v))}</title></circle>`;
          off += frac; return el;
        }).join('')}
        <text x="80" y="78" text-anchor="middle" font-size="12.5" font-weight="700" fill="#2a2f36">${UI.esc(fmt(total))}</text>
        <text x="80" y="93" text-anchor="middle" font-size="9" fill="#8a8f98">${centerLabel}</text>
      </svg>
      <div style="flex:1;min-width:160px;display:flex;flex-direction:column;gap:7px">
        ${parts.map((p, i) => `<div class="row small" style="justify-content:space-between">
          <span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${p.color || cols[i % cols.length]};margin-right:7px"></i>${UI.esc(p.label)}</span>
          <b>${UI.esc(fmt(p.v))} <span class="tiny muted">(${Math.round((p.v / total) * 100)}%)</span></b></div>`).join('')}
      </div></div>`;
  }

  /* ================= REPORTS ================= */
  async function pgReports(main, params) {
    const days = params.days || 30;
    const [d, ch] = await Promise.all([
      API.get('/api/admin/reports/occupancy', { query: { days } }),
      API.get('/api/admin/reports/charts', { query: { days } }),
    ]);
    const SC = { PENDING: '#c9a227', CONFIRMED: '#2f6f4f', CHECKED_IN: '#7ea88e', COMPLETED: '#5b6770',
                 CANCELLED: '#b0413e', EXPIRED: '#8a8f98', NO_SHOW: '#7d3c98', REFUNDED: '#b8764a' };
    const lbl = (dt) => UI.dmy(dt).slice(0, 5);
    main.innerHTML = `
      <div class="cards">
        <div class="kpi accent"><div class="lb">${UI.ICONS.chart}Doanh thu ${days} ngày</div><div class="v" style="font-size:22px">${UI.vnd(ch.totals.revenue)}</div><div class="d">${ch.totals.paid_orders} giao dịch PAID</div></div>
        <div class="kpi"><div class="lb">${UI.ICONS.calendar}Đơn tạo mới</div><div class="v">${ch.totals.bookings}</div><div class="d">trong kỳ báo cáo</div></div>
        <div class="kpi"><div class="lb">${UI.ICONS.bed}Công suất TB</div><div class="v">${d.occupancy_rate_pct}%</div><div class="d">${d.period_days} ngày</div></div>
        <div class="kpi"><div class="lb">${UI.ICONS.star}Ngày đỉnh điểm</div><div class="v" style="font-size:20px">${UI.dmy(d.best_day?.date || UI.today())}</div><div class="d">${d.best_day?.occupancy_pct || 0}% công suất</div></div>
      </div>
      <div class="panel">
        <div class="panel-hd"><h3>Doanh thu theo ngày (tiền PAID)</h3>
          <select class="select" id="dd" style="width:auto">${[14, 30, 60, 90].map((x) => `<option ${x == days ? 'selected' : ''}>${x}</option>`).join('')}</select>
          <a class="btn btn-primary btn-sm" href="/api/admin/reports/revenue.csv?days=${days}" download>${UI.ICONS.download} Tải CSV</a></div>
        ${chArea(ch.revenue_series.map((x) => ({ label: lbl(x.date), v: x.revenue })), { fmt: (v) => UI.vnd(v) })}
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="panel"><div class="panel-hd"><h3>Đơn đặt theo ngày</h3></div>
          ${chArea(ch.bookings_series.map((x) => ({ label: lbl(x.date), v: x.bookings })), { color: '#5b6770' })}</div>
        <div class="panel"><div class="panel-hd"><h3>Công suất phòng (%)</h3></div>
          ${chArea(d.days.map((x) => ({ label: lbl(x.date), v: x.occupancy_pct })), { color: '#c9a227', fmt: (v) => v + '%' })}</div>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="panel"><div class="panel-hd"><h3>Doanh thu theo hạng phòng</h3></div>
          ${chDonut(ch.revenue_by_type.map((x) => ({ label: x.name, v: x.total })), { fmt: (v) => UI.vnd(v) })}</div>
        <div class="panel"><div class="panel-hd"><h3>Đơn theo trạng thái</h3></div>
          ${chBars(ch.status_split.map((x) => ({ label: x.status, v: x.n, color: SC[x.status] || '#8a8f98' })))}</div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="panel-hd"><h3>Chi tiết tồn kho theo ngày</h3></div>
        <div class="tbl-wrap" style="max-height:440px;overflow:auto"><table class="tbl"><thead><tr><th>Ngày</th><th class="num">Tổng phòng</th><th class="num">Đã chiếm</th><th class="num">Trống</th><th class="num">Công suất</th></tr></thead>
        <tbody>${d.days.map((x) => `<tr><td>${UI.dmy(x.date)}${x.weekend ? ' <span class="tag warn">cuối tuần</span>' : ''}</td>
          <td class="num">${x.total_rooms}</td><td class="num">${x.occupied}</td><td class="num">${x.available}</td>
          <td class="num"><b style="color:${x.occupancy_pct >= 90 ? 'var(--danger)' : x.occupancy_pct >= 70 ? 'var(--warn)' : 'var(--success)'}">${x.occupancy_pct}%</b></td></tr>`).join('')}</tbody></table></div>
      </div>`;
    $('#dd').onchange = (e) => location.hash = `#/reports?days=${e.target.value}`;
  }

  /* ================= MAIL OUTBOX ================= */
  async function pgOutbox(main) {
    const d = await API.get('/api/admin/outbox');
    main.innerHTML = `
      <div class="panel">
        <div class="panel-hd"><h3>Hộp thư đã gửi (dev outbox)</h3>
          <span class="badge badge-muted">${d.items.length}</span></div>
        <p class="tiny muted" style="margin:-6px 0 14px">${UI.esc(d.note || '')} Khi cấu hình SMTP thật ở <span class="mono">.env</span>, email sẽ gửi qua mail server thay vì ghi ra đây.</p>
        ${d.items.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Thời gian</th><th>Người nhận</th><th>Tiêu đề</th><th>Đính kèm</th><th></th></tr></thead>
        <tbody>${d.items.map((m) => `
          <tr><td class="tiny">${UI.dtVN(m.at)}</td><td class="tiny">${UI.esc(m.to)}</td><td class="small"><b>${UI.esc(m.subject)}</b></td>
          <td class="tiny">${(m.attachments || []).map((a) => `<a href="/api/admin/outbox/${UI.esc(m.id)}/file/${encodeURIComponent(a)}" target="_blank" rel="noopener" style="color:var(--pine);font-weight:700">${UI.esc(a)}</a>`).join(', ') || '—'}</td>
          <td><a class="btn btn-ghost btn-sm" href="/api/admin/outbox/${UI.esc(m.id)}" target="_blank" rel="noopener">Xem</a></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted small">Chưa có email nào. Tạo và thanh toán một đơn để nhận email xác nhận kèm voucher PDF.</p>'}
      </div>`;
  }

  /* ================= LOYALTY ================= */
  const TIER_TAG = { MEMBER: '', SILVER: 'info', GOLD: 'warn', PLATINUM: 'crit' };
  const TIER_VI = { MEMBER: 'Thành viên', SILVER: 'Bạc 🥈', GOLD: 'Vàng 🥇', PLATINUM: 'Bạch kim 💎' };
  async function pgLoyalty(main, params) {
    if (ME.user.role !== 'admin') { main.innerHTML = '<div class="panel">Cần quyền admin.</div>'; return; }
    const d = await API.get('/api/admin/loyalty', { query: { q: params.q || '', tier: params.tier || '' } });
    const byTier = Object.fromEntries((d.stats || []).map((x) => [x.tier, x]));
    main.innerHTML = `
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
        ${d.tiers.map((t) => `<div class="panel" style="padding:14px 16px">
          <div class="tiny muted">${TIER_VI[t.key] || t.key} · giảm ${t.discount_pct}%</div>
          <b style="font-size:22px;font-family:var(--f-display)">${(byTier[t.key]?.n) || 0}</b>
          <div class="tiny muted">${((byTier[t.key]?.points) || 0).toLocaleString('vi-VN')} điểm</div></div>`).join('')}
      </div>
      <div class="panel">
        <div class="filters"><input class="input" id="q" placeholder="Tìm email / tên…" value="${UI.esc(params.q || '')}">
          <select class="select" id="tf"><option value="">Mọi hạng</option>
            ${d.tiers.map((t) => `<option value="${t.key}" ${params.tier === t.key ? 'selected' : ''}>${TIER_VI[t.key]}</option>`).join('')}</select>
          <button class="btn btn-primary btn-sm" id="go">Lọc</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Thành viên</th><th>Hạng</th><th class="num">Điểm</th><th class="num">Chi tiêu tích luỹ</th><th>Cập nhật</th><th></th></tr></thead>
        <tbody>${d.items.map((u) => `
          <tr><td><b>${UI.esc(u.full_name)}</b><div class="tiny muted">${UI.esc(u.email)}</div></td>
          <td><span class="tag ${TIER_TAG[u.tier] || ''}">${TIER_VI[u.tier] || u.tier}</span></td>
          <td class="num"><b>${u.points.toLocaleString('vi-VN')}</b></td>
          <td class="num">${UI.vnd(u.lifetime_spend)}</td>
          <td class="tiny">${u.updated_at ? UI.dtVN(u.updated_at) : '—'}</td>
          <td><button class="btn btn-ghost btn-sm" data-adj="${u.user_id}">Điều chỉnh</button></td></tr>`).join('')}</tbody></table></div>
      </div>`;
    const go = () => {
      const q = new URLSearchParams();
      if ($('#q').value) q.set('q', $('#q').value);
      if ($('#tf').value) q.set('tier', $('#tf').value);
      location.hash = '#/loyalty' + (q.toString() ? '?' + q : '');
    };
    $('#go').onclick = go; $('#q').onkeydown = (e) => e.key === 'Enter' && go(); $('#tf').onchange = go;
    $$('[data-adj]').forEach((b) => b.onclick = () => {
      const u = d.items.find((x) => x.user_id === b.dataset.adj);
      const m = UI.modal({ title: `Điều chỉnh điểm — ${u.full_name}`, body: `<form id="f" style="display:grid;gap:12px">
        <div class="field"><label>Điểm cộng/trừ (VD: 500 hoặc -200)</label><input class="input" type="number" name="points" value="0" required></div>
        <div class="field"><label>Chi tiêu tích luỹ ± (₫, xét hạng — thường để 0)</label><input class="input" type="number" name="lifetimeSpendDelta" value="0"></div>
        <div class="field"><label>Lý do (bắt buộc, ghi vào audit)</label><input class="input" name="note" minlength="3" required placeholder="VD: đền bù sự cố phòng"></div>
        <button class="btn btn-primary" type="submit">Thực hiện</button></form>` });
      m.el.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try {
          await API.post(`/api/admin/loyalty/${u.user_id}/adjust`, {
            points: +f.points || 0, lifetimeSpendDelta: +f.lifetimeSpendDelta || 0, note: f.note,
          });
          m.close(); UI.toast('Đã điều chỉnh điểm.', 'success');
          pgLoyalty(main, params); // re-render với dữ liệu mới
        } catch (err) { UI.errToast(err); }
      };
    });
  }

  /* ================= AUDIT ================= */
  async function pgAudit(main, params) {
    if (ME.user.role !== 'admin') { main.innerHTML = '<div class="panel">Cần quyền admin.</div>'; return; }
    const page = +params.page || 1;
    const d = await API.get('/api/admin/audit-logs', { query: { page, limit: 40, entityType: params.type || '' } });
    main.innerHTML = `
      <div class="panel">
        <div class="filters"><select class="select" id="tp"><option value="">Mọi hành động</option>
          ${['BOOKING_CREATED', 'BOOKING_CANCELLED', 'PAYMENT_PAID', 'PAYMENT_REFUNDED', 'USER_LOGIN', 'ROOM_TYPE_UPDATED', 'COUPON_CREATED'].map((x) => `<option ${params.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Thời gian</th><th>Hành động</th><th>Người</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead>
        <tbody>${d.items.map((a) => `
          <tr><td class="tiny">${UI.dtVN(a.created_at)}</td><td><span class="tag info">${UI.esc(a.action)}</span></td>
          <td class="tiny">${UI.esc(a.actor_role || '?')}<div class="muted">${UI.esc((a.actor_id || '').slice(0, 12))}</div></td>
          <td class="tiny">${UI.esc(a.entity_type || '')}<div class="muted mono">${UI.esc((a.entity_id || '').slice(0, 14))}</div></td>
          <td class="tiny mono" style="max-width:340px;word-break:break-all">${UI.esc(a.after_data || a.before_data || '').slice(0, 120)}</td></tr>`).join('')}</tbody></table></div>
        ${pager(d.meta, page)}
      </div>`;
    $('#tp').onchange = () => location.hash = '#/audit' + ($('#tp').value ? `?type=${$('#tp').value}` : '');
    bindPager(d.meta, (p) => location.hash = `#/audit?page=${p}`);
  }

  /* ================= SECURITY ================= */
  async function pgSecurity(main, params) {
    if (ME.user.role !== 'admin') { main.innerHTML = '<div class="panel">Cần quyền admin.</div>'; return; }
    const d = await API.get('/api/admin/security-events', { query: { severity: params.sev || '', limit: 60 } });
    main.innerHTML = `
      <div class="cards">
        ${d.by_type.slice(0, 4).map((x) => `
          <div class="kpi"><div class="lb">${UI.ICONS.shield}${UI.esc(x.type)}</div><div class="v">${x.n}</div>
          <div class="d"><span class="tag ${x.severity === 'critical' ? 'crit' : x.severity === 'warn' ? 'warn' : 'info'}">${x.severity}</span> 7 ngày qua</div></div>`).join('') || '<div class="kpi"><div class="v">0</div><div class="d">không có sự cố 7 ngày qua 🎉</div></div>'}
      </div>
      <div class="panel">
        <div class="filters"><select class="select" id="sv"><option value="">Mọi mức</option>${['info', 'warn', 'critical'].map((s) => `<option ${params.sev === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Thời gian</th><th>Loại</th><th>Mức</th><th>IP</th><th>Chi tiết</th></tr></thead>
        <tbody>${d.items.map((e2) => `
          <tr><td class="tiny">${UI.dtVN(e2.created_at)}</td><td class="tiny mono">${UI.esc(e2.type)}</td>
          <td><span class="tag ${e2.severity === 'critical' ? 'crit' : e2.severity === 'warn' ? 'warn' : 'info'}">${e2.severity}</span></td>
          <td class="tiny mono">${UI.esc(e2.ip || '')}</td>
          <td class="tiny">${UI.esc(e2.email || '')} ${UI.esc(e2.detail || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="center muted" style="padding:24px">Không có sự kiện</td></tr>'}</tbody></table></div>
      </div>`;
    $('#sv').onchange = () => location.hash = '#/security' + ($('#sv').value ? `?sev=${$('#sv').value}` : '');
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
