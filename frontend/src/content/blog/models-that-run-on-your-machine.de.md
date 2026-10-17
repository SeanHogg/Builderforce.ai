Jedes Token, das Sie an ein Cloud-Modell schicken, verlässt Ihren Rechner, und jedes einzelne wird abgerechnet. Für die meiste Arbeit ist das ein fairer Tausch. Für eine private Notiz, eine schnelle Umformulierung, eine Frage zu Code, den Sie lieber nirgendwo einfügen würden, oder einen Nachmittag im Zug ohne Netz ist er es nicht.

Ein kleines Modell lokal auszuführen war immer die naheliegende Antwort, und es ist immer an derselben Stelle gescheitert. Ein kleines Modell hat ein kleines Kontextfenster. Beginnen Sie eine Aufgabe mit einem Frontier-Modell, wechseln Sie mittendrin zu einem lokalen, und das lokale Modell bekommt ein Protokoll, das um ein Vielfaches größer ist, als es fassen kann. Es schneidet ab, vergisst die Anweisung oder scheitert ganz. In die andere Richtung macht das Cloud-Modell weiter, ohne zu wissen, was das lokale gerade getan hat.

Dieses Release schließt beide Hälften. Sie können jetzt ein Modell auf Ihrem eigenen Rechner ausführen, aus der Auswahl, die Sie ohnehin nutzen, und wenn ein Lauf zwischen Modellen wechselt, bekommt das nächste ein Gespräch, das für sein eigenes Fenster gepackt ist.

## Ein Modell wählen, das auf diesem Gerät läuft

Öffnen Sie im Eingabefeld das `/`-Menü, gehen Sie zu **Modell** und wählen Sie **Auf diesem Gerät**. Die Liste zeigt jedes Modell, das über WebGPU auf der GPU Ihres Browsers laufen kann. Drücken Sie einmal auf **Herunterladen**; Ihr Browser speichert das Modell, und von da an wird es von der Festplatte geladen.

```bf-figure
{
  "kind": "screen",
  "frame": "/-Menü · Modell · Auf diesem Gerät",
  "ratio": 1.6,
  "regions": [
    { "label": "Auf diesem Gerät", "note": "Dieselbe Auswahl wie bei Cloud-Modellen, gefiltert auf das, was auf Ihrer GPU läuft", "x": 3, "y": 5, "w": 94, "h": 13, "hue": "idea" },
    { "label": "Bonsai 8B", "note": "1-Bit · 1,16 GB · Tool-Aufrufe · Builderforce-Engine", "x": 3, "y": 22, "w": 62, "h": 15, "hue": "run" },
    { "label": "Bereit", "note": "Einmal heruntergeladen, lädt von der Festplatte, funktioniert offline", "x": 68, "y": 22, "w": 29, "h": 15, "hue": "good" },
    { "label": "Bonsai 4B", "note": "1-Bit · 0,57 GB · Tool-Aufrufe", "x": 3, "y": 41, "w": 62, "h": 15, "hue": "run" },
    { "label": "62 %", "note": "Wird heruntergeladen, mit sichtbarem Fortschritt", "x": 68, "y": 41, "w": 29, "h": 15, "hue": "prove" },
    { "label": "Bonsai 1.7B", "note": "1-Bit · 0,25 GB · Tool-Aufrufe", "x": 3, "y": 60, "w": 62, "h": 15, "hue": "run" },
    { "label": "Herunterladen", "note": "Ein Klick; nie von einem Chat-Zug ausgelöst", "x": 68, "y": 60, "w": 29, "h": 15, "hue": "make" },
    { "label": "Hermes 3 8B", "note": "Passt nicht auf diese GPU, und die Zeile sagt, warum", "x": 3, "y": 79, "w": 94, "h": 15, "style": "ghost" }
  ],
  "caption": "Herunterladen, Fortschritt, bereit. Ein Modell, das auf Ihrem Gerät nicht laufen kann, bleibt in der Liste und sagt, was es bräuchte."
}
```

Hinter dieser Liste stehen zwei Engines.

- **1-Bit Bonsai 8B, 4B und 1.7B** von PrismML, Apache-2.0, mit etwa 1,16 GB, 0,57 GB und 0,25 GB. Sie laufen auf Builderforces eigener Engine, derselben, auf der [Synapse auf dem Desktop läuft](/blog/synapse-runs-models-itself), kompiliert für den Browser. Alle drei rufen Tools auf, sie können also Agentenarbeit leisten und nicht nur chatten.
- **WebLLM-Modelle**: Qwen3 1.7B und 4B, Llama 3.2 3B sowie Hermes 3 8B, das ebenfalls Tools aufruft.

