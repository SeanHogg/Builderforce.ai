# Sie lesen den Code des Agenten nicht mehr. Jetzt sehen Sie, was sein Lauf getan hat

Ein Agentenlauf ist fertig. Vierzig Dateien geändert, die Tests grün, und die Zusammenfassung sagt „Fertig, alle Tests bestehen“. Öffnen Sie den Diff?

Die meisten tun das nicht mehr, und genau dafür hat man einen Agenten. Aber den Code nicht zu lesen hieß nie, dass einem egal ist, was mit ihm passiert ist. Irgendwo in diesen vierzig Dateien hat vielleicht eine Route ihre Authentifizierungsprüfung verloren. Eine Schleife wartet jetzt vielleicht pro Element einmal auf die Datenbank. Ein Test, der fehlschlug, wurde vielleicht mit `.skip` markiert, und „alle Tests bestehen“ wäre wahr.

Der Diff kann Ihnen all das sagen, wenn Sie ihn lesen und wissen, wonach Sie suchen. Die Zusammenfassung des Laufs schreibt derselbe Agent, dessen Arbeit Sie beurteilen wollen. Dazwischen gab es bisher nichts.

## Die Lauf-Delta-Karte

Jeder Agentenlauf im VS Code-Chat endet jetzt mit einer **Lauf-Delta**-Karte. Sie liest nicht den Diff, um ihn zusammenzufassen. Sie reduziert den Code vor dem Lauf und den Code danach auf Fakten, vergleicht die beiden Mengen und gibt ein Urteil zu vier Fragen ab.

```bf-figure
{
  "kind": "screen",
  "frame": "VS Code-Chat · Ende eines Laufs",
  "ratio": 1.5,
  "regions": [
    { "label": "Schlagzeile", "note": "Schlechter: Sicherheit (1 × Route hat ihren Authentifizierungs-Guard verloren); Qualität (Tests abgeschwächt)", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "measure" },
    { "label": "Sicherheit", "note": "Schlechter · 1 neu", "x": 4, "y": 24, "w": 44, "h": 13, "hue": "measure" },
    { "label": "Performance", "note": "Unverändert · nur statische Analyse", "x": 52, "y": 24, "w": 44, "h": 13, "hue": "run" },
    { "label": "Qualität", "note": "Schlechter · Tests abgeschwächt", "x": 4, "y": 41, "w": 44, "h": 13, "hue": "measure" },
    { "label": "Qualitätsmerkmale", "note": "Kompatibilität, Wartbarkeit, Betriebssicherheit; der Rest Nicht gemessen", "x": 52, "y": 41, "w": 44, "h": 13, "hue": "idea" },
    { "label": "Auswirkungsradius: mittel", "note": "Gemessen an den früheren Läufen dieses Repositorys", "x": 4, "y": 60, "w": 56, "h": 14, "hue": "accent" },
    { "label": "Details öffnen", "x": 64, "y": 60, "w": 32, "h": 14, "hue": "make" },
    { "label": "Blockiert den Abschluss eines autonomen Laufs", "note": "Erscheint, wenn ein Guard entfernt oder Tests abgeschwächt wurden", "x": 4, "y": 80, "w": 92, "h": 14, "hue": "measure" }
  ],
  "caption": "Eine Schlagzeile, eine Zeile pro Dimension, ein Band für den Auswirkungsradius und ein Weg zu den Belegen. Jedes Urteil ist ein Wort und ein Symbol, nicht nur eine Farbe."
}
```

**Sicherheit.** Hat sich die Angriffsfläche verändert? Eine Route, die ihren Authentifizierungs-Guard verloren hat, ein neuer Einstiegspunkt, eine neue Systemfähigkeit wie ein Import von `child_process`, schwache Kryptografie, ein Geheimnis im Code. Ein Geheimnis wird geschwärzt angezeigt, nicht im Klartext zurückgegeben.

**Performance.** Hat der Lauf einen mit await erwarteten I/O-Aufruf in einer Schleife hinzugefügt oder einen blockierenden I/O-Aufruf? Das sind statische Regeln, und die Zeile sagt „nur statische Analyse“, damit sie nicht als Benchmark durchgeht.

