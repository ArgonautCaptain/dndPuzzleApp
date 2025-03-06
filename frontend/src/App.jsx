import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import CipherApp from "./components/CipherApp";
import DMPanel from "./components/DMPanel";
//import styles from ./App.css
import './App.css';

function App() {
  return (
    <div>
      <Routes>
        <Route path="/" element={<CipherApp />} />
        <Route path="/dm" element={<DMPanel />} />
      </Routes>
      <div className="footer">
        <nav>
          <Link to="/">Player Page</Link> | <Link to="/dm">DM Panel</Link>
        </nav>
      </div>
    </div>

  );
}

export default App;
