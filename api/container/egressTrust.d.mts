export declare const EGRESS_CA_PATH: string;
/** Returns the bundle path it exported, or null when there is no platform CA (or the write failed). */
export declare function trustEgressCa(
  env?: Record<string, string | undefined>,
  caPath?: string,
  systemBundle?: string,
  outDir?: string,
): string | null;
