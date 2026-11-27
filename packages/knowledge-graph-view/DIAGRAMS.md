# Visualizer diagrams

Choose **Diagrams** above the canvas. The Code panel's active file or symbol scopes Graph and the code diagrams. Graph shows that definition, its members and its indexed neighbors. Clear the selection to return to the workspace graph. Map follows routes from entry points. **3D** shows system bases and module districts, with footprint and height based on file count at the overview and indexed method counts for classes in a drill.

Sequence and MSC use the same orbitable stage. The horizontal strands are messages in order. At code depth, the left-hand row numbers and the Code gutter use the same source sites, including recorded reads and inheritance references. **Flat** looks down over the lifelines. Browser-rendered text keeps a fixed screen size, and crowded mark labels rotate and stagger.

## Where the data comes from

| Views | Input and interpretation |
| --- | --- |
| C4 Context → Containers → Components → Code | Indexed systems, modules, directories, definitions and references. Select a mark to drill to the next C4 level. |
| UML Class, Composite Structure, Package, Component, Use Case, Communication, Interaction Overview and Call Graph | Indexed definitions, associations, packages, routes and calls. Actors, goals and authored scenarios can be supplied separately. |
| Deployment and C4 Containers | Deployable units and bindings available in the reviewed graph, and modules discovered by the workspace index. |
| 4+1 and ISO/IEC/IEEE 42010 | The Viewpoints entry links to the logical, process, development, physical and scenario cameras. An architecture description, stakeholders and concerns still come from the project. |
| arc42 | Import Markdown architecture documentation. Headings become sections and their contents appear in the inspector. |
| ArchiMate | Import Model Exchange XML elements and relationships. Layer type names group the marks. Goals, drivers and strategy must come from the model. |
| SysML v1 and v2 | Import a SysML XMI subset for requirements, blocks and constraints, or SysML v2 text for named definitions and direct satisfy relationships. |
| BPMN Process, Collaboration, Choreography and Conversation | Import BPMN XML. The renderer uses tasks, events, gateways, message links, participants and lane or pool membership when provided. |
| DMN and CMMN | Import decisions, decision table rules and requirements from DMN XML, or case stages, plan items and definitions from CMMN XML. |
| Sequence, MSC, Communication, Timing, Interaction Overview, Activity, BPMN Process and Flowchart | Select **Recent runs** to use recorded agent turns when the host has them. Ordering and durations come from that report. Sequence, MSC, Communication and Timing also accept OTLP JSON spans. Object snapshots require separate evidence. |
| UML Object | Import a snapshot with objects, attributes and links. |
| ERD in Crow's Foot, Chen and IDEF1X | Reads explicit tables and resolvable foreign keys from SQL, Prisma and Drizzle schema sources. The view scans up to 100 candidate files and shows up to 500 tables. |
| Yourdon and Gane–Sarson DFD, OpenLineage | Indexed read and write facts. OpenLineage also accepts RunEvent JSON or NDJSON, with dataset inputs entering jobs and outputs leaving them. |
| STRIDE threat DFD | Authored elements, trust boundaries, flows and threat findings. |
| DDD Context Map | Indexed source under `domains/<context>` and relationships between those directories. Shared kernels, anti-corruption layers and other business relationships are authored facts. |
| Event Storming | Authored events, commands, aggregates, policies and relationships. |
| Statecharts and Petri nets | Import SCXML states and transitions, or PNML places, transitions, arcs and initial markings. |
| Flowchart, Nassi–Shneiderman, SDL and Value Stream | Author steps, branch conditions, nested blocks, links and value-stream times. These are Visualizer JSON inputs. |
| OpenAPI and AsyncAPI | Endpoint and channel maps from OpenAPI 3, Swagger 2 and AsyncAPI 2 or 3 JSON contracts. |
| CodeCity, DSM and Hotspots | CodeCity opens the 3D districts. DSM counts dependencies between indexed packages. Hotspots ranks areas by commits over the last 90 days. |
| Wardley | Authored components and dependencies, plotted on Evolution and Visibility axes. |

Most views also accept the Visualizer JSON model below. This supplies facts outside the code index, such as UML profiles, state transitions, architecture goals, and business constraints. Native imports render the listed elements and relationships. They do not run models or validate all rules of each standard.

```json
{
  "nodes": [
    { "id": "idle", "label": "Idle", "kind": "state", "group": "Payment" },
    { "id": "running", "label": "Running", "kind": "state", "group": "Payment" }
  ],
  "edges": [
    { "from": "idle", "to": "running", "kind": "transition", "label": "start [ready]" }
  ]
}
```

- A node may include `members`, an array of objects containing `text`.
- Numeric `x` and `y` supply authored positions. Timing requires measured `x` values in the same unit. Wardley uses `x` for evolution and `y` for visibility, both 0–1. Wardley also accepts `components` with `id`, `name`, `evolution` and `visibility`, and `dependencies` with `from` and `to`.
- `group` names a lane, layer or boundary. In a Crow's Foot ERD, a kind ending in `many` draws a fork at the target. In IDEF1X, a kind beginning with `identifying` draws a solid connector.
- Authored flow files use `steps` and optional `flows`. A step can include `processMinutes` and `waitMinutes`. Nassi–Shneiderman uses nested `blocks`, each with an ID, name, optional kind, condition and child blocks.
- Authored STRIDE files use `elements`, `flows` and `threats`. An element can name a `boundary`. Findings specify `element`, `category` and `description`.
- Object snapshots use `objects` with named `attributes` and `links`. Event Storming imports `events`, `commands`, `aggregates`, `policies` and `relationships`. Connections use IDs in `from` and `to`.
- **Close** beside the imported data restores the indexed or recorded view. A host without WebGL uses a list or dependency table.