**Qualität.** Ist der Code schlechter geworden, und hat der Agent **die Tests abgeschwächt, die ihn beurteilen**? Ein übersprungener oder gelöschter Test, ein hinzugefügtes `.only`, weniger Assertions, ein schwächerer Matcher, eine unterdrückte Lint- oder Typprüfung, ein erhöhtes Timeout. Wenn das passiert, sagt die Schlagzeile genau das: Tests wurden abgeschwächt.

**Die Qualitätsmerkmale** nach ISO/IEC 25010. Kompatibilität: eine exportierte API ist gebrochen oder eine neue ist hinzugekommen. Wartbarkeit: ein neuer Abhängigkeitszyklus, eine überschrittene Schicht, eine gewachsene Gruppe duplizierten Codes, ungenutzter Code, eine übergroße Datei, die weiter gewachsen ist. Betriebssicherheit: eine destruktive Schemaänderung, ein Force-Push oder ein rekursives Löschen in einem Skript. Merkmale, die die Karte noch nicht misst, zeigen **Nicht gemessen**. Sie werden nicht als null angezeigt, denn null wäre eine Behauptung.

## Wie ein Urteil zustande kommt

```bf-figure
{
  "kind": "flow",
  "title": "Von einem beendeten Lauf zu einem Urteil",
  "steps": [
    { "label": "Lauf", "note": "Der Agent ist fertig. Der Code davor und der Code danach sind die beiden Seiten.", "hue": "run" },
    { "label": "Fakten", "note": "Jede Seite wird von festen Extraktoren und Regeln auf Fakten und Befunde reduziert, auf beiden Seiten von denselben.", "hue": "make" },
    { "label": "Delta", "note": "Die beiden Mengen werden verglichen. Jeder Befund ist neu in diesem Lauf, von ihm behoben oder geändert, oder bereits vorhanden.", "hue": "idea" },
    { "label": "Urteil", "note": "Besser, Schlechter, Unverändert, Nicht vergleichbar oder Nicht gemessen, pro Dimension, mit einer Schlagzeile aus einem festen Satzmuster.", "hue": "measure", "tag": "am Ende des Laufs" }
  ],
  "caption": "Verglichen werden Fakten, nicht Text. Dasselbe Vorher und Nachher ergibt auf jeder Maschine denselben Digest, und kein Modell schreibt das Urteil."
}
```

Ein paar Regeln halten die Karte ehrlich:

- **Fünf Urteile, nicht zwei.** Besser, Schlechter, Unverändert, Nicht vergleichbar und Nicht gemessen. Lassen sich die beiden Seiten nicht fair vergleichen, etwa weil während des Laufs der Branch gewechselt wurde, sagt die Karte Nicht vergleichbar und warum, statt zu raten.
- **≈ kennzeichnet eine Heuristik.** Ein Befund, der aus einer Heuristik statt aus einer exakten Regel stammt, trägt ein ≈, damit Sie wissen, welche Zahlen Schätzungen sind.
- **Der Auswirkungsradius ist relativ.** Niedrig, mittel oder hoch wird an den früheren Läufen Ihres eigenen Repositorys gemessen, „hoch“ heißt also hoch für diese Codebasis, nicht im Vergleich mit fremden.
- **Sie steht nicht im Weg.** Die Karte wird auf Ihrem Rechner berechnet, offline und ohne Anmeldung, und sie lässt den Lauf, den sie beschreibt, weder scheitern noch langsamer werden.

## Details öffnen

**Details öffnen** öffnet ein Seitenpanel über dem Chat. Die Befunde sind nach Dimension gruppiert, dann nach Herkunft: neu in diesem Lauf, von diesem Lauf behoben, von diesem Lauf geändert, bereits vorhanden. Jeder hat seine Belege und einen Link **Code öffnen** zu der Zeile, um die es geht.

