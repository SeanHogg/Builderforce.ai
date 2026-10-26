Geben Sie einem Agenten eine Spezifikation mit acht Arbeitspaketen und sehen Sie zu, was passiert: Er erledigt eines nach dem anderen. Die Migration, dann die API-Routen, dann den Scheduler, dann die Oberfläche, dann die Tests. Jeder Schritt wartet auf den vorherigen, auch wenn sie nichts miteinander zu tun haben. Ein Nachmittag Arbeit dauert den ganzen Nachmittag.

So arbeiten Menschen nicht. Eine Leitung teilt die Arbeit auf, gibt jedes Stück an jemanden, der es verantwortet, behält alle im Blick und führt am Ende alles zusammen. Bisher konnte ein Agent das nur *vortäuschen*. Er konnte einen Helfer starten, wartete dann aber, bis dieser fertig war. Der Helfer hatte ein Schrittlimit. Sie konnten ihn weder sehen noch ansprechen. Und auf manchen Cloud-Laufzeiten gab es ihn gar nicht.

Das ist die Lücke: **Ein Chat konnte immer nur eine Sache auf einmal tun, und Arbeit, die parallel hätte laufen können, stand in der Schlange.**

## Übergeben und weitermachen

Jetzt kann der Agent in Ihrem Chat Teile der Arbeit an **Sub-Agenten** übergeben. Sie starten sofort und arbeiten nebeneinander. Der Agent, der sie gestartet hat, hält nicht an. Er plant weiter, programmiert den Teil, den er selbst behalten hat, oder startet weitere Sub-Agenten.

```bf-figure
{
  "kind": "flow",
  "title": "Von einer Anfrage zu paralleler Arbeit",
  "steps": [
    { "label": "Aufteilen", "note": "Der Agent liest die Spezifikation und teilt sie in Teile. Jeder Teil bekommt eigene Dateien, damit keine zwei Sub-Agenten dasselbe bearbeiten.", "hue": "idea" },
    { "label": "Übergeben", "note": "Jeder Teil startet als Sub-Agent mit eigenem Namen oder als Teammitglied aus Ihrem Workspace. Alle starten gleichzeitig.", "hue": "make", "tag": "parallel" },
    { "label": "Arbeiten", "note": "Sub-Agenten arbeiten nebeneinander, ohne Schrittlimit. Ihre Nachrichten erscheinen im Chat unter ihrem eigenen Namen.", "hue": "make" },
    { "label": "Zusammenführen", "note": "Jeder Sub-Agent meldet sich, wenn er fertig ist. Die Leitung baut und testet die Gesamtänderung, behebt, was die Teile untereinander kaputt gemacht haben, und committet.", "hue": "run" }
  ],
  "caption": "Ein Sub-Agent ist derselbe Agentenlauf wie jeder andere, mit einem Unterschied: Er weiß, für wen er arbeitet, und meldet sich bei ihm zurück."
}
```

Ein Sub-Agent kann anonym sein („portiere die Auth-Middleware“) oder einer der Agenten Ihres Workspaces („Ada, übernimm das Schema“). Passt für einen Programmierteil niemand, besetzt der Chat dafür einen Developer, weist ihm das Ticket zu und lässt den Teil als dieser Developer laufen. Das Board zeigt, wer wofür zuständig ist.

## Sie sehen alle und können jeden ansprechen

Ein Team, das Sie nicht sehen, können Sie nicht führen. Jeder arbeitende Sub-Agent erscheint in der Liste **Agenten** des Chats neben den eingeladenen Agenten, mit seinem Kürzel und dem, der ihn gestartet hat. Ein Live-Streifen unter der Unterhaltung zeigt, was jeder gerade tut.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — Chat",
  "ratio": 1.5,
  "regions": [
    { "label": "Agenten (4)", "note": "Eingeladene Agenten und laufende Sub-Agenten zusammen: „Frontend prüfen · a3 — Sub-Agent von BuilderForce“", "x": 4, "y": 6, "w": 92, "h": 16, "hue": "accent" },
    { "label": "Ihre Nachrichten, unter ihren Namen", "note": "„QA TESTER — Sub-Agent von Frontend prüfen · a4“", "x": 4, "y": 26, "w": 92, "h": 36, "hue": "make" },
    { "label": "Sub-Agenten", "note": "Was jeder gerade tut · Umlenken · Stoppen · Alle stoppen", "x": 4, "y": 66, "w": 92, "h": 28, "hue": "run" }
  ],
  "caption": "Ein Sub-Agent kann für einen Teil seiner Aufgabe eigene Sub-Agenten starten, bis zu drei Ebenen tief. Der Chat zeigt, wer für wen arbeitet."
}
```

Um einen umzulenken, sprechen Sie ihn einfach an. `@Ada mach nur die API-Hälfte` erreicht den nächsten Schritt dieses Sub-Agenten. Auch die Erwähnung eines Tickets, an dem er arbeitet (`#2826 die Entwurfskarten brauchen einen Leerzustand`), erreicht ihn. **Stoppen** hält einen an, **Alle stoppen** hält alle Sub-Agenten auf einmal an.

