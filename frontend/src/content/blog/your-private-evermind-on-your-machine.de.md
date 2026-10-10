Jeder Assistent, den Sie nutzen, lernt etwas über Sie. Welche Projekte Ihnen wichtig sind, wie Sie Dinge benennen, welche Schritte einer monatlichen Aufgabe Sie immer von Hand erledigen. Und fast jeder von ihnen bewahrt dieses Wissen auf dem Server eines anderen auf, in einem Modell, das Ihnen nie gehören wird und das Sie vergisst, sobald Sie das Werkzeug wechseln.

Das ist die Lücke: **Was Ihre KI über Ihre Arbeit lernt, gehört nicht Ihnen.**

Synapse wurde gebaut, um sie zu schließen. Synapse ist die Desktop-App von Builderforce, und dort lebt Ihr eigenes Evermind: Die Fakten, Vorführungen und Fähigkeiten, die Ihre Werkzeuge aufschnappen, werden auf Ihrem Rechner gespeichert und trainiert, in einem `.evermind`-Modell, das Ihnen gehört. Bisher stützte es sich noch in drei Dingen auf die Cloud – beim Modell, das Ihnen antwortete, bei den Werkzeugen, die es erreichen konnte, und dabei, dass Sie am Schreibtisch saßen, wenn ein Agent ein Ja brauchte. Alle drei bleiben jetzt bei Ihnen.

```bf-figure
{
  "kind": "flow",
  "title": "Was jetzt auf Ihrem Rechner lebt",
  "steps": [
    { "label": "Ihr Evermind", "note": "Fakten, Vorführungen und Fähigkeiten, trainiert in ein Modell, das Ihnen gehört. Starten Sie mit einem der Modelle Ihres Arbeitsbereichs.", "hue": "idea" },
    { "label": "Lokale Modelle", "note": "Installiert und passend für Ihren Arbeitsspeicher bemessen; das Brain kann mit einem davon antworten, Claude Code ebenso.", "hue": "make" },
    { "label": "Konnektoren", "note": "GitHub, Slack, Playwright, Ihre Dateien – MCP-Server, die das Brain nutzt, laufen hier.", "hue": "make" },
    { "label": "Freigaben überall", "note": "Ein Agentenschritt, der ein Ja braucht, erreicht Ihr Telefon über Ihr eigenes Konto.", "hue": "run", "tag": "Opt-in" }
  ],
  "caption": "Nichts auf dieser Liste verlässt den Rechner, wenn Sie es nicht wollen – die Freigaben per Telefon eingeschlossen."
}
```

## Ein Modell, das zu Ihrem Rechner passt

Ein lokales Modell auszuwählen ist eine kleine Rechenprüfung: Parameterzahlen, Quantisierungsformate, wie viel Arbeitsspeicher noch frei ist, wenn Browser und Editor offen sind. Die meisten raten, laden elf Gigabyte herunter und stellen dann fest, dass es nicht passt.

