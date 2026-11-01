/**
 * Phase 3 browser/VM execution host — interface scaffolding.
 *
 * This is deliberately minimal scaffolding, NOT the host implementation. The
 * deliverable for Phase 3's first milestone is the defence: every result that
 * comes out of a browser/VM host is untrusted and MUST pass through the
 * instruction firewall ({@link sanitizeUntrustedToolResult}) before it reaches
 * the agent's context.
 *
 * This module defines the host contract and a thin reference wrapper that
 * enforces the firewall on every emitted tool result, so host implementations
 * cannot accidentally forward raw untrusted data.
 */

import {
  sanitizeUntrustedToolResult,
  type FirewallPolicy,
  type SanitizedToolResult,
} from "./instruction-firewall.js";

/* ------------------------------------------------------------------ *
 * Host capability surface (scaffolding)
 * ------------------------------------------------------------------ */

/** Host kinds planned for Phase 3. */
export type ExecutionHostKind = "browser" | "vm";

/** Capabilities a Phase 3 host may expose. */
export type ExecutionHostCapabilities = {
  fetchPage: boolean;
  runScript: boolean;
  screenshot: boolean;
  console: boolean;
};

/** Static descriptor for a host instance. */
export type ExecutionHostDescriptor = {
  kind: ExecutionHostKind;
  /** Human-readable instance label, e.g. "browser:chromium". */
  id: string;
  capabilities: ExecutionHostCapabilities;
  /** Whether the host is reachable. Scaffolding default: not yet wired. */
  available: boolean;
};

/** A single raw (untrusted) output produced by the host. */
export type HostToolResult = {
  /** Tool that produced it, e.g. "browser.fetch". */
  toolName: string;
  /** Raw bytes/text straight from the host. ALWAYS untrusted. */
  content: string;
  /** Origin hint for auditing, e.g. a URL or VM image name. */
  origin?: string;
};

/** Every host implements this minimal contract. */
export interface ExecutionHost {
  readonly descriptor: ExecutionHostDescriptor;
  /** Emit raw tool results. Implementations must NOT pre-trust this data. */
  execute(toolName: string, params: Record<string, unknown>): Promise<HostToolResult[]>;
  dispose(): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Firewall-backed wrapper
 * ------------------------------------------------------------------ */

export type FirewalledHostOptions = {
  /** Override firewall policy; defaults to the standard policy. */
  policy?: FirewallPolicy;
};

/**
 * Wraps a Phase 3 host so every emitted tool result is forced through the
 * instruction firewall before being handed to the agent. This is the only
 * supported way to consume host output.
 */
export class FirewalledExecutionHost {
  private readonly policy?: FirewallPolicy;

  constructor(
    private readonly inner: ExecutionHost,
    options: FirewalledHostOptions = {},
  ) {
    this.policy = options.policy;
  }

  get descriptor(): ExecutionHostDescriptor {
    return this.inner.descriptor;
  }

  /**
   * Runs a host tool and returns firewall-sanitized results. Raw host output
   * never escapes this method unwrapped.
   */
  async execute(
    toolName: string,
    params: Record<string, unknown> = {},
  ): Promise<SanitizedToolResult[]> {
    const raw = await this.inner.execute(toolName, params);
    return raw.map((result) =>
      sanitizeUntrustedToolResult(result.content, {
        host: this.inner.descriptor.kind,
        toolName: result.toolName,
        policy: this.policy,
      }),
    );
  }

  async dispose(): Promise<void> {
    await this.inner.dispose();
  }
}

/** Convenience constructor for the firewalled wrapper. */
export function behindInstructionFirewall(
  host: ExecutionHost,
  options: FirewalledHostOptions = {},
): FirewalledExecutionHost {
  return new FirewalledExecutionHost(host, options);
}

/* ------------------------------------------------------------------ *
 * Placeholder host descriptor (until the real host lands)
 * ------------------------------------------------------------------ */

/**
 * Descriptor for the not-yet-implemented Phase 3 browser/VM host. Kept here so
 * call sites can feature-detect on `available === false` until the host ships.
 */
export const PHASE3_HOST_PLACEHOLDER: ExecutionHostDescriptor = {
  kind: "browser",
  id: "phase3-host:scaffold",
  capabilities: {
    fetchPage: false,
    runScript: false,
    screenshot: false,
    console: false,
  },
  available: false,
};
