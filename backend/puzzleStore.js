const { Pool } = require("pg");

function createMemoryStore() {
  let puzzle = null;
  const attempts = [];
  return {
    async read() { return puzzle; },
    async save(nextPuzzle) { puzzle = nextPuzzle; },
    async recordAttempt(attempt) {
      attempts.push({ id: attempts.length + 1, attemptedAt: new Date().toISOString(), ...attempt });
    },
    async listAttempts(before) {
      return attempts.filter((attempt) => !before || attempt.id < before).slice().reverse().slice(0, 51);
    },
    async close() {},
  };
}

function createPostgresStore(pool) {
  let ready;
  function initialize() {
    if (!ready) {
      ready = pool.query(`
        CREATE TABLE IF NOT EXISTS arcane_puzzle (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          state JSONB NOT NULL
        )
      `).then(() => pool.query(`
        CREATE TABLE IF NOT EXISTS arcane_attempt (
          id SERIAL PRIMARY KEY,
          attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          input TEXT NOT NULL,
          normalized_input TEXT NOT NULL,
          correct BOOLEAN,
          output TEXT
        )
      `)).catch((error) => {
        // A temporary outage must not prevent later requests from reconnecting.
        ready = undefined;
        throw error;
      });
    }
    return ready;
  }

  return {
    async read() {
      await initialize();
      const result = await pool.query("SELECT state FROM arcane_puzzle WHERE id = 1");
      return result.rows[0]?.state || null;
    },
    async save(puzzle) {
      await initialize();
      // Keep the phrase, ciphertext, and mapping together in one atomic write.
      await pool.query(`
        INSERT INTO arcane_puzzle (id, state) VALUES (1, $1::jsonb)
        ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state
      `, [JSON.stringify(puzzle)]);
    },
    async recordAttempt(attempt) {
      await initialize();
      await pool.query(`
        INSERT INTO arcane_attempt (input, normalized_input, correct, output)
        VALUES ($1, $2, $3, $4)
      `, [attempt.input, attempt.normalizedInput, attempt.correct, attempt.output]);
    },
    async listAttempts(before) {
      await initialize();
      const result = await pool.query(`
        SELECT id, attempted_at AS "attemptedAt", input,
          normalized_input AS "normalizedInput", correct, output
        FROM arcane_attempt ${before ? "WHERE id < $1" : ""}
        ORDER BY id DESC LIMIT 51
      `, before ? [before] : []);
      return result.rows;
    },
    async close() { await pool.end(); },
  };
}

function createPuzzleStore() {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 10000,
      query_timeout: 10000,
      idleTimeoutMillis: 30000,
    });
    pool.on("error", (error) => {
      console.error("[Puzzle Backend] Database connection interrupted:", error.code || "connection error");
    });
    return createPostgresStore(pool);
  }
  if (process.env.RENDER === "true") {
    console.error("[Puzzle Backend] DATABASE_URL is required on Render. Puzzle storage is unavailable.");
    const unavailable = async () => { throw new Error("Database not configured"); };
    return { read: unavailable, save: unavailable, recordAttempt: unavailable, listAttempts: unavailable, async close() {} };
  }
  console.warn("[Puzzle Backend] No DATABASE_URL: using temporary local memory storage.");
  return createMemoryStore();
}

module.exports = { createPuzzleStore, createPostgresStore, createMemoryStore };
