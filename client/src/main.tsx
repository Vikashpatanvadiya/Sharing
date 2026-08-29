import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerPwa } from "./lib/pwa";
import { toast } from "./hooks/use-toast";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// A new build is live: offer a reload rather than swapping code underneath a
// half-finished upload.
registerPwa(() => {
  toast({
    title: "Update available",
    description: "Reload to get the latest version.",
    duration: 20000,
  });
});
