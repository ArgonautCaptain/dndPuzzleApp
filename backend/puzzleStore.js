const { Pool } = require("pg");

function createMemoryStore() {
  let puzzle = null;
  return {
    async read() { return puzzle; },
    async save(nextPuzzle) { puzzle = nextPuzzle; },
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
      `).catch((error) => {
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
    return { read: unavailable, save: unavailable, async close() {} };
  }
  console.warn("[Puzzle Backend] No DATABASE_URL: using temporary local memory storage.");
  return createMemoryStore();
}

module.exports = { createPuzzleStore, createPostgresStore, createMemoryStore };
