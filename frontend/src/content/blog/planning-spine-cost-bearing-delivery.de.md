Die Strategie lebt in einem Foliensatz. Die Lieferung lebt in einem Board. Die Kosten leben in einer Finanztabelle. Drei Tools, drei Verantwortliche und ein monatliches Ritual, bei dem jemand sie von Hand abgleicht und alle streiten, welche Zahl stimmt.

Die **Planning Spine** fasst diese drei Ebenen zu einer zusammen. Sie ist eine einzige datierte Hierarchie – **Portfolio → Initiative → Epic → Task**, wobei **Objectives and Key Results** auf jeder Ebene als Zielschicht andocken –, in der jeder Knoten ein Startdatum, ein Enddatum und seine eigenen aggregierten Kosten hat. Sie planen, liefern und rechnen dieselbe Arbeit am selben Ort ab.

> Die Planning Spine von Builderforce.ai ist eine einzige datierte, kostentragende Hierarchie – Portfolio, Initiative, Epic und Task auf einem einzigen Gantt –, in der die Kosten der Blätter auf jeden Vorfahren aggregiert und in CAPEX und OPEX aufgeteilt werden, sodass Finanzen und Delivery aus derselben Quelle der Wahrheit lesen.

![Diagramm der Planning Spine: eine verschachtelte Hierarchie aus Portfolio, Initiative, Epic und Task auf einem Gantt, in der die Kosten der Blatt-Tasks auf jeden Vorfahren aggregiert werden, jeder Knoten von einem prioritätsgeordneten Resolver als CAPEX oder OPEX klassifiziert wird, mit Anomalie-Markierungen, wo ein Kind seinem Elternknoten widerspricht, und CSV-Export für den Finanzabschluss](/blog/planning-spine.svg)

## Kosten sind eine Eigenschaft der Arbeit, kein separates Hauptbuch

Weil jede Aufgabe auf Builderforce.ai bereits instrumentiert ist – LLM-Ausgaben werden beim Schreiben aus dem Nutzungsprotokoll bepreist, menschlicher Aufwand aus dem Kostensatz jedes Mitglieds –, braucht die Planning Spine kein paralleles Finanzsystem. Die Kosten der Blätter **aggregieren** sich einfach auf jeden Vorfahren: Die Kosten einer Task fließen in ihr Epic, die des Epics in seine Initiative, die der Initiative in ihr Portfolio. Sie erhalten auf jeder Ebene eine reale Zahl ohne Nachbuchung.

Und jeder Dollar wird klassifiziert. Jeder Knoten trägt eine `cost_class` von **CAPEX** oder **OPEX**, aufgelöst in Prioritätsreihenfolge: Eine ausdrückliche Deklaration gewinnt, andernfalls wird sie vom Elternknoten geerbt, andernfalls schlägt ein Agent-Klassifikator anhand der Investitionskategorie der Arbeit eine vor (Innovation wird als CAPEX aktiviert; Betrieb, Support und Tech-Debt werden als OPEX verbucht), mit einem GAAP-konservativen Standard als Untergrenze. Widerspricht die deklarierte Klasse eines Kindes der seines Elternknotens, markiert die Spine das als **Anomalie**, die ein PM klären muss – Aktivierungsentscheidungen bekommen eine Freigabe, statt stillschweigend vererbt zu werden.

## Ein Gantt, jede Ebene

Die Planning Spine wird als eine einzige verschachtelte, einklappbare Timeline dargestellt. Ein Portfolio-Balken enthält seine Initiativen, eine Initiative ihre Epics, ein Epic seine Tasks – alle datiert, alle auf derselben Achse, nach Kostenklasse farbcodiert, mit Anomalie-Markierungen dort, wo die Aktivierung geprüft werden muss. **Abhängigkeiten** auf Initiativen-Ebene (Blocker → Blockierter, zyklengeprüft) steuern einen bei Bedarf berechneten **kritischen Pfad**, sodass die längste unvollständige Kette immer sichtbar ist.

Braucht die Finanzabteilung die Zahlen außerhalb der App, lässt sich die gesamte Spine für jeden Zeitraum als CSV exportieren – dieselben Zahlen, die das Dashboard zeigt, bereit für den Abschluss.

## Warum das wichtig ist

Eine KI-Workforce verändert das Kostenverhalten über Nacht. Wenn Agents bauen, sehen Ausgaben nicht mehr nach Personal aus, sondern nach Verbrauch – stoßweise, pro Task, zuordenbar. Ein Board, das den Status verfolgt, aber nicht die Kosten, kann die Frage nicht beantworten, die jeder CFO bald stellen wird: *Was hat diese Initiative tatsächlich gekostet, und wie viel davon können wir aktivieren?*

Die Planning Spine beantwortet sie aus Live-Daten. Das Engineering plant darauf, das PMO aggregiert darauf Portfolios, und die Finanzabteilung schließt daraus die Bücher – eine Hierarchie, ein Zahlensatz, kein Abgleichsschritt.

[Plattform-Rundgang →](/product) · [Das Lagebild jeder Rolle ansehen →](/blog/every-role-operating-picture) · [Kostenlos loslegen →](/register)
