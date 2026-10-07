import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { motion } from "motion/react";
import api from "../api/apiClient";

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
  const [displayedWords, setDisplayedWords] = useState([]);
  const [fullMessage, setFullMessage] = useState("");
  const [error, setError] = useState("");
  const [isInputVisible, setIsInputVisible] = useState(true); // Track input visibility
  const [transitionState, setTransitionState] = useState("visible"); // Track animation state
  const inputRef = useRef(null);
  const outputRef = useRef(null);
  const measureRef = useRef(null);

  useLayoutEffect(() => {
    const output = outputRef.current;
    const measure = measureRef.current;
    if (!output || !measure || !fullMessage) return;

    let active = true;
    const fitMessage = () => {
      if (!active || !output.clientWidth || !output.clientHeight) return;
      // Start at the responsive CSS size, then shrink against the entire message.
      // Measuring all words keeps the font steady throughout the reveal animation.
      output.style.removeProperty("font-size");
      const preferredSize = parseFloat(getComputedStyle(output).fontSize);
      const fits = () => measure.scrollHeight <= measure.clientHeight &&
        measure.scrollWidth <= measure.clientWidth;
      if (fits()) return;

      let lower = 1;
      let upper = preferredSize;
      for (let step = 0; step < 12; step += 1) {
        const candidate = (lower + upper) / 2;
        output.style.fontSize = `${candidate}px`;
        if (fits()) lower = candidate;
        else upper = candidate;
      }
      // Leave extra room for the script font's descenders and rounding differences.
      output.style.fontSize = `${lower * 0.95}px`;
    };

    fitMessage();
    const observer = new ResizeObserver(fitMessage);
    observer.observe(output);
    document.fonts.ready.then(fitMessage);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [fullMessage]);

  useEffect(() => {
    if (isInputVisible) inputRef.current?.focus();
  }, [isInputVisible]);

  // Fetch the encrypted message when the component loads
  useEffect(() => {
    const fetchMessage = async () => {
      try {
        await api.get("/get-message");
      } catch (err) {
        console.error("Error fetching message:", err);
        setError(err.response?.status === 404
          ? "No message set yet."
          : "The scroll is temporarily unavailable. Please try again shortly.");
      }
    };
    fetchMessage();
  }, []);

  // Handle form submission (Enter key or button click)
  const handleSubmit = async (e) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!playerPhrase.trim() || transitionState !== "visible") return;

      // Start fade-out animation
      setTransitionState("fading");
      setTimeout(() => {
        setIsInputVisible(false); // Hide input after fade-out
        setTransitionState("hidden");

        // Decode and animate word-by-word
        setTimeout(async () => {
          try {
            const response = await api.post("/decrypt", {
              phrase: playerPhrase,
            });

            const formattedMessage = toSentenceCase(
              response.data.decryptedMessage
            );
            setFullMessage(formattedMessage);

            const words = formattedMessage.split(" ");
            setDisplayedWords([]);
            words.forEach((word, index) => {
              setTimeout(() => {
                setDisplayedWords((prev) => [...prev, word]);
              }, index * 500);
            });
          } catch (err) {
            console.error("Error decoding message:", err);
            setFullMessage("Error decoding message.");
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
          To reveal its hidden message, scribe the passphrase upon the parchment.
          When you are ready, press Enter to unleash the magic.
        </p>
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>

      {/* Scroll area */}
      <div className="scroll-container">
        {isInputVisible ? (
          <form onSubmit={(event) => event.preventDefault()} className={`scroll-input-form ${transitionState}`}>
            <textarea
              ref={inputRef}
              value={playerPhrase}
              onChange={(event) => setPlayerPhrase(event.target.value)}
              onKeyDown={handleSubmit}
              placeholder="Write your passphrase..."
              aria-label="Arcane passphrase"
              autoCapitalize="none"
              rows={4}
              className="scroll-input"
            />
          </form>
        ) : (
          <div className="scroll-output">
            <div className="scroll-message" ref={outputRef} aria-label="Decoded scroll">
              <div className="scroll-measure" ref={measureRef} aria-hidden="true">{fullMessage}</div>
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
            </div>
            <button className="try-again-button" onClick={() => window.location.reload()}>Try Again</button>
          </div>

        )}
      </div>
    </div >
  );
}
