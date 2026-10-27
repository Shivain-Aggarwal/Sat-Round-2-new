window.Api = (() => {
  // Storage can throw (blocked cookies, some private modes). Fall back to in-memory for this page load.
  const store = {
    get: k => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* memory only */ } },
    del: k => { try { sessionStorage.removeItem(k); } catch { /* memory only */ } }
  };
  let token = store.get('nx-token');
  async function call(path, body) {
    const opts = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    let r;
    try { r = await fetch('/api' + path, opts); } catch { throw Object.assign(new Error('Server unreachable.'), { status: 0 }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || 'Request failed.'), { status: r.status, data: j });
    return j;
  }
  return {
    call,
    hasToken: () => !!token,
    setToken(t) { token = t; t ? store.set('nx-token', t) : store.del('nx-token'); },
    newSession: () => call('/session', {}),
    state: () => call('/state'),
    command: command => call('/command', { command }),
    complete: () => call('/mission/complete', {}),
    score: name => call('/score', { name }),
    leaderboard: () => call('/leaderboard')
  };
})();
