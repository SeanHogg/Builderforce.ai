/**
 * The build-time module that carries the web message catalogs, trimmed to the
 * namespaces the canvas reads (see the `bf-canvas-messages` plugin in
 * `vite.canvas.config.ts`).
 */
declare module 'virtual:bf-canvas-messages' {
  const catalogs: Record<string, Record<string, unknown>>;
  export default catalogs;
}
