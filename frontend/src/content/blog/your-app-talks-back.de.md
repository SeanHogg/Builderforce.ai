# Ihre App antwortet jetzt – ihre Konsole, Live-Verbindungen und eine Kopie zum Mitnehmen

Eine App, die vor Ihren Augen läuft, Ihnen aber nicht sagen kann, was sie gerade tut, ist ein Screenshot, der sich bewegt.

Das traf es genauer, als uns lieb war. Eine Builderforce-App lief in Ihrem Browser, doch sobald sie etwas Interessantes tat – eine Warnung protokollierte, eine Live-Verbindung öffnete, ein Login-Cookie setzte –, wurde die Vorschau stumm. Der Brain sah Abstürze und sonst nichts. Eine mit WebSockets gebaute Chat-App verband sich mit nichts. Ein Login funktionierte einmal und hatte Sie beim nächsten Klick vergessen. Und jedes Mal, wenn Sie zurückkamen, begann das Projekt mit einem vollständigen `npm install`, als hätte es Sie nie gesehen.

Dieses Release schließt diese Lücken. Sie liegen alle an derselben Stelle: in der Schleife zwischen einer Änderung und dem Moment, in dem Sie sehen, was sie bewirkt hat.

## Was Ihnen die App jetzt sagt

```bf-figure
{
  "kind": "screen",
  "frame": "Der Studio-Workspace mit geöffnetem Konsole-Tab",
  "ratio": 1.62,
  "regions": [
    { "label": "Ihre laufende App", "note": "Die Vorschau, in der Breite, die Sie gewählt haben", "x": 4, "y": 6, "w": 58, "h": 56, "hue": "make" },
    { "label": "Brain", "note": "Liest dieselbe Konsole wie Sie", "x": 66, "y": 6, "w": 30, "h": 56, "hue": "idea" },
    { "label": "Konsole", "note": "Jedes Log, jede Warnung und jeder Fehler der App, nach Stufe gefiltert, Wiederholungen gezählt", "x": 4, "y": 66, "w": 92, "h": 28, "hue": "run", "tag": "neu" }
  ],
  "caption": "Der Konsole-Tab sitzt neben Terminal, Ausgabe und Probleme. Was die App schreibt, erscheint hier, während sie läuft – von jeder Seite, die sie ausliefert."
}
```

- **Ein Konsole-Tab.** Alles, was Ihre App mit `console.log`, `warn` oder `error` schreibt, erscheint neben dem Terminal, in dem Moment, in dem es passiert. Sie können nach Stufe filtern, wiederholte Zeilen werden gezählt, statt sich zu stapeln, und jeder Lauf beginnt mit einer leeren Konsole.
- **Der Brain liest mit.** Fragen Sie „Warum ist der Warenkorb leer?“, und der Brain kann sich ansehen, was die App tatsächlich protokolliert hat, nicht nur, ob sie abgestürzt ist. Nach einer Korrektur kann er die Konsole erneut lesen und prüfen, ob die Warnung verschwunden ist.
- **Jede Seite, nicht nur die erste.** Fehler und Logs kommen von den Seiten des Dev-Servers und ebenso von Seiten, die ein Node-Server zurückgibt. Eine Express-App mit fünf Routen meldet sich aus allen fünf.

## Apps, die verbunden bleiben

Vieles von dem, was Menschen bauen, ist live: Chats, Dashboards, die sich aktualisieren, Multiplayer-Boards, Fortschrittsbalken für lange Aufgaben. All das hängt an drei Dingen, die eine Browser-Vorschau normalerweise nicht kann – und jetzt funktionieren alle drei.

```bf-figure
{
  "kind": "compare",
  "title": "In der Vorschau",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Antworten kamen auf einmal an, wenn der Server fertig war", "WebSockets hatten nichts, womit sie sich verbinden konnten", "Ein Login-Cookie ging bei der nächsten Anfrage verloren", "Shell-Skripte mit if, for oder while schlugen fehl"] },
    { "title": "Jetzt", "hue": "run", "items": ["Server-Sent Events und Fortschritt kommen an, während sie geschrieben werden", "WebSockets verbinden sich mit dem eigenen Server der App und tragen seine Pushes zurück", "Logins bleiben bestehen: Die Cookies, die der Server setzt, kommen bei jeder Anfrage zurück", "Shell-Skripte mit if, for, while, case und Funktionen laufen wie geschrieben"] }
  ],
  "caption": "All das läuft in Ihrem Browser-Tab, ohne einen Server von uns dazwischen und ohne spezielle Header auf Ihrer Website."
}
```

