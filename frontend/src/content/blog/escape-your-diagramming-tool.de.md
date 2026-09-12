Diagrammtools sind ungewöhnlich gut darin, Geiseln zu nehmen. Die Arbeit ist wertvoll, die Datei proprietär, und die Exportoptionen sind so gewählt, dass die einzige verlustfreie genau die ist, die sich nirgendwo sonst öffnen lässt. Am Ende zahlen Teams für eine Lizenz, die niemand nutzt – nur um gelegentlich ein Bild wieder aufzurufen, das vor vier Jahren gezeichnet wurde.

Dies ist ein praktischer Leitfaden, wie Sie diese Arbeit herausholen – was jeder Weg tatsächlich bewahrt, welchen Sie nehmen sollten und was zu tun ist, wenn Sie nur noch ein PNG haben.

[Creation Canvas öffnen →](/create/new)

## Die Rangfolge der Exporte

Nicht alle Exporte sind gleichwertig. Der Unterschied liegt darin, ob die **Struktur** erhalten bleibt oder nur das **Aussehen**.

```bf-figure
{
  "kind": "stack",
  "title": "Was Sie zurückbekommen – vom Besten zum Schlechtesten",
  "bands": [
    { "label": "Natives Format", "note": ".vsdx, .excalidraw, .drawio – Formen, Beschriftungen, Verbindungen und welche Form jeder Pfeil verbindet. Alles bleibt erhalten.", "hue": "good", "tag": "verlustfrei" },
    { "label": "SVG", "note": "Formen, Beschriftungen und Linien – aber Verbindungen werden zu Geometrie: Die Datei sagt nicht mehr, welche zwei Kästen ein Pfeil verbindet. Wiederherstellbar.", "hue": "prove", "tag": "strukturell" },
    { "label": "PDF", "note": "Vektoriell, aber Formen werden als Pfade ohne Identität gezeichnet. Ein Rechteck besteht aus vier Liniensegmenten.", "hue": "measure", "tag": "grenzwertig" },
    { "label": "PNG / JPG", "note": "Pixel. Nichts wiederherzustellen. Lässt sich einbetten, annotieren und daneben neu zeichnen – aber nicht bearbeiten.", "hue": "bad", "tag": "Endstation" }
  ],
  "caption": "Nehmen Sie immer die höchste Stufe, die Ihr Tool anbietet. Der Abstand zwischen SVG und PNG ist der Abstand zwischen einem Diagramm und einem Foto davon."
}
```

## Visio → Canvas

**Nehmen Sie:** die `.vsdx` selbst. Legen Sie sie auf ein Board.

Visio ist das häufigste eingehende Format – und dasjenige, das die meisten für eine Sackgasse halten. Ist es nicht: Eine `.vsdx` ist ein OPC-ZIP, derselbe Container-Typ wie eine `.docx`, mit den Formen in `visio/pages/page1.xml`.

Was übernommen wird: Position und Größe jeder Form, ihr Text, der Master, aus dem sie gezeichnet wurde (so wird aus einem *Decision*-Master eine Raute und aus einem *Terminator* eine Ellipse), und ihre Verbinder – einschließlich der Information, welche Formen jeder Verbinder verbindet, entnommen aus dem `<Connects>`-Block, der einzigen Stelle in der Datei, die das angibt.

Auf dem Weg hinein finden zwei Umrechnungen statt – und genau die machen naive Visio-Reader falsch: Koordinaten werden in **Zoll von der unteren linken Ecke der Seite** angegeben, und eine Form wird über ihren **Mittelpunkt** positioniert, nicht über ihre Ecke. Übersieht man eines davon, kommt die Zeichnung kopfüber und um eine halbe Form verrutscht an.

**Der Weg zurück:** Konvertieren Sie nach Draw.io. Visio importiert `.drawio`-Dateien, damit ist der Round-Trip geschlossen. Direktes Schreiben von `.vsdx` wird nicht angeboten, und das ist Absicht – ein gültiges Visio-Paket braucht korrekte Content Types, drei Relationship-Parts, einen Document-Part und einen Masters-Part, und Visio reagiert auf eine subtil fehlerhafte Datei nicht mit Nachsicht. Es verweigert das Öffnen komplett.

**Mehrseitige Zeichnungen:** Gelesen wird die erste Seite. Ein Canvas-Objekt ist ein Diagramm, und fünf Seiten übereinanderzustapeln wäre schlimmer, als die eine zu lesen, mit der sich die Datei öffnet.

## Lucidchart → Canvas

**Nehmen Sie:** `File → Export → Visio (.vsdx)`, falls Ihr Tarif das bietet. Andernfalls `SVG`.

Der `.vsdx`-Export von Lucidchart ist gut und nimmt den oben beschriebenen Visio-Weg. Haben Sie einen Tarif ohne diese Option – oder ist das Konto schon ausgelaufen, was meist der Grund ist, warum Sie das hier lesen –, exportieren Sie SVG und legen Sie das ab.

