import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Deliberately not wrapped in <StrictMode>: its dev-only double-mount would
// run effects twice, and a live interview must never open two sessions.
createRoot(document.getElementById("root")!).render(<App />);
