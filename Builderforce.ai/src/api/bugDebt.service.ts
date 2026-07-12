/**
 * Bug Debt Overview Service
 * 
 * Provides aggregated metrics about open bugs:
 * - Total open bugs
 * - Bugs by severity
 * - Bugs by age
 * - Trend analysis (previous period comparisons)
 */

export interface Bug {
  id: string;
  title: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  createdDate: Date;
  updatedDate: Date;
  [key: string]: any;
}

export interface BugsBySeverity {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface BugsByAge {
  lessThan7Days: number;
  between7And30Days: number;
  between30And90Days: number;
  moreThan90Days: number;
  total: number;
}

export interface BugTrend {
  current: number;
  previous: number;
  change: number; // positive = growing, negative = shrinking
  percentageChange: number;
}

export interface BugDebtOverview {
  totalOpenBugs: BugTrend;
  bySeverity: {
    critical: BugTrend;
    high: BugTrend;
    medium: BugTrend;
    low: BugTrend;
  };
  byAge: BugsByAge;
  lastUpdated: Date;
  dataSource: string;
}

export interface BugDebtServiceInterface {
  fetchOpenBugs(): Promise<Bug[]>;
  
  // Public API endpoints
  getOverview(period?: 'week' | 'month'): Promise<BugDebtOverview>;
  
  // Internal helper methods
  _calculateSeverityCounts(bugs: Bug[]): BugsBySeverity;
  _calculateAgeCounts(bugs: Bug[]): BugsByAge;
  _calculateTrend(current: number, previous: number): BugTrend;
}

class BugDebtService implements BugDebtServiceInterface {
  private mockBugs: Bug[] = [];

  async fetchOpenBugs(): Promise<Bug[]> {
    // In production, integrate with actual bug tracking system (Jira, GitHub Issues, etc.)
    // For now, return mock data
    
    if (this.mockBugs.length === 0) {
      this.mockBugs = this._generateMockBugs();
    }
    
    // Simulate API latency
    await this._sleep(300);
    
    // Return only open bugs
    return this.mockBugs.filter(bug => bug.status === 'Open');
  }

  async getOverview(period: 'week' | 'month' = 'week'): Promise<BugDebtOverview> {
    const bugs = await this.fetchOpenBugs();
    
    const now = new Date();
    const timeRangeMs = period === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    
    // Calculate previous period (same duration before current period)
    const previousPeriodStart = new Date(now.getTime() - timeRangeMs);
    const previousPeriodEnd = new Date(now.getTime() - timeRangeMs);
    
    const previousPeriodBugs = await this._fetchBugsFromPreviousPeriod(
      bugs,
      previousPeriodStart,
      previousPeriodEnd
    );
    
    // Aggregate current data
    const bySeverity = this._calculateTrendBySeverity(bugs);
    const byAge = this._calculateAgeCounts(bugs);
    
    // Aggregate previous period data
    const previousBySeverity = this._calculateTrendBySeverity(previousPeriodBugs);
    
    return {
      totalOpenBugs: {
        current: bySeverity.total,
        previous: previousBySeverity.total,
        change: previousBySeverity.total - bySeverity.total,
        percentageChange:
          previousBySeverity.total === 0
            ? bySeverity.total > 0
              ? 100
              : 0
            : ((bySeverity.total - previousBySeverity.total) / previousBySeverity.total) * 100,
      },
      bySeverity: {
        critical: this._getTrendBySeverity(bugs, previousBySeverity.critical, 'Critical'),
        high: this._getTrendBySeverity(bugs, previousBySeverity.high, 'High'),
        medium: this._getTrendBySeverity(bugs, previousBySeverity.medium, 'Medium'),
        low: this._getTrendBySeverity(bugs, previousBySeverity.low, 'Low'),
      },
      byAge,
      lastUpdated: now,
      dataSource: period === 'week' ? 'Last 7 days' : 'Last 30 days',
    };
  }

  private _calculateSeverityCounts(bugs: Bug[]): BugsBySeverity {
    return {
      critical: bugs.filter(b => b.severity === 'Critical').length,
      high: bugs.filter(b => b.severity === 'High').length,
      medium: bugs.filter(b => b.severity === 'Medium').length,
      low: bugs.filter(b => b.severity === 'Low').length,
      total: bugs.length,
    };
  }

