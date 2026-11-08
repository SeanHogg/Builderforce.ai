/** True outside a production build. Reads the literal `process.env.NODE_ENV` so a bundler's `define` can replace it; safe where `process` does not exist. */
export const isDevBuild = (): boolean => {
    try { return process.env.NODE_ENV !== 'production'; } catch { return false; }
};