Ein auf dem Board abgelegtes SVG bleibt bewusst ein **Bild**: Ein SVG eines Logos ist ein Bild, und es in „ein Diagramm mit einem rätselhaften Rechteck“ zu verwandeln, wäre der umgekehrte Fehler. Wählen Sie es aus und klicken Sie auf **In ein Diagramm umwandeln** – dann kommen die Formen zurück:

- `<rect>` wird zu einem Kasten, abgerundet, wenn es ein `rx` hat
- `<circle>` und `<ellipse>` werden zu Ellipsen
- `<polygon>` wird über seine Ecken gelesen – drei Punkte sind ein Dreieck, vier auf den Kantenmitten des Kastens eine Entscheidungsraute, sechs ein Sechseck
- `<line>`, `<polyline>` und gerade `<path>`-Verläufe werden zu Verbindern
- `<text>`, dessen Ankerpunkt innerhalb einer Form liegt, wird zur Beschriftung dieser Form; Text, der zu nichts gehört, wird zu einer eigenständigen Beschriftung, statt weggeworfen zu werden

Das Einzige, was ein SVG nicht verrät, ist, welche zwei Formen ein Pfeil verbindet – es kennt nur Koordinaten. Das wird geometrisch rekonstruiert: Ein Pfeil, dessen Enden in zwei Kästen landen, *ist* eine Beziehung zwischen ihnen. Ohne diesen Schritt würde jeder Verbinder verschwinden, sobald Sie das Ergebnis nach Mermaid konvertieren.

## Miro → Canvas

**Nehmen Sie:** den PDF- oder Bildexport des Boards als Referenz, und bauen Sie die Teile neu, auf die es ankommt.

Das ist die ehrliche Antwort. Der Export von Miro ist ein Bild, und in einem Bild gibt es keine Struktur, die sich wiederherstellen ließe. Was Ihnen das Canvas bietet, ist statt eines magischen Imports eine bessere Schleife für den Neuaufbau:

1. Legen Sie den Export auf das Board – er landet als Bild.
2. Setzen Sie ein Diagramm-Objekt daneben und bitten Sie Brain, es anhand des Bildes in Mermaid neu zu zeichnen.
3. Korrigieren Sie das Ergebnis im Text – das dauert Minuten statt der Stunden, die das Neuverschieben von Kästen kosten würde.

Das Bild bleibt neben dem Diagramm auf dem Board, sodass die Vorlage sichtbar ist, während Sie die Kopie prüfen.

## Excalidraw → Canvas

**Nehmen Sie:** die `.excalidraw`-Datei.

Der vollständigste Import von allen, weil das Excalidraw-Format ehrliches JSON mit echter Geometrie und echten Bindungen ist – `startBinding` und `endBinding` sagen genau, welche Elemente ein Pfeil verbindet. Rechtecke, Rauten und Ellipsen werden direkt auf Formen abgebildet, gebundener Text wird zu Beschriftungen, gelöschte Elemente werden ausgelassen.

Eine Falle, die man benennen sollte: Excalidraw exportiert auch als `.excalidraw.json` und manchmal als bloßes `.json`. Diese Endung schickte die Szene früher an den Datenimporter, und aus einer Workshop-Skizze wurde eine Tabelle mit einer Zeile, deren Zellen JSON-Fragmente waren. Heute wird die Datei an ihrer `type: "excalidraw"`-Deklaration erkannt statt am Dateinamen – sie kommt also als die Zeichnung an, die sie ist, egal wie sie heißt.

**Der Weg zurück:** Excalidraw ist ein vollwertiges Konvertierungsziel. Exporte sind deterministisch – dasselbe Diagramm erzeugt jedes Mal byte-identische Ausgabe statt bei jedem Export eine neue Datei, und lässt sich daher diffen.

## draw.io / diagrams.net → Canvas

**Nehmen Sie:** die `.drawio`-Datei oder `.xml`.

Nativ in beide Richtungen. Komprimierte Dateien werden verarbeitet – draw.io schreibt entweder reines mxGraph-XML oder einen deflate-komprimierten, URI-kodierten Payload, und beides kommt korrekt an. *Geschriebene* Dateien sind immer unkomprimiert, und zwar absichtlich: Eine reine Datei lässt sich im Pull Request diffen, ein Agent kann sie als Text bearbeiten, und sie lässt sich ohne Dekomprimierungsschritt erneut einlesen.

## Confluence / Sphinx / interne Wikis → Canvas

**Nehmen Sie:** den `.puml`-Quelltext, der meist ohnehin schon im Seitenmakro oder im Repo liegt.

Das Komponentenvokabular von PlantUML – `rectangle`, `card`, `usecase`, `database`, `node`, `hexagon`, `file` – wird direkt gelesen, ebenso die Kurzschreibweisen `[Component]` und `(Use case)`. Sequenz- und Aktivitätssyntax werden bewusst nicht konvertiert; sie sind keine Graphen aus Kästen, und sie plattzudrücken, ergäbe etwas, das sich rendern lässt und in die Irre führt.

## Generierte Graphen → Canvas

