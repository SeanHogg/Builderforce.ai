export * from './types';
export * from './registry';
export { openRouterModule, callOpenRouterEmbeddings, DEFAULT_EMBEDDING_MODEL } from './openrouter';
export type { EmbeddingsCallParams, EmbeddingsCallResult } from './openrouter';
export { cerebrasModule }   from './cerebras';
export { nvidiaModule }     from './nvidia';
export { ollamaModule }     from './ollama';
