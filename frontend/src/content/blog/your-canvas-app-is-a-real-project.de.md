Sie skizzieren eine Idee auf dem Canvas, bitten Brain um eine Marketing-Website und drücken **App**.

Bis heute war das, was Sie dort sahen, eine Vorschau. Der Canvas nahm die Code-Karten auf dem Board, fügte die Seite und ihre Stylesheets zu einem Dokument zusammen und zeigte es in einem Frame. Das war nützlich, um sich Dinge anzusehen. Es konnte die Server-Hälfte von nichts ausführen, kein Paket installieren und hatte keine Datenbank. Sobald die Idee etwas davon brauchte, verließen Sie den Canvas für Studio und fingen in einem zweiten Fenster mit einer zweiten Konversation von vorn an.

Jetzt **ist** der App-Tab Studio. Es ist derselbe Workspace, innerhalb des Canvas, auf dem Sie ohnehin waren.

## Was App jetzt öffnet

```bf-figure
{
  "kind": "screen",
  "frame": "Ein Canvas, der sich als seine App liest",
  "ratio": 1.62,
  "regions": [
    { "label": "Die laufende App", "note": "Echte Dateien auf einem echten Dev-Server, mit Hot Reload", "x": 4, "y": 10, "w": 46, "h": 56, "hue": "make" },
    { "label": "Dateien", "note": "Aus der Leiste öffnen, über das Projekt hinweg suchen", "x": 51, "y": 10, "w": 16, "h": 56, "hue": "accent" },
    { "label": "Terminal · Ausgabe · Probleme", "x": 4, "y": 68, "w": 63, "h": 14, "hue": "run" },
    { "label": "Brain", "note": "Das eigene Brain des Canvas, das jetzt die Dateien der App bearbeiten kann", "x": 70, "y": 10, "w": 26, "h": 72, "hue": "idea" },
    { "label": "Ausführen · Vorschau · Code · Datenbank · Veröffentlichen", "x": 4, "y": 88, "w": 92, "h": 8, "hue": "accent" }
  ],
  "caption": "Der Canvas behält sein eigenes Chrome: eine Session-Leiste, ein Brain, ein Stage-Bogen. Der Workspace fügt seine Bedienelemente der Leiste hinzu, statt eine zweite Toolbar zu zeichnen."
}
```

- **Ein echtes Projekt dahinter.** Es hat die Dateien, die der Agent geschrieben hat, eine Runtime im Browser, die Pakete installiert und einen Dev-Server ausführt (und einen Node-Server, falls Ihre App einen hat), dazu ein Terminal, Prüfungen und eine Problemliste.
- **Ein Brain.** Das Brain-Panel rechts ist das Brain des Canvas, dasselbe, mit dem Sie ohnehin gesprochen haben. Es kann jetzt die Dateien der App auflisten, lesen, durchsuchen und bearbeiten, sodass „mach den Header sticky“ den Code ändert und die Vorschau sich aktualisiert.
- **Ihre Code-Karten werden zu Dateien.** Wenn Sie mit Code-Karten auf dem Board gebaut haben, bringt App sie beim ersten Öffnen in das Projekt und erneut, sobald sich eine Karte ändert. Es wird nichts gefragt, und nichts geht verloren.
- **Datenbank und Veröffentlichen, wenn Sie sie brauchen.** Dieselbe Datenbank-Ansicht und dasselbe Veröffentlichen-Panel wie in Studio, einen Klick von der Session-Leiste entfernt.
- **In Studio öffnen**, wenn Sie den ganzen Bildschirm wollen. Es ist dasselbe Projekt, also muss nichts kopiert werden.

## Ohne Konto starten