Synapse übernimmt das Rechnen. Es verwaltet Ollama für Sie und liest aus, wie viel Arbeitsspeicher der Rechner hat. Für jedes Modell in seinem Hub ermittelt es, welche Quantisierung noch Platz für alles andere lässt – volle Präzision, wo sie passt, acht Bit, wo nicht, vier Bit für die größten –, und es markiert ein Modell als beste allgemeine Wahl für diesen Rechner. Installieren ist ein Klick, mit Fortschrittsanzeige; Entfernen ein weiterer.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse – Lokale Modelle",
  "ratio": 1.4,
  "regions": [
    { "label": "Das Brain antwortet mit", "note": "Standardmäßig Builderforce oder jedem installierten Modell", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "idea" },
    { "label": "Modelle für diesen Rechner", "note": "Jede Größe mit der passenden Quantisierung; eine als Empfohlen markiert", "x": 4, "y": 24, "w": 92, "h": 44, "hue": "make" },
    { "label": "In anderen Werkzeugen nutzen", "note": "OpenAI- und Anthropic-Format auf einem lokalen Port, mit Schlüssel", "x": 4, "y": 72, "w": 92, "h": 22, "hue": "run" }
  ],
  "caption": "Ist ein Modell zu groß für diesen Rechner, steht das vor dem Download da, nicht danach."
}
```

Danach gehören die Modelle Ihnen, überall. Schalten Sie **In anderen Werkzeugen nutzen** ein, und Synapse stellt sie auf Ihrem Rechner in beiden Formaten bereit, die KI-Werkzeuge sprechen – dem von OpenAI und dem von Anthropic, das Claude Code verwendet. Zwei Umgebungsvariablen, und Claude Code läuft auf einem Modell, das den Raum nie verlässt. Hinein kommen nur Programme auf dem Rechner, die den Schlüssel haben, und Webseiten werden grundsätzlich abgewiesen.

## Werkzeuge für das Brain, ohne die Schlüssel abzugeben

Das Brain in Synapse nutzte bereits die Werkzeuge der Plattform – Tickets, Boards, Spezifikationen. Jetzt nutzt es auch **Konnektoren**: MCP-Server, die auf Ihrem Rechner laufen. Wählen Sie GitHub, Slack, Brave Search, Playwright, Context7 oder einen Dateiordner aus dem Katalog und installieren Sie ihn mit einem Klick, oder fügen Sie einen beliebigen MCP-Server über seine Befehlszeile hinzu.

Tokens landen im Anmeldeinformationsspeicher Ihres Systems, nie in einer Einstellungsdatei. Ein Werkzeug, das nur liest, läuft sofort; eines, das etwas verändert – ein Issue eröffnen, eine Nachricht posten, eine Datei schreiben –, erscheint im Chat mit Freigeben und Ablehnen, genau wie die eigenen Werkzeuge der Plattform.

```bf-figure
{
  "kind": "compare",
  "title": "Wo das Werkzeug läuft",
  "columns": [
    { "title": "Ein gehosteter Assistent", "hue": "muted", "items": ["Ihre Tokens liegen auf seinen Servern", "Werkzeuge erreichen nur, was die Cloud erreicht", "Ihre lokalen Dateien sind tabu"] },
    { "title": "Synapse-Konnektoren", "hue": "make", "items": ["Tokens im Anmeldeinformationsspeicher Ihres Systems", "Server laufen auf Ihrem Rechner, neben Ihren Dateien", "Alles, was etwas verändert, fragt zuerst"] }
  ],
  "caption": "Dieselben MCP-Server, dort, wo Ihre Arbeit ohnehin schon ist."
}
```

## Sagen Sie Ja vom Telefon aus

Agenten, denen Sie etwas einmal beibringen – eine Aufgabe in einer beliebigen Desktop-App aufzeichnen, Synapse sie wiederholen lassen –, halten an den entscheidenden Schritten an und warten auf Ihre Freigabe. Bisher hieß das: warten, bis Sie wieder am Schreibtisch sind. Schalten Sie **Schritte vom Telefon aus freigeben** ein, und die Anfrage geht zusätzlich an Ihr Builderforce-Konto, wo die Freigabe-Warteschlange sie auf jedem Telefon anzeigt. Die erste Antwort gilt, egal auf welcher Seite; die andere Seite wird informiert.

Es ist so gebaut, dass nichts hineinkommt, was nicht hineingehört. Synapse öffnet nie einen Port zum Internet: Die Anfrage geht über Ihr eigenes angemeldetes Konto nach oben, und Synapse fragt die Antwort ab. Nur Sie können sie sehen oder beantworten – kein Teammitglied, keine Führungskraft, keine Regel zur automatischen Freigabe und kein anderes KI-Werkzeug. Und die Beschreibung des Schritts verlässt Ihren Rechner nur, solange dieser Schalter an ist.

## Ein Modell zum Starten

Ihr Evermind lernt aus dem, was Ihre Werkzeuge erleben, aber es braucht ein Modell, in das es hineinlernen kann – und die wenigsten haben eine `.evermind`-Datei herumliegen. Synapse bietet jetzt eine an: Wählen Sie ein beliebiges Evermind-Modell, das Ihr Arbeitsbereich bereits hat, und klicken Sie auf **Als mein Modell verwenden**. Es wird samt Tokenizer auf Ihren Rechner heruntergeladen und lernt von da an dort – der Arbeitsbereich sieht nie, was es lernt, es sei denn, Sie veröffentlichen es.

## Wo es in der Methode steht

Builderforce führt jede Idee entlang eines Bogens – [Idee, Machen, Betreiben, Messen](/blog/read-prove-build-the-inner-loop) – und jeden Akt darin durch die Schleife aus Lesen, Beweisen, Bauen.

In dieser Version geht es um **Betreiben**. Beim Betreiben geht die Arbeit weiter, während Sie nicht hinsehen, und genau dort brach ein privates Setup bisher: Der Agent blieb am ersten Tor stehen, weil Sie nicht am Schreibtisch waren, das Modell hinter der Antwort gehörte jemand anderem, und die Werkzeuge, die er nutzen konnte, waren die, die die Cloud erreichte. Freigaben auf dem Telefon halten einen Lauf in Bewegung. Lokale Modelle und Konnektoren lassen ihn dort laufen, wo Ihre Arbeit und Ihre Daten ohnehin sind.

Außerdem speist es das **Lesen** beim nächsten Mal. Was ein Lauf Ihrem Evermind beibringt, bleibt in einem Modell, das Ihnen gehört – wenn Sie oder eines Ihrer Werkzeuge Ihre Arbeit das nächste Mal lesen, lesen sie sie mit allem, was Sie bisher getan haben.

## Was Sie heute damit tun können

- **Ein lokales Modell mit einem Klick installieren**, das zu Ihrem Rechner passt, und das Brain damit antworten lassen.
- **Claude Code auf Ihren eigenen Rechner richten** – mit den zwei Zeilen, die Synapse Ihnen anzeigt.
- **Dem Brain GitHub, Slack oder Ihre Dateien** als Werkzeuge geben, wobei jede Änderung auf Ihre Freigabe wartet.
- **Den Schritt eines Agenten vom Telefon aus freigeben**, statt an den Schreibtisch zurückzukehren.
- **Ihr privates Evermind starten** – mit einem Modell, das Ihr Arbeitsbereich bereits hat.

[Synapse herunterladen](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) für Windows, macOS oder Linux.

---

**Weiterlesen:** [Ein privates Gehirn auf Ihrem Desktop, das die Arbeit an Ihre Agenten übergibt](/blog/a-private-brain-on-your-desktop-that-hands-work-to-agents) · [Einmal beibringen, dann erledigt es das immer wieder](/blog/teach-it-once-and-it-does-it-again) · [Ein lokaler Index für jedes KI-Werkzeug auf Ihrem Rechner](/blog/one-local-index-for-every-ai-tool)
