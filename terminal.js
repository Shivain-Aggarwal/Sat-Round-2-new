(() => {
  const $ = s => document.querySelector(s);
  const screens = ['boot', 'menu', 'briefing', 'game', 'board', 'victory'];
  const out = $('#out'), cmd = $('#cmd');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CELLS = 20; // 5% per cell, matching the smallest penalty step
  let state = null, hist = [], hi = 0, busy = false, lockEnd = 0, lockTotal = 0, lockTimer = null, t0 = 0, e0 = 0;

  const mmss = t => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  const gauge = (n, total) => '[' + '#'.repeat(n) + '.'.repeat(total - n) + ']';

  function show(id) {
    screens.forEach(s => $('#' + s).classList.toggle('hidden', s !== id));
    if (id === 'menu') $('[data-act=resume]').classList.toggle('hidden', !Api.hasToken());
    if (id === 'game') cmd.focus();
  }
  const print = (t, cls = '') => {
    const d = document.createElement('div'); d.className = 'line ' + cls; d.textContent = t;
    out.appendChild(d); out.scrollTop = out.scrollHeight;
  };
  function echo(text) {
    const d = document.createElement('div'); d.className = 'line echo';
    const p = document.createElement('span'); p.className = 'ps'; p.textContent = 'operator@nexus:~$ ';
    d.append(p, document.createTextNode(text));
    out.appendChild(d); out.scrollTop = out.scrollHeight;
  }
  // Presentation only: colors server lines by their leading tag. Text is never altered.
  const tag = l =>
    /^\[OK\]/.test(l) ? 't-ok' :
    /^\[(DENIED|FAIL|ERR)\]/.test(l) ? 't-bad' :
    /^\[HINT \d+\]/.test(l) ? 't-hint' :
    /^(\[INFO\]|RULE:|\(\+\d+% alert)/.test(l) ? 't-info' :
    /^>> MISSION/.test(l) ? 'banner' :
    /^[A-Z_]+( {2,}[A-Z_]+)+$/.test(l) ? 't-head' : '';

  // --- boot ---
  const BOOT = ['NEXUS CORP', 'SECURITY INFRASTRUCTURE', 'UNAUTHORIZED ACCESS IS PROHIBITED', '', '[ OK ] loading kernel modules', '[ OK ] mounting /vault (read-only)', '[ OK ] SENTINEL online', '[ !! ] environment is SIMULATED: no real systems are touched'];
  let bootDone = false, bootTimer;
  function endBoot() { if (bootDone) return; bootDone = true; clearInterval(bootTimer); show('menu'); }
  function bootLine(t) {
    const d = document.createElement('div'), m = /^\[ (OK|!!) \]/.exec(t);
    if (m) {
      const s = document.createElement('span'); s.className = m[1] === 'OK' ? 'boot-ok' : 'warn'; s.textContent = m[0];
      d.append(s, document.createTextNode(t.slice(m[0].length)));
    } else d.textContent = t || '\u00a0';
    $('#bootlog').appendChild(d);
  }
  (function boot() {
    let i = 0;
    bootTimer = setInterval(() => {
      if (i >= BOOT.length) { clearInterval(bootTimer); setTimeout(endBoot, 500); return; }
      bootLine(BOOT[i++]);
    }, reduce ? 0 : 260);
  })();
  addEventListener('keydown', () => { if (!bootDone) endBoot(); });
  $('#boot').addEventListener('click', endBoot);

  // --- HUD ---
  function render(s) {
    state = s; t0 = Date.now(); e0 = s.stats.elapsed;
    $('#mTitle').textContent = s.title; $('#mCount').textContent = `mission ${s.level}/${s.missions.length}`;
    $('#objective').textContent = 'objective: ' + s.objective;
    const zone = s.locked ? 'locked' : s.alert >= 80 ? 'critical' : s.alert >= 50 ? 'elevated' : 'calm';
    const bar = $('#bar');
    bar.textContent = gauge(Math.round(s.alert / 100 * CELLS), CELLS);
    bar.className = zone === 'critical' || zone === 'locked' ? 'crit' : zone === 'elevated' ? 'warn' : '';
    document.body.dataset.zone = zone;
    $('#alertN').textContent = s.alert + '%';
    $('#zone').textContent = { calm: 'low', elevated: 'elevated', critical: 'critical', locked: 'locked' }[zone];
    $('#stats').textContent = `hints ${s.stats.hints}  fails ${s.stats.failures}  peak ${s.stats.peak}%`;
    const nodes = $('#nodes'); nodes.innerHTML = '';
    s.missions.forEach(m => {
      const e = document.createElement('span');
      e.className = 'node ' + m.status; e.textContent = (m.status === 'done' ? '[x] ' : m.status === 'active' ? '[>] ' : '[ ] ') + m.id;
      e.title = m.status === 'locked' ? 'locked' : m.title; nodes.appendChild(e);
    });
    applyLock(s);
  }
  let lockGen = 0, polling = false;
  function applyLock(s) {
    clearInterval(lockTimer);
    const gen = ++lockGen; // invalidates any in-flight poll from an earlier lock or session
    polling = false;
    const bar = $('#lockbar');
    if (!s.locked) { lockTotal = 0; bar.classList.add('hidden'); cmd.disabled = false; $('#conn').textContent = 'CONNECTED'; if (!$('#game').classList.contains('hidden')) cmd.focus(); return; }
    lockEnd = Date.now() + s.lockRemaining; lockTotal = Math.max(lockTotal, s.lockRemaining); cmd.disabled = true; $('#conn').textContent = 'LOCKED';
    bar.classList.remove('hidden');
    const tick = async () => {
      const ms = lockEnd - Date.now(), left = Math.ceil(ms / 1000);
      if (left > 0) {
        const f = Math.max(0, Math.min(CELLS, Math.round(ms / lockTotal * CELLS)));
        bar.textContent = `[LOCKOUT] terminal frozen by SENTINEL\n${gauge(f, CELLS)} ${left}s`;
        return;
      }
      if (polling) return;
      polling = true;
      bar.textContent = '[LOCKOUT] lock expired. Contacting server...';
      try {
        const r = await Api.state();
        if (gen === lockGen) render(r.state); // render() re-arms the timer if the server says it is still locked
      } catch (e) {
        if (gen !== lockGen) return;
        if (e.status === 401) { clearInterval(lockTimer); bar.textContent = '[SESSION] expired or invalid. Press restart.'; }
        // any other failure: keep the interval running so the next tick retries; the terminal must never stay frozen
      } finally { if (gen === lockGen) polling = false; }
    };
    tick(); lockTimer = setInterval(tick, 500);
  }
  setInterval(() => {
    if (!state || state.finished) return;
    $('#clock').textContent = mmss(e0 + Math.floor((Date.now() - t0) / 1000));
  }, 1000);

  // --- game flow ---
  async function startNew() {
    try {
      const r = await Api.newSession(); Api.setToken(r.token);
      out.innerHTML = ''; hist = []; hi = 0;
      show('game'); render(r.state);
      print('NEXUS SECURE SHELL. Session active.', 'dim');
      print('Type help for commands, notes for recovered intel. This is a simulation.', 'dim');
    } catch (e) { alert('Could not start: ' + e.message); }
  }
  async function resume() {
    try {
      const r = await Api.state(); out.innerHTML = '';
      show('game'); render(r.state); print('Session resumed. Type notes to review recovered intel.', 'dim');
      if (r.state.finished) return victory(r.state);
      if (r.state.solved) await complete(); // solved but never advanced (e.g. the tab closed mid-transition)
    } catch (e) {
      if (e.status === 401) { Api.setToken(null); startNew(); } // only a rejected token means the session is gone
      else alert('Could not resume: ' + e.message);
    }
  }

  async function run(text) {
    echo(text);
    if (/^clear$/i.test(text.trim())) { out.innerHTML = ''; return; }
    try {
      const r = await Api.command(text);
      if (r.clear) out.innerHTML = ''; // the server decides what counts as clear (any casing, extra args)
      r.out.forEach(l => print(l, tag(l)));
      if (r.sentinel) print('SENTINEL: ' + r.sentinel, 'sentinel');
      render(r.state);
      if (r.state.alert >= 80 || r.state.locked) { Snd.warn(); if (!reduce) { document.body.classList.add('glitch'); setTimeout(() => document.body.classList.remove('glitch'), 200); } } else Snd.ok();
      if (r.state.solved) await complete();
    } catch (e) {
      if (e.status === 423) { print('[LOCKED] ' + e.message, 'crit'); render(e.data.state); }
      else if (e.status === 401) { print('[SESSION] expired or invalid. Press restart.', 'crit'); }
      else print('[ERR] ' + e.message, 'crit');
    }
  }
  async function complete() {
    const r = await Api.complete();
    r.out.forEach(l => print(l, l.startsWith('>> MISSION') ? 'banner' : 'warn'));
    if (r.sentinel) print('SENTINEL: ' + r.sentinel, 'sentinel');
    render(r.state);
    if (r.state.finished) setTimeout(() => {
      // only if the player is still looking at this finished run (not exited to the menu or restarted)
      if (state && state.finished && !$('#game').classList.contains('hidden')) victory(state);
    }, 1200);
  }
  function victory(s) {
    $('#debrief').textContent = [
      'EXTRACTION COMPLETE', '',
      'PROJECT_HELIX.DAT copied. SENTINEL logged the intrusion', 'but not the intruder.', '',
      `time ........ ${mmss(s.stats.elapsed)}`, `failed ...... ${s.stats.failures}`, `hints ....... ${s.stats.hints}`,
      `peak alert .. ${s.stats.peak}%`, `score ....... ${s.score}`].join('\n');
    $('#scoreForm').classList.toggle('hidden', s.submitted);
    $('#scoreMsg').textContent = s.submitted ? 'Score submitted.' : '';
    show('victory');
  }

  // --- input ---
  $('#prompt').addEventListener('submit', async e => {
    e.preventDefault();
    const v = cmd.value; if (busy || !v.trim()) return;
    cmd.value = ''; hist.push(v); hi = hist.length; busy = true;
    try { await run(v); } finally { busy = false; if (!cmd.disabled) cmd.focus(); }
  });
  cmd.addEventListener('keydown', e => {
    Snd.key();
    if (e.key === 'ArrowUp') { e.preventDefault(); if (hi > 0) cmd.value = hist[--hi]; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); cmd.value = hi < hist.length - 1 ? hist[++hi] : (hi = hist.length, ''); }
    else if (e.key === 'Escape') out.innerHTML = '';
  });
  $('#out').addEventListener('click', () => { if (!cmd.disabled) cmd.focus(); });

  $('#scoreForm').addEventListener('submit', async e => {
    e.preventDefault();
    try { await Api.score($('#pname').value); $('#scoreForm').classList.add('hidden'); $('#scoreMsg').textContent = 'Score submitted.'; }
    catch (err) { $('#scoreMsg').textContent = err.message; }
  });
  async function board() {
    show('board');
    const row = (r, n, sc, t) => `${r.padStart(2)}  ${n.padEnd(16)} ${sc.padStart(6)}  ${t}`;
    try {
      const { entries } = await Api.leaderboard();
      $('#boardList').textContent = entries.length
        ? [row('#', 'callsign', 'score', 'time'), '-'.repeat(34), ...entries.map((x, i) => row(String(i + 1), x.name, String(x.score), x.time + 's'))].join('\n')
        : 'No entries yet. Finish a breach to claim the first.';
    } catch (e) { $('#boardList').textContent = 'Could not load: ' + e.message; }
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    ({ start: startNew, resume, brief: () => show('briefing'), board, menu: () => show('menu') })[a.dataset.act]();
  });
  $('#restartBtn').addEventListener('click', startNew);
  const mute = $('#muteBtn');
  const label = () => (mute.textContent = 'sound: ' + (Snd.isMuted() ? 'off' : 'on'));
  mute.addEventListener('click', () => { Snd.toggle(); label(); }); label();

  const crt = $('#crtBtn');
  let scan = true;
  try { scan = localStorage.getItem('scan') !== '0'; } catch (e) { /* storage blocked */ }
  const applyScan = () => { document.body.classList.toggle('noscan', !scan); crt.textContent = 'scanlines: ' + (scan ? 'on' : 'off'); };
  crt.addEventListener('click', () => { scan = !scan; try { localStorage.setItem('scan', scan ? '1' : '0'); } catch (e) { /* not persisted */ } applyScan(); }); applyScan();
})();
