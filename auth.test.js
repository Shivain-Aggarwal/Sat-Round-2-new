process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
delete process.env.ANTHROPIC_API_KEY;
const test = require('node:test'), assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { createApp } = require('../backend/server');

let server, base;
test.before(async () => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
test.after(() => server.close());

const call = async (path, { token, body, method } = {}) => {
  const r = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
};
const newSession = async () => (await call('/session', { body: {} })).json;

test('rejects missing, garbage, tampered, expired, alg:none and wrong-secret tokens', async () => {
  const { token } = await newSession();
  assert.equal((await call('/state')).status, 401);
  assert.equal((await call('/state', { token: 'abc' })).status, 401);
  const [h, p, sig] = token.split('.');
  const tampered = `${h}.${p}.${sig.slice(0, -2)}${sig.slice(-2) === 'AA' ? 'BB' : 'AA'}`;
  assert.equal((await call('/state', { token: tampered })).status, 401);
  const sid = JSON.parse(Buffer.from(p, 'base64url')).sid;
  const expired = jwt.sign({ sid }, process.env.JWT_SECRET, { expiresIn: -10 });
  const r = await call('/state', { token: expired });
  assert.equal(r.status, 401); assert.equal(r.json.error.code, 'TOKEN_EXPIRED');
  const none = [h, p].join('.').replace(h, Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')) + '.';
  assert.equal((await call('/state', { token: none })).status, 401);
  assert.equal((await call('/state', { token: jwt.sign({ sid }, 'other-secret') })).status, 401);
  assert.equal((await call('/state', { token })).status, 200);
});

test('client-supplied level/alert/score are ignored; completion is gated', async () => {
  const { token } = await newSession();
  let r = await call('/command', { token, body: { command: 'scan', level: 5, alert: 0, score: 99999 } });
  assert.equal(r.json.state.level, 1);
  assert.equal((await call('/mission/complete', { token, body: {} })).status, 409);
  assert.equal((await call('/score', { token, body: { name: 'x', score: 99999 } })).status, 409);
  r = await call('/command', { token, body: { command: 'extract --file PROJECT_HELIX.DAT --key ORCHID' } });
  assert.equal(r.json.state.solved, false);
});

test('bad request shapes return consistent JSON errors', async () => {
  const { token } = await newSession();
  const r = await call('/command', { token, body: { cmd: 'scan' } });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, 'BAD_REQUEST');
  assert.equal((await call('/nope')).status, 404);
});

test('full playthrough over the API, lockout over the API, leaderboard', async () => {
  const { token } = await newSession();
  const steps = ['connect nx-07', 'authenticate --key glass-harbor-lantern', 'decrypt --key 3', 'escalate --via deploy', 'extract --file project_helix.dat --key orchid'];
  for (const command of steps) {
    const r = await call('/command', { token, body: { command } });
    assert.equal(r.json.state.solved, true, command);
    assert.equal((await call('/mission/complete', { token, body: {} })).status, 200);
  }
  const st = (await call('/state', { token })).json.state;
  assert.ok(st.finished && st.score > 0);
  assert.equal((await call('/score', { token, body: { name: '<script>' } })).status, 400);
  assert.equal((await call('/score', { token, body: { name: 'Shivain' } })).status, 200);
  assert.equal((await call('/score', { token, body: { name: 'Again' } })).status, 409);
  const lb = (await call('/leaderboard')).json.entries;
  assert.equal(lb[0].name, 'Shivain'); assert.equal(lb[0].score, st.score);

  const t2 = (await newSession()).token;
  let last;
  for (let i = 0; i < 15; i++) { last = await call('/command', { token: t2, body: { command: 'connect nx-01' } }); if (last.json.state.locked) break; }
  assert.ok(last.json.state.locked);
  const blocked = await call('/command', { token: t2, body: { command: 'connect nx-07' } });
  assert.equal(blocked.status, 423);
  assert.equal((await call('/state', { token: t2 })).json.state.locked, true, 'refresh does not clear lock');
});
