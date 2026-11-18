import type { Backend, BackendTensor } from "../../src/autograd";

/**
 * Wrap a backend so every handle it hands out is counted until released — the
 * leak oracle of the memory tests (no finalizer involved: a live handle is one
 * nobody released).
 */
export function counting(inner: Backend): { backend: Backend; live: () => number } {
  const live = new Set<object>();
  const note = (value: unknown) => {
    if (value && typeof value === "object") {
      if ("shape" in value && "dtype" in value) live.add(value);
      else for (const v of Object.values(value)) if (v && typeof v === "object" && "shape" in v) live.add(v);
    }
    return value;
  };
  const backend = new Proxy(inner, {
    get(target, prop, receiver) {
      const member = Reflect.get(target, prop, receiver);
      if (typeof member !== "function") return member;
      if (prop === "release") {
        return (h: BackendTensor) => {
          live.delete(h);
          return member.call(target, h);
        };
      }
      if (prop === "download") return member.bind(target);
      return (...args: unknown[]) => note(member.apply(target, args));
    },
  });
  return { backend, live: () => live.size };
}