Die Auswahl ist überall dieselbe, wo Sie mit Builderforce arbeiten: in der VS-Code-Erweiterung, in [Rovr](/blog/rovr-your-assistant-in-the-browser) in Chrome und auf builderforce.ai. Bevor sie ein Modell anbietet, prüft sie Ihr Gerät. Ein Modell, das zu groß für den Speicher Ihrer GPU ist oder eine GPU-Funktion braucht, die Ihre nicht hat, wird nicht versteckt; es sagt, warum es nicht läuft.

Wenn Sie eines wählen, verlassen Ihre Prompts für diese Züge Ihren Rechner nie. Es gibt keine Anfrage an einen Server, die protokolliert werden könnte, keine Tokens, die abgerechnet werden, und sobald das Modell heruntergeladen ist, braucht es überhaupt kein Netz.

## Zwischen Modellen wechseln, ohne den Faden zu verlieren

Echte Arbeit bleibt selten bei einem Modell. Sie entwerfen privat mit einem lokalen Modell und geben den schwierigen Teil an ein Cloud-Modell ab. Ein Plan wird von einem Modell geschrieben und von einem anderen programmiert. Ein Anbieter fällt mitten im Lauf aus, und Builderforce weicht auf den nächsten aus. Bei jedem dieser Wechsel bekam das nächste Modell bisher das ganze Gespräch, in der Hoffnung, dass es passt.

