import type { FindExtraGatewayServicesOptions } from "../../daemon/inspect.js";

export type GatewayRpcOpts = {
  url?: string;
  token?: string;
  password?: string;
  timeout?: string;
  json?: boolean;
};

export type DaemonStatusOptions = {
  rpc: GatewayRpcOpts;
  probe: boolean;
  json: boolean;
} & FindExtraGatewayServicesOptions;

export type DaemonInstallOptions = {
  port?: string | number;
  runtime?: string;
  token?: string;
  force?: boolean;
  /** Commander populates this from --no-cron (negated boolean). */
  cron?: boolean;
  /** When true, set cron.enabled: false in config to disable scheduled jobs. */
  noCron?: boolean;
  json?: boolean;
};

export type DaemonLifecycleOptions = {
  json?: boolean;
};
