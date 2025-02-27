import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import CipherApp from "./components/CipherApp";
import DMPanel from "./components/DMPanel";

function App() {
  return (
    <div>
      <div style={{ textAlign: "center", padding: "20px" }}>
        <h1>Magical Cipher App</h1>
        <nav>
          <Link to="/">Player Page</Link> | <Link to="/dm">DM Panel</Link>
        </nav>
      </div>

      <Routes>
        <Route path="/" element={<CipherApp />} />
        <Route path="/dm" element={<DMPanel />} />
      </Routes>
    </div>

  );
}

export default App;
