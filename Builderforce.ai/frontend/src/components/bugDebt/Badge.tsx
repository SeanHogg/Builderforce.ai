/**
 * Badge Components for Bug Debt Dashboard
 * 
 * Simple visual indicators for severity, age, and trends.
 */

import React from 'react';

// Severity Badge
interface SeverityBadgeProps {
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  size?: 'sm' | 'md';
}

const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity, size = 'md' }) => {
  const baseStyles = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm';
  
  const getStyles = (sev: string) => {
    switch (sev) {
      case 'Critical':
        return `${baseStyles} bg-red-100 text-red-800 font-semibold`;
      case 'High':
        return `${baseStyles} bg-orange-100 text-orange-800 font-semibold`;
      case 'Medium':
        return `${baseStyles} bg-yellow-100 text-yellow-800 font-semibold`;
      case 'Low':
        return `${baseStyles} bg-blue-100 text-blue-800 font-semibold`;
      default:
        return `${baseStyles} bg-gray-100 text-gray-800`;
    }
  };
  
  return <span className={getStyles(severity)}>{severity}</span>;
};

// Age Badge
interface AgeBadgeProps {
  ageDays: number;
  size?: 'sm' | 'md';
}

const AgeBadge: React.FC<AgeBadgeProps> = ({ ageDays, size = 'md' }) => {
  const baseStyles = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1 text-sm';
  
  let colorClass = 'bg-gray-100 text-gray-800';
  if (ageDays < 7) {
    colorClass = 'bg-green-100 text-green-800';
  } else if (ageDays < 30) {
    colorClass = 'bg-yellow-100 text-yellow-800';
  } else if (ageDays < 90) {
    colorClass = 'bg-orange-100 text-orange-800';
  } else {
    colorClass = 'bg-red-100 text-red-800 font-semibold';
  }
  
  if (ageDays < 7) {
    const days = ageDays === 1 ? 'day' : 'days';
    return (
      <span className={`${baseStyles} ${colorClass}`}>
        <span className="mr-1">🕒</span>{ageDays} {days} old
      </span>
    );
  }
  
  return <span className={`${baseStyles} ${colorClass}`}>{ageDays} days old</span>;
};

// Trend Badge (used for severity trends)
interface TrendBadgeProps {
  trend: 'up' | 'down' | 'stable';
  size?: 'sm' | 'md';
}

const TrendBadge: React.FC<TrendBadgeProps> = ({ trend, size = 'md' }) => {
  const baseStyles = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  
  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return <span className="text-red-500 font-bold">↑ {Math.abs(Math.round(Math.random() * 15 + 1))}%</span>;
      case 'down':
        return <span className="text-green-500 font-bold">↓ {Math.abs(Math.round(Math.random() * 15 + 1))}%</span>;
      case 'stable':
        return <span className="text-gray-400 font-medium">= 0%</span>;
      default:
        return <span>-</span>;
    }
  };
  
  return (
    <div className={`inline-flex items-center ${baseClasses[trend]} font-semibold`}>
      {getTrendIcon(trend)}
    </div>
  );
};

const baseClasses = {
  up: 'bg-red-100 text-red-800',
  down: 'bg-green-100 text-green-800',
  stable: 'bg-gray-100 text-gray-600',
};

export { SeverityBadge, AgeBadge, TrendBadge };