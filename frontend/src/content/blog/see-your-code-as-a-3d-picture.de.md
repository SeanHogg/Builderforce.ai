Die meisten Menschen, die auf Software angewiesen sind, können sie nicht lesen. Produktverantwortliche, Gründerinnen, Prüfer und neue Teammitglieder müssen trotzdem Fragen dazu beantworten: Wie groß ist dieser Teil, was hängt davon ab, ist eine Änderung sicher? Üblicherweise fragt man die eine Entwicklerin, die sich auskennt, und wartet.

Deshalb gilt jetzt: **Die Wissensansicht zeigt den Code und ein 3D-Bild des Systems nebeneinander, und jede Bewegung in der einen Hälfte bewegt auch die andere.**

## Ein Ort, zwei Ansichten

Links steht der Code, rechts das Bild. Beide teilen sich einen einzigen Ort, der vom gesamten System über eine Komponente, eine Klasse und eine Methode bis zu einer Zeile reicht.

```bf-figure
{
  "kind": "screen",
  "frame": "Die Wissensansicht",
  "ratio": 1.62,
  "regions": [
    { "label": "Code", "note": "Klassen und Methoden, mit Lenses darüber", "x": 3, "y": 8, "w": 44, "h": 78, "hue": "read" },
    { "label": "3D-Bild", "note": "Formen für dasselbe System, an derselben Stelle", "x": 50, "y": 8, "w": 47, "h": 78, "hue": "make" },
    { "label": "System > Komponente > Klasse > Methode > Zeile", "x": 3, "y": 89, "w": 94, "h": 8, "hue": "accent" }
  ],
  "caption": "Ein Ort, zweimal gezeigt. Wo Sie im Code stehen, dorthin blickt das Bild, und umgekehrt."
}
```

- **Klicken Sie auf eine Form, und ihr Code öffnet sich** links.
- **Klicken Sie im Code auf eine Klasse oder Methode, und das Bild zoomt hinein** an genau diese Stelle.
- **Zoomen Sie in eine Form, und sie öffnet sich.** Eine Komponente wird zu ihren Klassen, eine Klasse zu ihren Methoden, eine Methode zu ihrem Code. Sie müssen nie wissen, in welcher Datei Sie gerade sind.

Wenn Sie keinen Code lesen können, sehen Sie ihn trotzdem durch Formen: was groß ist, was verworren ist, was womit zusammenhängt. Wenn Sie ihn lesen können, müssen Sie die Karte nicht mehr im Kopf behalten.

## Lenses über dem Code

Über jeder Klasse und Methode steht eine Reihe kleiner Aktionen:

- **Hineingehen** und **Hinausgehen**, um eine Ebene tiefer oder höher zu wechseln.
- **Aufrufer**, um zu sehen, was davon abhängt.
- **No test · Simulate**, wenn keine Tests diesen Pfad abdecken. Das öffnet den Pfad-Simulator, damit Sie den Pfad ausführen und sehen, was passiert.
- **Restructure** bei Anti-Patterns. Ein Warnsymbol am Rand markiert denselben Code, sodass Sie ihn beim Scrollen finden.

## Flow und Sequence auf jeder Ebene

Jede Ebene hat eine **Flow**-Ansicht und eine **Sequence**-Ansicht: wie Daten fließen und in welcher Reihenfolge sich Teile aufrufen. Sie funktionieren für das System, eine Komponente, eine Klasse und eine Methode. Ein Schalter wechselt jede davon zwischen 3D und Flat, sodass Sie die für die jeweilige Frage besser lesbare wählen können.

## Vorher und Nachher

Ein Anti-Pattern lässt sich als Bild leichter beurteilen als als Beschreibung. Etwa ein God-Modul, das alles an sich gezogen hat, oder eine Schichtverletzung, bei der der falsche Teil in einen anderen hineingreift.

```bf-figure
{
  "kind": "compare",
  "title": "Eine Umstrukturierung in der Vorschau",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Eine große Datei mit mehreren Aufgaben", "Verbindungen, die Schichten überqueren, die sie nicht überqueren sollten", "Schwer zu sagen, wo eine Änderung landet"] },
    { "title": "Nachher (Vorschlag)", "hue": "make", "items": ["Neue Module wachsen aus der alten Datei heraus", "Verbindungen laufen über die richtige Schicht", "Neu, geändert und entfernt sind farblich getrennt"] }
  ],
  "caption": "Der Vorschlag ist eine Vorschau. An Ihrem Code ändert sich nichts, bis Sie ihn anwenden."
}
```

Wechseln Sie zu **Nachher**, und neue Module wachsen aus der alten Datei heraus, während die Verbindungen neu verlaufen. Farben trennen, was neu ist, was geändert wurde und was entfällt. Sie beurteilen die Form der Änderung, bevor Sie eine Zeile des Diffs lesen.

Sie können auch **einen Commit aus dem Verlauf** wählen. Die Karte zeigt, was dieser Commit geändert hat, und der Code zeigt, welche Zeilen.

Vorschläge sind Vorschauen. Das Anwenden läuft über den üblichen geprüften Fix-Ablauf, sodass weiterhin eine Person die Änderung freigibt und sie wie jede andere geprüft wird.

## Wo es in der Methode sitzt

Builderforce arbeitet nach **Read, Prove, Build** im Bogen aus Idea, Make, Run, Measure. Read und Prove sind die günstigen Schritte, und sie entscheiden, ob sich Build lohnt. Diese Funktion gehört zu **Read und Prove, in Idea**.

Dort war sie nötig, weil das Lesen vorhandenen Codes der langsame Teil dieser Phase ist. Wer ein System erbt oder eine Änderung daran beurteilen muss, hatte bisher nur einen Dateibaum und einen Nachmittag. Jetzt lesen Sie die Form des Systems in Minuten. Die Umstrukturierungs-Vorschau ist ein Proof im selben Sinn: Sie sehen, was eine Änderung bewirken würde, mit einer prüfbaren Abbruchbedingung (entfernt dieser Vorschlag die Verletzung tatsächlich?), bevor Sie Build-Aufwand investieren. Was Sie bauen wollen, geht weiter in [Make](/blog/read-prove-build-the-inner-loop), und ein Commit, den Sie mit dem Verlauf vergleichen können, zeigt später in Measure, was er bewirkt hat.

---

**Weiterlesen:** [Read, Prove, Build: der innere Kreislauf](/blog/read-prove-build-the-inner-loop) · [Entwerfen, bauen, debuggen – ein räumlicher Workspace](/blog/design-build-debug-one-spatial-workspace) · [Eine 3D-Welt im Browser bauen](/blog/build-a-3d-world-in-the-browser)

[Öffnen Sie einen Canvas](/create), wechseln Sie in einem Projekt zur Wissensansicht und klicken Sie auf eine Form.
