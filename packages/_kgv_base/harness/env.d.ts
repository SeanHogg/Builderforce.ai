/** Vite's inline-worker import (`?worker&inline`): a constructor of the bundled worker. */
/** A side-effect stylesheet import (`../src/tokens.css`): Vite inlines it into the page. */
declare module '*.css';

declare module '*?worker&inline' {
    const WorkerConstructor: new () => Worker;
    export default WorkerConstructor;
}
