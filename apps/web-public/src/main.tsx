import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { LanguageProvider } from "./i18n/LanguageContext.js";
import "./styles/globals.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
