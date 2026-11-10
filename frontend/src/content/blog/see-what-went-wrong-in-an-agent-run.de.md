Sie bitten den Editor-Agenten um ein paar weitere Visualisierungen. Dreizehneinhalb Minuten später hat er dreizehn Änderungen vorgenommen, der Token-Zähler ist über drei Millionen geklettert, und in der Datei, die er zuletzt angefasst hat, kompiliert etwas nicht mehr. Sie halten ihn an.

Dann versuchen Sie herauszufinden, was passiert ist, und es gelingt Ihnen nicht. Der Lauf ist nicht abgestürzt, es gibt also keinen Fehler zu lesen. Das Modell hat in jedem Turn geantwortet, es gab also kein Timeout. Der Diagnosebericht hat sich das Ganze angesehen und ein einziges Wort zurückgegeben: **Nicht eindeutig**.

Dieser Lauf ist echt. Hinterher haben wir seinen aufgezeichneten Trace von Hand nachgespielt, und jedes Problem steckte darin: 21 Turns nur mit Lesen vor der ersten Änderung, 13 Turns, die jeweils genau eine Bearbeitung vornahmen und dabei jedes Mal rund hunderttausend Tokens Gesprächsverlauf erneut sendeten, kein einziger Typecheck oder Test und eine Bearbeitung, die ein Objekt eine geschweifte Klammer zu früh schloss. All das war aufgezeichnet, und nichts hatte darauf hingewiesen.

## Die Schublade Agent runs

Der Visualizer in VS Code hat jetzt eine Schublade **Agent runs**. Sie listet Ihre letzten Läufe des Editor-Agenten für das Projekt auf, das Sie gerade ansehen. Wählen Sie einen aus, und sie liest den aufgezeichneten Lauf und sagt Ihnen, was darin schiefgelaufen ist.

```bf-figure
{
  "kind": "screen",
  "frame": "Visualizer · Agent runs",
  "ratio": 1.62,
  "regions": [
    { "label": "Letzte Läufe", "note": "Jeweils mit Modellen, Anzahl der Turns und Befunden nach Schweregrad", "x": 3, "y": 6, "w": 24, "h": 88, "hue": "idea" },
    { "label": "Turn-Leiste", "note": "Ein Balken pro Turn: Lesen, Schreiben, erzwungen oder fehlgeschlagen. Die Höhe zeigt die Prompt-Tokens", "x": 30, "y": 6, "w": 67, "h": 22, "hue": "run" },
    { "label": "Befunde", "note": "Was schiefgelaufen ist, das Schlimmste zuerst, jeweils mit Turn, Werkzeug und Datei", "x": 30, "y": 32, "w": 42, "h": 62, "hue": "measure" },
    { "label": "Berührte Dateien", "note": "Geschrieben oder geprüft, einen Klick von der Wissenskarte entfernt", "x": 75, "y": 32, "w": 22, "h": 62, "hue": "make" }
  ],
  "caption": "Der Lauf, der früher Nicht eindeutig meldete: eine lange flache Strecke aus Lese-Turns, dann eine Reihe dünner Turns mit je einem Schreibvorgang, jeder hoch vor Prompt-Tokens, und nirgends in der Leiste eine Prüfung."
}
```

Sie fasst nicht mit einem Modell zusammen. Jeder Befund stammt aus einer festen Prüfung der aufgezeichneten Turns, sodass derselbe Lauf jedes Mal dieselben Befunde liefert, und jeder zeigt Ihnen, woher er kommt.

- **Analyse ohne Ende:** viele reine Lese-Turns vor der ersten Änderung, und ob das Planbudget die Übergabe erzwingen musste.
- **Bereitschaft ohne Handeln:** Der Agent sagte, er sei bereit, und las dann weiter.
- **Ein Schreibvorgang pro Turn:** eine Folge von Turns, die jeweils eine einzige Änderung vornahmen, mit den Prompt-Tokens, die diese Turns zusammen gekostet haben.
- **Aufgeblähter Prompt:** wie viel Prompt der Lauf für jedes zurückgeschriebene Token gesendet hat und was jede Änderung gekostet hat.
- **Geschrieben, nie geprüft:** geänderte Dateien ohne anschließenden Typecheck, Test, Lint oder Diagnoseaufruf.
- **Klammern aus dem Gleichgewicht:** eine Bearbeitung, deren neuer Text mehr geschweifte, eckige oder runde Klammern öffnete oder schloss als der Text, den er ersetzte.
- **Churn:** dieselbe Datei immer wieder neu geschrieben.
- **Als Ticket angelegt, dann selbst erledigt:** während des Laufs erstellte Tickets, nie an jemanden übergeben und dann von der Sitzung selbst umgesetzt.
- **Langsame und übergroße Turns:** Turns über einer Minute und Werkzeugaufrufe mit Kilobytes an wiederholten Argumenten.
- **Ungeprüft gestoppt:** Der Lauf endete mit Ihrem Stopp, während noch ungeprüfte Änderungen offen waren.

Für den Lauf oben nennt die Schublade 13 Befunde. Nichts kommt als Nicht eindeutig zurück.

