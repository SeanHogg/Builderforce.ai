# Ihre Full-Stack-App läuft jetzt in dem Browser-Tab, in dem Sie sie gebaut haben

Sie beschreiben eine App: eine Seite, eine API dahinter, eine Datenbank darunter. Die Dateien stimmen. Der Blueprint stimmt. Und dann warten Sie — bis ein Container eingeplant, gestartet, befüllt und verdrahtet ist —, bevor Sie erfahren, ob das alles zusammen funktioniert.

Dieses Warten ist kein Detail. Es ist die Lücke zwischen *Ich habe etwas gebaut* und *Ich weiß, dass es funktioniert*, und jede Minute davon ist eine Minute, in der die Idee hätte getestet statt eingereiht werden können.

Diese Lücke ist weg. **Run startet jetzt Ihre ganze App im Browser-Tab.**

## Was beim Drücken von Run startet

Der App-Blueprint Ihres Projekts listet seine Dienste auf. Node-, Python- und PHP-Dienste — Express oder Next.js, FastAPI, Flask, Django, Laravel, Slim — laufen im Tab, und die Datenbank ist ein echtes Postgres, das in der Seite läuft. Die Dienste sind miteinander verbunden, und die Live-Vorschau öffnet sich neben dem Board.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Full-Stack-App, komplett in einem Tab",
  "steps": [
    { "label": "Frontend", "note": "Ihre Seite startet in ihrer eigenen Laufzeit und liefert die Live-Vorschau, durch die Sie klicken.", "hue": "make", "tag": "im Tab" },
    { "label": "API", "note": "Ein Node-, Python- oder PHP-Dienst beantwortet die Anfragen der Seite über eine virtuelle Verbindung zum Frontend.", "hue": "run", "tag": "im Tab" },
    { "label": "Postgres", "note": "Eine echte Postgres-Datenbank, in der Seite gehalten, sodass Abfragen, Schema und Seed-Daten sich wie in der Produktion verhalten.", "hue": "measure", "tag": "im Tab" }
  ],
  "caption": "Drei Dienste, zwei Verbindungen, ein Browser-Tab. Code, Daten und Anfragen der App bleiben in Ihrem Tab; nur Pakete werden heruntergeladen, aus ihren Registries."
}
```

Es gibt keinen Container, der gestartet oder bereitgestellt werden muss, und der Lauf verbraucht keine Cloud-Rechenleistung. Installationen finden weiterhin statt — npm, pip und composer laufen vor der ersten Seite im Tab —, und der erste Run startet die Laufzeit im Tab.

## Container-Lauf gegen Browser-Lauf

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Wege, dieselbe App laufen zu sehen",
  "columns": [
    { "title": "Lauf im Container", "hue": "muted", "items": ["Warten, bis eine Maschine eingeplant ist", "Warten auf Start und Installation", "Eine frische Maschine vor jedem ersten Blick", "Verbraucht bei jedem Blick Cloud-Rechenleistung", "Richtig für Ausführungen und Deployments"] },
    { "title": "Lauf im Browser", "hue": "run", "items": ["Kein Container zu starten oder bereitzustellen", "Frontend, API und Datenbank in einem Tab", "Installationen (npm, pip, composer) laufen im Tab", "Kostet keine Cloud-Rechenleistung", "Richtig, um herauszufinden, ob es funktioniert"] }
  ],
  "caption": "Der Container ist weiterhin da und bleibt der Ort für Ausführungen und Deployments. Er ist nur nicht mehr der Preis für den ersten Blick."
}
```

## Das Brain arbeitet in beiden Fällen gleich

Ein Lauf an neuem Ort hilft wenig, wenn der Assistent nicht hineinsehen kann. Er kann es. Dieselben Lauf-Werkzeuge — Logs lesen, einen Dienst neu starten, die Vorschau erfassen — funktionieren, ob die App in Ihrem Tab oder in einem Container läuft. Fragen Sie das Brain, warum die Checkout-Seite einen Fehler liefert, und es liest die Logs der API, ändert den Handler, startet den Dienst neu und erfasst die Seite erneut. Es muss nicht wissen, wo die App läuft.

Das ist wichtig, weil ein schneller Lauf nur die halbe Schleife ist. Die andere Hälfte ist ein Assistent, der das Ergebnis ansehen und darauf reagieren kann.

## Wo es in der Methode sitzt

Idea to Real ist ein Bogen — **Idea → Make → Run → Measure** — und eine Schleife darin: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Lesen und Beweisen kosten nichts, sodass die Entscheidung zu bauen eine Entscheidung ist. Beim Bauen beginnen die Kosten.

Run ist die Stufe, auf der das Gemachte die Begegnung mit sich selbst bestehen muss: Erreicht die Seite die API, erreicht die API die Daten, tut der ganze Weg, was Sie beschrieben haben? Ein Beweis in der Methode ist nur so gut wie die Schnelligkeit seiner Antwort. Ein Smoke-Test, ein Proof of Concept, ein Pilot: Jeder ist eine Frage, und jede lohnt sich, solange die Idee noch warm ist.

```bf-figure
{
  "kind": "stack",
  "title": "Der Bogen, mit der Run-Stufe im Tab",
  "bands": [
    { "label": "Idea", "note": "Was wäre, wenn? Lesen Sie sie und wählen Sie den günstigsten Beweis, der sein Geld wert ist.", "hue": "idea" },
    { "label": "Make", "note": "Bauen Sie das eine, was der Beweis verlangt — Blueprint, Dienste, Daten.", "hue": "make" },
    { "label": "Run", "note": "Sehen Sie es von Anfang bis Ende funktionieren, genau dort, wo Sie es gemacht haben, ohne auf einen Container zu warten.", "hue": "run", "tag": "jetzt im Tab" },
    { "label": "Measure", "note": "Bewerten Sie es an der Abbruchbedingung und geben Sie das Ergebnis an Idea zurück.", "hue": "measure" }
  ],
  "caption": "Run war früher ein Ort, zu dem man reiste. Jetzt ist es ein Zustand des Boards, auf dem Sie ohnehin sind."
}
```

## Was Sie heute damit tun können

- **Run drücken und Ihre Full-Stack-App im Tab funktionieren sehen** — Frontend, API und Datenbank zusammen, ohne Container, der gestartet oder bereitgestellt werden muss.
- **Eine Idee beweisen, solange sie noch warm ist.** Der Lauf startet in dem Tab, in dem Sie ohnehin sind, also liegt keine Warteschlange zwischen Frage und Antwort.
- **Änderungen frei ausprobieren.** Ein Lauf kostet keine Cloud-Rechenleistung, also kostet zehnmal neu starten bei der Fehlersuche nicht mehr als einmal.
- **Die Schleife dem Brain überlassen.** Es liest Logs, startet Dienste neu und erfasst die Vorschau genau wie bei einem Container.
- **Container für das behalten, was sie gut können** — Ausführungen und Deployments —, wenn die App den Tab verlassen soll.

---

**Weiterlesen:** [Die App auf Ihrem Canvas ist jetzt ein echtes Projekt](/blog/your-canvas-app-is-a-real-project) · [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas) · [Read, Prove, Build: die innere Schleife](/blog/read-prove-build-the-inner-loop)

[Öffnen Sie einen Canvas](/create), beschreiben Sie eine App mit Datenbank und drücken Sie Run.
