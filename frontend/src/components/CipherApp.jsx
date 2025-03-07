import { useState, useEffect, useRef } from "react";
import { animate } from "motion"
import { motion } from "motion/react";

// Utility function to convert text to sentence case
const toSentenceCase = (text) => {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
};

export default function CipherApp() {
  const [playerPhrase, setPlayerPhrase] = useState("");
  const [encryptedMessage, setEncryptedMessage] = useState("");
  const [decodedMessage, setDecodedMessage] = useState("");
  const [displayedWords, setDisplayedWords] = useState([]);
  const [error, setError] = useState("");
  const [isInputVisible, setIsInputVisible] = useState(true); // Track input visibility
  const [transitionState, setTransitionState] = useState("visible"); // Track animation state
  const inputRef = useRef(null);

  const InputForm = () => (
    <form onKeyDown={handleSubmit} className={`scroll-input-form ${transitionState}`}>
      <input
        ref={inputRef}
        type="text"
        value={playerPhrase}
        onChange={(e) => setPlayerPhrase(e.target.value)}
        onLoad={() => inputRef.current.focus()}
        placeholder="Write your passphrase..."
        className="scroll-input"
      />
    </form>
  );

  useEffect(() => {
    if (!inputRef.current.focus()) return;
    inputRef.current.focus();
  }, [InputForm]);

  // Fetch the encrypted message when the component loads
  useEffect(() => {
    const fetchMessage = async () => {
      try {
        const response = await fetch("http://localhost:5000/get-message");
        const data = await response.json();
        setEncryptedMessage(data.encryptedMessage);
      } catch (err) {
        setError("No message set yet.");
      }
    };
    fetchMessage();
  }, []);

  // Handle form submission (Enter key or button click)
  const handleSubmit = async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!playerPhrase.trim()) return; // Prevent empty submissions

      // Start fade-out animation
      setTransitionState("fading");
      setTimeout(() => {
        setIsInputVisible(false); // Hide input after fade-out
        setTransitionState("hidden");

        // Decode and animate word-by-word
        setTimeout(async () => {
          try {
            const response = await fetch("http://localhost:5000/decrypt", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phrase: playerPhrase }),
            });

            const data = await response.json();
            const formattedMessage = toSentenceCase(data.decryptedMessage);
            setDecodedMessage(formattedMessage);

            // Split the message into words and animate
            const words = formattedMessage.split(" ");
            setDisplayedWords([]); // Reset displayed words
            words.forEach((word, index) => {
              setTimeout(() => {
                setDisplayedWords((prev) => [...prev, word]);
              }, index * 500); // 500ms delay between each word
            });
          } catch (err) {
            setDecodedMessage("Error decoding message.");
            setDisplayedWords(["Error", "decoding", "message."]);
          }
        }, 500); // Delay to allow fade-out to finish
      }, 1000); // Match the fadeOut animation duration (1s)
    }
  };

  return (
    <div className="cipher-app-container">
      {/* Instructions to the left */}
      <div className="instructions">
        <h2>Magical Cipher Scroll</h2>
        <p>
          Welcome, brave adventurer! A mystical scroll lies before you, its secrets locked by an arcane cipher.
          To reveal its hidden message, scribe the passphrase upon the parchment below.
          When you are ready, press Enter to unleash the magic.
        </p>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>

      {/* Scroll area */}
      <div className="scroll-container">
        {isInputVisible ? (
          <InputForm />
        ) : (
          <div className="scroll-output">
            {displayedWords.map((word, index) => (
              <motion.span
                key={index}
                className="arcane-word"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1 }}
              >
                {word}{" "}
              </motion.span>
            ))}
            <input
              className="invisible-input"
              ref={inputRef}
            >
            </input>
            <button className="try-again-button" onClick={() => window.location.reload()}>Try Again</button>
          </div>

        )}
      </div>
    </div >
  );
}