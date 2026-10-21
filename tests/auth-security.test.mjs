import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, normalizeUsername, createSessionToken, hashToken, readSessionToken, sessionCookie, isSameOrigin, readLoginInput, loginWindow, LOGIN_WINDOW_MS, SESSION_SECONDS } from "../lib/account-security.ts";

test("passwords use fresh salted hashes and preserve exact spaces/case", async () => {
  const password = "Unit Test Secret 927!";
  const first = await hashPassword(password), second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.match(first, /^\$pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.toLowerCase(), first), false);
  assert.equal(await verifyPassword(password.replaceAll(" ", ""), first), false);
  assert.equal(await verifyPassword(password + " ", first), false);
  assert.equal(await verifyPassword(password, "broken"), false);
});

test("session tokens are random, stored as hashes, and cookies reject ambiguous tokens", async () => {
  const a = createSessionToken(), b = createSessionToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  const hash = await hashToken(a);
  assert.notEqual(hash, a);
  assert.equal(hash, await hashToken(a));
  assert.equal(readSessionToken("unrelated=x; zhixi_session=" + a), a);
  assert.equal(readSessionToken("zhixi_session=" + a + "; zhixi_session=" + b), null);
  assert.equal(readSessionToken("zhixi_session=forged"), null);
  assert.equal(readSessionToken(null), null);
});

test("session cookies are HttpOnly, same-site, scoped, secure on HTTPS and expirable", () => {
  const token = createSessionToken();
  const prod = sessionCookie(token, "https://study.example/login");
  assert.match(prod, /Path=\/; HttpOnly; SameSite=Lax;/);
  assert.match(prod, /; Secure$/);
  assert.match(prod, new RegExp("Max-Age=" + SESSION_SECONDS));
  assert.doesNotMatch(sessionCookie(token, "http://127.0.0.1:5173/login"), /Secure/);
  assert.match(sessionCookie("", "https://study.example", true), /Max-Age=0; Secure/);
});

test("username normalization is separate from password parsing", async () => {
  assert.equal(normalizeUsername("  Example   Student "), "example student");
  const request = new Request("https://study.example/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "  Example   Student ", password: "Exact  Secret " }) });
  const parsed = await readLoginInput(request);
  assert.deepEqual(parsed, { username: "example student", password: "Exact  Secret " });
});

test("login rejects cross-origin requests, unexpected fields and streamed oversized input", async () => {
  assert.equal(isSameOrigin(new Request("https://study.example/api/auth/login", { headers: { Origin: "https://study.example" } })), true);
  assert.equal(isSameOrigin(new Request("https://study.example/api/auth/login", { headers: { Origin: "https://attacker.example" } })), false);
  assert.equal(isSameOrigin(new Request("https://study.example/api/auth/login")), false);
  await assert.rejects(readLoginInput(new Request("https://study.example", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Example", password: "secret", role: "admin" }) })), /用户名/);
  let canceled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(5000)); }, cancel() { canceled = true; } });
  await assert.rejects(readLoginInput(new Request("https://study.example", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" })), /过长/);
  assert.equal(canceled, true);
});

test("rate-limit windows share a fixed expiry and roll over at the boundary", () => {
  const a = loginWindow(LOGIN_WINDOW_MS + 1), b = loginWindow(LOGIN_WINDOW_MS * 2 - 1), c = loginWindow(LOGIN_WINDOW_MS * 2);
  assert.deepEqual(a, b);
  assert.equal(a.expiresAt, LOGIN_WINDOW_MS * 2);
  assert.equal(c.number, a.number + 1);
  assert.equal(c.expiresAt, LOGIN_WINDOW_MS * 3);
});
