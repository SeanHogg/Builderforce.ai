import type { DeviceTensor } from "../device-tensor";

/**
 * PyTorch-style module base. Parameters and submodules are registered
 * explicitly, so `parameters()` is exactly what was registered — frozen ones
 * included (they report `requiresGrad === false`; optimizers skip them).
 */
export abstract class Module {
  training = true;
  private readonly params = new Map<string, DeviceTensor>();
  private readonly children = new Map<string, Module>();

  abstract forward(...inputs: DeviceTensor[]): DeviceTensor;

  protected registerParameter<T extends DeviceTensor>(name: string, t: T): T {
    this.params.set(name, t);
    return t;
  }

  protected registerModule<M extends Module>(name: string, m: M): M {
    this.children.set(name, m);
    return m;
  }

  *namedParameters(prefix = ""): Generator<[string, DeviceTensor]> {
    for (const [name, t] of this.params) yield [`${prefix}${name}`, t];
    for (const [name, child] of this.children) yield* child.namedParameters(`${prefix}${name}.`);
  }

  parameters(): DeviceTensor[] {
    return [...this.namedParameters()].map(([, t]) => t);
  }

  /** Parameters an optimizer should update. */
  trainableParameters(): DeviceTensor[] {
    return this.parameters().filter((t) => t.requiresGrad);
  }

  train(mode = true): this {
    this.training = mode;
    for (const child of this.children.values()) child.train(mode);
    return this;
  }

  eval(): this {
    return this.train(false);
  }

  zeroGrad(): void {
    for (const p of this.parameters()) {
      p.grad?.dispose();
      p.grad = null;
    }
  }
}

/** Run modules in order (`nn.Sequential`). */
export class Sequential extends Module {
  private readonly layers: Module[];

  constructor(...layers: Module[]) {
    super();
    this.layers = layers.map((m, i) => this.registerModule(String(i), m));
  }

  forward(x: DeviceTensor): DeviceTensor {
    return this.layers.reduce((h, layer) => layer.forward(h), x);
  }
}

/** An activation as a module, for `Sequential`. */
export class Lambda extends Module {
  constructor(private readonly fn: (x: DeviceTensor) => DeviceTensor) {
    super();
  }

  forward(x: DeviceTensor): DeviceTensor {
    return this.fn(x);
  }
}
