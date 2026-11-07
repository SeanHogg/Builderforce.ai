/** Vite's `?raw` import: a file's text, so a test reads a stylesheet or a catalog with no Node types (this package installs none). */
declare module '*?raw' {
    const text: string;
    export default text;
}
