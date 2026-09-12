Fügen Sie einen Businessplan in ein Canvas ein, richten Sie ihn an fünf Ihrer Agents und holen Sie sich einen Kaffee.

Vier Minuten später liegen vierundzwanzig Objekte auf dem Board. Ein Unternehmensprofil. Sechs Wettbewerber, jeder mit recherchierter Umsatzschätzung und Hauptsitz. Zwei Kundensegmente, samt Größe. Ein Go-to-Market-Plan. Ein Preismodell. Eine Karte, auf der die Wettbewerbslandschaft eingezeichnet ist.

Das ist das Produkt, das genau so arbeitet wie vorgesehen – und zugleich der Moment, in dem Menschen uns erzählen, dass sie erstarren.

> Es ist beeindruckend. Ich weiß nicht, was ich damit anfangen soll.

Das ist keine Beschwerde über die Recherche. Es ist eine Beschwerde über das Ankommen. Vierundzwanzig Objekte sind mehr, als irgendjemand auf einmal liest, und ein Board gibt Ihnen keinen Grund, sich eine bestimmte Karte zuerst anzusehen.

## Was tatsächlich nicht stimmte

Drei Dinge – und nur eines davon hatte mit Erklärung zu tun.

```bf-figure
{
  "kind": "compare",
  "title": "Warum sich ein generiertes Board wie eine Wand anfühlte",
  "columns": [
    { "title": "Was Sie gesehen haben", "hue": "muted", "items": ["Ein langes Band aus Karten, das unten aus dem Bildschirm läuft", "Zwei Drittel eines breiten Monitors leer daneben", "Sechs Agent-Karten auf einem Punkt gestapelt, die wie eine Karte wirken", "Derselbe Wettbewerber zweimal recherchiert", "Kein Hinweis, welche davon man öffnen sollte"] },
    { "title": "Was dahintersteckte", "hue": "make", "items": ["Der Platzierer konnte nur nach unten wachsen, nie in die Breite", "Nichts hat gemessen, wie breit das Board tatsächlich war", "Objekte, die im selben Tick hinzukamen, bekamen alle dieselbe Koordinate", "Ein Turn, der an seinem Ausgabelimit abbrach, erzeugte neu, was er nicht mehr sehen konnte", "Nichts auf dem Board wusste, wie es sich selbst vorstellen soll"] }
  ],
  "caption": "Die ersten vier sind Platzierungsfehler und behoben. Der fünfte ist der, für den es etwas Neues brauchte."
}
```

Die Platzierungshälfte verdient einen Satz, weil sie die uninteressanteste war und den meisten Schaden angerichtet hat. Neue Objekte wurden platziert, indem man von einem Startpunkt aus *nach unten* wanderte, bis eine freie Stelle kam – vernünftig für eine Karte, falsch für einen Stapel. Zehn Objekte, in einem einzigen Turn erstellt, keines mit Koordinaten, jedes gegen die neun davor platziert, ergeben eine schmale Spalte. Auf einem 3440-Pixel-Monitor ist das ein Band, neben dem der Großteil des Bildschirms ungenutzt bleibt – genau so lautete die Meldung, die wir bekamen.

Objekte füllen jetzt zuerst die Breite, die das Board tatsächlich hat, bevor sie nach unten wachsen – und diese Breite misst das Canvas, statt sie anzunehmen.

## Die Führung

Das Canvas hatte bereits eine Tour. Sie zeigte die *Bedienoberfläche*: hier das Brain-Dock, hier die Palette, hier „Teilen“. Das ist die richtige Tour für Ihr erstes Board, und über Ihre Arbeit sagt sie überhaupt nichts.

Also gibt es eine zweite, und sie führt durch die Artefakte.

```bf-figure
{
  "kind": "flow",
  "title": "Wie die Führung entscheidet, was sie Ihnen zeigt",
  "steps": [
    { "label": "Gruppieren", "note": "Nach Art, nicht nach Karte. Sechs Wettbewerber sind eine Antwort – das ist Ihre Konkurrenz –, nicht sechs Schritte.", "hue": "read" },
    { "label": "Ordnen", "note": "Nach den Verbindungen des Boards selbst. Was worauf aufbaut, ist auf dem Canvas bereits eingezeichnet, also folgt die Führung dem – und greift auf die Lesereihenfolge zurück, wenn nichts verbunden ist.", "hue": "read" },
    { "label": "Durchgehen", "note": "Das Board fliegt nacheinander zu jeder Gruppe und sagt, was sie ist – in den eigenen Worten des Objekts statt mit einer generischen Bildunterschrift.", "hue": "make", "tag": "auf dem Board" }
  ],
  "caption": "Nichts davon ist eine handgeschriebene Reihenfolge. Eine neue Objektart kommt an dem Tag in die Führung, an dem sie sich erstellen lässt – denn die Führung wird aus dem Board abgeleitet, nicht irgendwo aufgelistet."
}
```

Das Gruppieren ist die Entscheidung, die alles funktionieren lässt. Eine Station pro Objekt wäre dieselbe Wand mit einem Weiter-Button – vierundzwanzig Schritte sind schlimmer als vierundzwanzig Karten, denn jetzt können Sie nicht einmal mehr überfliegen. Vierundzwanzig Objekte in neun Arten sind neun Dinge, die es wert sind, gesagt zu werden, und eines davon lautet: *Diese sechs wurden zusammen recherchiert; lesen Sie sie als Set, der Vergleich ist der Punkt.*

