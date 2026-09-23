import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";

import { sessionClient } from "@app/api/client";
import "@app/main.css";
import { ConfirmProvider } from "@app/components/Confirm";
import { App } from "@app/islands/app/App";

const client = sessionClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
);
