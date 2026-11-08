Ein visueller Workspace wird brüchig, wenn jede Karte eine individuelle Komponente ist und jede Integration ein neues Verhalten erfindet. Creation Canvas nutzt stattdessen einen Registry-gesteuerten Vertrag: **48 Objektarten**, jede mit bekannter Gruppe, Renderer, Inspector, Aktionen, veränderbaren Feldern, Verbindungen, sicherem Brain-Kontext und Vorschau-Adapter.

![Produktansicht der Creation-Object-Palette mit zehn Gruppen, repräsentativen Live-Objektkarten auf dem Canvas, Capability-Badges und den sechs semantischen Verbindungsarten](/blog/creation-object-registry-workspace.svg)

## Zehn Gruppen decken die Arbeit ab, ohne sie einzuebnen

Die Palette ordnet Objekte in Build, Data, Knowledge, Insights, Work, People, Agents, Models, Collaborate und Integrations.

Build umfasst Workflow, Website, Chat, Dataset, WYSIWYG Prototype, Code, Browser-Vorschau, Repository- und Editor-Artefakte, lokale Services und Video. Data umfasst Table, Spreadsheet, Chart und KPI. Knowledge umfasst Documents, Slides, Dateien, URLs und Wissenseinträge. Insights umfasst Dashboards, Reports, Evaluations, Vergleiche, Roadmaps und Notes.

Work, People, Agents, Models und Collaborate enthalten die Planungs-, Belegschafts-, Modell- und Multiplayer-Artefakte rund um die Lieferung. Integrations stellt derzeit MCP-Tools als native Objekte bereit statt als unsichtbare Chat-Konfiguration.

## Jedes Objekt deklariert, was Brain tun darf

Die Registry liefert Standarddaten, native Aktionen und eine Allowlist veränderbarer Felder. Eine Website kann bearbeitet, in der Vorschau angezeigt und veröffentlicht werden. Ein Dataset kann importiert, profiliert und visualisiert werden. Ein Project kann erweitert und verglichen werden. Ein Agent kann inspiziert, konfiguriert und zugewiesen werden. Evermind kann lehren, trainieren, evaluieren und veröffentlichen. Ein MCP-Objekt kann sich authentifizieren und ausführen.

Brain liest dieselben Deklarationen, die auch den Inspector antreiben. Es kann kein nicht unterstütztes Feld und keine nicht unterstützte Aktion erfinden und darauf hoffen, dass der Canvas sie stillschweigend akzeptiert.

![Jede der 48 Objektarten durchläuft einen Registry-Vertrag für Standarddaten, Rendering, Inspektion, native Aktionen, veränderbare Felder, sicheren KI-Kontext, Vorschau, Capability-Richtlinie und sechs erlaubte semantische Beziehungen: Daten, Steuerung, Referenz, Präsentation, Lieferung und Mitgliedschaft](/blog/creation-object-registry-contract.svg)

## Sechs Kanten machen aus Layout einen Graphen

Creation Canvas definiert sechs semantische Verbindungsarten:

- **data** – ein Objekt liefert Werte an ein anderes;
- **control** – ein Objekt steuert oder konfiguriert ein anderes;
- **reference** – ein Artefakt zitiert ein anderes oder hängt von ihm ab;
- **presentation** – ein Artefakt präsentiert ein anderes;
- **delivery** – ein genehmigtes Artefakt bewegt sich auf die Ausführung zu;
- **membership** – eine Person, ein Agent oder ein Element gehört zu einer Gruppe oder einem Ritual.

Räumliche Nähe bleibt rein visuell. Bedeutung steckt in der expliziten Kante.

## Capability Gates wahren die Tenant-Richtlinie

Einige Arten – Evermind, MCP, Agent, LLM, Voice und Video – deklarieren Plattform-Capabilities. Die Palette filtert sie gegen die verfügbare Capability-Menge. Ein Template kann nur auf registrierte Arten verweisen, aber seine Installation umgeht nie den Tenant-Zugriff oder die Authentifizierung.

## Ein transportneutraler Vertrag über alle Oberflächen

Die Objektarten, Verbindungsarten und versionierten Befehlstypen leben in einem gemeinsamen Vertrag, den der Web-Canvas und die VS-Code-Oberfläche nutzen. Beide können daher über dieselbe Objektidentität und dieselbe Graphoperation sprechen, ohne eine UI in der anderen zu serialisieren.

Das Befehlsvokabular umfasst das Ersetzen des Graphen; Hinzufügen, Aktualisieren, Verschieben und Löschen von Objekten; Hinzufügen und Löschen von Verbindungen; sowie Viewport-Änderungen. Server-Revisionen liefern die Ordnungs- und Konfliktgrenze um diese Befehle.

## Erweiterbarkeit bleibt nachvollziehbar

Die Registry ist mehr als eine Palettenliste. Sie ist der Ort, an dem ein Objekt deklariert, was es offenlegen, annehmen, in der Vorschau zeigen und tun darf. Dadurch sind neue Objektarten von Anfang an mit Brain, Zusammenarbeit, Templates und beiden Client-Oberflächen kombinierbar.

Der Canvas kann wachsen, ohne zu einem untypisierten Kartenhaufen zu werden.

[Entdecken Sie die Creation-Object-Palette →](/create/new)
