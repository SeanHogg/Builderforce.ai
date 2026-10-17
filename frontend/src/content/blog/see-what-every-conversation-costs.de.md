„Builderforce merkt sich Dinge, also gibt es weniger aus.“ Das sagen wir seit Monaten. Bis heute mussten Sie uns das einfach glauben.

Die Gedächtnisschicht hat ihre Arbeit getan. Sie hat wiederholte Fragen aus dem Gedächtnis beantwortet und lange Unterhaltungen in einem schlanken Kontext gehalten. Der Prompt-Cache des Anbieters lieferte den Großteil eines langen Prompts für ein Zehntel des Preises. Nichts davon tauchte irgendwo auf, wo Sie hätten nachsehen können. Eine aus dem Gedächtnis beantwortete Frage hinterließ auf der Zeitleiste nur den Hinweis, dass das Modell übersprungen wurde – aber nichts darüber, was das wert war. Ein Durchgang über Ihren eigenen Claude-Schlüssel wurde mit null Kosten erfasst, weil Builderforce nichts dafür bezahlt hat. Sie haben trotzdem bezahlt.

Auf die Frage „Was kostet das, und hilft das Gedächtnis wirklich?“ gab es also keine Antwort auf dem Bildschirm, auf dem Sie gerade arbeiteten. Jetzt gibt es sie.

## Die Zahl über jedem Chat

Die Leiste über jeder Unterhaltung zeigt jetzt, was diese Unterhaltung gekostet und was das Gedächtnis ihr erspart hat – direkt neben dem Ticket-Status.

```bf-figure
{
  "kind": "screen",
  "frame": "Die Leiste über einer Unterhaltung",
  "ratio": 3.2,
  "regions": [
    { "label": "Ticket-Status", "note": "104 Tickets · 83 %", "x": 2, "y": 12, "w": 46, "h": 76, "hue": "make" },
    { "label": "$0.42 · 1.2M Tok. · ≈$0.31 gespart", "note": "Klicken für die Aufschlüsselung", "x": 52, "y": 12, "w": 46, "h": 76, "hue": "measure" }
  ],
  "caption": "Die Zahl kommt mit dem Chat, den die Seite ohnehin lädt. Sie braucht keine eigene Anfrage und kein Polling."
}
```

Klicken Sie auf die Zahl, um zu sehen, wohin das Geld geflossen ist:

- **Ausgegeben** hat zwei Zeilen. **Builderforce-Tarif** ist das, was Ihr Tarif abgerechnet hat. **Ihr Schlüssel** ist das, was Ihre eigenen Anbieterkonten berechnen würden, zum Listenpreis. Ein Durchgang über Ihr verbundenes Claude- oder OpenAI-Konto ist nicht kostenlos, nur weil wir ihn nicht bezahlt haben.
- **Durch das Gedächtnis gespart** ist nach Quelle aufgeschlüsselt, und jede Quelle ist entweder *erfasst* oder eine *Schätzung*.

## Was als Ersparnis zählt – und wie sicher wir sind

Nur ein Teil der Ersparnis lässt sich messen. Wir zeigen beide Arten getrennt und rechnen nie eine Schätzung in einen erfassten Wert ein.

```bf-figure
{
  "kind": "compare",
  "title": "Erfasste Werte und Schätzungen",
  "columns": [
    {
      "title": "Erfasst",
      "hue": "measure",
      "items": [
        "Aus dem Gedächtnis beantwortet. Als ein Modell die Frage zum ersten Mal beantwortet hat, haben wir die Token-Zahl zusammen mit der Antwort gespeichert. Wird die Frage wiederholt, spart das genau diesen Durchgang.",
        "Wiederholte Anfrage. Das Gateway hat eine identische Anfrage erneut ausgespielt, und die gespeicherte Antwort trägt noch den Verbrauch des ursprünglichen Aufrufs.",
        "Prompt-Cache. Ihr Anbieter meldet, wie viele Prompt-Tokens er aus dem Cache geliefert hat – für etwa ein Zehntel des Preises."
      ]
    },
    {
      "title": "Geschätzt (mit ≈ gekennzeichnet)",
      "hue": "idea",
      "items": [
        "Von Evermind beantwortet. Kein kostenpflichtiges Modell hat diese Antwort erzeugt, also zählen wir Frage und Antwort mit etwa vier Zeichen pro Token.",
        "Schlanker Kontext. Die Verdichtung hat ältere Durchgänge aus jedem Aufruf herausgehalten.",
        "Hinzugefügte Erinnerungen. Die Kostenseite: was abgerufene Erinnerungen jedem Prompt hinzugefügt haben. Das wird von der Schätzung abgezogen."
      ]
    }
  ],
  "caption": "Die Schätzungen sind eher zu niedrig. Ein echter Modelldurchgang schickt außerdem den System-Prompt, den Verlauf und die Werkzeugdefinitionen mit – nichts davon wird mitgezählt."
}
```