```bf-figure
{
  "kind": "flow",
  "title": "Vom Gast-Canvas zur dauerhaften App",
  "steps": [
    { "label": "App drücken", "note": "Wählen Sie Website, Mobile oder Web + Mobile – oder fragen Sie einfach Brain", "hue": "idea" },
    { "label": "Es läuft hier", "note": "Das Projekt lebt in Ihrem Browser und läuft auf derselben Runtime wie Studio", "hue": "make", "tag": "kein Konto" },
    { "label": "Arbeit behalten", "note": "Ihr Board wird in einem Konto gespeichert, und die Dateien der App wandern mit in ein echtes Projekt", "hue": "run" },
    { "label": "Veröffentlichen", "note": "Verlauf, eine Datenbank und eine Live-Adresse werden aktiviert", "hue": "accent" }
  ],
  "caption": "Bei der Übergabe wird nichts neu aufgebaut. Die Dateien, die Sie im Browser hatten, sind die Dateien, mit denen das Projekt startet."
}
```

Sie müssen sich nicht registrieren, um herauszufinden, ob die Idee funktioniert. Ein Canvas ohne Konto führt seine App über Dateien aus, die in Ihrem Browser gehalten werden, auf derselben Runtime, die Studio nutzt. Wenn es sich lohnt, es zu behalten, drücken Sie **Keep your work**. Das Board zieht in Ihr Konto um, und die App zieht mit in ein dauerhaftes Projekt mit Versionsverlauf, Datenbank und Veröffentlichung.

## Mehr als eine App auf einem Board

Ein Board kann mehrere Builds halten: eine Marketing-Website und ein Admin-Tool, oder eine Web-App und ihr Handy-Zwilling. App führt jeweils einen aus, und sobald es einen zweiten gibt, erscheint in der Session-Leiste ein Umschalter. Das Öffnen einer beliebigen Build-Karte auf dem Board bringt Sie direkt dorthin.

## Wo es in der Methode sitzt

Make ist der Akt, in dem aus einer Idee etwas wird, das Sie nutzen können. Es war auch der Akt, der sich auf zwei Produkte aufteilte. Read und [Prove](/blog/read-prove-build-the-inner-loop) passierten auf dem Canvas, und ernsthaftes Bauen passierte in einer separaten IDE. Die Distanz dazwischen war ein Kontextwechsel, ein Copy-and-paste der Idee und ein Brain, das bei null begann.

```bf-figure
{
  "kind": "compare",
  "title": "Von der bewiesenen Idee zur laufenden App",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Die Idee auf dem Canvas beweisen", "Studio in einem anderen Fenster öffnen", "Die Idee einem neuen Chat erneut erklären", "Dort bauen", "Zum Messen zurück zum Canvas"] },
    { "title": "Jetzt", "hue": "make", "items": ["Die Idee auf dem Canvas beweisen", "App drücken", "Weiter mit demselben Brain sprechen", "Ausführen, dann auf demselben Board messen"] }
  ],
  "caption": "Idee → Make → Run → Measure passiert jetzt auf einer Fläche, mit einer Konversation, die durch jede Phase getragen wird."
}
```

Weil die App auf demselben Board lebt wie die Recherche, der Beweis und die Metriken, folgen **Run** und **Measure** ohne Übergabe. Das, was Sie messen, ist das, was das Board gebaut hat, und das Brain, das die Zahlen liest, ist dasselbe, das den Code geschrieben hat.

## Was Sie heute damit tun können

- **App auf jedem Canvas öffnen** und mit echten Dateien, Paketen und einem Server bauen, ohne das Board zu verlassen.
- **Mit Brain weiterbauen**, das jetzt den Code Ihrer App direkt bearbeitet.
- **Bestehende Code-Karten in ein laufendes Projekt verwandeln**, einfach indem Sie App öffnen.
- **Ohne Konto ausprobieren** und behalten, wenn es sich lohnt.
- **Zwischen Apps wechseln** auf demselben Board, oder jede davon im Vollbild in Studio öffnen.

---

**Weiterlesen:** [Builderforce Studio — describe an app, watch it run, keep every version](/blog/builderforce-studio-describe-it-run-it) · [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [Create before you sign up](/blog/create-before-you-sign-up)

[Einen Canvas öffnen](/create), **App** drücken und nach etwas mit einem Backend fragen.
