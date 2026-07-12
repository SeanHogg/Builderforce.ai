/**
 * Severity Donut Chart
 * Visualizes bug distribution across Critical/High/Medium/Low tiers
 */

import React from "react";
import { TrendData, SeverityBreakdown } from "../../../types/quality";
import * as Recharts from "recharts";
import "./SeverityDonutChart.css";

interface SeverityDonutChartProps {
  breakdown: Record<"Critical" | "High" | "Medium" | "Low", number>;
  colors: Record<"Critical" | "High" | "Medium" | "Low", string>;
}

type Severity = "Critical" | "High" | "Medium" | "Low";

export function SeverityDonutChart({ breakdown, colors }: SeverityDonutChartProps) {
  const severityOrder: (keyof typeof breakdown)[] = ["Critical", "High", "Medium", "Low"];
  const data = severityOrder.map((severity) => ({
    name: severity,
    value: breakdown[severity],
    fill: colors[severity],
  }));

  const totals = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

  return (
    <div className="severity-donut-chart">
      <h3>Severity Distribution</h3>
      <div className="chart-container">
        <div className="donut-wrapper">
          <Recharts.DonutChart width={250} height={250}>
            <Recharts.Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius={100}
              innerRadius={50}
              paddingAngle={5}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Recharts.Cell key={index} fill={entry.fill} />
              ))}
            </Recharts.Pie>
            <Recharts.RecenterCar>RecenterCar</Recharts.RecenterCar>
          </Recharts.DonutChart>
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
        <span className="total-value">{totals}</span>
      </div>
    </div>
  );
}