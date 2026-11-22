import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/popup/App";
import { currentLang } from "@/lib/i18n";
import "@/styles/tailwind.css";

document.documentElement.lang = currentLang();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
