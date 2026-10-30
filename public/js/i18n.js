/* ============================================================================
   I18N — đa ngôn ngữ vi/en cho SPA khách (không thư viện ngoài)
   - t('key', {var}) : dịch chuỗi, hỗ trợ biến {var}
   - setLang(l)      : đổi ngôn ngữ, lưu localStorage, bắn event 'lang:change'
   - applyStatic()   : dịch mọi phần tử có [data-i18n] trong DOM tĩnh (nav…)
   - roomName/roomDesc/amen: chọn nội dung vi/en cho dữ liệu từ DB
   ========================================================================== */
const I18N = (() => {
  const DICT = {
    vi: {
      'nav.home': 'Trang chủ', 'nav.rooms': 'Phòng & Giá', 'nav.exp': 'Trải nghiệm', 'nav.mybookings': 'Đặt phòng của tôi',
      'hdr.login': 'Đăng nhập', 'hdr.booknow': 'Đặt phòng ngay', 'hdr.admin': 'Quản trị',
      'hdr.menu.my': 'Đặt phòng của tôi', 'hdr.menu.review': 'Viết đánh giá', 'hdr.menu.account': 'Tài khoản & bảo mật',
      'hdr.menu.admin': 'Trang quản trị', 'hdr.menu.logout': 'Đăng xuất',
      'hdr.role.admin': 'Quản trị viên', 'hdr.role.staff': 'Nhân viên', 'hdr.role.member': 'Thành viên',
      'hdr.bye': 'Đã đăng xuất. Hẹn gặp lại!',
      'foot.tagline': 'Khách sạn boutique giữa rừng thông Đà Lạt — nơi mỗi kỳ nghỉ là một lần chạm vào mây.',
      'foot.explore': 'Khám phá', 'foot.support': 'Hỗ trợ', 'foot.contact': 'Liên hệ', 'foot.deals': 'Nhận ưu đãi',
      'foot.allrooms': 'Tất cả phòng', 'foot.experience': 'Trải nghiệm & tiện ích', 'foot.reviews': 'Đánh giá khách ở',
      'foot.fav': 'Phòng được yêu thích', 'foot.cancel': 'Chính sách huỷ phòng', 'foot.faq': 'Câu hỏi thường gặp',
      'foot.manage': 'Quản lý đặt phòng', 'foot.staff': 'Dành cho nhân viên',
      'foot.newsPh': 'Email của bạn', 'foot.send': 'Gửi', 'foot.secure': 'Thanh toán bảo mật',
      'sc.checkin': 'Nhận phòng', 'sc.checkout': 'Trả phòng', 'sc.guests': 'Khách', 'sc.guestsN': '{n} khách',
      'sc.budget': 'Ngân sách/đêm', 'sc.bAll': 'Tất cả', 'sc.b1': 'Dưới 1,5tr', 'sc.b2': 'Dưới 2,5tr', 'sc.b3': 'Dưới 4tr',
      'sc.submit': 'Tìm phòng', 'sc.errDates': 'Vui lòng chọn ngày nhận và trả phòng', 'sc.errOrder': 'Ngày trả phòng phải sau ngày nhận phòng',
      'card.from': 'từ', 'card.night': '/đêm', 'card.soldout': 'Hết phòng', 'card.left': 'Còn {n} phòng',
      'card.soldoutDay': 'Hết phòng cho ngày này', 'card.detail': 'Xem chi tiết', 'card.book': 'Đặt ngay',
      'card.guests': '{n} khách', 'card.reviews': '{n} đánh giá',
      'home.kicker': 'Đà Lạt · 1.500m trên mực nước biển',
      'home.title': 'Ngủ giữa rừng thông,<br><em>thức dậy trong mây</em>',
      'home.sub': 'LakStay là khu nghỉ dưỡng boutique 35 phòng ẩn mình giữa đồi thông trăm tuổi, cách hồ Xuân Hương 5 phút. Đặt phòng trực tuyến, xác nhận tức thì, thanh toán VietQR — và việc còn lại của bạn là tận hưởng.',
      'home.s1k': 'Lưu trú', 'home.s1t': 'Sáu cách để ở lại Đà Lạt',
      'home.s1lead': 'Từ phòng Superior gỗ ấm cúng đến Grand Suite có bồn tắm nằm nhìn thẳng rừng thông và ban công hướng hồ Xuân Hương — mỗi hạng phòng là một cách cảm nhận thành phố sương mù.',
      'home.statRooms': 'Phòng & Suite',
      'home.whyK': 'Vì sao chọn LakStay', 'home.whyT': 'Chuyến đi của bạn,<br>được chăm từng chi tiết',
      'home.revK': 'Khách nói gì', 'home.revT': 'Những dòng nhận xét để lại sau kỳ nghỉ',
      'home.ctaK': 'Sẵn sàng chưa?', 'home.ctaT': 'Đà Lạt đang vào mùa đẹp nhất',
      'rooms.nf': 'Không tìm thấy phòng', 'rooms.back': 'Về danh sách phòng',
      'rd.floor': 'Tầng', 'rd.inv30': 'Tình trạng phòng 30 ngày tới',
      'rd.calMany': 'Còn nhiều', 'rd.calFew': 'Sắp hết (≤2)', 'rd.calOut': 'Hết phòng', 'rd.calPast': 'Quá khứ',
      'rd.polWhen': 'Thời điểm huỷ', 'rd.polFee': 'Phí huỷ', 'rd.polEx': 'Ví dụ với 1 đêm',
      'rd.polFree': 'Miễn phí', 'rd.polPenalty': 'Phạt {p}% đêm đầu', 'rd.polFull': 'Mất 100%', 'rd.polRefund': 'hoàn',
      'rd.revFrom': 'Đánh giá từ khách đã ở',
      'exp.k': 'Trải nghiệm', 'exp.t': 'Một ngày ở LakStay<br><em>trôi qua thế nào?</em>',
      'exp.k2': 'Tiện ích', 'exp.t2': 'Mọi thứ bạn cần, trong tầm tay',
      'rev.t': 'Đánh giá xác thực', 'help.t': 'Câu hỏi thường gặp',
      'home.cta': 'Khám phá phòng', 'home.cta2': 'Xem trải nghiệm',
      'home.whyTitle': 'Vì sao chọn LakStay', 'home.whySub': 'Bốn lời hứa chúng tôi giữ mỗi ngày.',
      'home.roomsTitle': 'Phòng đang mở bán', 'home.roomsSub': 'Giá cập nhật theo mùa và công suất thực tế.',
      'home.revTitle': 'Khách nói gì', 'home.revSub': 'Đánh giá xác thực từ khách đã ở.',
      'rooms.kicker': 'Phòng & giá', 'rooms.title': 'Chọn tổ ấm của bạn',
      'rooms.sub': 'Giá hiển thị đã gồm tồn kho thực tế cho kỳ ở bạn chọn.',
      'rooms.sort': 'Sắp xếp', 'rooms.sortAsc': 'Giá thấp → cao', 'rooms.sortDesc': 'Giá cao → thấp',
      'rooms.sortRating': 'Đánh giá tốt nhất', 'rooms.sortName': 'Tên A–Z',
      'rooms.minRating': 'Điểm ≥', 'rooms.all': 'Tất cả', 'rooms.cheap': '💡 Rẻ nhất tháng {m}:',
      'rooms.count': '{n} hạng phòng · {a} → {b} · {d} đêm',
      'rd.night': '/đêm', 'rd.guests': 'khách', 'rd.amen': 'Tiện nghi', 'rd.inv': 'Tồn kho 30 ngày',
      'rd.policy': 'Chính sách huỷ', 'rd.book': 'Đặt phòng này', 'rd.reviews': 'Đánh giá', 'rd.desc': 'Mô tả',
      'bk.subtotal': 'Tạm tính', 'bk.discount': 'Giảm giá', 'bk.member': 'Ưu đãi hạng thành viên',
      'bk.fee': 'Phí phục vụ', 'bk.tax': 'Thuế GTGT', 'bk.total': 'Tổng cộng', 'bk.payTotal': 'Tổng thanh toán',
      'bk.coupon': 'Mã giảm giá', 'bk.couponPh': 'Nhập mã giảm giá', 'bk.apply': 'Áp dụng',
      'bk.paynow': 'Thanh toán ngay', 'bk.qrTitle': 'Quét mã QR thanh toán', 'bk.voucher': 'Tải voucher PDF',
      'bk.myTitle': 'Đặt phòng của tôi', 'bk.detailTitle': 'Chi tiết đặt phòng', 'bk.cancel': 'Huỷ đặt phòng',
      'bk.paid': 'Đã trả', 'bk.refunded': 'Đã hoàn', 'bk.outstanding': 'Còn lại',
      'bk.paidFull': 'Đã thanh toán đủ', 'bk.paidAmt': 'Đã trả {x}', 'bk.unpaid': 'Chưa thanh toán',
      'bk.noBookings': 'Chưa có đặt phòng nào', 'bk.startFirst': 'Bắt đầu kỳ nghỉ đầu tiên của bạn tại LakStay.',
      'bk.explore': 'Khám phá phòng', 'bk.print': 'In voucher', 'bk.cancelRoom': 'Huỷ phòng',
      'bk.pay': 'Thanh toán {x}', 'bk.hold': 'Giữ chỗ còn', 'bk.code': 'Mã', 'bk.priceDetail': 'Chi tiết giá',
      'bk.tabAll': 'Tất cả', 'bk.tabUp': 'Sắp tới', 'bk.tabDone': 'Đã ở',
      'pf.kicker': 'Tài khoản', 'pf.hello': 'Xin chào, {name}', 'pf.total': 'Tổng đặt phòng', 'pf.up': 'Sắp tới',
      'pf.done': 'Đã hoàn tất', 'pf.spent': 'Tổng chi tiêu', 'pf.pwd': 'Đổi mật khẩu', 'pf.sessions': 'Phiên đăng nhập',
      'pf.revoke': 'Thu hồi tất cả', 'pf.update': 'Cập nhật mật khẩu',
      'st.PENDING': 'Chờ thanh toán', 'st.CONFIRMED': 'Đã xác nhận', 'st.CHECKED_IN': 'Đang ở',
      'st.COMPLETED': 'Hoàn tất', 'st.CANCELLED': 'Đã huỷ', 'st.EXPIRED': 'Hết hạn', 'st.NO_SHOW': 'No-show', 'st.REFUNDED': 'Đã hoàn tiền',
      'e404.t': 'Không tìm thấy trang', 'e404.s': 'Trang bạn yêu cầu không tồn tại.', 'e404.home': 'Về trang chủ',
    },
    en: {
      'nav.home': 'Home', 'nav.rooms': 'Rooms & Rates', 'nav.exp': 'Experiences', 'nav.mybookings': 'My bookings',
      'hdr.login': 'Sign in', 'hdr.booknow': 'Book now', 'hdr.admin': 'Admin',
      'hdr.menu.my': 'My bookings', 'hdr.menu.review': 'Write a review', 'hdr.menu.account': 'Account & security',
      'hdr.menu.admin': 'Admin panel', 'hdr.menu.logout': 'Sign out',
      'hdr.role.admin': 'Administrator', 'hdr.role.staff': 'Staff', 'hdr.role.member': 'Member',
      'hdr.bye': 'Signed out. See you soon!',
      'foot.tagline': 'A boutique hotel in Da Lat’s pine forests — where every stay touches the clouds.',
      'foot.explore': 'Explore', 'foot.support': 'Support', 'foot.contact': 'Contact', 'foot.deals': 'Get deals',
      'foot.allrooms': 'All rooms', 'foot.experience': 'Experiences & amenities', 'foot.reviews': 'Guest reviews',
      'foot.fav': 'Most loved rooms', 'foot.cancel': 'Cancellation policy', 'foot.faq': 'FAQ',
      'foot.manage': 'Manage bookings', 'foot.staff': 'Staff portal',
      'foot.newsPh': 'Your email', 'foot.send': 'Send', 'foot.secure': 'Secure payment',
      'sc.checkin': 'Check-in', 'sc.checkout': 'Check-out', 'sc.guests': 'Guests', 'sc.guestsN': '{n} guest(s)',
      'sc.budget': 'Budget/night', 'sc.bAll': 'Any', 'sc.b1': 'Under 1.5M', 'sc.b2': 'Under 2.5M', 'sc.b3': 'Under 4M',
      'sc.submit': 'Search rooms', 'sc.errDates': 'Please pick check-in and check-out dates', 'sc.errOrder': 'Check-out must be after check-in',
      'card.from': 'from', 'card.night': '/night', 'card.soldout': 'Sold out', 'card.left': '{n} left',
      'card.soldoutDay': 'Sold out for these dates', 'card.detail': 'View details', 'card.book': 'Book now',
      'card.guests': '{n} guest(s)', 'card.reviews': '{n} reviews',
      'home.kicker': 'Da Lat · 1,500 m above sea level',
      'home.title': 'Sleep in the pines,<br><em>wake among the clouds</em>',
      'home.sub': 'LakStay is a 35-room boutique hideaway in century-old pine hills, 5 minutes from Xuan Huong Lake. Book online, get instant confirmation, pay by VietQR — then all you have to do is enjoy.',
      'home.s1k': 'Stays', 'home.s1t': 'Six ways to stay in Da Lat',
      'home.s1lead': 'From warm oak-panelled Superior rooms to our Grand Suite with a forest-facing soaking tub and lake-view balconies — every room is a distinct way to feel the misty highlands.',
      'home.statRooms': 'Rooms & Suites',
      'home.whyK': 'Why LakStay', 'home.whyT': 'Your trip,<br>cared for in every detail',
      'home.revK': 'Guest voices', 'home.revT': 'Notes left behind after the stay',
      'home.ctaK': 'Ready?', 'home.ctaT': 'Da Lat is entering its most beautiful season',
      'rooms.nf': 'No rooms found', 'rooms.back': 'Back to all rooms',
      'rd.floor': 'Floor', 'rd.inv30': 'Availability for the next 30 days',
      'rd.calMany': 'Available', 'rd.calFew': 'Few left (≤2)', 'rd.calOut': 'Sold out', 'rd.calPast': 'Past',
      'rd.polWhen': 'When you cancel', 'rd.polFee': 'Fee', 'rd.polEx': 'Example (1 night)',
      'rd.polFree': 'Free', 'rd.polPenalty': '{p}% of first night', 'rd.polFull': '100% charged', 'rd.polRefund': 'refunded',
      'rd.revFrom': 'Reviews from past guests',
      'exp.k': 'Experiences', 'exp.t': 'A day at LakStay<br><em>how does it flow?</em>',
      'exp.k2': 'Amenities', 'exp.t2': 'Everything you need, within reach',
      'rev.t': 'Verified reviews', 'help.t': 'Frequently asked questions',
      'home.cta': 'Browse rooms', 'home.cta2': 'See experiences',
      'home.whyTitle': 'Why LakStay', 'home.whySub': 'Four promises we keep every day.',
      'home.roomsTitle': 'Rooms on sale', 'home.roomsSub': 'Rates follow season and real availability.',
      'home.revTitle': 'Guest voices', 'home.revSub': 'Verified reviews from past stays.',
      'rooms.kicker': 'Rooms & rates', 'rooms.title': 'Pick your nest',
      'rooms.sub': 'Prices include real availability for your dates.',
      'rooms.sort': 'Sort', 'rooms.sortAsc': 'Price low → high', 'rooms.sortDesc': 'Price high → low',
      'rooms.sortRating': 'Top rated', 'rooms.sortName': 'Name A–Z',
      'rooms.minRating': 'Rating ≥', 'rooms.all': 'All', 'rooms.cheap': '💡 Cheapest in {m}:',
      'rooms.count': '{n} room types · {a} → {b} · {d} night(s)',
      'rd.night': '/night', 'rd.guests': 'guests', 'rd.amen': 'Amenities', 'rd.inv': '30-day inventory',
      'rd.policy': 'Cancellation policy', 'rd.book': 'Book this room', 'rd.reviews': 'Reviews', 'rd.desc': 'Description',
      'bk.subtotal': 'Subtotal', 'bk.discount': 'Discount', 'bk.member': 'Member tier benefit',
      'bk.fee': 'Service fee', 'bk.tax': 'VAT', 'bk.total': 'Total', 'bk.payTotal': 'Total due',
      'bk.coupon': 'Coupon', 'bk.couponPh': 'Enter coupon code', 'bk.apply': 'Apply',
      'bk.paynow': 'Pay now', 'bk.qrTitle': 'Scan QR to pay', 'bk.voucher': 'Download PDF voucher',
      'bk.myTitle': 'My bookings', 'bk.detailTitle': 'Booking details', 'bk.cancel': 'Cancel booking',
      'bk.paid': 'Paid', 'bk.refunded': 'Refunded', 'bk.outstanding': 'Outstanding',
      'bk.paidFull': 'Paid in full', 'bk.paidAmt': 'Paid {x}', 'bk.unpaid': 'Not paid yet',
      'bk.noBookings': 'No bookings yet', 'bk.startFirst': 'Start your first stay with LakStay.',
      'bk.explore': 'Browse rooms', 'bk.print': 'Print voucher', 'bk.cancelRoom': 'Cancel room',
      'bk.pay': 'Pay {x}', 'bk.hold': 'Hold expires in', 'bk.code': 'Code', 'bk.priceDetail': 'Price details',
      'bk.tabAll': 'All', 'bk.tabUp': 'Upcoming', 'bk.tabDone': 'Past stays',
      'pf.kicker': 'Account', 'pf.hello': 'Hello, {name}', 'pf.total': 'Total bookings', 'pf.up': 'Upcoming',
      'pf.done': 'Completed', 'pf.spent': 'Lifetime spend', 'pf.pwd': 'Change password', 'pf.sessions': 'Sessions',
      'pf.revoke': 'Revoke all', 'pf.update': 'Update password',
      'st.PENDING': 'Awaiting payment', 'st.CONFIRMED': 'Confirmed', 'st.CHECKED_IN': 'In house',
      'st.COMPLETED': 'Completed', 'st.CANCELLED': 'Cancelled', 'st.EXPIRED': 'Expired', 'st.NO_SHOW': 'No-show', 'st.REFUNDED': 'Refunded',
      'e404.t': 'Page not found', 'e404.s': 'The page you requested does not exist.', 'e404.home': 'Back home',
    },
  };

  // tiện nghi: map vi → en cho toàn bộ bộ tiện ích seed (key khác thì giữ nguyên)
  const AMEN_EN = {
    'wifi': 'Wi-Fi', 'wifi tốc độ cao': 'High-speed Wi-Fi',
    'tv 43"': '43" Smart TV', 'tv 50"': '50" Smart TV', 'tv 55"': '55" Smart TV', 'tv 65"': '65" Smart TV',
    'tv thông minh': 'Smart TV', 'tivi 55 inch': '55-inch TV',
    'điều hoà 2 chiều': 'Two-way A/C & heater', 'điều hoà âm trần': 'Ceiling-concealed A/C',
    'nước nóng': '24/7 hot water', 'nước nóng 24/7': '24/7 hot water', 'khóa thẻ từ': 'Smart keycard lock',
    'minibar': 'Minibar', 'bàn làm việc': 'Work desk', 'bàn làm việc lớn': 'Executive work desk',
    'bàn làm việc riêng': 'Dedicated work desk', 'bàn làm việc hướng vườn': 'Garden-view desk',
    'bàn trang điểm gương led': 'Touch-LED vanity desk',
    'bàn trà đôi cạnh cửa sổ': 'Window-side tea set for two', 'bàn trà đôi đón nắng': 'Sunlit tea table for two',
    'ấm siêu tốc': 'Electric kettle', 'ấm đun siêu tốc': 'Kettle',
    'máy sấy tóc': 'Hair dryer',
    'ban công': 'Balcony', 'ban công riêng': 'Private balcony',
    'ban công sắt mỹ thuật': 'Wrought-iron balcony', 'ban công góc rộng': 'Wide corner balcony',
    'view thung lũng': 'Valley view', 'view hồ': 'Lake view', 'view hồ xuân hương': 'Xuan Huong Lake view',
    'view rừng thông': 'Pine forest view', 'view rừng thông toàn cảnh': 'Panoramic pine forest view',
    'hướng vườn cây xanh': 'Lush garden view', 'view thành phố': 'City view',
    'bồn tắm': 'Bathtub', 'bồn tắm nằm': 'Soaking bathtub', 'bồn tắm jacuzzi': 'Jacuzzi bathtub',
    'bồn tắm nằm cạnh cửa sổ': 'Window-side soaking tub', 'bồn tắm panorama rừng thông': 'Pine-forest panorama soaking tub',
    '2 giường đôi 1m8': 'Two 1.8m double beds', 'hệ tủ gỗ kịch trần': 'Full-height wooden wardrobes',
    'sofa da chesterfield': 'Chesterfield leather sofa', 'tủ rượu cánh kính': 'Glass display cabinet',
    'vách đá cẩm thạch hắt sáng': 'Backlit marble feature wall',
    'áo choàng tắm': 'Bathrobes', 'két sắt': 'In-room safe', 'két sắt laptop': 'Laptop-size safe',
    'trà & cà phê': 'Tea & coffee set', 'máy pha cà phê': 'Espresso machine',
    'sân vườn riêng': 'Private garden', 'lối đi riêng': 'Private entrance',
    'bàn ủi': 'Iron & board', 'miễn phí trẻ dưới 6 tuổi': 'Free for children under 6',
    '2 phòng ngủ': '2 bedrooms', '3 phòng ngủ': '3 bedrooms',
    'phòng khách riêng': 'Separate living room', 'phòng khách 40m²': '40m² living room',
    'bếp nhỏ': 'Kitchenette', 'bếp đầy đủ': 'Full kitchen',
    '2 phòng tắm': '2 bathrooms', 'máy giặt': 'Washer', 'bàn ăn 6 người': '6-seat dining table',
    'executive lounge': 'Executive Lounge access', 'đưa đón sân bay': 'Airport transfer',
    'hồ bơi nước ấm riêng': 'Private heated pool', 'sân bbq': 'Private BBQ patio',
    'quản gia 24/7': '24/7 butler', 'rạp phim mini': 'Mini cinema room',
    'xe đưa đón riêng': 'Private chauffeur', 'spa tại phòng': 'In-villa spa',
    'lò sưởi': 'Fireplace', 'sauna': 'Sauna', 'garage ô tô': 'Car garage',
  };

  const KEY = 'lakstay_lang';
  let lang = localStorage.getItem(KEY) || ((navigator.language || 'vi').startsWith('vi') ? 'vi' : 'en');

  const t = (key, vars) => {
    let s = (DICT[lang] && DICT[lang][key]) ?? DICT.vi[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  };
  const amen = (a) => (lang === 'en' ? AMEN_EN[String(a).toLowerCase()] || AMEN_EN[a] || a : a);
  const roomName = (r) => (lang === 'en' && r.name ? r.name : r.name_vi || r.name);
  const roomDesc = (r) => (lang === 'en' && r.description_en ? r.description_en : r.description);
  const status = (code) => t('st.' + code);

  function applyStatic(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.documentElement.lang = lang;
  }

  function setLang(l) {
    if (!DICT[l] || l === lang) return;
    lang = l;
    localStorage.setItem(KEY, l);
    applyStatic();
    window.dispatchEvent(new CustomEvent('lang:change', { detail: { lang: l } }));
  }

  return { t, amen, roomName, roomDesc, status, applyStatic, setLang, lang: () => lang, langs: ['vi', 'en'] };
})();
window.I18N = I18N;
