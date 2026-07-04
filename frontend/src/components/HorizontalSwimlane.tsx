import { useState, useEffect } from 'react';

// Styles for horizontal scrolling
const horizontalScrollStyle: React.CSSProperties = {
  overflowX: 'auto',
  whiteSpace: 'nowrap',
  padding: '8px 0',
};

const laneStyle: React.CSSProperties = {
  display: 'inline-block',
  minWidth: '200px',
  padding: '12px',
  boxSizing: 'border-box',
};

// Example component for swimlane with horizontal scroll
export function HorizontalSwimlane({ lanes }) {
  return (
    <div style={horizontalScrollStyle}>
      {lanes.map((lane, index) => (
        <div key={index} style={laneStyle}>
          <h3>{lane.title}</h3>
          <p>{lane.content}</p>
        </div>
      ))}
    </div>
  );
}