Dasselbe gilt für die Befehle in der README eines Projekts. `pnpm install`, `yarn dev` und `pnpm dlx` funktionieren wie geschrieben, neben npm.

## Dort weitermachen, wo Sie aufgehört haben

```bf-figure
{
  "kind": "flow",
  "title": "Ihr zweiter Besuch",
  "steps": [
    { "label": "Projekt öffnen", "note": "Dieselbe package.json wie beim letzten Mal", "hue": "make" },
    { "label": "Wiederherstellen", "note": "Die bei Ihrem letzten Besuch installierten Pakete kommen aus dem Speicher dieses Browsers zurück", "hue": "run", "tag": "Sekunden statt Minuten" },
    { "label": "Ausführen", "note": "Der Dev-Server startet sofort. Eine geänderte package.json wird wie gewohnt installiert", "hue": "run" }
  ],
  "caption": "Installierte Pakete bleiben auf Ihrem Gerät, für Ihre zuletzt genutzten Projekte. Ändern Sie eine Abhängigkeit, installiert der nächste Lauf neu und behält dann diesen Stand."
}
```

Beim ersten Lauf eines Projekts werden seine Pakete installiert wie bisher. Danach bleiben sie in Ihrem Browser. Ihr nächster Besuch stellt sie wieder her und geht direkt zum Ausführen über, und die Installationen des Brain nutzen denselben Speicher.

## Nehmen Sie es mit

**Projekt herunterladen** finden Sie im Mehr-Menü des Studio und in der Panel-Leiste der Canvas-App. Sie erhalten ein ZIP mit dem Quellcode Ihrer App, ohne `node_modules` und Build-Ausgaben, bereit zum Öffnen in jedem Editor, zum Pushen auf jeden Host oder zur Weitergabe an jeden. Was Sie auf Builderforce bauen, gehörte schon immer Ihnen. Jetzt ist es auch nur einen Klick entfernt.

## Wo das in der Methode steht

Bauen ist der dritte Akt von [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop), und der teure. Sobald Sie darin stecken, hängt die ganze Erfahrung davon ab, wie kurz der Weg von *etwas ändern* zu *wissen, was es bewirkt hat* ist.

Jede der Lücken oben war eine Stelle, an der dieser Weg abbrach. Entweder tat die App etwas, das Sie nicht sehen konnten, oder sie konnte nicht tun, was die echte App tun würde, oder das Zurückkommen kostete Sie die ersten Minuten. Sie zu schließen hält den Akt Bauen ehrlich: Was Sie in der Vorschau sehen, ist das, was die App tun wird. Und dann bringt der Download-Button Ihre Arbeit aus Machen hinaus und in Betreiben hinein, auf welcher Plattform auch immer Sie sie betreiben wollen.

## Was Sie heute tun können

- **Öffnen Sie den Konsole-Tab**, während Ihre App läuft, oder fragen Sie den Brain, was die App protokolliert.
- **Bauen Sie etwas Live-Fähiges:** einen Chat, ein Dashboard, das sich aktualisiert, einen Upload mit Fortschrittsbalken. Und nutzen Sie es dann in der Vorschau.
- **Melden Sie sich in Ihrer eigenen App an** und bleiben Sie angemeldet.
- **Kommen Sie morgen wieder** und sparen Sie sich die Neuinstallation.
- **Laden Sie das Projekt herunter** und nehmen Sie es überallhin mit.

---

**Weiterlesen:** [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers ist Open Source](/blog/builderforce-webcontainers-open-source)

[Öffnen Sie einen Canvas](/create) und bauen Sie etwas, das verbunden bleiben muss.
