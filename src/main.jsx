import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Absolute: from /prepayment/ a relative "sw.js" resolves to
    // /prepayment/sw.js and 404s. The scope has to be the site root anyway,
    // since one worker serves every route.
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  });
}
