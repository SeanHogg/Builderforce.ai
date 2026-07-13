export interface Capability {
  id: string;
  name: string;
  status: 'shipped' | 'in_progress' | 'planned';
  category: string | null;
  healthScore: number | null; // null if health not yet scored
  lastUpdated: string | null; // YYYY-MM-DD, null if not yet tracked
}