const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createDmAuth = require("./dmAuth");

async function serve(t, app) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => server.listening ? new Promise((resolve) => server.close(resolve)) : undefined);
  const request = async (route, body, token) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };
  request.close = () => new Promise((resolve) => server.close(resolve));
  return request;
}

test("DM API protection, login, logout, and public puzzle decoding", async (t) => {
  const dmPassword = "test-only-dm-password";
  const { createMemoryStore } = require("./puzzleStore");
  const app = require("./server")({ store: createMemoryStore(), dmPassword });
  const request = await serve(t, app);
  assert.equal((await request("/set-message", { phrase: "arcane", message: "the" })).status, 401);
  assert.equal((await request("/validate-message", { message: "the" })).status, 401);
  assert.equal((await request("/dm/login", { password: "wrong" })).status, 401);
  assert.equal((await request("/dm/login", { password: 123 })).status, 401);
  const login = await request("/dm/login", { password: dmPassword });
  assert.equal(login.status, 200);
  assert.match(login.data.token, /^[a-f0-9]{64}$/);
  const token = login.data.token;
  assert.equal((await request("/dm/session", undefined, "forged-token")).status, 401);
  assert.equal((await request("/dm/session", undefined, token)).status, 204);
  assert.equal((await request("/validate-message", { message: "the" }, token)).status, 200);
  assert.equal((await request("/set-message", { phrase: "arcane", message: "the" }, token)).status, 200);
  assert.equal((await request("/get-message")).status, 200);
  const decoded = await request("/decrypt", { phrase: "arcane" });
  assert.equal(decoded.status, 200);
  assert.equal(decoded.data.decryptedMessage, "the");
  for (const phrase of ["ARCANE", "ArCaNe"]) {
    const result = await request("/decrypt", { phrase });
    assert.equal(result.status, 200);
    assert.equal(result.data.decryptedMessage, "the");
  }
  for (const phrase of ["Arcane", "ARCANE", "arcane Moon"]) {
    const rejected = await request("/set-message", { phrase, message: "the" }, token);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.data.error, "Secret phrase must use lowercase letters.");
  }
  // Rejecting an invalid DM phrase must preserve the active puzzle.
  assert.equal((await request("/decrypt", { phrase: "ARCANE" })).data.decryptedMessage, "the");
  for (const phrase of ["", "   ", 123]) {
    assert.equal((await request("/set-message", { phrase, message: "the" }, token)).status, 400);
    assert.equal((await request("/decrypt", { phrase })).status, 400);
  }
  assert.equal((await request("/set-message", { phrase: "moon song 42!", message: "the" }, token)).status, 200);
  assert.equal((await request("/decrypt", { phrase: "MoOn SoNg 42!" })).data.decryptedMessage, "the");
  assert.equal((await request("/decrypt", { phrase: "wrong" })).status, 200);
  assert.equal((await request("/dm/logout", {}, token)).status, 204);
  assert.equal((await request("/set-message", { phrase: "arcane", message: "the" }, token)).status, 401);
});

test("DM access fails closed without a configured password", async (t) => {
  const app = express();
  const auth = createDmAuth("");
  app.use(express.json());
  app.post("/dm/login", auth.login);
  app.post("/set-message", auth.requireDm, (req, res) => res.json({ ok: true }));
  const request = await serve(t, app);
  assert.equal((await request("/dm/login", { password: "anything" })).status, 503);
  assert.equal((await request("/set-message", {})).status, 503);
});

test("Repeated bad passwords are rate limited", async (t) => {
  const app = express();
  app.use(express.json());
  app.post("/dm/login", createDmAuth("private-password").login);
  const request = await serve(t, app);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal((await request("/dm/login", { password: "wrong" })).status, 401);
  }
  assert.equal((await request("/dm/login", { password: "private-password" })).status, 429);
});

test("Postgres puzzle survives backend recreation and replaces the current puzzle atomically", async (t) => {
  const { newDb } = require("pg-mem");
  const { createPostgresStore } = require("./puzzleStore");
  const createApp = require("./server");
  // pg-mem's AST coverage check rejects the no-op CREATE TABLE IF NOT EXISTS
  // after a restart, even though PostgreSQL supports this idempotent operation.
  const database = newDb({ noAstCoverageCheck: true });
  const { Pool } = database.adapters.createPg();
  const store = createPostgresStore(new Pool());
  const dmPassword = "test-only-password";
  const first = await serve(t, createApp({ store, dmPassword }));
  assert.equal((await first("/get-message")).status, 404);
  const login = await first("/dm/login", { password: dmPassword });
  const saved = await first("/set-message", { phrase: "moon song", message: "the moon" }, login.data.token);
  assert.equal(saved.status, 200);
  const ciphertext = (await first("/get-message")).data;
  assert.deepEqual(Object.keys(ciphertext), ["encryptedMessage"]);
  await first.close();
  await store.close();

  // New server, auth sessions, and pool; only the database retains the puzzle.
  const reopenedStore = createPostgresStore(new Pool());
  t.after(() => reopenedStore.close());
  const second = await serve(t, createApp({ store: reopenedStore, dmPassword }));
  assert.deepEqual((await second("/get-message")).data, ciphertext);
  const decoded = await second("/decrypt", { phrase: "MOON Song" });
  assert.equal(decoded.status, 200);
  assert.equal(decoded.data.decryptedMessage, "the moon");
  assert.equal((await second("/dm/session", undefined, login.data.token)).status, 401);
  const newLogin = await second("/dm/login", { password: dmPassword });
  assert.equal((await second("/set-message", { phrase: "sun", message: "the sun" }, newLogin.data.token)).status, 200);
  assert.equal((await second("/decrypt", { phrase: "SUN" })).data.decryptedMessage, "the sun");
  assert.equal((await database.public.many("SELECT * FROM arcane_puzzle")).length, 1);
});

test("Storage outages return 503 instead of success or a missing-puzzle response", async (t) => {
  const createApp = require("./server");
  const failingStore = {
    async read() { throw new Error("unavailable"); },
    async save() { throw new Error("unavailable"); },
  };
  const request = await serve(t, createApp({ store: failingStore, dmPassword: "test-password" }));
  const login = await request("/dm/login", { password: "test-password" });
  assert.equal((await request("/set-message", { phrase: "moon", message: "the moon" }, login.data.token)).status, 503);
  assert.equal((await request("/get-message")).status, 503);
  assert.equal((await request("/decrypt", { phrase: "moon" })).status, 503);
});

test("Automatic table initialization recovers after a temporary database failure", async () => {
  const { newDb } = require("pg-mem");
  const { createPostgresStore } = require("./puzzleStore");
  const { Pool } = newDb().adapters.createPg();
  const pool = new Pool();
  let failOnce = true;
  const store = createPostgresStore({
    query(...args) {
      if (failOnce) {
        failOnce = false;
        return Promise.reject(new Error("temporary connection failure"));
      }
      return pool.query(...args);
    },
    end: () => pool.end(),
  });
  await assert.rejects(store.read());
  assert.equal(await store.read(), null);
  await store.close();
});

test("Render without DATABASE_URL cannot silently save a temporary puzzle", async () => {
  const { createPuzzleStore } = require("./puzzleStore");
  const previousUrl = process.env.DATABASE_URL;
  const previousRender = process.env.RENDER;
  try {
    delete process.env.DATABASE_URL;
    process.env.RENDER = "true";
    const store = createPuzzleStore();
    await assert.rejects(store.read(), /Database not configured/);
    await assert.rejects(store.save({}), /Database not configured/);
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = previousRender;
  }
});
