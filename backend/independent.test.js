// Independent probes use explicit test credentials and an isolated database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config = () => ({});
const createApp = require('./server');
const { createMemoryStore, createPostgresStore } = require('./puzzleStore');
const { newDb } = require('pg-mem');
const words = require('./dnd-words-updated.json').commonWords;

async function serve(t, store) {
  const server = await new Promise(resolve => {
    const listener = createApp({ store, dmPassword: 'Independent-Password!' })
      .listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, body, token, raw = false) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, cache: response.headers.get('cache-control') };
  };
  const login = await request('/dm/login', { password: 'Independent-Password!' });
  assert.equal(login.status, 200);
  return { request, token: login.data.token };
}

test('Independent multi-guess invariants survive JSONB mapping order and backend recreation', async t => {
  const database = newDb({ noAstCoverageCheck: true });
  const { Pool } = database.adapters.createPg();
  const store = createPostgresStore(new Pool());
  t.after(() => store.close());
  const { request, token } = await serve(t, store);
  const message = 'the moon and the sun and the moon';
  assert.equal((await request('/set-message', { phrase: 'moon song 42!', message }, token)).status, 200);
  const guesses = Array.from({ length: 40 }, (_, i) => `independent guess ${i}!`);
  const before = [];
  for (const phrase of guesses) {
    const result = await request('/decrypt', { phrase });
    assert.equal(result.status, 200);
    const output = result.data.decryptedMessage.split(' ');
    assert.equal(output.length, 8);
    assert.ok(output.every(word => words.includes(word)));
    assert.equal(output[0], output[3]);
    assert.equal(output[0], output[6]);
    assert.equal(output[1], output[7]);
    assert.equal(output[2], output[5]);
    before.push(result.data);
    assert.deepEqual((await request('/decrypt', { phrase: phrase.toUpperCase() })).data, result.data);
  }
  const state = await store.read();
  state.wordMap = Object.fromEntries(Object.entries(state.wordMap).reverse());
  await store.save(state);
  const reopened = createPostgresStore(new Pool());
  t.after(() => reopened.close());
  const second = await serve(t, reopened);
  for (let i = 0; i < guesses.length; i++) {
    assert.deepEqual((await second.request('/decrypt', { phrase: guesses[i] })).data, before[i]);
  }
  assert.equal((await second.request('/decrypt', { phrase: 'MOON SONG 42!' })).data.decryptedMessage, message);
  assert.equal((await second.request('/dm/session', undefined, token)).status, 401);
  assert.deepEqual(Object.keys((await second.request('/get-message')).data), ['encryptedMessage']);
  assert.equal((await second.request('/get-message')).cache, 'no-store');
});

test('Independent message round trips, invalid writes, and malformed requests', async t => {
  const { request, token } = await serve(t, createMemoryStore());
  for (const message of ['The MOON and the Sun', '  the  moon  ', 'the\tmoon\nand\tthe sun']) {
    assert.equal((await request('/validate-message', { message }, token)).data.valid, true);
    assert.equal((await request('/set-message', { phrase: 'abc 123!', message }, token)).status, 200);
    assert.equal((await request('/decrypt', { phrase: 'ABC 123!' })).data.decryptedMessage, message.trim().split(/\s+/).join(' '));
  }
  const original = (await request('/get-message')).data;
  for (const body of [{ phrase: 'UPPER', message: 'the' }, { phrase: 'abc', message: 'notadictionarywordzz' }, { phrase: null, message: 'the' }, { phrase: 'abc', message: [] }]) {
    assert.equal((await request('/set-message', body, token)).status, 400);
    assert.deepEqual((await request('/get-message')).data, original);
  }
  assert.equal((await request('/dm/login', { password: 'independent-password!' })).status, 401);
  for (const body of [{}, { phrase: 123 }, { phrase: [] }, { phrase: '  ' }]) {
    assert.equal((await request('/decrypt', body)).status, 400);
  }
  assert.equal((await request('/decrypt', '{invalid', undefined, true)).status, 400);
  assert.equal((await request('/validate-message', {}, token)).status, 400);
});

test('Independent storage failure never publishes success or internal error details', async t => {
  const store = { async read() { throw new Error('SECRET-INTERNAL-DETAIL'); }, async save() { throw new Error('SECRET-INTERNAL-DETAIL'); } };
  const { request, token } = await serve(t, store);
  for (const [route, body, auth] of [['/get-message', undefined], ['/decrypt', { phrase: 'x' }], ['/set-message', { phrase: 'x', message: 'the moon' }, token]]) {
    const result = await request(route, body, auth);
    assert.equal(result.status, 503);
    assert.ok(!JSON.stringify(result.data).includes('SECRET-INTERNAL-DETAIL'));
  }
});

test('Distinct plaintext words retain distinct encoded words at duplicate dictionary entries', async t => {
  const { request, token } = await serve(t, createMemoryStore());
  // "clutch" occurs at adjacent dictionary positions 2982 and 2983.
  const phrase = 'a'.repeat(2982);
  assert.equal((await request('/set-message', { phrase, message: 'the moon' }, token)).status, 200);
  assert.equal((await request('/decrypt', { phrase })).data.decryptedMessage, 'the moon');
});

test('DM sessions expire at eight hours and failed login windows reset', () => {
  const createDmAuth = require('./dmAuth');
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const auth = createDmAuth('TestPassword');
    const response = () => ({ statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.data = value; return this; } });
    const login = password => { const res = response(); auth.login({ ip: 'test-ip', body: { password } }, res); return res; };
    const token = login('TestPassword').data.token;
    const session = () => { const res = response(); let allowed = false; auth.requireDm({ get: () => `Bearer ${token}` }, res, () => { allowed = true; }); return { allowed, res }; };
    now += 8 * 60 * 60 * 1000 - 1;
    assert.equal(session().allowed, true);
    now += 1;
    assert.equal(session().res.statusCode, 401);
    for (let i = 0; i < 10; i++) assert.equal(login('wrong').statusCode, 401);
    assert.equal(login('TestPassword').statusCode, 429);
    now += 15 * 60 * 1000;
    assert.equal(login('TestPassword').statusCode, 200);
  } finally {
    Date.now = originalNow;
  }
});
