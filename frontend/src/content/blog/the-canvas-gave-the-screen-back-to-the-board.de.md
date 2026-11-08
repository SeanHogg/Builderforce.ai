Öffnen Sie einen Canvas, und das Board ist das Produkt. Alles andere – der Titel, der Surface-Umschalter, das Roster, der Speicherstatus, die sieben Buttons – ist Gerüst darum herum.

Lange Zeit war dieses Gerüst in **Bändern** angeordnet: Streifen in voller Breite, die sich im Fenster stapelten, jeder zog eine harte Linie, jeder nahm dem, wofür die Leute gekommen waren, Höhe weg. Der schlimmste Übeltäter war eine 54 Pixel hohe Session-Leiste mit Titel, Umschalter, sieben Buttons, Roster und Speichern-Button, verteilt über ein ganzes Fenster – größtenteils leerer Raum zwischen Bedienelementen, die nichts miteinander zu tun hatten.

```bf-figure
{
  "kind": "screen",
  "frame": "Vorher – das Board bekommt, was übrig bleibt",
  "ratio": 1.6,
  "regions": [
    { "label": "Session-Leiste", "note": "Titel · Umschalter · sieben Buttons · Roster · Speichern", "x": 2, "y": 3, "w": 96, "h": 11, "hue": "bad" },
    { "label": "Surface-Steuerung", "x": 2, "y": 16, "w": 96, "h": 9, "hue": "bad" },
    { "label": "Das Board", "x": 2, "y": 27, "w": 96, "h": 46, "hue": "muted" },
    { "label": "Team-Leiste – immer an", "x": 2, "y": 75, "w": 96, "h": 9, "hue": "bad" },
    { "label": "Live-Dock · Rechtshinweis-Ecke", "x": 2, "y": 86, "w": 96, "h": 11, "hue": "bad" }
  ],
  "caption": "Vier Bänder, gemessen an jedem Canvas auf jeder Seite – einschließlich des Live-Docks, das einen Streifen des Fensters für einen Anruf reservierte, den fast niemand gleich starten wollte."
}
```

```bf-figure
{
  "kind": "screen",
  "frame": "Nachher – das Board füllt das Fenster, alles schwebt",
  "ratio": 1.6,
  "regions": [
    { "label": "Das Board", "note": "Von Rand zu Rand, läuft hinter dem Chrome, statt unterhalb davon zu beginnen", "x": 2, "y": 3, "w": 96, "h": 94, "hue": "make" },
    { "label": "Was dieser Canvas IST", "x": 5, "y": 7, "w": 30, "h": 10, "hue": "idea" },
    { "label": "Wie er GELESEN wird", "x": 38, "y": 7, "w": 26, "h": 10, "hue": "accent" },
    { "label": "Wie Arbeit ihn VERLÄSST", "x": 67, "y": 7, "w": 28, "h": 10, "hue": "reach" },
    { "label": "Was Sie damit TUN", "x": 20, "y": 84, "w": 60, "h": 10, "hue": "accent" }
  ],
  "caption": "In welcher Karte ein Bedienelement landet, ist DATEN, keine Ermessensentscheidung in einer Komponente: Eine Tabelle deklariert die vier Slots, und ein Bedienelement kann nicht zu einem hinzugefügt werden, ohne dass der Test bemerkt, dass es im anderen fehlt."
}
```

## Die Regel, die das Einklappen sicher machte

Ein Canvas füllt den Bildschirm, und seine Leiste ändert sich minutenlang nicht – deshalb lohnt es sich, sie wegzuklappen. Gefährlich wird das durch die Hälfte der Leiste, die **berichtet**, statt zu handeln.

Klappt man „Wer ist in dieser Session“, „Ist die Verbindung live“ und „Läuft gerade ein Run“ weg, arbeitet der Operator blind auf einem Board, das andere Menschen bearbeiten.

```bf-figure
{
  "kind": "compare",
  "title": "Einklappen verbirgt Bedienelemente, nie den Status",
  "columns": [
    { "title": "Übersteht das Einklappen – Status", "hue": "good", "items": ["Der Titel – auf welchem Canvas Sie sind", "Speicherstatus – die TATSACHE, ob gespeichert ist", "Das Roster – wer hier ist", "Surface-Status – ob dieses Ding live ist"] },
    { "title": "Klappt weg – Bedienelemente", "hue": "muted", "items": ["Der Surface-Umschalter", "Das Aktions-Cluster", "Surface-spezifische Bedienelemente", "Der Speichern-BUTTON – ein Klick öffnet das Konto-Gate"] }
  ],
  "caption": "Speichern ist der interessante Fall: Es liest sich wie ein Zustand und verhält sich wie ein Bedienelement, also klappt der Button weg und der Zustand daneben bleibt. Etwas, das man drücken kann, ist ein Bedienelement – egal wie sehr seine Beschriftung nach einer Tatsache klingt."
}
```

Sie ist als Tabelle formuliert und nicht als Bedingung, weil „die Aktionen“ nicht die Grenze ist – der Surface-Umschalter ist ein Bedienelement, die Echtzeit-Anzeige nicht, und beide sitzen zwei Elemente voneinander entfernt in derselben Zeile. Eine Regel, die sich Reviewer merken müssen, hält etwa drei Pull Requests lang.

## Eine Leiste pro Canvas, nicht eine pro Runtime

Eine Möglichkeit hinzuzufügen, eine App auf dem Board *auszuführen*, brachte sofort das hervor, was jeder visuelle Editor vermeiden will: zwei Toolbars, gleiche Höhe, gleiches Styling, uneins darüber, welche man drückt.

Jetzt steuert das Surface seine Bedienelemente **in** die eine Leiste bei. Ein Surface, das nächstes Jahr hinzukommt, bekommt kostenlos einen Platz darin, und eine Aktion deklariert, was sie *braucht* – Objekte, ein Board –, statt die Surfaces aufzulisten, für die sie gilt. Die Alternative wäre, jedes künftige Surface in jede Liste einzutragen, für die es zufällig passt – in einer Datei, die aus diesem Grund niemand öffnet.

## Und ein Telefon konnte einen Canvas gar nicht teilen

Dies ist der Teil, der sich zu verallgemeinern lohnt.

Eine pauschale Mobil-Regel blendete jeden unbeschrifteten Button in der Leiste aus. Das Overflow-Sheet, das sie überlebte, listete keinen davon auf. So verlor ein Telefon stillschweigend Rückgängig, Wiederherstellen, Diagnose, die Ergebnis-Scorecard **und jeden Weg zum Einladungs-Panel** – fünf Aktionen, keine davon irgendwo als fehlend deklariert. Es ergab sich aus einer einzigen CSS-Zeile, die an einen Klassennamen gebunden war.

Platzierung sind jetzt Daten: Jede Aktion deklariert, ob ein Telefon sie in der Leiste oder im Overflow zeigt, und beide werden aus dieser einen Liste gerendert, sodass Leiste und Menü Komplemente voneinander sind. Eine Aktion kann in keinem von beiden landen, und ein Test stellt das sicher – einschließlich des Zwei-Aktionen-Budgets für die Telefon-Leiste, denn ab zwei wird das herausgedrückt, was den Titel anzeigt, das Einzige, das Ihnen sagt, auf welchem Canvas Sie sind.

---

**Weiterlesen:** [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [The Creation Canvas is not a chat window](/blog/creation-canvas-beyond-chat) · [Multiplayer Creation Canvas, web and VS Code](/blog/multiplayer-creation-canvas-web-vscode)

[Einen Canvas öffnen](/create) – er ist jetzt auf dem Telefon derselbe, was er vorher nicht war.
