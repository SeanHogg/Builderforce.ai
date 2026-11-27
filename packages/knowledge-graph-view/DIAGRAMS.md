# Visualizer diagrams

Choose a view from **Diagrams** above the canvas. The current file, class, or method scopes the code diagrams. Select a definition in an indexed diagram to open its source. **Flat** and **3D** switch between an orthogonal and a perspective view. DSM uses a dependency table.

The Visualizer derives its Class, Package, Component, Composite Structure, Deployment and C4 views from the reviewed graph and loaded symbols. The Use Case view can show indexed routes. It needs an authored model for actors and goals. Communication, Interaction Overview and Call Graph can use indexed calls. Those calls describe possible interactions in the code. Use a trace for observed order or time.

Sequence and MSC open the 3D Sequence view, which draws calls in source order with depth and activation bars. Code City opens the Tower. These options appear only when that view is available.

In a C4 view, select an element to drill down: Context to Containers to Components to Code. Choosing a view from the list starts again at the whole picture.

DFD, DFD Gane–Sarson and OpenLineage are derived from the indexed `reads` edges. Hotspots ranks areas by their commits over the last 90 days.

Views with missing evidence show an empty state. On a diagram board, choose **Import diagram data** to supply an authored or runtime model. OpenAPI also accepts OpenAPI 3 and Swagger 2 contracts, and AsyncAPI accepts AsyncAPI 2 and 3 contracts, as JSON. The other import format is a JSON object containing `nodes` and `edges`.

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
