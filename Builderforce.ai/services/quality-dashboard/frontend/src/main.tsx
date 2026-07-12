/**
 * Quality Dashboard App Entry Point
 * Mounts the QualityDashboard component into the React root
 * Reads initial filters from URL on mount for AC-05 shareability.
 */

import React from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QualityDashboard } from "./App";
import "./index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("No root element found");
}

createRoot(container).render(
  <StrictMode>
    <QualityDashboard />
  </StrictMode>
);