import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { I18nProvider } from "./i18n";
import "./ui-global.css";
import App from "./App.tsx";
import { C, UI } from "./theme";
import { queryClient } from "./app/queryClient";
import { registerServiceWorker } from "./app/swUpdate";
import AppErrorBoundary from "./components/AppErrorBoundary";
import { installChunkErrorHandlers } from "./lib/chunkReload";

document.body.style.fontFamily = UI;
document.body.style.color = C.text;
document.body.style.background = C.bg;

// Self-heal stale-cache chunk-load failures (a tab open across a deploy) BEFORE React
// mounts, so an unhandled dynamic-import rejection can't white-screen the app.
installChunkErrorHandlers();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

// Register the notifications service worker (enables chat notifications on mobile)
// and wire eager update handling: a fresh deploy fires `controllerchange`, which
// surfaces a non-blocking "new version available" refresh banner.
registerServiceWorker();
