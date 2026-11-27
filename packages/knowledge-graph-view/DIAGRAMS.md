# Visualizer diagrams

Choose a view from **Diagrams** above the canvas. The current file, class, or method scopes the code diagrams. Select a definition in an indexed diagram to open its source. **Flat** and **3D** switch between an orthogonal and a perspective view. DSM uses a dependency table.

The Visualizer derives its Class, Package, Component, Composite Structure, Deployment and C4 views from the reviewed graph and loaded symbols. The Use Case view can show indexed routes. It needs an authored model for actors and goals. Sequence, Communication, Interaction Overview, MSC, and Call Graph can use indexed calls. Those calls describe possible interactions in the code. Use a trace for observed order or time.

Views with missing evidence show an empty state. Choose **Import diagram data** on any view to supply an authored or runtime model. OpenAPI and AsyncAPI also accept their JSON contract documents. The other import format is a JSON object containing `nodes` and `edges`.

```json
{
  "nodes": [
    { "id": "idle", "label": "Idle", "kind": "state" },
    { "id": "running", "label": "Running", "kind": "state" }
  ],
  "edges": [
    { "from": "idle", "to": "running", "kind": "transition", "label": "start [ready]" }
  ]
}
```

- A node can include `members`, an array of objects with a `text` string.
- Use numeric `x` and `y` coordinates to position authored nodes. In a Timing diagram, every node needs an `x` value measured on the same time scale.
- In a Wardley map, use values from 0 to 1 for both evolution (`x`) and visibility (`y`). In a Crow’s Foot ERD, a relationship kind ending in `many` draws a crow’s foot at its target.
- In a Sequence or Communication diagram, edges appear in input order unless every edge supplies a numeric `time`.
- Imports apply to the chosen diagram in the current viewer. Select **Close** beside the imported data to return to the indexed view.