```bf-figure
{
  "kind": "compare",
  "title": "Derselbe Lauf, auf zwei Arten gelesen",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["13 min 38 s, 3,06 Mio. Prompt-Tokens", "Von Hand gestoppt", "Bericht: Nicht eindeutig", "Den Trace öffnen und die Turns selbst zählen"] },
    { "title": "In der Schublade Agent runs", "hue": "measure", "items": ["21 Lese-Turns vor dem ersten Schreibvorgang; das Planbudget erzwang die Übergabe", "13 Turns mit je einem Schreibvorgang und der Prompt, den sie erneut sendeten", "Jede geschriebene Datei, keine geprüft", "labels.ts: eine geschweifte Klammer zu früh geschlossen, mit dem Turn und der Bearbeitung, die das verursacht haben", "Mit ungeprüften Änderungen gestoppt", "Insgesamt 13 Befunde, jeder mit seinem Beleg"] }
  ],
  "caption": "Es wurde nichts Neues aufgezeichnet. Jeder Befund stand bereits im Trace; die Schublade ist das, was ihn liest."
}
```

## Der Agent bemerkt es auch im selben Turn

Eine Schublade, die einen schlechten Lauf im Nachhinein erklärt, ist nützlich. Besser ist es, wenn der Lauf gar nicht erst schiefgeht. Deshalb bekommt der Editor-Agent jetzt bei jeder Bearbeitung zwei Signale zurück:

```bf-figure
{
  "kind": "flow",
  "title": "Was jetzt von einer Bearbeitung zurückkommt",
  "steps": [
    { "label": "Bearbeitung", "note": "Der Agent ändert eine Datei.", "hue": "make" },
    { "label": "Diagnose", "note": "Die Fehler des Language Servers für diese Datei kommen im eigenen Ergebnis der Bearbeitung zurück, neben jedem anderen Hinweis zu diesem Ergebnis.", "hue": "run" },
    { "label": "Gleichgewicht", "note": "Wenn die Änderung mehr Klammern geöffnet oder geschlossen hat, als sie ersetzt hat, sagt das Ergebnis es, auch wenn kein Prüfwerkzeug eingerichtet ist.", "hue": "run" },
    { "label": "Nächster Turn", "note": "Der Agent repariert die Datei, die er gerade kaputt gemacht hat, statt darauf weiterzubauen.", "hue": "measure", "tag": "derselbe Lauf" }
  ],
  "caption": "Die Klammer, die labels.ts kaputt gemacht hat, würde jetzt bei der Bearbeitung gemeldet, die sie verursacht hat, statt am Ende des Laufs von einem Menschen gefunden zu werden."
}
```

## Was Sie heute damit tun können

- **Öffnen Sie einen beliebigen aktuellen Lauf des Editor-Agenten** und sehen Sie in Sekunden, wohin Zeit und Tokens geflossen sind.
- **Zeigen Sie auf den Turn, das Werkzeug und die Datei** hinter jedem Problem, statt es aus dem Gedächtnis zu beschreiben.
- **Sehen Sie, welche Dateien ein Lauf geändert und nie geprüft hat**, und springen Sie von jeder davon zur Wissenskarte.
- **Lassen Sie den Agenten seine eigenen kaputten Bearbeitungen bemerken**: Language-Server-Fehler und eine Klammerwarnung kommen direkt bei der Bearbeitung zurück.

## Wo es in der Methode steht

Idea to Real durchläuft Idea, Make, Run und Measure, und die innere Schleife ist [Read, Prove, Build](/blog/read-prove-build-the-inner-loop): verstehen, was da ist, die Behauptung günstig belegen und erst dann in das Bauen investieren. Das verlangen wir von der Arbeit, und der Agent, der die Arbeit erledigt, sollte denselben Maßstab erfüllen.

Ein Agentenlauf ist ein Build, und bisher hatte er kein Measure. Sie konnten sehen, dass er fertig war oder dass Sie ihn gestoppt hatten, aber nicht, ob er zu lange gelesen, ohne Prüfung geschrieben oder unterwegs etwas kaputt gemacht hat. Die Schublade Agent runs ist das Measure für den Agenten, und die Prüfungen, die sie ausführt, sind Belege über den aufgezeichneten Lauf. Ein Befund sagt, was passiert ist, in welchem Turn, in welcher Datei. Die Diagnose zum Zeitpunkt der Bearbeitung und die Klammerwarnung verlagern einen Teil dieses Belegs in den Lauf hinein, auf genau den Schritt, der sonst still gescheitert wäre.

```bf-figure
{
  "kind": "compare",
  "title": "Measure, angewandt auf den Agenten",
  "columns": [
    { "title": "Read", "hue": "idea", "items": ["Wie viele Turns auf das Lesen entfielen", "Ob die behauptete Bereitschaft Bestand hatte"] },
    { "title": "Prove", "hue": "measure", "items": ["Auf jede geschriebene Datei folgt eine Prüfung – oder ein Befund", "Jede Bearbeitung hält ihre Klammern im Gleichgewicht – oder meldet es sofort"] },
    { "title": "Build", "hue": "make", "items": ["Was jede Änderung an Prompt-Tokens gekostet hat", "Ob angelegte Tickets übergeben oder selbst erledigt wurden"] }
  ],
  "caption": "Dieselben drei Fragen, die wir stellen, bevor wir irgendetwas bauen – gestellt an den Lauf, der das Bauen erledigt hat."
}
```

---

**Weiterlesen:** [Read, Prove, Build: die innere Schleife](/blog/read-prove-build-the-inner-loop) · [Ein Agent, ein Kern](/blog/one-agent-one-kernel) · [Packen Sie das Wissen, das Ihr Review belegt hat](/blog/portable-knowledge-packs)

Öffnen Sie den Visualizer in VS Code, öffnen Sie **Agent runs** und wählen Sie den letzten Lauf, der nicht so gelaufen ist, wie Sie es erwartet haben.
