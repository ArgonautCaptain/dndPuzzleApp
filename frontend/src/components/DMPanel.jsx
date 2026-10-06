import { useState, useEffect } from "react";
import api from "../api/apiClient";

export default function DMPanel() {
  const [secretPhrase, setSecretPhrase] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [invalidWords, setInvalidWords] = useState([]);
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const hasUppercasePhrase = secretPhrase !== secretPhrase.toLowerCase();

  const clearPanel = () => {
    setToken("");
    setPassword("");
    setSecretPhrase("");
    setMessage("");
    setInvalidWords([]);
    setStatus("");
  };

  const unlockPanel = async (event) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await api.post("/dm/login", { password });
      setToken(response.data.token);
      setPassword("");
    } catch (error) {
      setStatus(error.response?.data?.error || "Unable to reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const lockPanel = async () => {
    const currentToken = token;
    clearPanel();
    try {
      await api.post("/dm/logout", {}, { headers: { Authorization: `Bearer ${currentToken}` } });
    } catch {
      // Local access is already cleared; server sessions also expire automatically.
    }
  };

  // Function to validate the message in real-time
  useEffect(() => {
    if (!token || message.trim() === "") {
      setInvalidWords([]);
      return;
    }

    const controller = new AbortController();
    const validateMessage = async () => {
      try {
        const response = await api.post("/validate-message", { message }, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        setInvalidWords(response.data.invalidWords || []);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error.response?.status === 401 || error.response?.status === 503) {
          setToken("");
          setSecretPhrase("");
          setMessage("");
          setInvalidWords([]);
        }
        setStatus(error.response?.data?.error || "Unable to validate the message.");
      }
    };

    validateMessage();
    return () => controller.abort();
  }, [message, token]);

  // Function to save the message
  const saveMessage = async () => {
    if (busy) return;
    if (hasUppercasePhrase) {
      setStatus("Secret phrase must use lowercase letters.");
      return;
    }
    if (invalidWords.length > 0) {
      setStatus("Cannot save. Message contains invalid words.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const response = await api.post("/set-message", {
        phrase: secretPhrase,
        message,
      }, { headers: { Authorization: `Bearer ${token}` } });

      setStatus(response.data.message);
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 503) clearPanel();
      setStatus(error.response?.data?.error || "Error setting message.");
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="dm-panel">
        <h2>DM Control Panel</h2>
        <p>Enter your DM password to unlock the panel.</p>
        <form onSubmit={unlockPanel}>
          <label htmlFor="dm-password">DM password</label>
          <input
            id="dm-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
          />
          <button type="submit" disabled={busy || !password}>
            {busy ? "Unlocking…" : "Unlock panel"}
          </button>
        </form>
        <p role="status">{status}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "400px", margin: "auto", textAlign: "center", padding: "20px", color: "white" }}>
      <h2>DM Control Panel</h2>
      <button onClick={lockPanel} disabled={busy}>Lock panel</button>

      <label htmlFor="secret-phrase">Set Secret Phrase (lowercase letters only):</label>
      <input
        id="secret-phrase"
        type="text"
        value={secretPhrase}
        onChange={(e) => setSecretPhrase(e.target.value)}
        placeholder="Enter secret phrase..."
        autoCapitalize="none"
        autoCorrect="off"
        aria-invalid={hasUppercasePhrase}
        aria-describedby={hasUppercasePhrase ? "secret-phrase-error" : undefined}
        style={{ width: "100%", padding: "8px", margin: "10px 0" }}
      />
      {hasUppercasePhrase && (
        <p id="secret-phrase-error" role="alert" style={{ color: "red" }}>
          Secret phrase must use lowercase letters. Spaces, numbers, and punctuation are allowed.
        </p>
      )}

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

      <button onClick={saveMessage} disabled={busy || hasUppercasePhrase || !secretPhrase.trim() || !message.trim() || invalidWords.length > 0} style={{ padding: "10px", cursor: "pointer" }}>
        {busy ? "Saving…" : "Encrypt & Save"}
      </button>

      <p role="status">{status}</p>
    </div>
  );
}
