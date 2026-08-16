/**
 * One roster, drawn in two places (the command bar's collapsed cluster and the
 * chat surface's header) — the initials and the colour-cycling rule live here
 * once so the same person reads as the same avatar in both.
 */

/** Up to two initials from a display name, or a placeholder for one with none. */
export function memberInitials(displayName: string | null | undefined): string {
  return (displayName || 'U').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

/** Which of the three avatar colour classes a roster slot cycles to. */
export function memberAvatarClass(
  index: number,
  classes: { pink: string; orange: string; green: string },
): string {
  return [classes.pink, classes.orange, classes.green][index % 3]!;
}