Und der Agent, mit dem Sie sprechen, bleibt Ihrer. Wartet er auf seine Sub-Agenten und Sie schicken ihm eine Nachricht, hört er auf zu warten und antwortet Ihnen. Die Sub-Agenten arbeiten weiter, und ihre Berichte erreichen ihn trotzdem.

## Dasselbe Team im Editor und in der Cloud

Die meisten Werkzeuge, die das können, können es an einem Ort. Hier ist es eine Arbeitsweise, wo immer die Arbeit läuft.

```bf-figure
{
  "kind": "compare",
  "title": "Wo ein Sub-Agent laufen kann",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Die Leitung hielt an, bis der Helfer fertig war", "Helfer stießen an ein Limit von 8 Schritten", "Helfer hatten im Chat keinen Namen", "Manche Cloud-Laufzeiten konnten keinen starten"] },
    { "title": "Jetzt", "hue": "make", "items": ["Die Leitung arbeitet weiter, während Sub-Agenten arbeiten", "Kein Schrittlimit — ein Sub-Agent endet, wenn sein Teil fertig ist", "Jeder Sub-Agent hat einen Namen, steht in der Liste und ist erreichbar", "Gleiches Verhalten in VS Code und auf jeder Cloud-Laufzeit"] }
  ],
  "caption": "In der Cloud ist jeder Sub-Agent ein eigener Lauf mit eigenem Datensatz, und seine Tokens zählen zu dem Lauf, der ihn gestartet hat."
}
```

Wenn etwas schiefgeht, sehen Sie, wo. **Diagnose kopieren** enthält jetzt jeden Sub-Agenten, den der Chat gestartet hat, auch die bereits fertigen. Für jeden steht dort, wer ihn gestartet hat, welche Modelle er nutzte, welche Schritte fehlschlugen, welche Dateien er geändert hat und was er berichtet hat.

## Wo es in der Methode sitzt

Arbeit in Builderforce folgt einem Bogen — **Idee → Machen → Betreiben → Messen** — und jeder Akt durchläuft dieselbe innere Schleife: [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop).

Sub-Agenten sind ein Feature von **Machen**, und sie verändern vor allem den Schritt **Bauen**. Beim Bauen passiert die teure Arbeit, und dort schadet eine einzige Arbeitslinie am meisten: Jeder Teil wartet auf den vorherigen. Aufgeteilt kostet das Bauen so viel wie der längste Teil, nicht wie die Summe aller.

Sie halten auch **Beweisen** ehrlich. Jeder Sub-Agent schließt mit demselben kurzen Bericht ab: was er geändert hat, was er geprüft hat und welche offenen Punkte bleiben. Die Leitung ist für jeden offenen Punkt verantwortlich, bis er behoben ist. Das Prüfen selbst übernimmt ein Prüf-Sub-Agent auf einem günstigeren Modell: Er führt die Typprüfung und die Tests aus, die die Änderung abdecken, und meldet jeden Fehler wörtlich. Die Leitung behebt, was er findet, und committet wird nur, was die Prüfung besteht. Parallele Arbeit, ein Urteil.

## Was Sie heute damit tun können

- **Eine mehrteilige Spezifikation an einen Chat geben** und ihre Arbeitspakete nebeneinander laufen lassen.
- **An Ihre eigenen Agenten mit Namen delegieren** oder den Chat einen Developer für einen Teil besetzen lassen, zu dem niemand passt.
- **Jeden Sub-Agenten sehen und steuern**: mit `@Name` oder einem `#Ticket` umlenken, einen stoppen oder alle stoppen.
- **In der Cloud genauso arbeiten**, wo jeder Sub-Agent ein eigener Lauf mit eigenem Datensatz ist.

Aktualisieren Sie die BuilderForce-Erweiterung in VS Code auf 2026.10.22 oder neuer, um all das zu nutzen.

---

**Weiterlesen:** [Lesen, Beweisen, Bauen – die innere Schleife](/blog/read-prove-build-the-inner-loop) · [Einmal beibringen, dann erledigt es das immer wieder](/blog/teach-it-once-and-it-does-it-again)
