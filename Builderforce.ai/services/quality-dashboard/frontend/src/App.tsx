/**
 * Quality Dashboard root component.
 *
 * Reads the initial filter state from the URL query string so that a shared
 * link (AC-05) restores the dashboard in the same filtered state for any user
 * with access, then renders the dashboard view.
 */

import React from "react";
import { QualityDashboardView } from "./components/QualityDashboard";
import { extractFiltersFromUrl } from "./utils/filters";
import type { BugFilter } from "./types/quality";
import "./index.css";

export function QualityDashboard() {
  // Derive the initial filter from the URL exactly once, on first render.
  const initialFilter = React.useMemo<BugFilter>(() => extractFiltersFromUrl(), []);

  return <QualityDashboardView initialFilter={initialFilter} />;
}

export default QualityDashboard;