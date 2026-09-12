Eine 3D-Ansicht gibt es auf dem Creation Canvas schon eine Weile. Sie war eine Lesart des flachen Boards – Ihre Karten, im Raum angeordnet, angenehm zum Durchfliegen, aber eine Ansicht und kein Ort. Nichts lebte darin. Sie konnten keine Kiste abstellen.

Eine **Welt** ist etwas anderes: ein Objekt mit eigener Kamera, eigenen Requisiten und echter Physik, das sich so öffnet, wie sich eine Website in eine Seitenvorschau oder ein Spiel in eine Spielfläche öffnet.

## Was es wirklich heißt, eine Welt zu gestalten

```bf-figure
{
  "kind": "flow",
  "title": "Von der leeren Szene zu etwas, durch das man laufen kann",
  "steps": [
    { "label": "Platzieren", "note": "Legen Sie Requisiten in die Szene und verschieben Sie sie. Jede ist ein Objekt auf Ihrem Board, mit demselben Einstellungsbereich wie jedes andere Objekt.", "hue": "make" },
    { "label": "Einrahmen", "note": "Bewegen Sie die Kamera. Was Sie einstellen, ist das, womit sich die Welt für andere öffnet.", "hue": "make" },
    { "label": "Laufen", "note": "Übernehmen Sie die Steuerung einer Figur und bewegen Sie sich mit echtem Gewicht, echter Schwerkraft und echten Kollisionen durch die Szene.", "hue": "make", "tag": "Physik" }
  ],
  "caption": "Gebaut auf Three.js mit einer Rapier-Physiklaufzeit – Kollider statt der Illusion davon: Eine Wand hält Sie auf, eine Rampe bremst Sie."
}
```

```bf-figure
{
  "kind": "screen",
  "frame": "Eine Welt, geöffnet auf dem Canvas",
  "ratio": 1.62,
  "regions": [
    { "label": "Die Szene", "note": "Requisiten mit Kollidern, eine Kamera, die Sie bewegen, ein Körper, den der Boden trägt", "x": 4, "y": 8, "w": 60, "h": 72, "hue": "make" },
    { "label": "Requisiten", "note": "Jede ein Objekt auf Ihrem Board", "x": 67, "y": 8, "w": 29, "h": 34, "hue": "idea" },
    { "label": "Einstellungen", "note": "Derselbe Bereich wie bei jedem anderen Objekt", "x": 67, "y": 46, "w": 29, "h": 34, "hue": "accent" },
    { "label": "Spielen · Kamera · Teilen", "x": 4, "y": 86, "w": 92, "h": 9, "hue": "accent" }
  ],
  "caption": "Eine Welt ist ein Objekt wie jedes andere – deshalb erbt sie Einstellungen, Freigaben und die Befehlsleiste, statt ein separater, seitlich angeschraubter Editor zu sein."
}
```

Der entscheidende Unterschied sind **Kollider**. Sehr viele 3D-Tools im Browser liefern Ihnen eine Szene, die Sie umkreisen können. Nur sehr wenige liefern einen Körper, dem die Szene Widerstand leistet. Sobald es eine Figur mit Masse gibt, einen Boden, der sie trägt, und Wände, die das nicht tun, hört das, was Sie bauen, auf, das Diagramm eines Raums zu sein, und wird zu einem Raum – und die Fragen ändern sich von „sieht das richtig aus?“ zu „kommt man von hier nach dort?“.

## Spiele, die hier entstehen, lassen sich jetzt spielen

Zwischen „ein Spiel anfordern“ und „ein Spiel spielen“ standen zwei Fehler, die nichts miteinander zu tun hatten – weshalb die Behebung des einen nie zu helfen schien.

**Der erste lag beim Erstellen.** Wer ein Roblox-Spiel anforderte, bekam ein Designdokument mit viertausend Wörtern – Säulen, Klassen, ein Monetarisierungsplan, eine Zwölf-Monats-Roadmap – und nichts Spielbares. Die Auslieferungs-Hälfte war gebaut, die Erstellungs-Hälfte nie angeschlossen: Ein Tool erzeugte das Objekt, ein anderes produzierte Artefakte, und nichts verband beide. Der Weg zu einem spielbaren Build war ein Button im Inspektor, der erst erschien, wenn bereits ein Build existierte. Der Button, der ein Spiel erzeugt hätte, setzte also ein Spiel voraus.

