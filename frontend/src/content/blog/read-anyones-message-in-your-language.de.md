Ein Team ohne gemeinsame Sprache verliert bei jeder Übergabe Kontext. Die Entscheidung in einem Thread, den man nur halb lesen konnte. Der Kommentar an einer Karte, den man übersprungen hat, weil der Umweg zu lang war. Das importierte Dokument, das niemand geöffnet hat.

Üblicherweise kopiert man den Text in einen Übersetzer. Dabei gehen Ihre Gespräche, Ihre Pläne und die Namen Ihrer Kunden Nachricht für Nachricht an einen Cloud-Dienst, und bei echtem Volumen kostet das echtes Geld.

## Ein Klick, in Ihrer Sprache

Nachrichten und Kommentare in einer anderen Sprache werden automatisch übersetzt, sobald sie ins Bild scrollen, genau dort, wo Sie lesen. „Original anzeigen“ ist einen Klick entfernt. Bei einem importierten Dokument wird die Übersetzung angeboten, und ein Klick erzeugt eine übersetzte Kopie daneben. Kein Kopieren und Einfügen, kein zweiter Tab.

```bf-figure
{
  "kind": "screen",
  "frame": "Eine Nachricht von einer Kollegin",
  "ratio": 1.62,
  "regions": [
    { "label": "Aus dem Spanischen übersetzt · Original anzeigen", "note": "Immer gekennzeichnet, immer umkehrbar", "x": 4, "y": 6, "w": 92, "h": 12, "hue": "accent" },
    { "label": "Die Nachricht in Ihrer Sprache", "note": "Lesen, zitieren, beantworten", "x": 4, "y": 22, "w": 92, "h": 46, "hue": "make" },
    { "label": "Antworten", "note": "Sie schreiben in Ihrer Sprache, sie liest in ihrer", "x": 4, "y": 74, "w": 92, "h": 20, "hue": "idea" }
  ],
  "caption": "Die Übersetzung sagt, was sie ist und woher sie kommt. Das Original ist einen Klick hinter dem Hinweis, niemand muss einer Übersetzung blind vertrauen."
}
```

## Zuerst Ihr Gerät, danach ein kostenloser Ersatz

Chrome hat einen Übersetzer eingebaut. Builderforce nutzt ihn zuerst: Der Text wird auf Ihrem eigenen Gerät übersetzt und muss dafür nirgendwohin gesendet werden. Hat Ihr Browser keinen, wie Edge derzeit, übernimmt eine Cloud-Übersetzung, die innerhalb der Tageslimits kostenlos ist. Die Funktion fehlt also nie, sie ist höchstens weniger privat.

Zusammenfassungen und Umformulierungen folgen derselben Reihenfolge. Wenn der Browser es kann, laufen sie zuerst auf dem Gerät (Gemini Nano in Chrome, Phi-4-mini in Edge) und gehen nur dann an die Cloud-Modelle, wenn er es nicht kann.

```bf-figure
{
  "kind": "devices",
  "title": "Dieselbe Übersetzung, wo auch immer Sie arbeiten",
  "devices": [
    { "label": "Web", "width": 1280, "hue": "make", "note": "Nachricht oder Kartenkommentar direkt übersetzen" },
    { "label": "Rovr", "width": 834, "hue": "run", "note": "Seite oder Thread in der Browser-Seitenleiste in Ihrer Sprache lesen" },
    { "label": "VS Code", "width": 390, "hue": "measure", "note": "Die Notiz einer Kollegin neben dem Code lesen, um den es geht" }
  ],
  "caption": "Ein Verhalten auf jeder Oberfläche: zuerst das Gerät, dann ein Cloud-Übersetzer, innerhalb der Tageslimits kostenlos, das Original immer einen Klick entfernt."
}
```

```bf-figure
{
  "kind": "compare",
  "title": "Auf Ihrem Gerät oder in der Cloud",
  "columns": [
    { "title": "Cloud-Übersetzer", "hue": "muted", "items": ["Ihr Text geht an einen Dritten", "Bei Volumen pro Zeichen kostenpflichtig", "Braucht jedes Mal eine Verbindung", "Ein weiterer Tab und ein Einfügeschritt"] },
    { "title": "Zuerst auf Ihrem Gerät", "hue": "make", "items": ["Der Text bleibt auf Ihrem Computer", "Auf dem Gerät kostenlos, egal wie viel Sie lesen", "Funktioniert offline, sobald die Sprache installiert ist", "Direkt übersetzt, Original einen Klick entfernt"] }
  ],
  "caption": "Die Cloud-Alternative gibt es, damit niemand ohne Übersetzung bleibt. Sie ist die zweite Wahl, nicht der Standard."
}
```

## Wo es in der Methode sitzt

Builderforce arbeitet in einem Bogen: [Idee, Machen, Ausführen, Messen, Reichweite](/blog/read-prove-build-the-inner-loop), mit Lesen, Belegen und Bauen als innerer Schleife, die Sie von der Idee zum Machen führt. Die Übersetzung gehört zum ersten Schritt dieser Schleife, dem **Lesen**, in der Idee, und öffnet ihn für das ganze Team.

Lesen ist der günstige Schritt, der entscheidet, ob überhaupt etwas gebaut wird, und er funktioniert nur, wenn Sie lesen können, was die Belege sagen. Ein Kundeninterview auf Portugiesisch, eine Spezifikation von einem Auftragnehmer in Berlin, ein Kommentar einer Kollegin in Madrid: Bisher wurde das übersprungen oder an einen Dienst geschickt. Jetzt ist es sofort lesbar, und die Entscheidung zum Machen fällt auf Basis alles dessen, was das Team weiß, nicht nur des Teils in Ihrer Sprache.

## Was Sie heute damit tun können

- **Die Nachricht einer Kollegin in Ihrer Sprache lesen**, sobald sie ins Bild scrollt, und in Ihrer antworten.
- **Ein importiertes Dokument** in einer anderen Sprache als neues Dokument daneben übersetzen, ohne die Seite zu verlassen.
- **Ihre Gespräche auf Ihrem Computer behalten**, wenn Ihr Browser einen Übersetzer hat (derzeit der eingebaute Übersetzer von Chrome).
- **Die Quelle jederzeit prüfen**: Jede Übersetzung zeigt, woher sie kommt, und hält das Original einen Klick entfernt.

---

**Weiterlesen:** [Lokale KI: WebGPU im Browser](/blog/local-first-ai-webgpu-in-the-browser) · [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas)

[Eine Leinwand öffnen](/create) und jemanden einladen, der in einer anderen Sprache schreibt.
