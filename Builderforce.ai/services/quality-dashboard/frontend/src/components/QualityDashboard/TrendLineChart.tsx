/**
 * Trend Line Chart
 * Shows time-series trends for open bugs, newly opened, and resolved
 * Using pure HTML/CSS/SVG with animation
 */

import React from "react";
import { TrendData } from "../../../types/quality";
import "./TrendLineChart.css";

interface TrendLineChartProps {
  labels: string[];
  totalOpen: number[];
  newlyOpened: number[];
  resolved: number[];
}

export function TrendLineChart({
  labels,
  totalOpen,
  newlyOpened,
  resolved,
}: TrendLineChartProps) {
  const maxTotalOpen = Math.max(...totalOpen, 1);
  const maxPoint = Math.max(
    ...totalOpen,
    ...newlyOpened,
    ...resolved,
    0
  );
  const minPoint = Math.min(...totalOpen, ...newlyOpened, ...resolved, 0);
  const range = maxPoint - minPoint || 1;

  const allData = [
    { series: "Total Open", values: totalOpen, color: "#3b82f6" },
    { series: "Newly Opened", values: newlyOpened, color: "#10b981" },
    { series: "Resolved", values: resolved, color: "#ef4444" },
  ];

  const getYPosition = (value: number) => {
    const normalized = (value - minPoint) / range;
    return 100 - normalized * 80; // Keep 10% padding top and bottom
  };

  const getXPosition = (index: number, total: number) => {
    return (index / (total - 1)) * 100;
  };

  const isDataEmpty = totalOpen.length === 0;

  return (
    <div className="trend-line-chart">
      <h3>Trend Analysis</h3>
      <div className="chart-container">
        {isDataEmpty ? (
          <div className="no-data">No data available for the selected time range</div>
        ) : (
          <svg width="100%" height="200" viewBox="0 0 1000 200" className="chart-svg">
            {/* Grid lines */}
            <line x1={0} y1={100} x2={1000} y2={100} stroke="#e5e7eb" strokeWidth="1" />
            <line x1={0} y1={200} x2={1000} y2={200} stroke="#e5e7eb" strokeWidth="1" />
            <line x1={0} y1={20} x2={1000} y2={20} stroke="#e5e7eb" strokeWidth="1" />

            {/* Y-axis labels */}
            <text x="990" y={10} fontSize="10" fill="#6b7280" textAnchor="end" className="axis-label">
              {maxPoint}
            </text>
            <text x="990" y={100} fontSize="10" fill="#6b7280" textAnchor="end" className="axis-label">
              {(maxPoint - range / 2).toFixed(0)}
            </text>
            <text x="990" y={190} fontSize="10" fill="#6b7280" textAnchor="end" className="axis-label">
              {minPoint}
            </text>

            {/* X-axis labels */}
            {labels.map((label, index) => {
              if (index % Math.ceil(labels.length / 5) !== 0 && labels.length > 5) {
                return null;
              }
              return (
                <text
                  key={index}
                  x={getXPosition(index, labels.length)}
                  y={215}
                  fontSize="10"
                  fill="#6b7280"
                  textAnchor="middle"
                  className="axis-label"
                >
                  {label}
                </text>
              );
            })}

            {/* Lines */}
            {allData.map((series) => {
              if (series.values.length === 0) return null;

              let points = "";
              series.values.forEach((value, index) => {
                const x = getXPosition(index, series.values.length);
                const y = getYPosition(value);

                if (points === "") {
                  points += `M ${x} ${y}`;
                } else {
                  points += ` L ${x} ${y}`;
                }
              });

              return (
                <path
                  key={series.series}
                  d={points}
                  fill="none"
                  stroke={series.color}
                  strokeWidth="2"
                  className="trend-line"
                >
                  <animate
                    attributeName="stroke-dasharray"
                    from="1000"
                    to="0"
                    dur="1s"
                    fill="freeze"
                  />
                </path>
              );
            })}

            {/* Data points */}
            {allData.map((series) => (
              series.values.map((value, index) => (
                <circle
                  key={`${series.series}-${index}`}
                  cx={getXPosition(index, series.values.length)}
                  cy={getYPosition(value)}
                  r="4"
                  fill={series.color}
                  className="data-point"
                />
              ))
            ))}

            {/* Legend */}
            {allData.map((series) => (
              <g
                key={series.series}
                transform="translate(10, 10)"
                className="legend-group"
              >
                <line
                  x1={0}
                  y1={0}
                  x2={80}
                  y2={0}
                  stroke={series.color}
                  strokeWidth="2"
                />
                <circle cx={5} cy={0} r="3" fill={series.color} />
                <text
                  x={90}
                  y={4}
                  fontSize="11"
                  fill="#374151"
                  className="legend-text"
                >
                  {series.series}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}