**Nehmen Sie:** die `.dot`- oder `.gv`-Datei, die Ihr Tooling ohnehin ausgibt.

Abhängigkeitsgraphen, Aufrufgraphen und Build-DAGs kommen meist als DOT aus ihren Tools. Beschriftungen, Formen, Füllungen und Kantenattribute werden alle übernommen, einschließlich der Standardattribut-Anweisung (`node [shape=box]`). Das ist wichtig, weil der eigene Standard von Graphviz eine Ellipse ist – eine Datei, die ihn überschreibt, meint das auch.

## Prozesstools → Canvas

**Nehmen Sie:** die `.bpmn`-Datei.

BPMN aus Camunda, Flowable, Zeebe oder bpmn.io wird mit seinen echten Koordinaten gelesen, wenn die Datei Diagram Interchange enthält. Fehlt dieser Teil – bei per Code erzeugtem BPMN der Normalfall –, wird der Prozess anhand seiner Sequenzflüsse angelegt, statt abgelehnt zu werden. Ein Prozess ohne Zeichnung ist immer noch ein Prozess, und genau dann ist es am wichtigsten, ihn zu sehen.

## Wenn das Ziel nicht alles abbilden kann

Konvertierungen zwischen Geometrie- und Text-Notationen sind nicht immer vollständig – und das Canvas sagt Ihnen das, statt Sie es später herausfinden zu lassen.

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Dinge, die verloren gehen können – und was dann passiert",
  "columns": [
    {
      "title": "Wird im Moment der Konvertierung gemeldet",
      "hue": "good",
      "items": [
        "Verbindungen, die eine Text-Notation nicht ausdrücken kann – gezählt im Ergebnishinweis",
        "Das Layout, wenn Geometrie → Text konvertiert wird (die Layout-Engine platziert alles neu)",
        "Exakte Gestaltung jenseits von Füllung, Kontur und Strichelung"
      ]
    },
    {
      "title": "Wird nie stillschweigend verworfen",
      "hue": "prove",
      "items": [
        "Ein Pfeil, dessen Endpunkte nur als Geometrie vorlagen – wird vor dem Schreiben rekonstruiert",
        "Text, der zu keiner Form gehört – bleibt als eigenständige Beschriftung erhalten",
        "Eine Form ohne exakte Entsprechung – wird der nächstliegenden zugeordnet, nie verworfen"
      ]
    }
  ],
  "caption": "Eine Text-Notation kann nur sagen: „A ist mit B verbunden.“ Ein Pfeil, der nichts verbindet, wird als verworfen gemeldet – mit Anzahl –, statt still zu verschwinden."
}
```

Die drei rein lesbaren Formate – Visio, ArchiMate und SVG – werden nie als *Ziel* angeboten, sodass das Konvertierungsmenü nach dem Klick nicht fehlschlagen kann. Es zeigt genau die Notationen, die für das ausgewählte Objekt funktionieren – bei einem Foto ist das nur Draw.io, wo es eingebettet wird, statt so zu tun, als bestünde es aus Formen.

## Eine Migration, die Sie heute Nachmittag erledigen können

```bf-figure
{
  "kind": "flow",
  "title": "Die Diagramme eines Teams aus einer Lizenz befreien",
  "steps": [
    { "label": "Nativ exportieren", "note": ".vsdx / .excalidraw / .drawio nehmen, wo immer das Tool es anbietet; sonst SVG", "hue": "read" },
    { "label": "Auf ein Board legen", "note": "Jede Datei wird zu einem bearbeitbaren Diagramm-Objekt – mit Formen und Verbindungen intakt", "hue": "prove" },
    { "label": "Konvertieren, was gepflegt wird", "note": "Alles, was sich mit dem Code ändert, wird zu Mermaid – Text, im Repo, im Pull Request reviewbar", "hue": "build" },
    { "label": "Den Rest als draw.io belassen", "note": "Diagramme, die verschickt statt gepflegt werden, behalten ihr exaktes Layout – in einem Format, das jeder öffnen kann", "hue": "reach" },
    { "label": "Die Lizenz kündigen", "note": "Nichts auf dem Board braucht mehr das ursprüngliche Tool, um geöffnet zu werden", "hue": "expand" }
  ]
}
```

Die Aufteilung in Schritt drei und vier ist die, auf die es ankommt. Diagramme, die ein sich bewegendes System beschreiben, sollten Text sein – denn ein Bild einer Architektur ist am Tag nach dem Zeichnen veraltet, und niemand merkt es. Diagramme, die an jemanden übergeben werden, sollten draw.io sein – denn dort ist das Layout die Botschaft und die universelle Öffenbarkeit der eigentliche Zweck.

Weiterführend: [Jedes Diagrammformat, das das Canvas liest und schreibt](/blog/every-diagram-format-the-canvas-reads) als vollständige Notationsreferenz und [Welches Diagramm sollten Sie zeichnen?](/blog/which-diagram-should-you-draw), um den Typ vor dem Tool zu wählen.

[Canvas öffnen und eine Datei ablegen →](/create/new)