```bf-figure
{
  "kind": "screen",
  "frame": "Station 3 von 8",
  "ratio": 1.62,
  "regions": [
    { "label": "6 Wettbewerber-Objekte", "note": "Die Gruppe im Spotlight, ins Bild geholt", "x": 4, "y": 10, "w": 58, "h": 56, "hue": "make" },
    { "label": "Was diese Gruppe ist", "note": "Benannt nach der eigenen verfassten Zeile des Objekts, nie eine erfundene Zusammenfassung", "x": 66, "y": 16, "w": 30, "h": 34, "hue": "idea" },
    { "label": "Der Rest des Boards", "note": "Weiterhin sichtbar, weiterhin Ihres", "x": 4, "y": 70, "w": 58, "h": 18, "hue": "muted" },
    { "label": "Zurück · Weiter · jederzeit verlassen", "x": 66, "y": 54, "w": 30, "h": 8, "hue": "accent" }
  ],
  "caption": "Das Spotlight folgt jetzt einer Karte, auf die das Canvas noch zufliegt. Früher hat es einmal gemessen, im ersten Frame, und sich dort festgesetzt, wo die Karte gewesen war."
}
```

Angeboten wird sie einmal pro Board, und nur auf Boards, auf denen genug liegt, um sich zu verlieren – ein Canvas mit drei Karten braucht keinen Guide, und ihn anzubieten, wirkt, als traue das Produkt Ihnen nicht. Danach lebt sie in der Befehlsleiste, neben den Diagnosen und der Ergebnis-Scorecard, weil sie dieselbe Frage beantwortet wie diese: *Was habe ich hier eigentlich?*

## Zwei Duplikate, die nie Ihre waren

Während wir ohnehin dabei waren, zeigte derselbe Session-Bericht denselben Wettbewerber zweimal auf dem Board und einen Agent dreimal. Keines davon war ein Recherchefehler.

**Ein Platz ist eine Identität, kein Ereignis.** Wer denselben Teamkollegen zweimal ansprach, bekam früher zwei Karten mit demselben Namen. Jetzt wird die Karte, die Sie bereits haben, ins Bild geholt.

**Ein Modell, das abgeschnitten wird, macht seine Arbeit noch einmal.** Erreicht ein Turn mitten im Satz sein Ausgabelimit, hat der nächste Versuch kein eigenes Transkript mehr, mit dem er abgleichen könnte – also erstellt er das Unternehmensprofil erneut. Das Board kann es aber noch sehen, also antwortet jetzt das Board: Ein Objekt derselben Art mit demselben Namen liefert die ID des bereits vorhandenen und die Anweisung, dieses zu aktualisieren. Haftnotizen sind ausgenommen, denn auf einer Wand voller Haftnotizen dürfen durchaus drei „Preise“ heißen.

## Wo es in der Methode steht

[Lesen kommt vor Nachweisen und Nachweisen vor Bauen](/blog/read-prove-build-the-inner-loop) – der ganze Sinn dieser Reihenfolge ist, dass Lesen günstig ist und Bauen nicht, die Entscheidung zu bauen also eine informierte sein sollte.

Das hier gehört eindeutig zu **Lesen**, und es schließt eine Lücke, die sich dort aufgetan hatte. Wir hatten das *Erzeugen* von Belegen fast kostenlos gemacht: ein Prompt, vier Minuten, eine recherchierte Wettbewerbslandschaft mit Quellen. Was wir nicht kostenlos gemacht hatten, war das *Aufnehmen*. Eine ungelesene Landschaft informiert keine einzige Entscheidung – eine Lesen-Phase, die mehr erzeugt, als ein Mensch aufnehmen kann, ist also still und leise an dem einen gescheitert, wofür es sie gibt. Und sie scheitert unsichtbar, denn das Board sieht so oder so beeindruckend aus.

```bf-figure
{
  "kind": "compare",
  "title": "Der Weg von „erzeugt“ zu „verstanden“",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Vierundzwanzig Karten erscheinen", "Eine zufällig öffnen", "Versuchen herauszufinden, was das Ganze ist", "Die Segmente komplett übersehen", "Brain fragen, was es gemacht hat"] },
    { "title": "Jetzt", "hue": "read", "items": ["Vierundzwanzig Karten erscheinen, über den Bildschirm verteilt", "Auf „Zeig es mir“ drücken", "Acht Stationen, in der Reihenfolge, die das Board selbst nahelegt", "An jeder Station aussteigen und loslegen"] }
  ],
  "caption": "Lesen ist nur dann günstig, wenn es tatsächlich stattfindet. Das ist der Unterschied zwischen Belegen, die erzeugt werden, und Belegen, die gelesen werden."
}
```

## Was Sie heute damit tun können

- **Stellen Sie eine große Frage und erhalten Sie eine lesbare Antwort** – die Objekte kommen über Ihren Bildschirm verteilt an, statt sich nach unten zu stapeln.
- **Drücken Sie auf „Zeig es mir“**, wenn ein Board voller zurückkommt als erwartet, und steigen Sie an der Station aus, an der Sie genug gesehen haben.
- **Kommen Sie später darauf zurück** – über die Befehlsleiste, auf jedem Board, so oft Sie möchten.
- **Hören Sie auf, von Hand zu deduplizieren** – derselbe Wettbewerber, dasselbe Unternehmen oder derselbe Teamkollege landet nicht zweimal.

---

**Weiterlesen:** [Das Creation Canvas ist kein Chatfenster](/blog/creation-canvas-beyond-chat) · [Brain bedient das Creation Canvas](/blog/brain-operates-the-creation-canvas) · [Führen Sie die App aus, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas)

[Öffnen Sie ein Canvas](/create) und stellen Sie ihm eine Frage, die groß genug ist, um eine Führung zu brauchen.