Jetzt läuft jeder Wechsel über **builderforce-memory**, das das Gespräch für das Modell packt, das gerade übernimmt.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Übergabe von Ihrem Gerät an die Cloud",
  "steps": [
    { "label": "Lokales Modell", "note": "Bonsai entwirft privat in Ihrem Browser, mit einem Fenster von etwa 14.000 Tokens.", "hue": "run", "tag": "auf dem Gerät" },
    { "label": "Memory packt", "note": "builderforce-memory behält den System-Prompt, Ihre letzte Anweisung wörtlich und die jüngste Arbeit, und macht aus dem Rest eine Zusammenfassung oder Erinnerung.", "hue": "prove", "tag": "passt ins nächste Fenster" },
    { "label": "Übergabenotiz", "note": "Der gepackte Kontext beginnt mit einer Zeile, welches Modell an welches übergeben hat.", "hue": "idea" },
    { "label": "Cloud-Modell", "note": "Übernimmt die Aufgabe mit dem Wissen, was passiert ist, nicht nur, wo das Protokoll endete.", "hue": "make", "tag": "in der Cloud" }
  ],
  "caption": "Dasselbe Packen läuft auch in die andere Richtung, sodass ein kleines lokales Modell nie ein Protokoll bekommt, das es nicht fassen kann."
}
```

Die Regeln sind einfach. Der System-Prompt bleibt. Ihre letzte Anweisung bleibt Wort für Wort. Ein Tool-Aufruf wird nie von seinem Ergebnis getrennt. Die jüngsten Züge bleiben wörtlich erhalten, so weit das Fenster des nächsten Modells reicht, und der ältere Mittelteil wird zu einer einzigen Notiz: einer Zusammenfassung, wenn sich eine erstellen lässt, sonst dem, was das Gedächtnis zu Ihrer Anweisung erinnert. Das gepackte Gespräch passt immer in das Fenster des Modells, das es empfängt, mit Platz für seine Antwort.

So bekommt ein kleines Modell ein Gespräch, mit dem es wirklich arbeiten kann, und ein großes Modell, das nach einem kleinen übernimmt, weiß, was getan wurde.

```bf-figure
{
  "kind": "compare",
  "title": "Auf diesem Gerät oder in der Cloud",
  "columns": [
    { "title": "Auf diesem Gerät", "hue": "run", "items": ["Prompts verlassen Ihren Rechner nie", "Keine Kosten pro Token", "Funktioniert offline, sobald heruntergeladen", "Bonsai- und WebLLM-Modelle bis etwa 8B", "Braucht einen Browser und eine GPU mit WebGPU", "Kleineres Fenster und weniger Tiefe als Frontier-Modelle"] },
    { "title": "Builderforce-Cloud", "hue": "make", "items": ["Frontier-Modelle und lange Fenster", "Nichts herunterzuladen", "Läuft in jedem Browser und auf jedem Gerät", "Abrechnung pro Token", "Übernimmt einen Lauf mit Übergabenotiz", "Die richtige Wahl für große, schwierige Aufgaben"] }
  ],
  "caption": "Wählen Sie pro Zug. builderforce-memory sorgt dafür, dass Sie beim Wechsel keinen Kontext verlieren."
}
```

## Was Sie erwarten können

Ein paar ehrliche Grenzen, denn ein lokales Modell, das enttäuscht, ist schlimmer als eines, das Sie nie ausprobiert haben.

- **Es braucht WebGPU.** Aktuelles Chrome und Edge haben es auf den meisten Desktops. Ein Browser oder eine GPU ohne WebGPU kann diese Modelle nicht ausführen, und die Auswahl sagt das, statt später zu scheitern.
- **Der erste Download ist groß.** Bonsai 8B hat etwa 1,16 GB. Es wird einmal heruntergeladen und danach von der Festplatte geladen; entfernen können Sie es in derselben Auswahl.
- **Es sind kleine Modelle.** Sie sind gut im Entwerfen, Umformulieren, bei kurzen Fragen und gezielten Tool-Aufrufen. Frontier-Modelle sind sie nicht, und bei einer langen, verwickelten Aufgabe ist ein Cloud-Modell besser.
- **Das Fenster ist kleiner als in der Cloud.** Bonsai 8B fasst im Browser etwa 14.000 Tokens Kontext auf einer GPU mit Halbpräzision, ohne sie etwa 7.000. Genau deshalb gibt es das Packen bei der Übergabe, und genau in dieser Richtung zählt es am meisten.

## Wo es in der Methode steht

Arbeit auf Builderforce folgt einem Bogen, **Idee → Machen → Betreiben → Messen → Reichweite**, und darin der Schleife, die entscheidet, was es wert ist, gebaut zu werden: [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop).

- **Lesen** wird günstiger und privater. Eine Idee durchdenken, die eigenen Notizen noch einmal lesen und die Fragen stellen, die Sie nie in ein Cloud-Tool einfügen würden: all das kann auf Ihrem Gerät geschehen, ohne Kosten.
- **Beweisen** hält den günstigen Teil günstig. Lesen und Beweisen sind die Akte, die nichts kosten sollten; ein lokales Modell lässt die kleinen Prüfungen laufen, ohne ein Token auszugeben, und das Budget bleibt für den Beweis, der ein Frontier-Modell braucht.
- **Bauen** ist der Ort, an dem sich Übergaben auszahlen. Ein lokal entworfener Plan erreicht das programmierende Modell gepackt, mit unveränderter Anweisung und einer Notiz zu dem, was entschieden wurde.
- **Betreiben** wird stabiler. Fällt ein Anbieter mitten im Lauf aus, bekommt das übernehmende Modell ein Gespräch, das in sein Fenster passt, sodass ein Ausweichen die Arbeit fortsetzt, statt sie neu zu beginnen.
- **Messen** bekommt die einfachste Ersparnis überhaupt: Ein Zug, der auf Ihrem Gerät beantwortet wird, ist ein Zug, den niemand abrechnet.

## Was Sie heute damit tun können

- **Privat entwerfen.** Wählen Sie Bonsai oder ein WebLLM-Modell unter **Auf diesem Gerät**, und nichts, was Sie in diesen Zügen tippen, verlässt Ihren Rechner.
- **Offline arbeiten.** Laden Sie vor der Reise ein Modell herunter; es läuft ganz ohne Verbindung.
- **Klein anfangen, groß abschließen.** Beginnen Sie mit einem lokalen Modell und wechseln Sie zu einem Cloud-Modell, wenn die Aufgabe wächst. Das Cloud-Modell bekommt ein gepacktes Gespräch und eine Übergabenotiz.
- **Überall dasselbe Modell nutzen.** Die Auswahl ist in VS Code, in Rovr und auf builderforce.ai dieselbe.
- **Sehen, warum ein Modell nicht läuft.** Ein Modell, das nicht auf Ihr Gerät passt, sagt, was fehlt, statt mitten im Download zu scheitern.

Öffnen Sie das `/`-Menü, wählen Sie **Modell** und dann **Auf diesem Gerät**, und laden Sie eines herunter.

---

**Weiterlesen:** [Synapse führt Modelle jetzt selbst aus](/blog/synapse-runs-models-itself) · [Local-first-KI mit WebGPU im Browser](/blog/local-first-ai-webgpu-in-the-browser) · [Das ist Rovr](/blog/rovr-your-assistant-in-the-browser) · [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop)
