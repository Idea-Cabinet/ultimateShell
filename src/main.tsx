import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installInputMethodGuard } from "./utils/inputMethod";
import { I18nProvider } from "./i18n";

const removeInputMethodGuard = installInputMethodGuard();
import.meta.hot?.dispose(removeInputMethodGuard);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
