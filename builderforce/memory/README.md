# @builderforce/memory

BuilderForce memory management utilities for AI agents - file-backed search, retrieval, and memory persistence.

## Features

- **Memory Storage**: Persistent storage for AI agent memories with configurable backends
- **Search Engine**: Powerful search and retrieval with multiple ranking methods
- **Event System**: Real-time event streaming for memory operations
- **Type Safety**: Full TypeScript support with comprehensive type definitions
- **File-Backed**: Built-in file-based storage with auto-save capabilities

## Installation

```bash
npm install @builderforce/memory
# or
pnpm add @builderforce/memory
# or
yarn add @builderforce/memory
```

## Quick Start

```typescript
import { initMemorySystem, createSearchEngine, MemoryStore } from '@builderforce/memory';

// Initialize a complete memory system
const { store, engine } = await initMemorySystem({
  storagePath: './my-memory-data',
  maxEntries: 10000,
  autoSave: true,
  saveInterval: 60000
});

// Add memories
await store.add({
  content: 'Agent completed task X successfully',
  metadata: {
    tags: ['task', 'completed'],
    agentId: 'agent-1',
    category: 'performance',
    importance: 5
  }
});

// Search memories
const results = await engine.search({
  text: 'task completed',
  limit: 10,
  filters: {
    tags: ['task'],
    agentId: 'agent-1'
  },
  ranking: {
    method: 'hybrid'
  }
});

console.log(`Found ${results.length} matching memories`);

// Event listeners
store.on('entry_created', (event) => {
  console.log('New memory created:', event.entry.id);
});

// Get statistics
const stats = await store.getStats();
console.log('Total entries:', stats.totalEntries);
console.log('Unique tags:', stats.uniqueTags.join(', '));
```

## API Reference

### MemoryStore

#### Constructor
```typescript
new MemoryStore(options?: Partial<PersistenceStrategy>)
```

#### Methods

- `initialize()`: Initialize the memory store
- `add(entry)`: Add a new memory entry
- `update(id, updates)`: Update an existing memory entry
- `delete(id)`: Delete a memory entry
- `get(id)`: Get a specific memory entry
- `list(filters?, limit?)`: List memory entries with filters
- `searchTags(tags)`: Search memories by tags
- `searchByAgent(agentId)`: Search memories by agent
- `searchBySession(sessionId)`: Search memories by session
- `save()`: Manually save to storage
- `load()`: Load from storage
- `clear()`: Clear all memories
- `getStats()`: Get statistics about stored memories
- `getUsage()`: Get storage usage information
- `on(event, callback)`: Subscribe to events
- `off(event, callback)`: Unsubscribe from events
- `emit(event)`: Emit an event

### SearchEngine

#### Constructor
```typescript
new SearchEngine(store: MemoryStore, config?: SearchEngineConfig)
```

#### Methods

- `search(query)`: Search memories with ranking
- `findSimilar(query, limit?)`: Find similar memories
- `indexEntry(entry)`: Index a memory entry
- `removeEntry(id)`: Remove a memory from index
- `optimize()`: Optimize the search index

### Utility Functions

- `createMemoryStore(options)`: Factory function for MemoryStore
- `createSearchEngine(store)`: Factory function for SearchEngine
- `initMemorySystem(config)`: Initialize complete memory system
- `DEFAULT_CONFIG`: Default configuration options

## Configuration

### PersistenceStrategy

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `storagePath` | string | `./memory-data` | Path to storage directory |
| `maxEntries` | number | `10000` | Maximum number of entries to store |
| `compress` | boolean | `true` | Enable compression |
| `backend` | 'file' \| 'filesystem' \| 'json' | `'file'` | Storage backend |
| `autoSave` | boolean | `true` | Automatically save after changes |
| `saveInterval` | number | `60000` | Auto-save interval in milliseconds |
| `version` | string | `'1.0.0'` | Package version string |

### SearchEngineConfig

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `algorithm` | string | — | Search algorithm to use |
| `similarityThreshold` | number | — | Threshold for similarity matching |
| `embeddingModel` | string | — | Embedding model for semantic search |
| `vectorDimensions` | number | — | Vector dimensionality |
| `cacheSize` | number | — | Size of search result cache |

## Memory Entry Structure

```typescript
interface MemoryEntry {
  id: string;                    // Unique identifier
  content: string;               // Memory content
  metadata?: {
    tags?: string[];             // Search tags
    timestamp?: number;          // Creation timestamp
    agentId?: string;            // Associated agent ID
    sessionId?: string;          // Session identifier
    category?: string;           | // Categorization
    importance?: number;         // Relevance/importance score (0-10)
    source?: string;             | // Data source
  };
  createdAt: number;             // Unix timestamp of creation
  updatedAt: number;             // Unix timestamp of last update
}
```

## Search

The search engine supports multiple ranking methods:

- **relevance**: Score based on text matches and match positions
- **recency**: Score based on how recent entries are
- **importance**: Score based on importance metadata
- **hybrid**: Combine multiple ranking factors (default)

### Query Example

```typescript
const results = await engine.search({
  text: 'user preferences',
  limit: 20,
  filters: {
    tags: ['user', 'preferences'],
    category: 'config',
    minImportance: 7
  },
  ranking: {
    method: 'hybrid',
    boost: {
      recency: 0.3
    }
  }
});
```

## Events

MemoryStore emits events for important operations:

- `entry_created`: New memory added
- `entry_updated`: Memory updated
- `entry_deleted`: Memory deleted
- `search_executed`: Search completed
- `storage_initialized`: Storage successfully initialized
- `storage_error`: Storage operation failed

## TypeScript Support

This package is fully typed and uses TypeScript. Install the types for your own projects:

```typescript
import type { MemoryEntry, SearchQuery, SearchResult } from '@builderforce/memory';
```

## License

MIT

## Version

1.0.0

## Contributing

Contributions are welcome! Please read our Contributing Guidelines for more details.

## Links

- [GitHub Repository](https://github.com/seanhogg/Builderforce.ai/tree/main/builderforce/memory)
- [Package on npm](https://www.npmjs.com/package/builderforce/memory)
- [BuilderForce Documentation](https://builderforce.ai/docs)