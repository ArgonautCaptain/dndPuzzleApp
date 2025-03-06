import { useState, useEffect } from "react";

export default function DMPanel() {
  const [secretPhrase, setSecretPhrase] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [invalidWords, setInvalidWords] = useState([]);

  // Function to validate the message in real-time
  useEffect(() => {
    if (message.trim() === "") {
      setInvalidWords([]);
      return;
    }

    const validateMessage = async () => {
      try {
        const response = await fetch("http://localhost:5000/validate-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });

        const data = await response.json();
        setInvalidWords(data.invalidWords || []);
      } catch (error) {
        console.error("Validation error:", error);
      }
    };

    validateMessage();
  }, [message]);

  // Function to save the message
  const saveMessage = async () => {
    if (invalidWords.length > 0) {
      setStatus("Cannot save. Message contains invalid words.");
      return;
    }

    try {
      const response = await fetch("http://localhost:5000/set-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase: secretPhrase, message }),
      });

      const data = await response.json();
      setStatus(data.message);
    } catch (error) {
      setStatus("Error setting message.");
    }
  };

  return (
    <div style={{ maxWidth: "400px", margin: "auto", textAlign: "center", padding: "20px", color: "white" }}>
      <h2>DM Control Panel</h2>

      <label>Set Secret Phrase (Can be anything):</label>
      <input
        type="text"
        value={secretPhrase}
        onChange={(e) => setSecretPhrase(e.target.value)}
        placeholder="Enter secret phrase..."
        style={{ width: "100%", padding: "8px", margin: "10px 0" }}
      />

      <label>Enter Message to Encrypt (Only common words allowed):</label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Enter text here..."
        rows="4"
        style={{ width: "100%", padding: "8px", margin: "10px 0" }}
      />

      {invalidWords.length > 0 && (
        <p style={{ color: "red" }}>
          Invalid words: {invalidWords.join(", ")}
        </p>
      )}

      <button onClick={saveMessage} style={{ padding: "10px", cursor: "pointer" }}>
        Encrypt & Save
      </button>

      <p>{status}</p>
    </div>
  );
}
