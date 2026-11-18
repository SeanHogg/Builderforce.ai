/**
 * GPU error and device-loss tracking. WebGPU reports both asynchronously — a
 * validation or out-of-memory error as an `uncapturederror` event, a loss
 * through `device.lost` — so a synchronous enqueue never sees them. This keeps
 * the latest of each and surfaces it at the next point the engine touches the
 * device (`Dispatcher.run`, readback), as a typed error instead of silently
 * wrong numbers.
 */

export class DeviceLostError extends Error {
  constructor(
    readonly reason: string,
    detail: string,
  ) {
    super(`WebGPU device lost (${reason})${detail ? `: ${detail}` : ""}`);
    this.name = "DeviceLostError";
  }
}

export class GpuOperationError extends Error {
  constructor(
    readonly kind: string,
    detail: string,
  ) {
    super(`WebGPU ${kind}: ${detail}`);
    this.name = "GpuOperationError";
  }
}

export class DeviceHealth {
  private pending: GpuOperationError | null = null;
  private lost: DeviceLostError | null = null;
  private destroying = false;

  constructor(device: GPUDevice) {
    // Typed structurally: the engine compiles without the DOM lib (it runs in Workers and Node).
    const onError = (event: { error?: { message?: string; constructor?: { name?: string } } }) => {
      const error = event.error;
      this.pending ??= new GpuOperationError(error?.constructor?.name ?? "error", error?.message ?? "unknown error");
    };
    const target = device as unknown as {
      addEventListener?: (type: string, listener: typeof onError) => void;
      onuncapturederror: typeof onError | null;
    };
    if (typeof target.addEventListener === "function") target.addEventListener("uncapturederror", onError);
    else target.onuncapturederror = onError;
    void device.lost.then((info) => {
      if (!this.destroying) this.lost = new DeviceLostError(info.reason ?? "unknown", info.message ?? "");
    });
  }

  /** The backend is destroying the device itself: its loss is expected, not an error. */
  markDestroying(): void {
    this.destroying = true;
  }

  get isLost(): boolean {
    return this.lost !== null;
  }

  /**
   * Throw the device loss (sticky — every later call throws it too), or the
   * pending GPU error (thrown once, then cleared so the caller can recover).
   */
  assertHealthy(): void {
    if (this.lost) throw this.lost;
    const error = this.pending;
    if (error) {
      this.pending = null;
      throw error;
    }
  }
}