  private _calculateAgeCounts(bugs: Bug[]): BugsByAge {
    const now = new Date();
    
    return {
      lessThan7Days: bugs.filter(bug => this._getAgeInDays(bug.createdDate, now) < 7).length,
      between7And30Days: bugs.filter(
        bug => this._getAgeInDays(bug.createdDate, now) >= 7 && this._getAgeInDays(bug.createdDate, now) <= 30
      ).length,
      between30And90Days: bugs.filter(
        bug => this._getAgeInDays(bug.createdDate, now) > 30 && this._getAgeInDays(bug.createdDate, now) <= 90
      ).length,
      moreThan90Days: bugs.filter(bug => this._getAgeInDays(bug.createdDate, now) > 90).length,
      total: bugs.length,
    };
  }

  private _getTrendBySeverity(
    currentBugs: Bug[],
    previousCount: number,
    severity: 'Critical' | 'High' | 'Medium' | 'Low'
  ): BugTrend {
    const currentCount = currentBugs.filter(b => b.severity === severity).length;
    
    return this._calculateTrend(currentCount, previousCount);
  }

  private _calculateTrend(current: number, previous: number): BugTrend {
    const change = previous - current;
    const percentageChange =
      previous === 0
        ? current > 0
          ? 100
          : 0
        : Math.round(((change) / previous) * 100) * -1; // Invert for increasing trend (show positive = growing)

    return {
      current,
      previous,
      change,
      percentageChange,
    };
  }

  /**
   * Fetch bugs from previous period accounting for reuse of mock data
   */
  private async _fetchBugsFromPreviousPeriod(
    currentBugs: Bug[],
    start: Date,
    end: Date
  ): Promise<Bug[]> {
    // In production, this would fetch from the bug tracking system with date filters
    // For now, we simulate by randomly filtering from current bugs
    const pastBugs = currentBugs.filter(bug => {
      return bug.createdDate >= start && bug.createdDate <= end;
    });
    
    // Ensure we have enough mock data
    if (pastBugs.length === 0 && currentBugs.length > 0) {
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      return [
        ...currentBugs,
        this._generateMockBug({
          createdDate: new Date(weekAgo.getTime() - 7 * 24 * 60 * 60 * 1000),
          id: `bug-${Date.now()}-past-1`,
        }),
        this._generateMockBug({
          createdDate: new Date(weekAgo.getTime() - 12 * 24 * 60 * 60 * 1000),
          id: `bug-${Date.now()}-past-2`,
        }),
      ].filter(bug => bug.createdDate >= start && bug.createdDate <= end);
    }
    
    return pastBugs;
  }

  private _generateMockBugs(): Bug[] {
    const severities: Array<'Critical' | 'High' | 'Medium' | 'Low'> = [
      'Critical',
      'High',
      'Medium',
      'Low',
    ];
    
    const statuses: Array<'Open' | 'In Progress' | 'Resolved' | 'Closed'> = [
      'Open',
      'Open',
      'Open',
      'Open',
      'In Progress',
    ];
    
    const titles = [
      'Authentication token expiration',
      'Database connection timeout',
      'Memory leak in user service',
      'Slow query performance',
      'API rate limit exceeded',
      'Payment processing failure',
      'Missing error handling in checkout',
      'Race condition in cache',
      'UI responsiveness issue',
      'API documentation outdated',
    ];
    
    const bugs: Bug[] = [];
    const now = new Date();
    
    // Generate 25 open bugs at various ages
    for (let i = 0; i < 25; i++) {
      const seedDate = new Date(now.getTime() - i * 2 * 24 * 60 * 60 * 1000);
      const severity = severities[Math.floor(Math.random() * severities.length)];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const title = titles[Math.floor(Math.random() * titles.length)];
      
      bugs.push(this._generateMockBug({ severity, status, title, createdDate: seedDate }));
    }
    
    return bugs;
  }

  private _generateMockBug(overrides?: Partial<Bug>): Bug {
    const now = new Date();
    const createdDate = overrides?.createdDate || new Date(now.getTime() - Math.random() * 90 * 24 * 60 * 60 * 1000);
    
    return {
      id: overrides?.id || `bug-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      title: overrides?.title || 'Mock bug from data',
      severity: overrides?.severity || 'Medium',
      status: overrides?.status || 'Open',
      createdDate,
      updatedDate: new Date(createdDate.getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000),
    };
  }

  private _getAgeInDays(createdDate: Date, now: Date): number {
    const diffMs = now.getTime() - createdDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const bugDebtService = new BugDebtService();

// Export companion types
export type {
  Bug,
  BugsBySeverity,
  BugsByAge,
  BugTrend,
  BugDebtOverview,
};