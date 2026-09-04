import React from "react";
import { createRoot } from "react-dom/client";

function App(): React.ReactElement {
  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Coding Agent Workbench</h1>
      <p>Scaffold is ready. No product code yet.</p>
    </div>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container not found");
}

const root = createRoot(container);
root.render(<App />);
