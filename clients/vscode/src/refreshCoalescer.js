export function createRefreshCoalescer(run, windowMs) {
    let timer = null;
    let pending = false;
    let disposed = false;
    const fire = () => {
        pending = false;
        // A failed run is the owner's to surface; the throttle only decides WHEN.
        void Promise.resolve().then(run).catch(() => undefined);
        timer = setTimeout(windowClosed, windowMs);
    };
    const windowClosed = () => {
        timer = null;
        if (pending && !disposed)
            fire();
    };
    return {
        request() {
            if (disposed)
                return;
            if (timer) {
                pending = true;
                return;
            }
            fire();
        },
        dispose() {
            disposed = true;
            pending = false;
            if (timer)
                clearTimeout(timer);
            timer = null;
        },
    };
}
//# sourceMappingURL=refreshCoalescer.js.map