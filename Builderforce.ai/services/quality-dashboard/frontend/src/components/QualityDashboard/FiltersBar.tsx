/**
 * Filters Bar
 * Provides filter controls for project, team, component, assignee, and severity
 * Filters are serialized to URL and persisted per session
 */

import React from "react";
import { BugFilter } from "../../../types/quality";
import "./FiltersBar.css";

interface FiltersBarProps {
  filter: BugFilter;
  onFilterChange: (filter: BugFilter) => void;
}

export function FiltersBar({ filter, onFilterChange }: FiltersBarProps) {
  const handleFilterChange = (
    key: keyof Partial<BugFilter>,
    value: string | number | undefined
  ) => {
    const newFilter = { ...filter, [key]: value };
    onFilterChange(newFilter);
    window.history.pushState({}, "", `?${new URLSearchParams(newFilter as any).toString()}`);
  };

  return (
    <div className="filters-bar">
      <div className="filter-row">
        <div className="filter-group">
          <label htmlFor="filter-project">Project</label>
          <select
            id="filter-project"
            value={filter.project_id || ""}
            onChange={(e) =>
              handleFilterChange("project_id", e.target.value ? parseInt(e.target.value) : undefined)
            }
          >
            <option value="">All Projects</option>
            <option value="1">Project 1</option>
            <option value="2">Project 2</option>
            <option value="3">Project 3</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="filter-team">Team</label>
          <select
            id="filter-team"
            value={filter.team || ""}
            onChange={(e) => handleFilterChange("team", e.target.value || undefined)}
          >
            <option value="">All Teams</option>
            <option value="auth">Auth</option>
            <option value="payments">Payments</option>
            <option value="docs">Docs</option>
            <option value="core">Core</option>
            <option value="performance">Performance</option>
            <option value="ui">UI</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="filter-component">Component</label>
          <select
            id="filter-component"
            value={filter.component || ""}
            onChange={(e) => handleFilterChange("component", e.target.value || undefined)}
          >
            <option value="">All Components</option>
            <option value="auth-service">Auth Service</option>
            <option value="ui">UI</option>
            <option value="api">API</option>
            <option value="docs">Docs</option>
            <option value="core">Core</option>
            <option value="frontend">Frontend</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="filter-assignee">Assignee</label>
          <select
            id="filter-assignee"
            value={filter.assignee || ""}
            onChange={(e) => handleFilterChange("assignee", e.target.value || undefined)}
          >
            <option value="">Any Assignee</option>
            <option value="alice">Alice</option>
            <option value="bob">Bob</option>
            <option value="carol">Carol</option>
            <option value="dave">Dave</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="filter-severity">Severity</label>
          <select
            id="filter-severity"
            value={filter.severity_threshold || ""}
            onChange={(e) => handleFilterChange("severity_threshold", e.target.value || undefined)}
          >
            <option value="">All Severities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>

      <div className="filter-row">
        <div className="filter-group">
          <label htmlFor="filter-time-window">Time Window (days)</label>
          <select
            id="filter-time-window"
            value={filter.time_window_days}
            onChange={(e) => handleFilterChange("time_window_days", parseInt(e.target.value))}
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </div>

        <button
          onClick={() => {
            const emptyFilter = {
              project_id: undefined,
              team: undefined,
              component: undefined,
              assignee: undefined,
              severity_threshold: undefined,
              time_window_days: 30,
            };
            onFilterChange(emptyFilter);
            window.history.pushState({}, "", "?");
          }}
          className="reset-filters-button"
        >
          Reset Filters
        </button>
      </div>
    </div>
  );
}