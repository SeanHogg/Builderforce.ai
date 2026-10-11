Ein Dashboard kann Ihnen sagen, dass Leute gegangen sind. Es kann Ihnen nicht sagen, warum. Absprungrate, Verweildauer, ein Trichter, der zwischen Schritt zwei und drei abbricht — das sind Zählungen. Sie schweigen über die Überschrift, die wie ein Link aussah, den Button, der nicht feuerte, das Formular, das den ersten Versuch verschluckte, den Moment, in dem jemand wütend klickte und den Tab schloss.

Diese Stille ist teuer. Teams streiten aus dem Gedächtnis über einen Besuch, den niemand gesehen hat. Sie liefern eine Korrektur für die falsche Sache. Sie benoten einen Beweis anhand einer Zahl, die nie gefragt hat, ob die Stichprobe überhaupt erreicht wurde, oder ob die Leute, die nicht konvertiert sind, eine kaputte Seite gesehen haben.

Session Replay schließt diese Lücke. Sie sehen den Besuch so, wie der Besucher ihn gesehen hat.

## Der Besuch, auf der Seite, die sie sahen

Insights hat jetzt eine Visitors-Ansicht, die die Sitzung abspielt: die Seite, der Cursor, der Klick, der ins Leere ging. Ein Besuch ist mit dem Release gekennzeichnet, auf dem er lief. Wutklicks, tote Klicks, Fehler und die Conversion (oder das Verfehlen) sitzen auf der Zeitleiste, damit Sie sie anspringen können, statt danach zu suchen.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — Visitors",
  "ratio": 1.5,
  "regions": [
    { "label": "Aufnahmen", "note": "Ein Besuch, gekennzeichnet mit dem Release, auf dem er lief", "x": 4, "y": 6, "w": 36, "h": 88, "hue": "measure" },
    { "label": "Die Seite, die sie sahen", "note": "Die Wiedergabe spielt den Raum, das Formular, den Klick, der ins Leere ging", "x": 42, "y": 6, "w": 54, "h": 58, "hue": "accent" },
    { "label": "Momente", "note": "Wutklick · toter Klick · Fehler · Conversion", "x": 42, "y": 68, "w": 54, "h": 26, "hue": "run" }
  ],
  "caption": "Die Aufnahme ist der Besuch. Zählungen sitzen daneben, damit Sie den Moment finden und dann zusehen können."
}
```

Eingaben bleiben maskiert. API-Schlüssel bleiben blockiert. Ein angemeldeter Besuch auf builderforce.ai und der anonyme davor sind dieselbe Aufnahme.

## Von einer Aufnahme zur nächsten Änderung

Zuschauen ist nicht der Punkt. Der Punkt ist, was Sie mit dem Moment tun.

```bf-figure
{
  "kind": "flow",
  "title": "Von einer live Seite zum nächsten Ticket",
  "steps": [
    { "label": "Ausführen", "note": "Die gehostete App oder das Snippet auf Ihrem eigenen Origin zeichnet den Besuch auf.", "hue": "run" },
    { "label": "Aufnehmen", "note": "Abschnitte landen innerhalb von Sekunden. Frustration, Fehler und Conversions werden markiert, während sie passieren.", "hue": "measure" },
    { "label": "Ansehen", "note": "Öffnen Sie die Aufnahme. Springen Sie zum Wutklick. Sehen Sie die Seite, die sie wirklich sahen.", "hue": "measure", "tag": "der Besuch" },
    { "label": "Ticket", "note": "Ein Moment wird zur Aufgabe, mit der Aufnahme daran, damit die Korrektur für diesen Klick ist.", "hue": "idea" },
    { "label": "Machen", "note": "Das nächste Release trägt die Änderung. Heatmaps und Aufnahmen auf diesem Release sagen Ihnen, ob sie gewirkt hat.", "hue": "make" }
  ],
  "caption": "Die Schleife ist das Produkt. Eine Aufnahme, die kein Ticket wird, ist ein Video, das Sie einmal angesehen haben."
}
```

## Ein Release gegen das nächste

Eine Heatmap ohne Release ist ein Durchschnitt jeder Seite, die Sie je ausgeliefert haben. So versteckt sich eine kaputte Überschrift von letzter Woche in einer gesund aussehenden Klickkarte.

```bf-figure
{
  "kind": "compare",
  "title": "Dieselbe Seite, zwei Releases",
  "columns": [
    { "title": "Dieses Release", "hue": "muted", "items": ["Wut auf der Überschrift, die wie ein Link aussieht", "Tote Klicks auf einem Button, der nie feuerte", "Scrollen, das das Formular nie erreichte"] },
    { "title": "Das nächste Release", "hue": "measure", "items": ["Die Überschrift ist eine Überschrift", "Der Button sendet ab", "Das Formular ist im Blick — und die Leute nutzen es"] }
  ],
  "caption": "Vergleichen Sie Heatmaps nach Release, nicht nach URL. Die URL hat sich nicht geändert. Die Seite schon."
}
```

## Wo es in der Methode sitzt

**Messen** ist der Ort, an dem die Kill-Bedingung eines Beweises benotet wird. Replay ist das, was sie benotet: eine Stichprobe, die wirklich erreicht wurde, ein Erfolgsereignis, das Besucher wirklich ausgelöst haben, und Aufnahmen der Besucher, die nicht konvertiert sind.

Diese Evidenz geht zurück zu **Idee** — noch einmal lesen mit dem, was Sie gelernt haben — und weiter zu **Machen**: ein Ticket aus dem Moment, dessen Wirkung Sie am nächsten Release messen.

[Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop) ist die innere Schleife. [Den Beweis benoten](/blog/grade-the-proof-and-close-the-loop) ist, wo die Zahl aufgeschrieben wird. Replay ist, wie diese Zahl aufhört, ein Dashboard zu sein, und anfängt, ein Besuch zu sein, den Sie ansehen können.

```bf-figure
{
  "kind": "flow",
  "title": "Die Schleife, benotet durch den Besuch",
  "steps": [
    { "label": "Beweisen", "note": "Eine Kill-Bedingung, eine Stichprobengröße, ein Erfolgsereignis. Absichtlich billig.", "hue": "idea" },
    { "label": "Bauen", "note": "Das Kleinste, das erreicht werden kann.", "hue": "make" },
    { "label": "Ausführen", "note": "Ein live Origin, ein Release-Token, ein Snippet oder eine gehostete App.", "hue": "run" },
    { "label": "Messen", "note": "Replay benotet den Beweis: Stichprobe erreicht, Ereignis ausgelöst, Aufnahmen derer, die nicht konvertiert sind.", "hue": "measure", "tag": "benotet durch Replay" },
    { "label": "Idee", "note": "Noch einmal lesen mit dem, was die Besuche zeigten. Das nächste Machen beginnt bei einem Moment, nicht bei einer Vermutung.", "hue": "idea" }
  ],
  "caption": "Idee → Machen → Ausführen → Messen ist der Bogen. Replay ist die Note auf Messen, nicht ein separates Produkt daneben."
}
```

Installieren Sie Insights, legen Sie ein Snippet auf Ihre Site, oder schalten Sie die Aufnahme für eine gehostete App ein. Der erste Besuch landet innerhalb von Sekunden. Die Methode selbst ist [das Menü](/blog/idea-make-run-measure-menu-as-methodology).

---

**Weiterlesen:** [Den Beweis benoten](/blog/grade-the-proof-and-close-the-loop) · [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop) · [Idee, Machen, Ausführen, Messen](/blog/idea-make-run-measure-menu-as-methodology)

[Eine Leinwand öffnen](/create) und den nächsten Besuch ansehen.
