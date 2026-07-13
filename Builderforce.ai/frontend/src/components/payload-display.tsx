// Payload is consumed only in the in-progress state per CR-2—AC-6.
// Pass the shared payload context; the component will re-render when it changes (see CR-3).
export function PayloadDisplay({
  payload,
  loading,
  lastValidPayload,
  reasonError,
}: {
  payload: unknown;
  loading: boolean;
  lastValidPayload: unknown | null;
  reasonError: string | null;
}): JSX.Element | null {
  const maybePayload = loading ? lastValidPayload : payload;

  const loaded = maybePayload !== undefined && maybePayload !== null;
  const isMalformed = typeof maybePayload !== "object" || maybePayload === null;

  const maybePayloadSafe = isMalformed ? null : (maybePayload as Record<string, unknown>);

  const fieldsToShow =
    maybePayloadSafe != null
      ? findTopLevelFields(maybePayloadSafe)
      : [];

  if (loading) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-semibold opacity-70">loading...</span>
        <span className="opacity-50 italic text-xs">while generating payload</span>
      </div>
    );
  }

  if (!loaded) {
    return null;
  }

  if (isMalformed) {
    const description =
      typeof maybePayload === "string" ? maybePayload : "<malformed, not an object>";
    return (
      <div>
        <p className="text-red-600">{reasonError || "malformed payload"}</p>
        <p className="text-xs opacity-60">{description}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {fieldsToShow.map(([k, v]) => (
        <div key={k}>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{k}:</span>
            <span>{String(v)}</span>
          </div>
          {v != null && typeof v === "object" && !(v instanceof Date) && !(v instanceof RegExp) ? (
            <details className="pl-2 text-[11px] text-slate-400">
              <summary className="cursor-pointer">
                {Object.entries(v)
                  .slice(0, 3)
                  .map(([subK, subV]) => `${subK}: ${String(subV)}`)
                  .join(", ")}
                {Object.keys(v).length > 3 ? ` (+${Object.keys(v).length - 3})` : ""}
              </summary>
              {...Object.entries(v).map(([subK, subV]) => (
                <div key={subK} className="my-0.5 pl-2">
                  • {subK} = {String(subV)}
                </div>
              ))}
            </details>
          ) : null}
        </div>
      ))}
      {typeof maybePayloadSafe.extensions === "object" && maybePayloadSafe.extensions != null ? (
        <details className="my-1 break-words">
          <summary className="cursor-pointer text-xs font-medium opacity-80">
            Extensions
          </summary>
          <ul className="flex flex-col gap-1 pl-2 font-mono">
            {Object.entries(maybePayloadSafe.extensions).map(([key, value]) => (
              <li key={key}>
                • {key}: {typeof value === "object" ? "[object]" : String(value)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Returns a flat list of top-level keys plus their values. Only uses the top-level for CR-3. */
function findTopLevelFields(obj: Record<string, unknown>): Array<[string, unknown]> {
  // Only the top-level; nested objects/components are left inside the details section.
  const keys = Object.keys(obj);
  return keys
    .map((k): [string, unknown] => [k, obj[k]])
    .sort((a, b) => {
      const aVal = String(a[1]);
      const bVal = String(b[1]);
      if (aVal === bVal) return a[0].localeCompare(b[0]);
      return aVal.localeCompare(bVal);
    });
}