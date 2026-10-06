const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");

const SESSION_DURATION = 8 * 60 * 60 * 1000;
const ATTEMPT_WINDOW = 15 * 60 * 1000;

module.exports = function createDmAuth(password) {
  const sessions = new Map();
  const attempts = new Map();
  const hash = (value) => createHash("sha256").update(value).digest();
  const passwordHash = password ? hash(password) : null;

  function prune() {
    const now = Date.now();
    for (const [token, expires] of sessions) {
      if (expires <= now) sessions.delete(token);
    }
    for (const [ip, attempt] of attempts) {
      if (attempt.expires <= now) attempts.delete(ip);
    }
  }

  function requireDm(req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!passwordHash) {
      return res.status(503).json({ error: "DM access is disabled. Configure DM_PASSWORD on the backend." });
    }
    prune();
    const token = req.get("Authorization")?.replace(/^Bearer /, "");
    if (!sessions.has(token)) {
      return res.status(401).json({ error: "Unlock the DM panel to continue." });
    }
    req.dmToken = token;
    next();
  }

  function login(req, res) {
    res.set("Cache-Control", "no-store");
    if (!passwordHash) {
      return res.status(503).json({ error: "DM access is disabled. Configure DM_PASSWORD on the backend." });
    }
    prune();
    const ip = req.ip;
    const attempt = attempts.get(ip) || { count: 0, expires: Date.now() + ATTEMPT_WINDOW };
    if (attempt.count >= 10) {
      res.set("Retry-After", String(Math.ceil((attempt.expires - Date.now()) / 1000)));
      return res.status(429).json({ error: "Too many password attempts. Try again in 15 minutes." });
    }
    const supplied = req.body?.password;
    if (typeof supplied !== "string" || !timingSafeEqual(hash(supplied), passwordHash)) {
      attempt.count += 1;
      attempts.set(ip, attempt);
      return res.status(401).json({ error: "Incorrect DM password." });
    }
    attempts.delete(ip);
    const token = randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_DURATION);
    res.json({ token });
  }

  function logout(req, res) {
    sessions.delete(req.dmToken);
    res.sendStatus(204);
  }

  return { login, logout, requireDm };
};