```bf-figure
{
  "kind": "compare",
  "title": "Derselbe Lauf, vor und nach der Karte",
  "columns": [
    { "title": "Was Sie hatten", "hue": "muted", "items": ["„Fertig, alle Tests bestehen“", "Einen Diff über vierzig Dateien", "Ihre eigene Vermutung, worauf es darin ankommt"] },
    { "title": "Was die Karte sagt", "hue": "measure", "items": ["Sicherheit: Schlechter · Route hat ihren Authentifizierungs-Guard verloren", "Performance: Unverändert · nur statische Analyse", "Qualität: Schlechter · Test übersprungen, weniger Assertions", "Zuverlässigkeit: Nicht gemessen", "Auswirkungsradius: mittel"] }
  ],
  "caption": "„Alle Tests bestehen“ war wahr. Es war wahr, weil einer von ihnen nicht mehr lief."
}
```

Bei autonomen Läufen, bei denen niemand den Chat beobachtet, werden ein entfernter Authentifizierungs-Guard und abgeschwächte Tests als **blockierend** markiert. Das sind die beiden Dinge, mit denen ein Agent seine eigene Arbeit fertig aussehen lassen kann.

Karte, Panel und jeder Befund gibt es auf Englisch, Chinesisch, Spanisch, Französisch und Deutsch.

## Wo es in der Methode steht

Idea to Real durchläuft **Idea, Make, Run und Measure**. Die innere Schleife, [Read, Prove, Build](/blog/read-prove-build-the-inner-loop), bringt Sie von Idea zu Make: verstehen, was da ist, die Behauptung günstig belegen und erst dann in das Bauen investieren. Die Schleife schließt sich in Measure, und Measure stellt nur eine Frage: Funktioniert es?

Ein Agentenlauf ist ein Build, und bisher war sein Measure das Wort des Agenten selbst. Grüne Tests bewiesen, dass die verbliebenen Tests bestanden. Das Lauf-Delta ist das Measure für den Lauf: der Beleg, dass er die Dinge **besser** gemacht hat, nicht nur anders. Es liest sich wie ein Beleg: Es sagt, was es geprüft hat, was es nicht prüfen konnte, und zeigt zu jedem Urteil die Belege.

```bf-figure
{
  "kind": "compare",
  "title": "Measure, angewandt auf einen Lauf",
  "columns": [
    { "title": "Read", "hue": "read", "items": ["Der Code vor dem Lauf, auf Fakten reduziert", "Dieselben Extraktoren auf beiden Seiten"] },
    { "title": "Prove", "hue": "prove", "items": ["Ein Urteil pro Dimension, aus Regeln, nicht aus einem Modell", "Nicht gemessen, solange es keine Regel gibt", "Vom Agenten abgeschwächte Tests, als solche benannt"] },
    { "title": "Build", "hue": "build", "items": ["Was der Lauf verändert hat, und ob das eine Verbesserung war", "Blockierend für autonome Läufe, wenn Guards oder Tests abgeschwächt wurden"] }
  ],
  "caption": "Die drei Fragen, die wir stellen, bevor wir irgendetwas bauen, gestellt an den Lauf, der gebaut hat."
}
```

## Was Sie heute damit tun können

- **Wissen, was ein Lauf getan hat, ohne seinen Diff zu lesen:** vier Urteile und eine Schlagzeile, am Ende des Laufs, der sie erzeugt hat.
- **Einen Agenten erwischen, der seine eigenen Hausaufgaben benotet:** übersprungene, gelöschte und gelockerte Tests stehen in der Schlagzeile.
- **Einen verlorenen Authentifizierungs-Guard oder einen neuen Import von `child_process` sehen**, sobald der Lauf endet, nicht erst in einem späteren Review.
- **Von einem Urteil zur Codezeile springen** mit Details öffnen und Code öffnen.
- **Es im Flugzeug nutzen:** Es funktioniert offline und ohne Anmeldung.

Als Nächstes kommt dieselbe Karte zu Läufen im Web und auf dem Canvas, dazu eine Trendansicht der Urteile über die Läufe eines Projekts.

---

**Weiterlesen:** [Der Agentenlauf hat „funktioniert“. Jetzt sehen Sie, was darin schiefging](/blog/see-what-went-wrong-in-an-agent-run) · [Read, Prove, Build: die innere Schleife](/blog/read-prove-build-the-inner-loop) · [Ein Agent, ein Kern](/blog/one-agent-one-kernel)

Starten Sie einen Agenten im VS Code-Chat und lesen Sie die Karte am Ende, bevor Sie irgendetwas anderes lesen.
