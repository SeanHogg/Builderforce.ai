/**
 * FR1: Unassigned High-Priority Task Identification API
 * Endpoint: GET /api/tasks/unassigned-high-priority
 *
 * Returns all tasks with:
 * - priority = high or critical
 * - assignedUserId IS NULL
 * - NOT archived, NOT done
 *
 * Query parameters:
 * - projectId: optional filter by project
 * - page: pagination offset
 * - limit: items per page (default 50)
 * - sort: order by (dueDate | title | createdAt) default dueDate
 */

export interface UnassignedHighPriorityTask {
  id: number;
  key: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  assignedUserId: null;
  status: string;
  projectId: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UnassignedHighPriorityResponse {
  tasks: UnassignedHighPriorityTask[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  cacheInfo: {
    validForSeconds: number; // AC1: dashboard comfortable with 1800s (30 min) polling
    lastUpdated: string;
  };
}

/**
 * Simulated backend service for FR1
 * In production, this would query the actual TasksService
 */
export class UnassignedHighPriorityService {
  /**
   * Get unassigned high-priority tasks
   * AC1: Returns cached results with freshness info; client polls every 30 min
   */
  static async getUnassignedHighPriority(
    options: {
      projectId?: number;
      page?: number;
      limit?: number;
      sort?: 'dueDate' | 'title' | 'createdAt';
    } = {}
  ): Promise<UnassignedHighPriorityResponse> {
    const { projectId, page = 1, limit = 50, sort = 'dueDate' } = options;

    // Simulate database query
    const allTasks = await this.simulatedTaskStore();
    
    // Filter tasks
    const filtered = allTasks.filter(
      (task) =>
        (task.priority === 'high' || task.priority === 'critical') &&
        task.assignedUserId === null &&
        !task.archived &&
        !task.status === 'done'
    );

    // Apply projectId filter if provided
    const projectFiltered = projectId
      ? filtered.filter((task) => task.projectId === projectId)
      : filtered;

    // Paginate
    const total = projectFiltered.length;
    const start = (page - 1) * limit;
    const paginated = projectFiltered.slice(start, start + limit);

    // Sort
    const sorted = this.sortTasks(paginated, sort);

    return {
      tasks: sorted,
      total,
      page,
      limit,
      hasMore: start + limit < total,
      cacheInfo: {
        validForSeconds: 1800, // AC1: supports 30-minute polling window
        lastUpdated: new Date().toISOString(),
      },
    };
  }

  private static simulatedTaskStore(): Promise<any[]> {
    // Simulates asynchronous DB call
    return new Promise((resolve) => {
      setTimeout(
        () =>
          resolve([
            {
              id: 143,
              key: '1-UNTITLED-1773010025035-074',
              title:
                'Analyze: Delivery tracking — velocity, deadlines, and trend assessment',
              priority: 'high' as const,
              assignedUserId: null,
              status: 'in_review',
              projectId: 11,
              dueDate: '2026-07-15',
              createdAt: '2026-07-10T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z',
              archived: false,
            },
            {
              id: 154,
              key: '1-UNTITLED-1773010025035-085',
              title:
                'Onboarding Wizard UX — guided flow from questions → integrations → diagnostics → resolution',
              priority: 'critical' as const,
              assignedUserId: null,
              status: 'in_review',
              projectId: 11,
              dueDate: '2026-07-20',
              createdAt: '2026-07-08T00:00:00.000Z',
              updatedAt: '2026-07-11T00:00:00.000Z',
              archived: false,
            },
            {
              id: 145,
              key: '1-UNTITLED-1773010025035-076',
              title:
                'Analyze: Acceleration opportunities — what can we do to deliver sooner?',
              priority: 'high' as const,
              assignedUserId: null,
              status: 'in_review',
              projectId: 11,
              dueDate: '2026-07-18',
              createdAt: '2026-07-09T00:00:00.000Z',
              updatedAt: '2026-07-10T00:00:00.000Z',
              archived: false,
            },
            {
              id: 142,
              key: '1-UNTITLED-1773010025035-073',
              title:
                'Analyze: Bug and quality audit — count known bugs, regressions, and test failures',
              priority: 'critical' as const,
              assignedUserId: null,
              status: 'in_review',
              projectId: 11,
              dueDate: '2026-07-12',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-07T00:00:00.000Z',
              archived: false,
            },
          ]),
        50 // simulated latency
      );
    });
  }

  private static sortTasks(
    tasks: UnassignedHighPriorityTask[],
    sort: 'dueDate' | 'title' | 'createdAt'
  ): UnassignedHighPriorityTask[] {
    return [...tasks].sort((a, b) => {
      switch (sort) {
        case 'dueDate':
          return (a.dueDate ?? '9999-12-31').localeCompare(
            b.dueDate ?? '9999-12-31'
          );
        case 'title':
          return a.title.localeCompare(b.title);
        case 'createdAt':
          return b.createdAt.localeCompare(a.createdAt);
        default:
          return 0;
      }
    });
  }
}