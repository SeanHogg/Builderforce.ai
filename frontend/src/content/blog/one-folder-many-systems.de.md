Sie richten ein Review auf den Ordner, in dem Sie Ihre Arbeit ablegen. Er enthält fünf Repositories und zwei lose Kopien eines davon, die jemand für einen Test angelegt und nie gelöscht hat. Sie erwarten eine Karte mit fünf Systemen.

Sie bekamen ein System. Jede Linie trug den Namen dessen, was zuerst kam, die meisten endeten nach einer einzigen Station, und die Kopien wurden wie echter Code gezählt, sodass dieselben Probleme dreimal auftauchten. Bei den größten Ordnern wurden die meisten Dateien gar nicht gelesen, weil das Review nach einer festen Zahl aufhörte.

Das ist die Lücke: **Ein großer Ordner las sich als ein verworrenes System, und verstreute Kopien verschmutzten die Karte.**

## Jedes System ist ein eigenes System

Das Review schaut jetzt, was im Ordner liegt, und teilt ihn auf. Ein Unterordner, der ein eigenes Repository ist, ist ein System. Ein Ordner mit Projektmanifest ist ein System. Innerhalb eines Systems sind seine Workspace-Pakete die Apps, aus denen es besteht. Ein Ordner, der selbst ein Repository ist, bleibt einfach ein System.

```bf-figure
{
  "kind": "compare",
  "title": "Derselbe Ordner, vorher und nachher",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Fünf Repos und zwei Kopien galten als ein Projekt", "Linien nach den Kopien benannt", "Jede Linie endete nach einer Station", "Probleme für jede Kopie erneut gezählt", "Bei großen Ordnern die meisten Dateien nie gelesen"] },
    { "title": "Jetzt", "hue": "make", "items": ["Jedes Repo ist ein eigenes System", "Linien nach System gruppiert, benannt nach System und Paket", "Jede Linie sagt, wo und warum sie endet", "Probleme nur innerhalb eines Systems gezählt", "Keine Obergrenze: der ganze Ordner wird erfasst"] }
  ],
  "caption": "An Ihrem Ordner hat sich nichts geändert. Die Karte tut nur nicht mehr so, als wäre er ein einziges Ding."
}
```

Die Linien werden nach System gruppiert und gerecht verteilt, sodass ein großes System die anderen nicht von der Karte verdrängt. Die Kopfzeile beginnt beim System, in dem Sie sich befinden. Enthält der Ordner mehr als ein System, zeigt die Systemansicht für jedes eine eigene Ebene.

## Verstreute Kopien werden gefunden, nicht erraten

Tragen zwei Systeme dasselbe Projekt und stimmen ihre Dateien fast vollständig überein, behandelt das Review das als Kopie. Es sagt Ihnen, welcher Ordner wie die verstreute Kopie aussieht, meist der ohne Repository dahinter, und warum. Bis Sie entscheiden, bleibt die Kopie auf der Karte, als Kopie markiert, ihre Linien unter dem Original eingeordnet, damit sie das Rauschen nicht verdoppelt.

Sie entscheiden mit einem Klick.

```bf-figure
{
  "kind": "flow",
  "title": "Vom unübersichtlichen Ordner zur sauberen Karte",
  "steps": [
    { "label": "Review", "note": "Auf den Ordner richten. Jedes System wird gefunden und für sich gezeichnet.", "hue": "idea" },
    { "label": "Kopien erkennen", "note": "Ein mitgelieferter oder duplizierter Baum wird als Kopie markiert, samt Begründung.", "hue": "make" },
    { "label": "Ausschließen", "note": "Ein Klick setzt den Ordner auf Ihre Ignorierliste und startet ein Re-Review mit der üblichen Schätzung und Bestätigung.", "hue": "run", "tag": "Ihre Entscheidung" },
    { "label": "Saubere Karte", "note": "Nur der echte Code bleibt, nach System gruppiert.", "hue": "measure" }
  ],
  "caption": "Das Review findet das Problem und bietet die Lösung an. Es ändert Ihren Ordner nie hinter Ihrem Rücken, und Sie müssen nie eine Ignorierdatei von Hand bearbeiten."
}
```

**Ausschließen ist ein normales Re-Review.** Es durchläuft dieselbe Planung, Schätzung und Bestätigung wie jedes andere, Sie sehen also die Kosten, bevor etwas ausgegeben wird, und danach ist die Kopie von der Karte verschwunden.

## Keine Obergrenze, nichts stillschweigend ausgelassen

Ein großer Ordner wird vollständig gelesen. Die einzige verbleibende Grenze ist die Größe einer einzelnen Datei, und jede übersprungene Datei wird gezählt und in der Diagnose genannt. Eine Lücke in der Karte lässt sich also nachlesen, statt sie nur zu vermuten. Ein System, das abgebrochen wurde, sagt das.

Verweise zwischen Systemen gelten als extern, nicht als Schichtungsfehler. Ein Dienst, der ein anderes Repository aufruft, wird nicht mehr als Bruch seiner eigenen Architektur gemeldet.

```bf-figure
{
  "kind": "screen",
  "frame": "Review eines Ordners mit vielen Systemen",
  "ratio": 1.62,
  "regions": [
    { "label": "Systeme", "note": "Eine Ebene pro System, wenn der Ordner mehr als eines enthält", "x": 4, "y": 8, "w": 56, "h": 52, "hue": "make" },
    { "label": "Linien nach System", "note": "Nach System gruppiert, benannt nach System und Paket, jeweils mit Endgrund", "x": 64, "y": 8, "w": 32, "h": 52, "hue": "idea" },
    { "label": "Kopie gefunden · Vom Review ausschließen", "note": "Der verstreute Ordner, warum er wie eine Kopie aussieht, und der Button", "x": 4, "y": 64, "w": 56, "h": 30, "hue": "run" },
    { "label": "Diagnose", "note": "Systeme, Kopien, übersprungene Dateien, wo jede Linie endet", "x": 64, "y": 64, "w": 32, "h": 30, "hue": "measure" }
  ],
  "caption": "So sieht ein Workspace mit vielen Repos jetzt aus: die Systeme, die Kopie und der Weg, sie zu entfernen, auf einem Bildschirm."
}
```

## Wo es in der Methode steht

Das ist der Schritt **Read** (Lesen): verstehen, was man hat, bevor man baut. Die Methode läuft Read, Prove, Build, und der Bogen darum läuft Idea, Make, Run, Measure. Eine Karte, die fünf Systeme zu einem verschmilzt oder eine verstreute Kopie als echten Code zählt, liefert ein falsches Bild für Entscheidungen, und jeder spätere Schritt erbt den Fehler. Wer jedes System für sich liest und die Kopien aus dem Weg räumt, trifft die Entscheidung zum Bauen auf Grundlage dessen, was wirklich da ist.

## Was Sie heute damit tun können

- **Einen Workspace mit vielen Repos prüfen** und jedes als eigenes System sehen.
- **Ein Monorepo nach Paketen lesen**, mit Linien gruppiert unter dem System, zu dem sie gehören.
- **Verstreute Kopien erkennen** und mit einem Klick von der Karte nehmen, nach der üblichen Schätzung.
- **Der Größe der Karte vertrauen**, weil keine Datei wegfällt, nur weil sie die vieltausendste ist.

---

**Weiterlesen:** [Watch your codebase review run](/blog/watch-your-codebase-review-run) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)
