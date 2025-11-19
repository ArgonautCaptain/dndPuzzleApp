require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

let secretPhrase = null;
let encryptedMessage = null;
let wordMap = {}; // Stores the word substitution mapping

// API to check if words in the MESSAGE are valid
app.post("/validate-message", (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "No message provided." });

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
  let availableWords = [...commonWords];
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
  const words = message.split(" ");
  wordMap = generateWordMap(words, keyWords);
  return words.map((word) => wordMap[word] || word).join(" ");
};

// Decrypt a message (reverse the word substitution)
const decryptMessage = (message) => {
  const reversedMap = Object.fromEntries(
    Object.entries(wordMap).map(([k, v]) => [v, k])
  );
  return message
    .split(" ")
    .map((word) => reversedMap[word] || "???")
    .join(" ");
};

// API to set the encrypted message and secret phrase
app.post("/set-message", (req, res) => {
  const { phrase, message } = req.body;
  if (!phrase || !message) {
    return res
      .status(400)
      .json({ error: "Secret phrase and message are required." });
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

  secretPhrase = phrase.split(" ");
  encryptedMessage = encryptMessage(message, secretPhrase);

  res.json({ message: "Message encrypted successfully!" });
});

// API to get the encrypted message
app.get("/get-message", (req, res) => {
  if (!encryptedMessage) {
    return res.status(404).json({ error: "No message set yet." });
  }
  res.json({ encryptedMessage });
});

// API to attempt decryption
app.post("/decrypt", (req, res) => {
  const { phrase } = req.body;
  if (!phrase || !secretPhrase || !encryptedMessage) {
    return res.status(400).json({ error: "Missing data for decryption." });
  }

  const inputPhrase = phrase.split(" ");
  const isCorrect =
    JSON.stringify(inputPhrase) === JSON.stringify(secretPhrase);

  if (isCorrect) {
    const decryptedMessage = decryptMessage(encryptedMessage);
    res.json({ decryptedMessage });
  } else {
    // Incorrect phrase, generate structured gibberish
    if (commonWords.length === 0) {
      // fallback if dictionary missing
      return res.json({
        decryptedMessage: "The magic fails; the message remains obscured.",
      });
    }

    const scrambledWords = encryptedMessage.split(" ");
    const gibberish = scrambledWords
      .map(
        () => commonWords[Math.floor(Math.random() * commonWords.length)]
      )
      .join(" ");

    res.json({ decryptedMessage: gibberish });
  }
});

app.listen(PORT, () => {
  console.log('Puzzle Backend is running on port', PORT);
});