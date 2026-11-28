function fields(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

/** Decode flat and nested error envelopes. Gateway SDK metadata belongs to the nested envelope when present. */
export function flattenApiError(value: unknown, preferNested = false) {
  const outer = fields(value);
  const nested = fields(outer?.error);
  const primary = preferNested ? nested ?? outer : outer;
  const secondary = preferNested ? outer : nested;
  const message = [primary?.message, secondary?.message, primary?.error, secondary?.error]
    .find((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  const code = [primary?.code, secondary?.code].find((entry) => typeof entry === 'string' || typeof entry === 'number');
  return {
    message,
    code: code === undefined ? undefined : String(code),
    details: primary?.details ?? secondary?.details,
    metadata: primary,
  };
}
