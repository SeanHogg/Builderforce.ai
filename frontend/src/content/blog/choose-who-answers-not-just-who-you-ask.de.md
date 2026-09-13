Ein Gespräch mit einem Team aus Agenten stellt bei jedem Zug zwei Fragen. **Mit wem spreche ich?** Und **wer antwortet mir?**

Für die erste gibt es schon länger ein Bedienelement. „An“ im Eingabefeld oder eine @-Erwähnung schickt eine Nachricht an einen eingeladenen Agenten oder ein Teammitglied statt an das Brain. Die zweite gab es nur im Web. Dort ließ „Handelt als“ das Brain als Website-Builder, als Mobile-Entwickler oder als Evermind-Lehrer antworten – oder als einen der Agenten, die Ihrem Workspace zugewiesen sind. In VS Code, wo das meiste gebaut wird, bekamen Sie jedes Mal den Standard-Assistenten.

Diese Lücke ist geschlossen.

## Handelt als – in Ihrem Editor

Das Eingabefeld des Editors trägt jetzt dieselben zwei Bedienelemente wie das Web, nebeneinander.

```bf-figure
{
  "kind": "screen",
  "frame": "Das Chat-Eingabefeld in VS Code",
  "ratio": 2.2,
  "regions": [
    { "label": "Ihre Nachricht", "note": "Getippt wie bisher; eine @-Erwähnung leitet sie weiterhin", "x": 3, "y": 8, "w": 94, "h": 46, "hue": "muted" },
    { "label": "Handelt als", "note": "Standard-Brain · eine Persona · ein zugewiesener Agent", "x": 3, "y": 62, "w": 30, "h": 30, "hue": "idea" },
    { "label": "An", "note": "Das Brain · ein eingeladener Agent · ein Teammitglied", "x": 36, "y": 62, "w": 26, "h": 30, "hue": "make" },
    { "label": "+ · / · Senden", "x": 65, "y": 62, "w": 32, "h": 30, "hue": "accent" }
  ],
  "caption": "Dieselben zwei Auswahlfelder wie im Web-Eingabefeld – beide Oberflächen bieten dieselben Optionen und benennen sie gleich."
}
```

„Handelt als“ bietet drei Arten von Antwort:

- **Das Standard-Brain** – Ihr Coding-Assistent, verankert im geöffneten Workspace.
- **Eine Persona** – Website, Mobil, Web + Mobile, Evermind, Feinabstimmung oder Stimme. Das sind die Personas, mit denen der Web-Builder arbeitet: Die Mobil-Persona schreibt React Native mit 44-Punkt-Tippflächen und sicheren Bereichen, und die Evermind-Persona lehrt, statt zu trainieren.
- **Ein dem Brain zugewiesener Agent** – jeder davon. Das Brain antwortet in der Rolle und Stimme dieses Agenten und läuft auf dessen eigenem Modell, sofern Sie im `/`-Menü kein Modell festgelegt haben.

## Die Persona liegt über Ihrem Workspace

Eine Sache funktioniert im Editor bewusst anders. Im Web *ist* eine Persona die Anweisung an das Brain, weil es sonst nichts zu beschreiben gibt. Im Editor weiß das Brain bereits Reales: welcher Ordner geöffnet ist, welche Datei Sie ansehen, welche Werkzeuge Ihr Repository berühren dürfen. Eine Website-Persona, die „Die Vorschau ist live“ verspricht, darf nichts davon überschreiben.

Deshalb wird die Persona in VS Code obendrauf gelegt.

```bf-figure
{
  "kind": "compare",
  "title": "Was eine Persona ändert – und was sie unberührt lässt",
  "columns": [
    { "title": "Im Web", "hue": "muted", "items": ["Die Persona ist die ganze Anweisung", "Ihre Welt ist der Browser-Builder: Vorschau, Veröffentlichen, der Dev-Server", "Wählen Sie Mobil, baut sie für den Gerätesimulator"] },
    { "title": "In Ihrem Editor", "hue": "make", "items": ["Die Persona kommt zu dem hinzu, was der Editor bereits weiß", "Ihr geöffneter Ordner, Ihre Datei und Ihr Repository bleiben ihre Welt", "Wählen Sie Mobil, baut sie React Native – in Ihren Dateien"] }
  ],
  "caption": "Eine Persona ändert, wie das Brain baut. Sie ändert nie, wo das Brain Ihren Code vermutet."
}
```

## Eine Frage an das ganze Board zeigt, an wen sie ging

Fragen Sie ein Canvas etwas, ohne jemanden per @ zu erwähnen, antwortet jeder Agent auf dem Board. Die Antworten trugen schon immer ihre Absender. Die Frage nicht: Auf der Chat-Seite geöffnet, las sie sich, als sei sie an niemand Bestimmtes gerichtet.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Frage an das ganze Board",
  "steps": [
    { "label": "Fragen", "note": "Keine @-Erwähnung, also geht die Frage an jeden Agenten auf dem Canvas", "hue": "idea" },
    { "label": "Adressiert", "note": "Die Frage hält jeden Agenten fest, an den sie ging – mit Namen", "hue": "make" },
    { "label": "Beantwortet", "note": "Jeder Agent antwortet als er selbst; das Brain hält sich heraus", "hue": "make", "tag": "Web und Editor" }
  ],
  "caption": "Eine Frage mit drei Empfängern zeigt jetzt alle drei, und sie gehört ihnen – das Brain greift sie nie auf, selbst wenn einer nicht antwortet."
}
```

## Wo es in der Methode steht

[Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop) ist eine Schleife darüber, *wer die Arbeit macht*, nicht nur, welche Arbeit es ist. Einen Markt zu lesen ist eine andere Aufgabe, als einen Preis zu beweisen, und beides unterscheidet sich vom Bau des Bildschirms, der ihn verkauft. Bisher ließ Sie der Editor wählen, wen Sie fragen. Er ließ Sie nicht wählen, wer antwortet – also lief jeder Akt der Schleife durch denselben Generalisten.

Wer antwortet, zählt am meisten in **Make**, der Stufe des [Bogens](/blog/idea-to-real-the-operating-methodology), in der Bauen der teure Akt ist. Dort zeigt sich der Unterschied zwischen „einem Assistenten“ und „dem Mobile-Entwickler“ als Nacharbeit: Tippflächen, die nie 44 Punkte hatten, ein Layout, das einen Hover voraussetzte. Die Persona vor der ersten Zeile zu wählen ist günstiger, als sie hinterher zu korrigieren. Früher im Bogen lässt das Brain als der Agent, den Sie der Strategie zugewiesen haben, das Lesen und Beweisen aus der Rolle kommen, die Sie ohnehin gefragt hätten.

## Was Sie heute damit tun können

- **Einen Zug als Spezialist ausführen, in Ihrem Editor** – Website, Mobil, Web + Mobile, Evermind, Feinabstimmung oder Stimme – ohne Ihre Dateien zu verlassen.
- **Als einer Ihrer Agenten antworten**, auf dessen eigenem Modell, aus demselben Eingabefeld, in das Sie ohnehin tippen.
- **Eine Nachricht an ein Teammitglied oder einen eingeladenen Agenten richten** – mit demselben „An“ im Web und in VS Code.
- **Alle sehen, an die eine Frage ging**, wenn Sie das ganze Board auf einmal fragen.

---

**Weiterlesen:** [Mehrparteien-Teamchat](/blog/multi-party-team-chat-humans-and-agents) · [Psychometrische Personas für Agenten](/blog/ai-agent-personality-psychometric-personas) · [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop)

[Brain Storm öffnen](/brainstorm) und wählen, wer antwortet.
