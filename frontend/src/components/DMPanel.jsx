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
  const [attempts, setAttempts] = useState([]);
  const [logCursor, setLogCursor] = useState(null);
  const [nextBefore, setNextBefore] = useState(null);
  const [logRefresh, setLogRefresh] = useState(0);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState("");
  const hasUppercasePhrase = secretPhrase !== secretPhrase.toLowerCase();

  const clearPanel = () => {
    setToken("");
    setPassword("");
    setSecretPhrase("");
    setMessage("");
    setInvalidWords([]);
    setStatus("");
    setAttempts([]);
    setLogCursor(null);
    setNextBefore(null);
    setLogError("");
  };

  useEffect(() => {
    if (!token) {
      setAttempts([]);
      setLogCursor(null);
      setNextBefore(null);
      setLogLoading(false);
      return;
    }
    const controller = new AbortController();
    const loadLog = async () => {
      setLogLoading(true);
      setLogError("");
      try {
        const response = await api.get("/dm/attempts", {
          headers: { Authorization: `Bearer ${token}` },
          params: logCursor ? { before: logCursor } : {},
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setAttempts((previous) => logCursor ? [...previous, ...response.data.attempts] : response.data.attempts);
        setNextBefore(response.data.nextBefore);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error.response?.status === 401) {
          setToken("");
          setSecretPhrase("");
          setMessage("");
          setAttempts([]);
          setLogCursor(null);
          setNextBefore(null);
          setStatus("Your DM session expired. Unlock the panel again.");
        }
        setLogError(error.response?.data?.error || "Unable to load player attempts. Try refreshing the log.");
      } finally {
        if (!controller.signal.aborted) setLogLoading(false);
      }
    };
    loadLog();
    return () => controller.abort();
  }, [token, logCursor, logRefresh]);

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
    <div className="dm-console">
      <div className="dm-editor">
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
      <section className="attempt-log" aria-labelledby="attempt-log-heading">
        <h2 id="attempt-log-heading">Player attempt log</h2>
        <p>Newest first. History includes attempts on previously saved puzzles.</p>
        <button disabled={logLoading} onClick={() => {
          setLogCursor(null);
          setLogRefresh((value) => value + 1);
        }}>Refresh log</button>
        {logError && <p role="alert">{logError}</p>}
        {logLoading && <p role="status">Loading attempts…</p>}
        {!logLoading && !logError && attempts.length === 0 && <p>No player attempts recorded yet.</p>}
        <ol className="attempt-list">
          {attempts.map((attempt) => (
            <li key={attempt.id}>
              <div className="attempt-summary">
                <time dateTime={attempt.attemptedAt}>{new Date(attempt.attemptedAt).toLocaleString()}</time>
                <strong>{attempt.correct === null ? "No puzzle set" : attempt.correct ? "Correct" : "Incorrect"}</strong>
              </div>
              <p><b>Input:</b> <span className="attempt-phrase">{attempt.input}</span></p>
              {attempt.input !== attempt.normalizedInput && <p><b>Used as:</b> {attempt.normalizedInput}</p>}
              {attempt.output !== null && <p><b>Output:</b> {attempt.output}</p>}
            </li>
          ))}
        </ol>
        {nextBefore !== null && <button disabled={logLoading} onClick={() => {
          if (logCursor === nextBefore) setLogRefresh((value) => value + 1);
          else setLogCursor(nextBefore);
        }}>Load older attempts</button>}
      </section>
    </div>
  );
}
