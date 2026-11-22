import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/sidepanel/App";
import { ToastProvider } from "@/components/Toasts";
import { currentLang } from "@/lib/i18n";
import "@/styles/tailwind.css";

document.documentElement.lang = currentLang();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