Der letzte Punkt ist wichtig. Auch das Abrufen von Erinnerungen kostet Tokens, denn abgerufene Erinnerungen werden dem Prompt hinzugefügt. Wir ziehen diese Kosten ab, die angezeigte Ersparnis ist also netto. Wenn sich das Gedächtnis bei einer Unterhaltung nicht rechnet, sagt die Zahl das auch.

## Das Arbeitspanel, überall gleich

Das `/`-Panel im Eingabefeld ist auf jeder Oberfläche dasselbe: im Brain im Web, auf dem Canvas, im VS Code-Panel und in Rovr in Chrome. Es hat überall dieselben vier Tabs: Modus, Aufwand, Modell und Status.

```bf-figure
{
  "kind": "devices",
  "title": "Ein Eingabebereich, vier Orte",
  "devices": [
    { "label": "Brain im Web", "width": 1280, "height": 800, "note": "Modus · Aufwand · Modell · Status", "hue": "make" },
    { "label": "Canvas", "width": 1024, "height": 720, "note": "Dasselbe Panel, derselbe Status-Tab", "hue": "make" },
    { "label": "VS Code-Panel", "width": 320, "height": 720, "note": "Dasselbe Panel in einer schmalen Seitenleiste", "hue": "run" },
    { "label": "Rovr-Seitenleiste", "width": 360, "height": 720, "note": "Dasselbe Panel in Chrome", "hue": "run" }
  ],
  "caption": "Eine gemeinsame Komponente. Eine Einstellung kann nicht an einem Ort existieren und an einem anderen fehlen."
}
```

**Status** zeigt jetzt die KI-Ausgaben und -Ersparnisse Ihres Arbeitsbereichs der letzten 30 Tage, neben dem Tarif und seinen Verbrauchsanzeigen. Außerdem steht dort klar, wenn alle Limits aufgehoben sind, weil Sie Superadmin-Operator sind – statt „Free“ neben einer Spalte voller „Unbegrenzt“ anzuzeigen. Das Evermind des Projekts erscheint als die zwei getrennten Tatsachen, die es tatsächlich sind: ob es aus den Chats dieses Projekts **lernt** und ob es anstelle eines kostenpflichtigen Modells **antworten** darf.

**Gedächtnis** im Tab Modus ist jetzt eine Einstellung der Unterhaltung selbst. Schalten Sie es im Editor aus, ist es auch im Web aus. Aus heißt außerdem, dass die eigenen Werkzeuge des Agenten zum Abrufen und Merken abgeschaltet sind – nicht nur der Abruf, der vor jeder Antwort stattfindet.

## Wo es in der Methode steht

Idee bis Real schließt mit **Messen**: Jeder Beweis hat eine Zahl, die das Projekt stoppen könnte, und diese Zahl wird geprüft, sobald die Arbeit läuft. Kosten sind eine dieser Zahlen, und das Gedächtnis soll sie senken. Eine Ersparnis, die niemand sehen kann, lässt sich nicht prüfen. Sie können nicht entscheiden, ob das Gedächtnis für eine Unterhaltung an bleiben soll, ob Sie Ihren eigenen Schlüssel verbinden oder welchen Aufwand eine Aufgabe braucht, ohne zu wissen, was jede Option kostet.

Damit steht diese Zahl dort, wo die Entscheidung fällt: an der Unterhaltung, während Sie arbeiten, mit erfassten Werten und Schätzungen sauber getrennt – damit die Prüfung ehrlich ist.

Und der Betrieb kostet nichts extra. Die Ersparnisse werden in dieselben Verbrauchsdatensätze geschrieben, die die Plattform ohnehin führt. Die Zahlen kommen mit Daten, die jede Oberfläche bereits lädt. Der Zähler hat keine einzige zusätzliche Anfrage gebracht.
