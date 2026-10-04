import { type RefObject, useInsertionEffect, useRef } from 'react';

/**
 * A ref that holds the latest COMMITTED `value` — the "read the newest board without
 * depending on it" ref the canvas's handlers and Brain tools are built on.
 *
 * Mirrored in an insertion effect rather than written during render: a render React
 * throws away never leaks its values, and insertion effects run before every layout
 * effect in the tree (a child's included), so nothing that runs after commit can see
 * the previous value.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}
