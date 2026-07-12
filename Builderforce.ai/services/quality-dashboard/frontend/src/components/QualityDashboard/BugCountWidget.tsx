/**
 * Bug Count Widget
 * Displays total open, newly opened, resolved counts and net change
 */

import React from "react";
import { BugCountSummary } from "../../types/quality";
import "./BugCountWidget.css";

interface BugCountWidgetProps {
  totalOpen: number;
  newlyOpened: number;
  resolved: number;
  netChange: number;
}

export function BugCountWidget({
  totalOpen,
  newlyOpened,
  resolved,
  netChange,
}: BugCountWidgetProps) {
  const getNetChangeColor = (value: number) => {
    return value >= 0 ? "text-green-600" : "text-red-600";
  };

  const getDeltaIcon = (value: number) => {
    return value >= 0 ? (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
        <polyline points="17 18 23 18 23 12"></polyline>
      </svg>
    ) : (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="1 18 10.5 8.5 15.5 13.5 23 6"></polyline>
        <polyline points="7 18 1 18 1 12"></polyline>
      </svg>
    );
  };

  return (
    <div className="bug-count-widget">
      <h3>Bug Count Summary</h3>
      <div className="count-grid">
        <div className="count-card primary">
          <div className="count-label">Total Open</div>
          <div className="count-value">{totalOpen}</div>
          <div className="card-icon">bugs</div>
        </div>

        <div className="count-card secondary">
          <div className="count-label">Newly Opened</div>
          <div className="count-value secondary">{newlyOpened}</div>
          <div className="card-icon">add</div>
        </div>

        <div className="count-card secondary">
          <div className="count-label">Resolved</div>
          <div className="count-value secondary">{resolved}</div>
          <div className="card-icon">check-circle</div>
        </div>

        <div className="count-card highlight">
          <div className="count-label">Net Change</div>
          <div className={`count-value ${getNetChangeColor(netChange)}`}>
            {getDeltaIcon(netChange)}
            {netChange >= 0 ? "+" : ""}
            {netChange}
          </div>
          <div className="card-icon">trending-up</div>
        </div>
      </div>

      <div className="count-description">
        <p>
          {netChange >= 0
            ? `${totalOpen} open bugs + ${netChange} new in this window`
            : `${totalOpen} open bugs - ${Math.abs(netChange)} closed in this window`}
        </p>
      </div>
    </div>
  );
}