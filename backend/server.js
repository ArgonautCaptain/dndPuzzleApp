require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { createHash } = require("node:crypto");
const createDmAuth = require("./dmAuth");
const { createPuzzleStore } = require("./puzzleStore");

const PORT = process.env.PORT || 5000;

function createApp({ store = createPuzzleStore(), dmPassword = process.env.DM_PASSWORD } = {}) {
  const app = express();
  app.locals.puzzleStore = store;
  app.use(cors());
  app.use(express.json());
  const dmAuth = createDmAuth(dmPassword);
  app.post("/dm/login", dmAuth.login);
  app.get("/dm/session", dmAuth.requireDm, (req, res) => res.sendStatus(204));
  app.post("/dm/logout", dmAuth.requireDm, dmAuth.logout);

  //load common words safely
  let commonWords = [];
  let commonWordsSet = new Set();

  (function loadCommonWords() {
    try {
      const commonWordsPath = path.join(__dirname, "dnd-words-updated.json");

      if (!fs.existsSync(commonWordsPath)) {
        console.error(
          "[Puzzle Backend] dnd-words-updated.json not found at:",
          commonWordsPath
        );
        return; // keep server running, but validation will always fail
      }

      const raw = fs.readFileSync(commonWordsPath, "utf8");
      const parsed = JSON.parse(raw);

      if (!parsed || !Array.isArray(parsed.commonWords)) {
        console.error(
          "[Puzzle Backend] dnd-words-updated.json is missing a 'commonWords' array."
        );
        return;
      }

      commonWords = parsed.commonWords;
      commonWordsSet = new Set(commonWords.map((word) => word.toLowerCase()));
      console.log(
        `[Puzzle Backend] Loaded ${commonWords.length} common words from dictionary.`
      );
    } catch (err) {
      console.error("[Puzzle Backend] Failed to load common words dictionary:", err);
      // leave commonWords as [] and commonWordsSet empty; routes will handle this
    }
  })();

  const storedRoute = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      // Database connection strings and puzzle contents must not appear in errors.
      console.error("[Puzzle Backend] Puzzle storage request failed:", error.code || "storage error");
      res.status(503).json({ error: "Puzzle storage is temporarily unavailable. Please try again shortly." });
    });
  };

  // API to check if words in the MESSAGE are valid
  app.post("/validate-message", dmAuth.requireDm, (req, res) => {
    const { message } = req.body;
    if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "No message provided." });

    if (commonWordsSet.size === 0) {
      return res.status(500).json({
        error:
          "Dictionary not loaded on server. Please contact the DM to check backend configuration.",
      });
    }

    const words = message.trim().split(/\s+/).map((word) => word.toLowerCase());
    const invalidWords = words.filter((word) => !commonWordsSet.has(word));

    res.json({ valid: invalidWords.length === 0, invalidWords });
  });

  // Function to create a deterministic mapping from message words to dictionary words
  const generateWordMap = (messageWords, keyWords) => {
    let availableWords = [...new Set(commonWords)];
    let mapping = {};

    messageWords.forEach((word, index) => {
      if (!mapping[word]) {
        if (availableWords.length === 0) {
          // Fallback: if dictionary somehow empty, map to itself
          mapping[word] = word;
          return;
        }

        let keyIndex = index % keyWords.length;
        let shift = keyWords[keyIndex].length % availableWords.length;
        let [newWord] = availableWords.splice(shift, 1);
        mapping[word] = newWord || word;
      }
    });

    return mapping;
  };

  // Encrypt a message using word substitution
  const encryptMessage = (message, keyWords) => {
    const words = message.trim().split(/\s+/);
    const wordMap = generateWordMap(words, keyWords);
    return {
      wordMap,
      encryptedMessage: words.map((word) => wordMap[word] || word).join(" "),
    };
  };

  // Decrypt a message (reverse the word substitution)
  const decryptMessage = (message, wordMap) => {
    const reversedMap = Object.fromEntries(
      Object.entries(wordMap).map(([k, v]) => [v, k])
    );
    return message
      .split(" ")
      .map((word) => reversedMap[word] || "???")
      .join(" ");
  };

  // API to set the encrypted message and secret phrase
  app.post("/set-message", dmAuth.requireDm, storedRoute(async (req, res) => {
    const { phrase, message } = req.body;
    if (typeof phrase !== "string" || !phrase.trim() || typeof message !== "string" || !message.trim()) {
      return res
        .status(400)
        .json({ error: "Secret phrase and message are required." });
    }

    if (phrase !== phrase.toLowerCase()) {
      return res.status(400).json({ error: "Secret phrase must use lowercase letters." });
    }

    if (commonWordsSet.size === 0) {
      return res.status(500).json({
        error:
          "Dictionary not loaded on server. Please contact the DM to check backend configuration.",
      });
    }

    const words = message.trim().split(/\s+/).map((word) => word.toLowerCase());
    const invalidWords = words.filter((word) => !commonWordsSet.has(word));

    if (invalidWords.length > 0) {
      return res
        .status(400)
        .json({ error: "Invalid words in message.", invalidWords });
    }

    const secretPhrase = phrase.split(" ");
    const puzzle = { secretPhrase, ...encryptMessage(message, secretPhrase) };
    await store.save(puzzle);

    res.json({ message: "Message encrypted successfully!" });
  }));

  // API to get the encrypted message
  app.get("/get-message", storedRoute(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const puzzle = await store.read();
    const encryptedMessage = puzzle?.encryptedMessage;
    if (!encryptedMessage) {
      return res.status(404).json({ error: "No message set yet." });
    }
    res.json({ encryptedMessage });
  }));

  // API to attempt decryption
  app.post("/decrypt", storedRoute(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { phrase } = req.body;
    if (typeof phrase !== "string" || !phrase.trim()) {
      return res.status(400).json({ error: "Missing data for decryption." });
    }
    const puzzle = await store.read();
    if (!puzzle) {
      return res.status(400).json({ error: "Missing data for decryption." });
    }
    const { secretPhrase, encryptedMessage, wordMap } = puzzle;

    const inputPhrase = phrase.toLowerCase().split(" ");
    const isCorrect =
      JSON.stringify(inputPhrase) === JSON.stringify(secretPhrase);

    if (isCorrect) {
      const decryptedMessage = decryptMessage(encryptedMessage, wordMap);
      res.json({ decryptedMessage });
    } else {
      // Incorrect guesses produce a stable substitution for this phrase and puzzle.
      if (commonWords.length === 0) {
        // fallback if dictionary missing
        return res.json({
          decryptedMessage: "The magic fails; the message remains obscured.",
        });
      }

      const scrambledWords = encryptedMessage.split(" ");
      // Different plaintexts can have the same ciphertext with this cipher.
      // Sort mapping keys because JSONB storage can reorder object properties.
      const sortedMapping = Object.entries(wordMap).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0);
      const puzzleSeed = createHash("sha256")
        .update(JSON.stringify([encryptedMessage, sortedMapping])).digest("hex");
      const gibberish = scrambledWords
        .map(
          (word) => {
            const seed = JSON.stringify([
              "arcane-wrong-guess-v1", phrase.toLowerCase(), puzzleSeed, word,
            ]);
            const index = createHash("sha256").update(seed).digest().readUInt32BE(0);
            return commonWords[index % commonWords.length];
          }
        )
        .join(" ");

      res.json({ decryptedMessage: gibberish });
    }
  }));

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log('Puzzle Backend is running on port', PORT);
  });
}

module.exports = createApp;
