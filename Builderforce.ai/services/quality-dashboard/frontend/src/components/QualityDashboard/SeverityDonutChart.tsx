/**
 * Severity Donut Chart
 * Visualizes bug distribution across Critical/High/Medium/Low tiers
 * Using pure HTML/CSS/SVG (no external charting library)
 */

import React from "react";
import { SeverityBreakdown } from "../../types/quality";
import "./SeverityDonutChart.css";

type Severity = "Critical" | "High" | "Medium" | "Low";

interface SeverityDonutChartProps {
  breakdown: Record<Severity, number>;
  colors: Record<Severity, string>;
}

export function SeverityDonutChart({ breakdown, colors }: SeverityDonutChartProps) {
  const severityOrder: Severity[] = ["Critical", "High", "Medium", "Low"];
  const data = severityOrder.map((severity) => ({
    name: severity,
    value: breakdown[severity],
    fill: colors[severity],
  }));

  const total = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

  // Calculate SVG paths for donut segments
  const getSegmentPath = (
    value: number,
    color: string,
    index: number
  ): string => {
    if (total === 0) return "";

    const startAngle = (index * 360) / 4;
    const endAngle = ((index + 1) * 360) / 4;

    const innerRadius = 50;
    const outerRadius = 100;
    const cx = 125;
    const cy = 125;

    // Convert polar to cartesian coordinates
    const getCoordinates = (angle: number) => {
      const radians = ((angle - 90) * Math.PI) / 180;
      return {
        x: cx + outerRadius * Math.cos(radians),
        y: cy + outerRadius * Math.sin(radians),
      };
    };

    const startOuter = getCoordinates(startAngle + (endAngle - startAngle) * 0.2);
    const endOuter = getCoordinates(startAngle + (endAngle - startAngle) * 0.8);
    const startInner = getCoordinates(startAngle + (endAngle - startAngle) * 0.3);
    const endInner = getCoordinates(startAngle + (endAngle - startAngle) * 0.7);

    const largeArcFlag = value / total > 0.5 ? 1 : 0;

    return `M ${startOuter.x} ${startOuter.y}
            A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x} ${endOuter.y}
            L ${endInner.x} ${endInner.y}
            A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${startInner.x} ${startInner.y}
            Z`;
  };

  return (
    <div className="severity-donut-chart">
      <h3>Severity Distribution</h3>
      <div className="chart-container">
        <div className="donut-wrapper">
          <svg width="250" height="250" viewBox="0 0 250 250" className="donut-chart">
            <circle cx="125" cy="125" r="50" fill="#f3f4f6" />
            {data.map((entry, index) => (
              entry.value > 0 && (
                <path
                  key={entry.name}
                  d={getSegmentPath(entry.value, entry.fill, index)}
                  fill={entry.fill}
                  className="donut-segment"
                />
              )
            ))}
          </svg>
        </div>

        <div className="legend">
          {data.map((entry) => (
            <div key={entry.name} className="legend-item">
              <div
                className="legend-color"
                style={{ backgroundColor: entry.fill }}
              ></div>
              <div className="legend-label">
                <span className="legend-severity">{entry.name}</span>
                <span className="legend-count">{entry.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="total-count">
        <span className="total-label">Total Open Bugs:</span>
        <span className="total-value">{total}</span>
      </div>
    </div>
  );
}