const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createDmAuth = require("./dmAuth");

async function serve(t, app) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (route, body, token) => {
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
}

test("DM API protection, login, logout, and public puzzle decoding", async (t) => {
  process.env.DM_PASSWORD = "test-only-dm-password";
  const app = require("./server");
  const request = await serve(t, app);
  assert.equal((await request("/set-message", { phrase: "arcane", message: "the" })).status, 401);
  assert.equal((await request("/validate-message", { message: "the" })).status, 401);
  assert.equal((await request("/dm/login", { password: "wrong" })).status, 401);
  assert.equal((await request("/dm/login", { password: 123 })).status, 401);
  const login = await request("/dm/login", { password: process.env.DM_PASSWORD });
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
