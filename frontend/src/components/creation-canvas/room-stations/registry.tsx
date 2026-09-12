import { accessibilityAuditView } from './academic/AccessibilityAudit';
import { assessmentDeskView } from './academic/AssessmentDesk';
import { citationsDeskView } from './academic/CitationsDesk';
import { gradebookBoardView } from './academic/GradebookBoard';
import { approvalDeskView } from './ApprovalDesk';
import { metricsBoardView } from './MetricsBoard';
import type { RoomStationView } from './types';
import { widgetStandView } from './WidgetStand';

/**
 * What each station LOOKS LIKE and what its panel DOES, keyed by the station ids that
 * `lib/canvas/roomStations.ts` declares WHEN a station stands.
 *
 * A new station is one entry there and one entry here; the room renders whatever both
 * agree on and branches on none of them. A station id with no view here stands nowhere
 * (`RoomStations.tsx` filters it out), so declaring the WHEN before the LOOK is safe.
 */
export const ROOM_STATION_VIEWS: Readonly<Record<string, RoomStationView>> = {
  approvals: approvalDeskView,
  metrics: metricsBoardView,
  widget: widgetStandView,
  assessment: assessmentDeskView,
  gradebook: gradebookBoardView,
  accessibility: accessibilityAuditView,
  citations: citationsDeskView,
};
