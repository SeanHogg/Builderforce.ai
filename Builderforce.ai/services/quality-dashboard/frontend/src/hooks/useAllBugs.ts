/**
 * Hook to fetch ALL bugs for a given filter (not paginated).
 * Intended for exports (CSV/PDF) and for views that need the unfiltered such as BugTable.
 */

import { useState, useEffect, useCallback } from "react";
import { getBugList } from "../utils/apiClient";
import type { BugFilter, BugListResponse } from "../types/quality";

export function useAllBugs(filter: BugFilter) {
  const [allBugs, setAllBugs] = useState<Bug[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Request a large page size to get all results at once.
      const BUG_PAGE_SIZE = 10000;
      const list: BugListResponse = await getBugList(filter, 1, BUG_PAGE_SIZE);
      setAllBugs(list.bugs);
      setTotal(list.total);
    } catch (err) {
      console.error("Failed to fetch all bugs:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return { allBugs, total, loading, error, refetch: fetchAll };
}