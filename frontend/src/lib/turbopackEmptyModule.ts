// Browser-only replacement for native Node dependencies referenced by
// Transformers.js. Runtime environment checks keep these exports unused.
const unavailableNativeModule = {};

export { unavailableNativeModule };
export default unavailableNativeModule;
