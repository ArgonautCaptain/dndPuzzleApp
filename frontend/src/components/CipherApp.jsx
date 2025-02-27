import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

export default function CipherApp() {
  const [playerPhrase, setPlayerPhrase] = useState("");
  const [encryptedMessage, setEncryptedMessage] = useState("");
  const [decodedMessage, setDecodedMessage] = useState("");
  const [error, setError] = useState("");

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

  // Attempt to decode the message
  const attemptDecode = async () => {
    try {
      const response = await fetch("http://localhost:5000/decrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase: playerPhrase }),
      });

      const data = await response.json();
      setDecodedMessage(data.decryptedMessage);
    } catch (err) {
      setDecodedMessage("Error decoding message.");
    }
  };

  return (
    <div style={{ maxWidth: "500px", margin: "auto", textAlign: "center", padding: "20px" }}>
      <h2>Magical Cipher Scroll</h2>

      {error ? <p style={{ color: "red" }}>{error}</p> : <p></p>}

      <label>Enter Secret Words to Decode:</label>
      <input
        type="text"
        value={playerPhrase}
        onChange={(e) => setPlayerPhrase(e.target.value)}
        placeholder="Enter secret words..."
        style={{ width: "100%", padding: "8px", margin: "10px 0" }}
      />

      <button onClick={attemptDecode} style={{ padding: "10px", cursor: "pointer" }}>
        Decode Message
      </button>

      <h3>Decryption Output:</h3>
      <p style={{ border: "1px solid #ccc", padding: "10px", minHeight: "50px" }}>
        {decodedMessage}
      </p>
    </div>
  );
}
//TODO: Add formatting to the correct output phrase so that it has proper capitalization.
//TODO: Make it a greek mechanical computer style decoder
//TODO: Need scroll and cipher wheel