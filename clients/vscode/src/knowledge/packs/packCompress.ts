/**
 * Knowledge packs are gzip by default (PRD 49 §5). One place decides the suffix.
 */
export function packWritePath(file: string, compress = true): string {
  if (!compress) return file.endsWith(".gz") ? file.slice(0, -3) : file;
  return file.endsWith(".gz") ? file : `${file}.gz`;
}

/** Attach the methodology pack only while some live chat has a role on. */
export function methodologyPackActive(chats: ReadonlyArray<{ persona?: { role?: string | null } | null }>): boolean {
  return chats.some((chat) => typeof chat.persona?.role === "string" && chat.persona.role.length > 0);
}
