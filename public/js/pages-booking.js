/* ============================================================================
   Booking flow: wizard đặt phòng, thanh toán QR, quản lý đặt phòng, đánh giá
   ========================================================================== */
const B = (() => {

  /* ================= WIZARD ================= */
  async function book(params) {
    const main = document.getElementById('main');
    const state = {
      step: 1,
      checkIn: params.in || UI.addDays(UI.today(), 7),
      checkOut: params.out || UI.addDays(params.in || UI.addDays(UI.today(), 7), 2),
      guests: +(params.guests || 2),
      lines: params.room ? [{ roomTypeId: params.room, qty: +(params.qty || 1), guests: +(params.guests || 2) }] : [],
      coupon: params.coupon || '',
      guest: {},
      quote: null,
      booking: null,
      idemKey: 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    };

    main.innerHTML = `
      <div style="height:var(--nav-h)"></div>
      <section class="section" style="padding-top:34px;min-height:80vh">
        <div class="wrap" style="max-width:1040px">
          <div class="stepper" id="steps"></div>
          <div id="wz"></div>
        </div>
      </section>`;

    const STEPS = ['Chọn phòng', 'Thông tin khách', 'Xác nhận', 'Thanh toán', 'Hoàn tất'];
    function renderSteps() {
      document.getElementById('steps').innerHTML = STEPS.map((s, i) => `
        <div class="st ${state.step > i + 1 ? 'done' : state.step === i + 1 ? 'active' : ''}">
          <span class="dot">${state.step > i + 1 ? '✓' : i + 1}</span><span class="lb">${s}</span>
        </div>${i < STEPS.length - 1 ? `<div class="line ${state.step > i + 1 ? 'done' : ''}"></div>` : ''}`).join('');
    }

    const el = () => document.getElementById('wz');

    /* ---------- step 1: chọn phòng ---------- */
    async function step1() {
      el().innerHTML = `
        <div class="grid" style="grid-template-columns:1fr 340px;gap:26px;align-items:start" id="s1">
          <div>
            <div class="tst" style="padding:18px">
              <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:12px">
                <div class="field"><label>Nhận phòng</label><input class="input" type="date" id="ci" value="${state.checkIn}" min="${UI.today()}"></div>
                <div class="field"><label>Trả phòng</label><input class="input" type="date" id="co" value="${state.checkOut}" min="${UI.addDays(state.checkIn, 1)}"></div>
                <div class="field"><label>Khách</label><input class="input" type="number" id="gs" value="${state.guests}" min="1" max="12"></div>
              </div>
            </div>
            <div class="room-grid" id="pick" style="grid-template-columns:1fr;gap:14px;margin-top:16px">${UI.skeletonCards(3)}</div>
          </div>
          <aside class="tst" style="padding:20px;position:sticky;top:calc(var(--nav-h) + 16px)" id="sum1"></aside>
        </div>`;

      let types = [];
      async function loadTypes() {
        const d = await API.get('/api/rooms', { query: { checkIn: state.checkIn, checkOut: state.checkOut, guests: state.guests, limit: 20 } });
        types = d.items;
        // giữ line hợp lệ
        state.lines = state.lines.filter((l) => types.some((t) => t.id === l.roomTypeId && t.available >= l.qty));
        renderList();
        await updateSummary();
      }
      function renderList() {
        document.getElementById('pick').innerHTML = types.map((t) => {
          const line = state.lines.find((l) => l.roomTypeId === t.id);
          const sold = t.available === 0;
          return `
          <div class="tst" style="padding:14px;display:flex;gap:16px;align-items:center;opacity:${sold && !line ? .6 : 1}">
            <img src="${UI.esc((t.images || ['/img/room-deluxe.jpg'])[0])}" style="width:118px;height:84px;object-fit:cover;border-radius:12px;flex:none" alt="">
            <div style="flex:1;min-width:0">
              <b style="font-size:16px;font-family:var(--f-display)">${UI.esc(t.name_vi)}</b>
              <div class="meta small" style="gap:12px;margin-top:2px">
                <span>${t.capacity} khách</span><span>${t.size_m2}m²</span>
                <span class="${sold ? 'badge badge-danger' : t.available <= 2 ? 'badge badge-warning' : 'badge badge-success'}" style="padding:2px 8px">${sold ? 'Hết phòng' : 'Còn ' + t.available}</span>
              </div>
              <div class="tiny muted" style="margin-top:4px">${UI.vnd(t.base_price)}/đêm · huỷ miễn phí trước ${t.policy.cancel_free_hours}h</div>
            </div>
            <div class="row gap-8" style="flex:none">
              <button class="btn btn-ghost btn-sm" data-dec="${t.id}" ${(!line || line.qty <= 1) ? 'disabled' : ''}>−</button>
              <b style="min-width:20px;text-align:center">${line ? line.qty : 0}</b>
              <button class="btn btn-ghost btn-sm" data-inc="${t.id}" ${(sold || (line && line.qty >= t.available)) ? 'disabled' : ''}>+</button>
            </div>
          </div>`;
        }).join('');
        document.querySelectorAll('[data-inc]').forEach((b) => b.onclick = () => {
          const id = b.dataset.inc; const t = types.find((x) => x.id === id);
          const line = state.lines.find((l) => l.roomTypeId === id);
          if (line) line.qty = Math.min(t.available, line.qty + 1);
          else state.lines.push({ roomTypeId: id, qty: 1, guests: state.guests });
          renderList(); updateSummary();
        });
        document.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => {
          const id = b.dataset.dec;
          const line = state.lines.find((l) => l.roomTypeId === id);
          if (!line) return;
          line.qty--; if (line.qty <= 0) state.lines = state.lines.filter((l) => l !== line);
          renderList(); updateSummary();
        });
      }
      async function updateSummary() {
        const box = document.getElementById('sum1');
        if (!state.lines.length) { box.innerHTML = `<b>Tóm tắt</b><p class="muted small">Chọn ít nhất 1 hạng phòng để tiếp tục.</p>`; return; }
        try {
          const q = await API.post('/api/rooms/quote', {
            checkIn: state.checkIn, checkOut: state.checkOut, guests: state.guests,
            lines: state.lines.map((l) => ({ roomTypeId: l.roomTypeId, qty: l.qty, guests: l.guests || state.guests })),
            couponCode: state.coupon || undefined,
          });
          state.quote = q.quote;
          box.innerHTML = `
            <b style="font-size:16px">Tóm tắt kỳ nghỉ</b>
            <div class="tiny muted" style="margin:6px 0 12px">${UI.dmy(state.checkIn)} → ${UI.dmy(state.checkOut)} · ${q.quote.nights} đêm · ${state.guests} khách</div>
            ${q.quote.lines.map((l) => `<div class="row small" style="justify-content:space-between;margin:5px 0"><span>${l.qty}× ${UI.esc(l.room_type_name)}</span><b>${UI.vnd(l.total)}</b></div>`).join('')}
            ${q.quote.discount ? `<div class="row small" style="justify-content:space-between;color:var(--success)"><span>Mã ${UI.esc(state.coupon)}</span><b>−${UI.vnd(q.quote.discount)}</b></div>` : ''}
            ${q.quote.member_discount ? `<div class="row small" style="justify-content:space-between;color:var(--gold,#b8860b)"><span>${I18N.t('bk.member')} ${UI.esc(q.quote.member_tier_name || q.quote.member_tier)} (${q.quote.member_pct}%)</span><b>−${UI.vnd(q.quote.member_discount)}</b></div>` : ''}
            <div class="row small" style="justify-content:space-between"><span>${I18N.t('bk.fee')} (${q.quote.service_fee_pct}%)</span><b>${UI.vnd(q.quote.service_fee)}</b></div>
            <div class="row small" style="justify-content:space-between"><span>${I18N.t('bk.tax')} (${q.quote.tax_pct}%)</span><b>${UI.vnd(q.quote.tax)}</b></div>
            <div class="row" style="justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px dashed var(--sand)">
              <b>${I18N.t('bk.total')}</b><b style="font-size:22px;color:var(--pine);font-family:var(--f-display)">${UI.vnd(q.quote.total_amount)}</b></div>
            <button class="btn btn-gold btn-lg" style="width:100%;margin-top:16px" id="next1">Tiếp tục ${UI.ICONS.arrow}</button>`;
          document.getElementById('next1').onclick = () => { state.step = 2; render(); };
        } catch (e) {
          box.innerHTML = `<span class="err-text">${UI.esc(e.message)}</span>`;
        }
      }
      ['ci', 'co', 'gs'].forEach((id) => document.getElementById(id).onchange = () => {
        state.checkIn = document.getElementById('ci').value;
        state.checkOut = document.getElementById('co').value;
        state.guests = +document.getElementById('gs').value || 2;
        if (state.checkOut <= state.checkIn) state.checkOut = UI.addDays(state.checkIn, 1);
        document.getElementById('co').value = state.checkOut;
        loadTypes();
      });
      await loadTypes().catch(UI.errToast);
    }

    /* ---------- step 2: thông tin khách ---------- */
    function step2() {
      const u = API.getUser();
      el().innerHTML = `
        <div class="grid" style="grid-template-columns:1fr 340px;gap:26px;align-items:start">
          <div class="tst" style="padding:24px">
            <b style="font-size:17px">Thông tin người nhận phòng</b>
            <p class="tiny muted" style="margin:4px 0 16px">Thông tin này dùng để làm thủ tục check-in và gửi xác nhận.</p>
            <form id="gf" style="display:grid;gap:14px">
              <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px">
                <div class="field"><label>Họ và tên *</label><input class="input" name="guestName" required value="${UI.esc(state.guest.name || u?.user?.full_name || '')}"></div>
                <div class="field"><label>Số điện thoại *</label><input class="input" name="guestPhone" required placeholder="09xxxxxxxx" value="${UI.esc(state.guest.phone || u?.user?.phone || '')}"></div>
              </div>
              <div class="field"><label>Email nhận xác nhận *</label><input class="input" type="email" name="guestEmail" required value="${UI.esc(state.guest.email || u?.user?.email || '')}"></div>
              <div class="field"><label>Yêu cầu đặc biệt</label>
                <textarea class="input" name="specialRequest" rows="3" placeholder="VD: phòng tầng cao, thêm giường phụ, nhận phòng sớm…">${UI.esc(state.guest.request || '')}</textarea></div>
              <div class="field"><label>${I18N.t('bk.coupon')} (${I18N.t('rooms.all') === 'Tất cả' ? 'tuỳ chọn' : 'optional'})</label>
                <div class="row gap-8">
                  <input class="input" name="coupon" value="${UI.esc(state.coupon)}" placeholder="DALAT10" style="text-transform:uppercase">
                  <button class="btn btn-ghost" type="button" id="apply">${I18N.t('bk.apply')}</button>
                </div>
                <span class="field-hint" id="cpn-msg"></span></div>
            </form>
          </div>
          <aside class="tst" style="padding:20px">
            <b>Tóm tắt</b>
            <div class="small muted" style="margin:8px 0">${state.quote ? `${state.quote.lines.map((l) => `${l.qty}× ${l.room_type_name}`).join(', ')}<br>${UI.dmy(state.checkIn)} → ${UI.dmy(state.checkOut)}` : ''}</div>
            ${state.quote ? `<div class="row" style="justify-content:space-between"><b>${I18N.t('bk.total')}</b><b style="color:var(--pine);font-size:20px;font-family:var(--f-display)">${UI.vnd(state.quote.total_amount)}</b></div>` : ''}
            <div class="row gap-8" style="margin-top:18px">
              <button class="btn btn-ghost" id="back2">${UI.ICONS.arrowL} Quay lại</button>
              <button class="btn btn-gold" style="flex:1" id="next2">Tiếp tục</button>
            </div>
          </aside>
        </div>`;
      document.getElementById('back2').onclick = () => { state.step = 1; render(); };
      document.getElementById('apply').onclick = async () => {
        const f = Object.fromEntries(new FormData(document.getElementById('gf')));
        state.coupon = (f.coupon || '').trim().toUpperCase();
        const msg = document.getElementById('cpn-msg');
        try {
          const q = await API.post('/api/rooms/quote', {
            checkIn: state.checkIn, checkOut: state.checkOut, guests: state.guests,
            lines: state.lines, couponCode: state.coupon || undefined,
          });
          state.quote = q.quote;
          msg.innerHTML = `<span style="color:var(--success)">✓ ${UI.esc(q.quote.coupon.label)} — giảm ${UI.vnd(q.quote.discount)}</span>`;
          UI.toast('Đã áp dụng mã giảm giá', 'success');
          state.step = 2; render();
        } catch (e) { msg.innerHTML = `<span class="err-text">${UI.esc(e.message)}</span>`; state.coupon = ''; }
      };
      document.getElementById('next2').onclick = () => {
        const form = document.getElementById('gf');
        const f = Object.fromEntries(new FormData(form));
        // validate phía client cho phản hồi nhanh
        if (!f.guestName || f.guestName.trim().length < 2) return UI.toast('Vui lòng nhập họ tên', 'warning');
        if (!/^(\+?84|0)\d{8,10}$/.test(f.guestPhone.trim())) return UI.toast('Số điện thoại không hợp lệ', 'warning');
        if (!/^\S+@\S+\.\S+$/.test(f.guestEmail.trim())) return UI.toast('Email không hợp lệ', 'warning');
        state.guest = f;
        state.step = 3; render();
      };
    }

    /* ---------- step 3: xác nhận ---------- */
    function step3() {
      const q = state.quote;
      el().innerHTML = `
        <div class="grid" style="grid-template-columns:1fr 340px;gap:26px;align-items:start">
          <div class="tst" style="padding:24px">
            <b style="font-size:17px">Kiểm tra lại lần cuối</b>
            <table class="tbl" style="min-width:0;margin-top:14px">
              <tbody>
                <tr><td style="width:160px" class="muted">Kỳ nghỉ</td><td><b>${UI.dmy(state.checkIn)} → ${UI.dmy(state.checkOut)}</b> (${q.nights} đêm)</td></tr>
                <tr><td class="muted">Khách</td><td>${state.guests} khách</td></tr>
                ${q.lines.map((l) => `<tr><td class="muted">Phòng</td><td><b>${l.qty}× ${UI.esc(l.room_type_name)}</b>
                  <div class="tiny muted">${l.per_night.map((n) => `${UI.dmyShort(n.date)}: ${UI.vnd(n.unit_price)}${n.weekend ? ' (cuối tuần)' : ''}${n.rule_name ? ' · ' + n.rule_name : ''}`).join(' · ')}</div></td></tr>`).join('')}
                <tr><td class="muted">Người nhận phòng</td><td>${UI.esc(state.guest.guestName)} · ${UI.esc(state.guest.guestPhone)}<br><span class="tiny muted">${UI.esc(state.guest.guestEmail)}</span></td></tr>
                ${state.guest.specialRequest ? `<tr><td class="muted">Yêu cầu</td><td>${UI.esc(state.guest.specialRequest)}</td></tr>` : ''}
              </tbody>
            </table>
            <div style="margin-top:16px;padding:14px;background:var(--warn-bg);border-radius:10px" class="tiny">
              <b>Chính sách huỷ:</b> ${q.lines.map((l) => `${UI.esc(l.room_type_name)} — miễn phí trước ${l.policy?.cancel_free_hours ?? 48}h`).join(' · ')}
            </div>
            <label class="row gap-8 small" style="margin-top:16px;cursor:pointer">
              <input type="checkbox" id="agree" style="width:17px;height:17px"> Tôi đồng ý với điều khoản lưu trú và chính sách huỷ phòng
            </label>
          </div>
          <aside class="tst" style="padding:20px">
            <b>Chi tiết giá</b>
            <div class="row small" style="justify-content:space-between;margin-top:10px"><span>${I18N.t('bk.subtotal')}</span><b>${UI.vnd(q.subtotal)}</b></div>
            ${q.discount ? `<div class="row small" style="justify-content:space-between;color:var(--success)"><span>${I18N.t('bk.discount')}</span><b>−${UI.vnd(q.discount)}</b></div>` : ''}
            ${q.member_discount ? `<div class="row small" style="justify-content:space-between;color:var(--gold,#b8860b)"><span>${I18N.t('bk.member')} ${UI.esc(q.member_tier_name || q.member_tier)} (${q.member_pct}%)</span><b>−${UI.vnd(q.member_discount)}</b></div>` : ''}
            <div class="row small" style="justify-content:space-between"><span>${I18N.t('bk.fee')}</span><b>${UI.vnd(q.service_fee)}</b></div>
            <div class="row small" style="justify-content:space-between"><span>${I18N.t('bk.tax')}</span><b>${UI.vnd(q.tax)}</b></div>
            <div class="row" style="justify-content:space-between;margin-top:12px;padding-top:12px;border-top:1px dashed var(--sand)">
              <b>${I18N.t('bk.payTotal')}</b><b style="font-size:22px;color:var(--pine);font-family:var(--f-display)">${UI.vnd(q.total_amount)}</b></div>
            <div class="row gap-8" style="margin-top:18px">
              <button class="btn btn-ghost" id="back3">${UI.ICONS.arrowL}</button>
              <button class="btn btn-gold" style="flex:1" id="create">Xác nhận đặt phòng</button>
            </div>
            <p class="tiny muted center" style="margin-top:10px">Giữ chỗ 15 phút — chưa trừ tiền</p>
          </aside>
        </div>`;
      document.getElementById('back3').onclick = () => { state.step = 2; render(); };
      document.getElementById('create').onclick = async (btn) => {
        if (!document.getElementById('agree').checked) return UI.toast('Vui lòng đồng ý điều khoản để tiếp tục', 'warning');
        const b = document.getElementById('create');
        b.disabled = true; b.innerHTML = '<span class="spinner"></span> Đang giữ chỗ…';
        try {
          const res = await API.post('/api/bookings', {
            checkIn: state.checkIn, checkOut: state.checkOut, guests: state.guests,
            lines: state.lines,
            guestName: state.guest.guestName, guestPhone: state.guest.guestPhone,
            guestEmail: state.guest.guestEmail, specialRequest: state.guest.specialRequest || null,
            couponCode: state.coupon || null,
            clientExpectedTotal: state.quote.total_amount,
          }, { idempotencyKey: state.idemKey });
          state.booking = res.booking;
          if (res.price_warning) UI.toast(res.price_warning, 'warning', 'Giá đã thay đổi');
          if (res.replayed) UI.toast('Yêu cầu trùng lặp đã được bỏ qua', 'info');
          state.step = 4; render();
        } catch (e) {
          UI.errToast(e);
          if (e.code === 'CONFLICT' || e.code === 'ALREADY_BOOKED') { state.step = 1; render(); }
        } finally { b.disabled = false; b.textContent = 'Xác nhận đặt phòng'; }
      };
    }

    /* ---------- step 4: thanh toán ---------- */
    async function step4() {
      const bk = state.booking;
      el().innerHTML = `
        <div class="center" style="max-width:640px;margin:auto">
          <div class="badge badge-success" style="font-size:14px;padding:9px 18px">${UI.ICONS.check} Đã giữ chỗ thành công</div>
          <h2 style="margin-top:16px">Mã đặt phòng <span class="mono" style="color:var(--gold)">${UI.esc(bk.code)}</span></h2>
          <p class="muted small">Giữ chỗ đến <b class="mono" id="hold"></b>. Thanh toán để xác nhận chính thức.</p>
          <div class="row gap-12" style="justify-content:center;margin:22px 0;flex-wrap:wrap" id="pvs"></div>
          <div id="paybox"></div>
          <div class="row gap-8" style="justify-content:center;margin-top:16px">
            <a class="btn btn-ghost btn-sm" href="#/booking/${bk.id}">Để sau, xem chi tiết</a>
          </div>
        </div>`;
      startHoldCountdown(bk.timeline.hold_expires_at, document.getElementById('hold'));

      const providers = await API.get('/api/payments/providers');
      const pvIcons = { VIETQR: 'qr', MOMO: 'wallet', VNPAY: 'wallet', CARD: 'wallet', CASH: 'wallet', MANUAL: 'qr' };
      document.getElementById('pvs').innerHTML = providers.providers.map((p, i) => `
        <button class="btn ${i === 0 ? 'btn-gold' : 'btn-ghost'}" data-p="${p.id}">${UI.ICONS[pvIcons[p.id]] || 'wallet'} ${UI.esc(p.name)}</button>`).join('');
      document.querySelectorAll('[data-p]').forEach((b) => b.onclick = async () => {
        document.querySelectorAll('[data-p]').forEach((x) => x.className = 'btn btn-ghost');
        b.className = 'btn btn-gold';
        await startPayment(bk.id, b.dataset.p, document.getElementById('paybox'), () => { state.step = 5; render(); });
      });
      // mặc định VietQR
      document.querySelector('[data-p="VIETQR"]')?.click();
    }

    /* ---------- step 5: hoàn tất ---------- */
    function step5() {
      const bk = state.booking;
      el().innerHTML = `
        <div class="center" style="max-width:620px;margin:auto;padding:20px 0">
          <div style="width:86px;height:86px;margin:auto;border-radius:50%;background:var(--success-bg);display:grid;place-items:center;color:var(--success);animation:zoomIn .5s var(--ease)">
            <span style="width:40px;height:40px">${UI.ICONS.check}</span></div>
          <h2 style="margin-top:20px">Thanh toán thành công!</h2>
          <p class="muted">Phòng của bạn đã được xác nhận. Mã đặt phòng
            <b class="mono" style="color:var(--pine);font-size:19px">${UI.esc(bk.code)}</b></p>
          <div class="tst" style="text-align:left;margin:24px 0;padding:20px">
            <div class="row small" style="justify-content:space-between"><span class="muted">Kỳ nghỉ</span><b>${UI.dmy(bk.check_in)} → ${UI.dmy(bk.check_out)}</b></div>
            <div class="row small" style="justify-content:space-between;margin-top:6px"><span class="muted">Phòng</span><b>${bk.lines.map((l) => `${l.qty}× ${l.room_type_name}`).join(', ')}</b></div>
            <div class="row small" style="justify-content:space-between;margin-top:6px"><span class="muted">Đã thanh toán</span><b style="color:var(--success)">${UI.vnd(bk.money.paid)}</b></div>
          </div>
          <div class="row gap-12" style="justify-content:center;flex-wrap:wrap">
            <a class="btn btn-primary" href="#/booking/${bk.id}">Xem chi tiết &amp; in voucher</a>
            <a class="btn btn-gold" href="/api/bookings/${bk.id}/voucher.pdf" target="_blank" rel="noopener">${UI.ICONS.download} ${I18N.t('bk.voucher')}</a>
            <a class="btn btn-ghost" href="#/my-bookings">${I18N.t('bk.myTitle')}</a>
          </div>
          <p class="tiny muted" style="margin-top:14px">Email xác nhận kèm voucher PDF đã được gửi tới <b>${UI.esc(bk.guest?.email || '')}</b>.</p>
        </div>`;
      el().insertAdjacentHTML('beforeend', `<style>@keyframes zoomIn{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}</style>`);
    }

    function render() {
      renderSteps();
      ({ 1: step1, 2: step2, 3: step3, 4: step4, 5: step5 })[state.step]();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    render();
  }

  /* ---------- countdown giữ chỗ ---------- */
  function startHoldCountdown(isoStr, target) {
    if (!isoStr || !target) return () => {};
    const end = new Date(isoStr.replace(' ', 'T') + 'Z').getTime();
    const tick = () => {
      const left = end - Date.now();
      if (left <= 0) { target.textContent = 'ĐÃ HẾT HẠN'; target.style.color = 'var(--danger)'; return; }
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      target.textContent = `${m}:${String(s).padStart(2, '0')}`;
      target.style.color = left < 3 * 60000 ? 'var(--danger)' : left < 6 * 60000 ? 'var(--warn)' : '';
    };
    tick();
    const t = setInterval(tick, 1000);
    G._cleanup.push(() => clearInterval(t));
    return () => clearInterval(t);
  }

  /* ---------- QR payment box + polling ---------- */
  async function startPayment(bookingId, provider, box, onPaid) {
    box.innerHTML = `<div class="center muted small"><span class="spinner" style="border-color:var(--sand);border-top-color:var(--pine);width:22px;height:22px;border-radius:50%;border-width:2.5px;border-style:solid;display:inline-block;animation:spin .7s linear infinite"></span> Đang tạo mã thanh toán…</div>`;
    let payment;
    try {
      const r = await API.post('/api/payments', { bookingId, provider });
      payment = r.payment;
    } catch (e) { box.innerHTML = `<span class="err-text">${UI.esc(e.message)}</span>`; return; }

    if (provider === 'VIETQR' || provider === 'MANUAL') {
      box.innerHTML = `
        <div class="qr-box">
          <div class="qr-frame"><img src="${payment.qr_image}" alt="Mã QR VietQR"><div class="qr-scan"></div></div>
          <div class="countdown" id="qr-cd">--:--</div>
          <div class="tiny muted">Mã QR hết hạn sau thời gian trên</div>
          <div style="margin:16px auto 0;max-width:400px;display:flex;flex-direction:column;gap:8px">
            <div class="bank-line">${UI.ICONS.wallet}<div style="text-align:left"><b>${UI.esc(payment.bank.bank_name)}</b><br><span class="mono">${UI.esc(payment.bank.account_number)}</span> · ${UI.esc(payment.bank.account_name)}</div>
              <button class="copy-btn" data-c="${UI.esc(payment.bank.account_number)}">Sao chép</button></div>
            <div class="bank-line">${UI.ICONS.spark}<div style="text-align:left">Số tiền<br><b style="font-size:17px;color:var(--pine)">${UI.vnd(payment.amount)}</b></div>
              <button class="copy-btn" data-c="${payment.amount}">Sao chép</button></div>
            <div class="bank-line">${UI.ICONS.edit}<div style="text-align:left">Nội dung CK (bắt buộc)<br><b class="mono">${UI.esc(payment.transfer_content)}</b></div>
              <button class="copy-btn" data-c="${UI.esc(payment.transfer_content)}">Sao chép</button></div>
          </div>
          <p class="tiny muted" style="margin-top:14px;max-width:420px;margin-inline:auto">
            Mở app ngân hàng / MoMo / ZaloPay, quét mã và chuyển <b>đúng số tiền + nội dung</b>.
            Hệ thống tự xác nhận trong vài giây sau khi nhận tiền.</p>
          <div class="row gap-8" style="justify-content:center;margin-top:12px">
            ${payment.qr_url ? `<a class="btn btn-ghost btn-sm" href="${UI.esc(payment.qr_url)}" target="_blank" rel="noopener">Mở QR VietQR chính chủ</a>` : ''}
            <button class="btn btn-ghost btn-sm" id="recheck">${UI.ICONS.refresh || UI.ICONS.spark} Kiểm tra lại</button>
          </div>
          <div id="pay-status" class="small" style="margin-top:10px"></div>
        </div>`;
      box.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => UI.copy(b.dataset.c));
      startHoldCountdown(payment.expired_at, document.getElementById('qr-cd'));

      // REALTIME: server ĐẨY trạng thái qua SSE ngay khi webhook tới.
      // Polling 5s chỉ là fallback phòng khi SSE bị chặn bởi proxy/mạng.
      let settled = false, pollTimer = null, es = null;
      const stEl = () => document.getElementById('pay-status');
      const settle = (html, paid) => {
        if (settled) return; settled = true;
        if (pollTimer) clearInterval(pollTimer);
        if (es) es.close();
        if (stEl()) stEl().innerHTML = html;
        if (paid) setTimeout(onPaid, 900);
      };
      const poll = async () => {
        try {
          const s2 = await API.get(`/api/payments/${payment.id}/status`);
          if (s2.payment.status === 'PAID') return settle(`<span class="badge badge-success">${UI.ICONS.check} Đã nhận thanh toán!</span>`, true);
          if (['EXPIRED', 'FAILED'].includes(s2.payment.status)) return settle('<span class="badge badge-danger">Mã đã hết hạn — tạo mã mới</span>', false);
          if (stEl()) stEl().innerHTML = '<span class="muted">Đang chờ ngân hàng xác nhận…</span>';
        } catch { /* lỗi mạng thoáng qua: bỏ qua */ }
      };
      try {
        es = new EventSource(`/api/payments/${payment.id}/stream`);
        es.addEventListener('status', (e) => {
          let ev; try { ev = JSON.parse(e.data); } catch { return; }
          if (ev.status === 'PAID') settle(`<span class="badge badge-success">${UI.ICONS.check} Đã nhận thanh toán!</span>`, true);
          else if (['EXPIRED', 'FAILED'].includes(ev.status)) settle('<span class="badge badge-danger">Mã đã hết hạn — tạo mã mới</span>', false);
        });
      } catch { es = null; }
      pollTimer = setInterval(poll, 5000);
      G._cleanup.push(() => { if (pollTimer) clearInterval(pollTimer); if (es) es.close(); });
      document.getElementById('recheck').onclick = poll;
    } else {
      // Mock các cổng khác
      box.innerHTML = `
        <div class="tst" style="padding:22px;text-align:left">
          <b>${UI.esc(provider)} — môi trường mô phỏng</b>
          <p class="muted small" style="margin:8px 0 14px">Ở môi trường thật, bước này sẽ chuyển bạn tới cổng thanh toán của ${UI.esc(provider)}.
             Ở bản demo, bấm nút bên dưới để giả lập giao dịch thành công (có chữ ký webhook hợp lệ).</p>
          <div class="row small" style="justify-content:space-between;background:var(--cream);padding:10px 14px;border-radius:10px">
            <span>Số tiền</span><b>${UI.vnd(payment.amount)}</b></div>
          <button class="btn btn-gold" style="width:100%;margin-top:14px" id="sim">${UI.ICONS.check} Giả lập thanh toán thành công</button>
          <div id="pay-status" class="small center" style="margin-top:10px"></div>
        </div>`;
      document.getElementById('sim').onclick = async (e) => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Đang xử lý…';
        try {
          await API.post('/api/payments/simulate/success', { paymentId: payment.id });
          document.getElementById('pay-status').innerHTML = `<span class="badge badge-success">Thanh toán thành công</span>`;
          setTimeout(onPaid, 800);
        } catch (err) { UI.errToast(err); b.disabled = false; b.textContent = 'Thử lại'; }
      };
    }
  }

  /* ================= MY BOOKINGS ================= */
  async function myBookings(params) {
    const main = document.getElementById('main');
    if (!API.getUser()) { G.openAuth('login', '#/my-bookings'); return; }
    main.innerHTML = `<div style="height:var(--nav-h)"></div>
      <section class="section" style="padding-top:40px"><div class="wrap">
        <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div><span class="kicker">Của tôi</span><h1 style="font-size:clamp(28px,4vw,40px)">Đặt phòng của tôi</h1></div>
          <a class="btn btn-gold" href="#/book">Đặt phòng mới</a>
        </div>
        <div class="row gap-8" style="margin:20px 0;flex-wrap:wrap" id="tabs">
          ${[['', I18N.t('bk.tabAll')], ['CONFIRMED', I18N.t('bk.tabUp')], ['PENDING', I18N.t('st.PENDING')], ['COMPLETED', I18N.t('bk.tabDone')], ['CANCELLED', I18N.t('st.CANCELLED')]]
            .map(([v, l]) => `<button class="btn btn-sm ${params.status === v ? 'btn-primary' : 'btn-ghost'}" data-s="${v}">${l}</button>`).join('')}
        </div>
        <div id="bl" style="display:flex;flex-direction:column;gap:14px">${UI.skeletonCards(3)}</div>
      </div></section>`;
    document.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => {
      const s = b.dataset.s;
      location.hash = s ? `#/my-bookings?status=${s}` : '#/my-bookings';
    });
    async function load() {
      const d = await API.get('/api/bookings', { query: { status: params.status || '', limit: 20 } });
      document.getElementById('bl').innerHTML = d.items.length ? d.items.map((b) => bookingRow(b)).join('') : `
        <div class="tst center" style="padding:50px"><b>${I18N.t('bk.noBookings')}</b>
        <p class="muted small">${I18N.t('bk.startFirst')}</p>
        <a class="btn btn-gold" href="#/rooms" style="margin-top:12px">${I18N.t('bk.explore')}</a></div>`;
      document.querySelectorAll('[data-open]').forEach((a) => a.onclick = () => location.hash = `#/booking/${a.dataset.open}`);
      document.querySelectorAll('[data-pay]').forEach((a) => a.onclick = () => openPayModal(a.dataset.pay));
      document.querySelectorAll('[data-cancel]').forEach((a) => a.onclick = () => cancelFlow(a.dataset.cancel));
      C.decorate(main);
    }
    await load().catch(UI.errToast);
  }

  function bookingRow(b) {
    return `
    <div class="tst" style="padding:18px;display:flex;gap:18px;align-items:center;flex-wrap:wrap" data-reveal>
      <img src="${UI.esc((b.lines?.[0]?.images?.[0]) || '/img/room-deluxe.jpg')}" style="width:104px;height:74px;object-fit:cover;border-radius:12px" alt="">
      <div style="flex:1;min-width:200px">
        <div class="row gap-12" style="flex-wrap:wrap"><b class="mono">${UI.esc(b.code)}</b>${UI.statusBadge(b.status)}</div>
        <div class="small muted" style="margin-top:4px">${UI.dmy(b.check_in)} → ${UI.dmy(b.check_out)} · ${b.nights} đêm · ${b.lines?.map((l) => `${l.qty}× ${UI.esc(I18N.lang() === 'en' && l.name_en ? l.name_en : l.name_vi)}`).join(', ')}</div>
      </div>
      <div style="text-align:right;min-width:120px">
        <b style="font-size:18px;font-family:var(--f-display)">${UI.vnd(b.total_amount)}</b>
        <div class="tiny muted">${b.paid_amount >= b.total_amount ? I18N.t('bk.paidFull') : b.paid_amount ? I18N.t('bk.paidAmt', { x: UI.vnd(b.paid_amount) }) : I18N.t('bk.unpaid')}</div>
      </div>
      <div class="row gap-8">
        ${b.status === 'PENDING' ? `<button class="btn btn-gold btn-sm" data-pay="${b.id}">Thanh toán</button>` : ''}
        ${['PENDING', 'CONFIRMED'].includes(b.status) ? `<button class="btn btn-ghost btn-sm" data-cancel="${b.id}">Huỷ</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-open="${b.id}">Chi tiết</button>
      </div>
    </div>`;
  }

  /* ================= BOOKING DETAIL ================= */
  async function bookingDetail(id) {
    const main = document.getElementById('main');
    if (!API.getUser()) { G.openAuth('login', `#/booking/${id}`); return; }
    let bk;
    try { bk = (await API.get(`/api/bookings/${id}`)).booking; }
    catch (e) { main.innerHTML = `<div style="height:var(--nav-h)"></div><section class="section"><div class="wrap center"><h2>${UI.esc(e.message)}</h2><a class="btn btn-primary" href="#/my-bookings" style="margin-top:16px">Về danh sách</a></div></section>`; return; }

    main.innerHTML = `<div style="height:var(--nav-h)"></div>
      <section class="section" style="padding-top:40px"><div class="wrap" style="max-width:1000px">
        <div class="row no-print" style="justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div><a class="tiny muted" href="#/my-bookings">← ${I18N.t('bk.myTitle')}</a>
            <h1 style="font-size:clamp(26px,3.6vw,38px);margin-top:4px">${I18N.t('bk.code')} <span class="mono">${UI.esc(bk.code)}</span></h1></div>
          <div class="row gap-8 no-print">
            <button class="btn btn-ghost btn-sm" id="print">${UI.ICONS.print} ${I18N.t('bk.print')}</button>
            <a class="btn btn-ghost btn-sm" href="/api/bookings/${bk.id}/voucher.pdf" target="_blank" rel="noopener">${UI.ICONS.download} PDF</a>
            ${['PENDING', 'CONFIRMED'].includes(bk.status) ? `<button class="btn btn-ghost btn-sm" id="cx">${I18N.t('bk.cancelRoom')}</button>` : ''}
            ${bk.status === 'PENDING' ? `<button class="btn btn-gold btn-sm" id="pay">${I18N.t('bk.pay', { x: UI.vnd(bk.money.outstanding) })}</button>` : ''}
          </div>
        </div>
        <div class="row gap-12" style="margin:10px 0 22px">${UI.statusBadge(bk.status)}
          ${bk.status === 'PENDING' ? `<span class="tiny muted">${I18N.t('bk.hold')} <b class="mono" id="hold2"></b></span>` : ''}</div>

        <div class="grid" style="grid-template-columns:1.4fr 1fr;gap:22px;align-items:start" id="bd">
          <div style="display:flex;flex-direction:column;gap:18px">
            <div class="tst" style="padding:22px">
              <b style="font-size:16px">Kỳ nghỉ</b>
              <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;text-align:center">
                <div style="background:var(--cream);border-radius:12px;padding:12px"><div class="tiny muted">Nhận phòng</div><b>${UI.dmy(bk.check_in)}</b><div class="tiny muted">từ 14:00</div></div>
                <div style="background:var(--cream);border-radius:12px;padding:12px"><div class="tiny muted">Trả phòng</div><b>${UI.dmy(bk.check_out)}</b><div class="tiny muted">trước 12:00</div></div>
                <div style="background:var(--cream);border-radius:12px;padding:12px"><div class="tiny muted">Thời gian</div><b>${bk.nights} đêm</b><div class="tiny muted">${bk.guests} khách</div></div>
              </div>
              ${bk.rooms?.length ? `
              <div style="margin-top:16px"><b class="small">Phòng được xếp</b>
                <div class="row gap-8" style="flex-wrap:wrap;margin-top:8px">
                  ${[...new Set(bk.rooms.map((r) => r.room_number))].map((n) => `<span class="chip" style="background:var(--pine);color:#fff;padding:7px 13px">${UI.ICONS.key} Phòng ${UI.esc(n)}</span>`).join('')}
                </div></div>` : '<p class="tiny muted" style="margin-top:12px">Phòng cụ thể sẽ được xếp khi check-in.</p>'}
              ${bk.guest.request ? `<p class="small" style="margin-top:14px"><b>Yêu cầu:</b> ${UI.esc(bk.guest.request)}</p>` : ''}
            </div>

            <div class="tst" style="padding:22px">
              <b style="font-size:16px">${I18N.t('bk.priceDetail')}</b>
              <table class="tbl" style="min-width:0;margin-top:10px"><tbody>
                ${bk.lines.map((l) => `<tr><td>${l.qty}× ${UI.esc(I18N.lang() === 'en' && l.name_en ? l.name_en : l.room_type_name)}</td><td class="num">${UI.vnd(l.line_total)}</td></tr>`).join('')}
                ${bk.money.discount ? `<tr><td style="color:var(--success)">Mã ${UI.esc(bk.coupon_code)}</td><td class="num" style="color:var(--success)">−${UI.vnd(bk.money.discount)}</td></tr>` : ''}
                ${bk.money.member_discount ? `<tr><td style="color:#b8860b">${I18N.t('bk.member')}</td><td class="num" style="color:#b8860b">−${UI.vnd(bk.money.member_discount)}</td></tr>` : ''}
                <tr><td>${I18N.t('bk.fee')}</td><td class="num">${UI.vnd(bk.money.service_fee)}</td></tr>
                <tr><td>${I18N.t('bk.tax')}</td><td class="num">${UI.vnd(bk.money.tax)}</td></tr>
                <tr><td><b>${I18N.t('bk.total')}</b></td><td class="num"><b>${UI.vnd(bk.money.total)}</b></td></tr>
                <tr><td style="color:var(--success)">Đã thanh toán</td><td class="num" style="color:var(--success)">${UI.vnd(bk.money.paid)}</td></tr>
                ${bk.money.refunded ? `<tr><td>${I18N.t('bk.refunded')}</td><td class="num">${UI.vnd(bk.money.refunded)}</td></tr>` : ''}
              </tbody></table>
              <details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Xem giá từng đêm</summary>
                <div class="tiny" style="margin-top:8px">${(bk.breakdown || []).map((l) => `<b>${UI.esc(l.room_type_name)}</b><br>` + (l.per_night || []).map((n) => `${UI.dmyShort(n.date)}: ${UI.vnd(n.unit_price)}${n.weekend ? ' (cuối tuần)' : ''}`).join(' · ')).join('<br>')}</div>
              </details>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:18px">
            <div class="tst" style="padding:22px">
              <b style="font-size:16px">Khách nhận phòng</b>
              <div class="small" style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
                <span>${UI.esc(bk.guest.name)}</span>
                <span class="muted">${UI.esc(bk.guest.phone)}</span>
                <span class="muted">${UI.esc(bk.guest.email)}</span>
              </div>
            </div>
            <div class="tst" style="padding:22px">
              <b style="font-size:16px">Lịch sử thanh toán</b>
              <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
                ${bk.payments?.length ? bk.payments.map((p) => `
                  <div class="row small" style="justify-content:space-between;background:var(--cream);padding:9px 12px;border-radius:10px">
                    <span>${p.type === 'REFUND' ? 'Hoàn tiền' : 'Thanh toán'} · ${p.provider}</span>
                    <span><b>${UI.vnd(p.amount)}</b> ${UI.statusBadge(p.status === 'PAID' ? 'COMPLETED' : p.status === 'PENDING' ? 'PENDING' : 'CANCELLED')}</span>
                  </div>`).join('') : '<p class="muted small">Chưa có giao dịch.</p>'}
              </div>
            </div>
            <div class="tst" style="padding:22px">
              <b style="font-size:16px">Hành trình đơn</b>
              <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px" class="tiny">
                ${[['Tạo đặt phòng', bk.timeline.created_at], ['Xác nhận', bk.timeline.confirmed_at], ['Nhận phòng', bk.timeline.checkin_at], ['Hoàn tất', bk.timeline.checkout_at], ['Huỷ', bk.timeline.cancelled_at]]
                  .filter(([, v]) => v).map(([l, v]) => `<div class="row gap-8"><span style="width:8px;height:8px;border-radius:50%;background:var(--success);flex:none"></span><span>${l}</span><span class="right muted">${UI.dtVN(v)}</span></div>`).join('')}
                ${bk.timeline.cancel_reason ? `<div class="tiny muted">Lý do huỷ: ${UI.esc(bk.timeline.cancel_reason)}</div>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div></section>`;

    document.getElementById('print')?.addEventListener('click', () => window.print());
    document.getElementById('pay')?.addEventListener('click', () => openPayModal(bk.id, () => bookingDetail(bk.id)));
    document.getElementById('cx')?.addEventListener('click', () => cancelFlow(bk.id, () => bookingDetail(bk.id)));
    if (bk.status === 'PENDING') startHoldCountdown(bk.timeline.hold_expires_at, document.getElementById('hold2'));
    C.decorate(main);
  }

  /* ================= PAY MODAL ================= */
  function openPayModal(bookingId, onDone) {
    const m = UI.modal({ title: 'Thanh toán', wide: true, body: `<div id="pm"><div class="center muted">Đang tải…</div></div>` });
    (async () => {
      const bk = (await API.get(`/api/bookings/${bookingId}`)).booking;
      const providers = await API.get('/api/payments/providers');
      m.$('#pm').innerHTML = `
        <div class="row" style="justify-content:space-between;background:var(--cream);padding:14px 16px;border-radius:12px">
          <div><b>${UI.esc(bk.code)}</b><div class="tiny muted">${UI.dmy(bk.check_in)} → ${UI.dmy(bk.check_out)}</div></div>
          <div style="text-align:right"><div class="tiny muted">Cần thanh toán</div><b style="font-size:20px;color:var(--pine)">${UI.vnd(bk.money.outstanding)}</b></div>
        </div>
        <div class="row gap-8" style="margin:14px 0;flex-wrap:wrap" id="pvm">
          ${providers.providers.map((p, i) => `<button class="btn btn-sm ${i === 0 ? 'btn-gold' : 'btn-ghost'}" data-p="${p.id}">${UI.esc(p.name)}</button>`).join('')}
        </div>
        <div id="pvbox"></div>`;
      m.$$('[data-p]').forEach((b) => b.onclick = () => {
        m.$$('[data-p]').forEach((x) => x.className = 'btn btn-sm btn-ghost');
        b.className = 'btn btn-sm btn-gold';
        startPayment(bookingId, b.dataset.p, m.$('#pvbox'), () => {
          m.close();
          UI.toast('Thanh toán thành công! Phòng đã được xác nhận.', 'success');
          onDone ? onDone() : (location.hash = `#/booking/${bookingId}`);
        });
      });
      m.$('[data-p="VIETQR"]').click();
    })().catch((e) => { m.$('#pm').innerHTML = `<span class="err-text">${UI.esc(e.message)}</span>`; });
  }

  /* ================= CANCEL FLOW ================= */
  async function cancelFlow(bookingId, onDone) {
    let info;
    try { info = await API.get(`/api/bookings/${bookingId}/cancel-policy`); }
    catch (e) { return UI.errToast(e); }
    const r = info.refund_if_cancel_now;
    const m = UI.modal({
      title: I18N.t('bk.cancel'),
      body: `
        <div style="padding:14px 16px;border-radius:12px;background:${r.eligible ? 'var(--warn-bg)' : 'var(--danger-bg)'}">
          <b>${UI.esc(r.message)}</b>
          <div class="row" style="justify-content:space-between;margin-top:10px" class="small">
            <span class="small">Tiền sẽ hoàn về tài khoản</span>
            <b style="font-size:19px;color:${r.eligible ? 'var(--success)' : 'var(--danger)'}">${UI.vnd(r.refund_amount)}</b></div>
          ${r.penalty ? `<div class="row small" style="justify-content:space-between"><span>Phí huỷ</span><b style="color:var(--danger)">−${UI.vnd(r.penalty)}</b></div>` : ''}
          <div class="tiny muted" style="margin-top:6px">Còn ${Math.max(0, Math.round(info.hours_until_checkin))} giờ nữa đến giờ nhận phòng.</div>
        </div>
        <div class="field" style="margin-top:16px"><label>Lý do huỷ (tuỳ chọn)</label>
          <textarea class="input" id="rs" rows="2" placeholder="VD: đổi kế hoạch công tác…"></textarea></div>`,
      footer: `<button class="btn btn-ghost" data-no>Giữ phòng</button><button class="btn btn-danger" data-yes>Xác nhận huỷ</button>`,
    });
    m.$('[data-no]').onclick = () => m.close();
    m.$('[data-yes]').onclick = async () => {
      const btn = m.$('[data-yes]'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Đang huỷ…';
      try {
        const res = await API.post(`/api/bookings/${bookingId}/cancel`, { reason: m.$('#rs').value || undefined });
        m.close();
        UI.toast(res.refund.eligible ? `Đã huỷ. Sẽ hoàn ${UI.vnd(res.refund.refund_amount)}.` : 'Đã huỷ đặt phòng.', 'success', 'Huỷ thành công');
        onDone ? onDone() : (location.hash = `#/booking/${bookingId}`);
      } catch (e) { UI.errToast(e); btn.disabled = false; btn.textContent = 'Xác nhận huỷ'; }
    };
  }

  /* ================= REVIEW FORM ================= */
  async function reviewsEligible() {
    const main = document.getElementById('main');
    if (!API.getUser()) { G.openAuth('login', '#/reviews-eligible'); return; }
    const d = await API.get('/api/reviews/eligible');
    main.innerHTML = `<div style="height:var(--nav-h)"></div>
      <section class="section" style="padding-top:40px"><div class="wrap" style="max-width:860px">
        <span class="kicker">Cảm ơn bạn</span><h1 style="font-size:clamp(28px,4vw,40px)">Viết đánh giá kỳ nghỉ</h1>
        <p class="muted small">Chỉ những kỳ nghỉ đã hoàn tất mới hiện ở đây. Mỗi phòng trong đơn được đánh giá một lần.</p>
        <div style="display:flex;flex-direction:column;gap:14px;margin-top:22px">
          ${d.items.length ? d.items.map((it) => `
            <div class="tst" style="padding:18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
              <img src="${UI.esc((it.images || ['/img/room-deluxe.jpg'])[0])}" style="width:96px;height:68px;object-fit:cover;border-radius:10px" alt="">
              <div style="flex:1;min-width:180px"><b>${UI.esc(it.name_vi)}</b>
                <div class="tiny muted">${UI.esc(it.code)} · ${UI.dmy(it.check_in)} → ${UI.dmy(it.check_out)}</div></div>
              ${it.reviewed ? '<span class="badge badge-success">Đã đánh giá</span>' : `<button class="btn btn-gold btn-sm" data-rv="${it.booking_id}|${it.room_type_id}">Viết đánh giá</button>`}
            </div>`).join('') : '<div class="tst center" style="padding:40px"><p class="muted">Bạn chưa có kỳ nghỉ nào cần đánh giá.</p></div>'}
        </div>
      </div></section>`;
    main.querySelectorAll('[data-rv]').forEach((b) => b.onclick = () => {
      const [bid, rtid] = b.dataset.rv.split('|');
      const m = UI.modal({
        title: 'Đánh giá của bạn',
        body: `<form id="rf" style="display:grid;gap:14px">
          <div class="field"><label>Chấm điểm</label>
            <div class="row gap-8" id="stars" style="font-size:30px;color:var(--sand);cursor:pointer">
              ${[1, 2, 3, 4, 5].map((i) => `<span data-v="${i}">★</span>`).join('')}</div></div>
          <div class="field"><label>Tiêu đề</label><input class="input" name="title" maxlength="120" placeholder="VD: Kỳ nghỉ đáng nhớ"></div>
          <div class="field"><label>Nội dung *</label><textarea class="input" name="content" rows="5" minlength="20" required placeholder="Chia sẻ trải nghiệm của bạn (tối thiểu 20 ký tự)…"></textarea></div>
          <button class="btn btn-gold" type="submit">Gửi đánh giá</button></form>`,
      });
      let rating = 0;
      m.$$('#stars span').forEach((s) => s.onclick = () => {
        rating = +s.dataset.v;
        m.$$('#stars span').forEach((x, i) => x.style.color = i < rating ? 'var(--gold)' : 'var(--sand)');
      });
      m.$('#rf').onsubmit = async (e) => {
        e.preventDefault();
        if (!rating) return UI.toast('Vui lòng chấm điểm', 'warning');
        const f = Object.fromEntries(new FormData(e.target));
        try {
          const res = await API.post('/api/reviews', { bookingId: bid, roomTypeId: rtid, rating, title: f.title, content: f.content });
          m.close(); UI.toast(res.message, 'success');
          setTimeout(() => location.reload(), 800);
        } catch (err) { UI.errToast(err); }
      };
    });
    C.decorate(main);
  }

  return { book, myBookings, bookingDetail, openPayModal, cancelFlow, reviewsEligible, startHoldCountdown };
})();

window.B = B;
