/* ============================================================================
   LakStay API client
   - Tự quản CSRF token (double-submit): lấy 1 lần, gửi kèm mọi mutating request
   - Tự retry với idempotency-key cho các thao tác tạo booking/thanh toán
   - Chuẩn hoá lỗi để UI hiển thị tiếng Việt
   ========================================================================== */
const API = (() => {
  let csrfToken = null;
  let site = null;
  let user = null;

  async function ensureCsrf() {
    if (csrfToken) return csrfToken;
    const res = await fetch('/api/auth/csrf', { credentials: 'include' });
    const j = await res.json();
    csrfToken = j?.data?.csrfToken || null;
    return csrfToken;
  }

  function buildHeaders(method, extra = {}) {
    const h = { ...extra };
    if (method !== 'GET') {
      h['Content-Type'] = 'application/json';
      if (csrfToken) h['X-CSRF-Token'] = csrfToken;
    }
    return h;
  }

  async function request(method, path, { body, query, headers = {}, idempotencyKey, retry = 1 } = {}) {
    await ensureCsrf();
    let url = path;
    if (query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
      const qs = q.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    const h = buildHeaders(method, headers);
    if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;

    let lastErr;
    for (let attempt = 0; attempt <= retry; attempt++) {
      const res = await fetch(url, {
        method,
        headers: h,
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
      });
      let data;
      try { data = await res.json(); } catch { data = { success: false, error: { code: 'PARSE_ERROR', message: 'Phản hồi không hợp lệ' } }; }

      if (res.ok) return data.data ?? data;

      // Hết phiên => thử refresh 1 lần rồi gọi lại
      if (res.status === 401 && data.error?.code === 'TOKEN_EXPIRED' && attempt === 0) {
        const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: buildHeaders('POST') });
        if (r.ok) { continue; }
        setUser(null);
      }
      lastErr = Object.assign(new Error(data.error?.message || 'Lỗi không xác định'), {
        status: res.status, code: data.error?.code, details: data.error?.details, requestId: data.requestId,
      });
      if (res.status < 500) break; // lỗi 4xx không retry
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    throw lastErr;
  }

  const get = (path, opts) => request('GET', path, opts);
  const post = (path, body, opts) => request('POST', path, { body, ...opts });
  const put = (path, body, opts) => request('PUT', path, { body, ...opts });
  const patch = (path, body, opts) => request('PATCH', path, { body, ...opts });
  const del = (path, opts) => request('DELETE', path, opts);

  function setUser(u) { user = u; window.dispatchEvent(new CustomEvent('auth:change', { detail: u })); }
  function getUser() { return user; }

  async function loadMe() {
    try { const d = await get('/api/auth/me'); setUser(d); return d; }
    catch { setUser(null); return null; }
  }

  async function logout() {
    try { await post('/api/auth/logout'); } catch {}
    setUser(null);
    csrfToken = null;
  }

  async function loadSite() {
    if (site) return site;
    site = await get('/api/site');
    return site;
  }

  return { get, post, put, patch, del, request, setUser, getUser, loadMe, logout, loadSite, ensureCsrf,
           get csrf() { return csrfToken; } };
})();

window.API = API;