**Der zweite lag beim Erkennen.** Ein `.rbxlx`-Place ist XML. Alles, was ein Spiel enthielt, fragte „ist das HTML?“, um zu entscheiden, welche Laufzeit zum Einsatz kommt – und wertete „nein“ als *hier gibt es kein Spiel*. So lag ein generierter, herunterladbarer, korrekt benannter Roblox-Place auf dem Board, während die Spielfläche darunter **„Noch kein Spiel.“** anzeigte.

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Fragen, die zu einer zusammengefallen waren",
  "columns": [
    { "title": "Welche Laufzeit nutzt das?", "hue": "make", "items": ["HTML → die Web-Laufzeit", "Ein Roblox-Place → dekodieren und durchlaufen", "Eine Welt → die Szenen-Laufzeit"] },
    { "title": "Gibt es dieses Spiel?", "hue": "measure", "items": ["Gibt es überhaupt ein Artefakt?", "Beantwortet vom Artefakt, nicht von seinem Format", "Eine echte Datei antwortet jetzt mit Ja"] }
  ],
  "caption": "Eine Frage, die zwei Hüte trägt, ist die häufigste Form eines Fehlers, der von außen betrachtet keinen Sinn ergibt."
}
```

Ein Roblox-Place ist jetzt im Browser spielbar – nicht, indem so getan wird, als liefe Luau, das eine serverautoritative Engine ist, die keine Webseite je sein kann, sondern indem die Welt aus der Datei ausgelesen und in derselben Three.js- und Rapier-Laufzeit durchlaufen wird, die der Canvas ohnehin besitzt. Parts werden zu Requisiten in einem Maßstab, der aus der Körpergröße der Figur abgeleitet ist – ein in Studs gebauter Place kommt also in der Größe an, für die er entworfen wurde.

Und noch einer, gemeldet von einer laufenden Spielfläche: eine Respawn-Schleife bei Gefahrenzonen, die die Figur am Spawnpunkt festnagelte, die Pfeiltasten tot, der Punktestand bei `0/3 collected, 2076 hits`. Jede Berührung einer Gefahrenzone baute den Kollisions-Handler neu auf, der den Kollider neu registrierte, der wiederum die Überlappung erneut auslöste, die den Handler neu aufbaute. Die Figur konnte sich durchaus bewegen; sie wurde nur in jedem Frame zurückteleportiert. Jetzt bewegt sie sich.

## Warum ein Build-Tool überhaupt eine 3D-Engine enthält

Weil „mach es real“ nicht immer eine Webseite bedeutet.

Die [acht Wege, eine Idee real zu machen](/blog/eight-ways-to-make-an-idea-real), reichen von einem 90-Sekunden-Demo-Video bis zu einem Live-System, und der richtige Nachweis für eine räumliche Idee – ein Trainingsszenario, ein Grundriss, durch den sich jemand bewegen muss, eine Spielschleife, die sich entweder gut anfühlt oder nicht – ist fast nie ein Screenshot mit Pfeilen. Eine begehbare Szene ist ein wirklich günstiger Nachweis für etwas, worüber sich in einem Dokument sonst unmöglich streiten lässt.

Dasselbe Board enthält die Designnotizen, den Code, die Tickets und die Welt. Das ist das ganze Argument: nicht, dass ein Canvas 3D kann, sondern dass das 3D direkt neben allem anderen liegt, das darüber entscheidet, ob das Ding gebaut wird.

---

**Weiterlesen:** [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas) · [Achtundvierzig Live-Objekte, ein Creation Canvas](/blog/forty-eight-live-objects-one-creation-canvas) · [Entwerfen, bauen, debuggen – ein räumlicher Workspace](/blog/design-build-debug-one-spatial-workspace)

[Öffnen Sie einen Canvas](/create) und bitten Sie um eine Welt mit einer Rampe und einer verschlossenen Tür darin.
