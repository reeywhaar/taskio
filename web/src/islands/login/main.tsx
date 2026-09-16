import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@app/main.css";
import { Login } from "@app/islands/login/Login";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Login />
  </StrictMode>,
);
