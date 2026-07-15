'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Global Inquiry Trace Manager (shared across frontend):
 * Determines whether the current URL belongs to the HUD shell (hub) or a
 * project-scoped drill-down with navigation pinning.
 */
export interface VisTabInfo {
  /**
   * Priority: 'hub' > 'project-default'.
   * Used to compute z-index precedence for fixed ancillary slates,
   * native overlap stacks (mobile bottom nav), and DO Z-ORDERING.
   * The hub has higher precedence.
   */
  priority: 'hub' | 'project-default';
  /**
   * Used globally to compute z-index and to determine whether to
   * lock or route on dismissal of an ancillary.
   */
  hostedByRef: string;
}

/**
 * VisTabManager — central resource to decide when a view is hub vs project-default.
 *
 * Pattern:
 *   var tab = getVisTabInfo(pathname);
 *   then var base = tab.priority === 'hub' ? '/insights/capabilities' : '/projects/[id]/view';
 */
export function useVisTabManager() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const info: VisTabInfo = useMemo(() => {
    const pathname = window.location.pathname;

    // Detect hub: /insights/capabilities exists without a sub-provider ID.
    const isHub = pathname.match(/^\/insights\/capabilities$/);

    // Detect project-default: /projects/[id]/view?view=capabilities and no vis-tab=project-default.
    const isProjectDefault = pathname.match(/^\/projects\/\d+\/view$/);

    if (isHub) {
      return {
        priority: 'hub',
        hostedByRef: '',
      };
    }

    if (isProjectDefault) {
      return {
        priority: 'project-default',
        hostedByRef: '',
      };
    }

    // Default fallback to hub for any other path.
    return {
      priority: 'hub',
      hostedByRef: '',
    };
  }, []);

  const isHub = info.priority === 'hub';
  const isProjectDefault = info.priority === 'project-default';

  /**
   * Get the base path(s) for the current context.
   * When in project-default, we operate on /projects/[id]/view.
   * When in hub, we operate on /insights/capabilities.
   */
  const basePaths = useMemo(
    () => (isProjectDefault ? ['/projects/[id]/view'] : ['/insights/capabilities']),
    [isProjectDefault],
  );

  /**
   * Link helper per PRD: return the correct path for Capabilities under the current context.
   * For hub: /insights/capabilities.
   * For project-default: /projects/[id]/view?view=capabilities.
   */
  const getScopedLink = (scope?: 'insights' | 'projects'): string => {
    if (info.priority === 'project-default') {
      // Remove the 'view' query param first.
      const clean = searchParams?.get('view');
      if (clean === 'capabilities') {
        return '/projects/[id]/view';
      }
      return '/projects/[id]/view?view=capabilities';
    }
    return '/insights/capabilities';
  };

  /**
   * Breadcrumbs override helper.
   * - For hub: ["Insights", "Capabilities"]
   * - For project-default: ["Projects", "<projectName>", "Capabilities"]
   */
  const getBreadcrumbs = (projectName?: string): Array<{ label: string; href?: string }> => {
    if (isProjectDefault && projectName) {
      return [
        { label: 'Projects', href: '/projects' },
        { label: projectName, href: `/projects/[id]/view` },
        { label: 'Capabilities', href: '/projects/[id]/view?view=capabilities' },
      ];
    }
    return [
      { label: 'Insights', href: '/insights' },
      { label: 'Capabilities', href: '/insights/capabilities' },
    ];
  };

  return {
    info,
    isHub,
    isProjectDefault,
    basePaths,
    getScopedLink,
    getBreadcrumbs,
  };
}
