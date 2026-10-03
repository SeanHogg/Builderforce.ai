Ein Agent übernimmt ein Ticket, findet heraus, dass eine Schemaänderung an dieser Stelle eine Deklaration in einem Modul, eine von Hand geschriebene Migration und zwei Prüfungen in einer bestimmten Reihenfolge braucht, bringt das Ganze zum Merge und ist fertig.

Morgen übernimmt ein anderer Agent das nächste Schema-Ticket und erarbeitet sich all das noch einmal.

Genau das schließt dieses Release. Nicht „der Agent war nicht klug genug“ — er war klug genug, zweimal. Das Problem war, dass alles, was er herausgefunden hatte, in einem Transkript lebte, das niemand liest, und dass es im Produkt kein Objekt für „ein Vorgehen, das hier funktioniert hat“ gab.

## Ein Skill ist ein Vorgehen, und jetzt kann ein Agent einen schreiben

Skills gab es schon: vierundfünfzig davon gebündelt mit der Runtime, dazu ein Marktplatz. Jeder Schreibweg führte über einen Menschen. Die einzigen Vorgehensweisen, denen Agenten folgen konnten, waren also die, die sich ein Mensch hingesetzt und aufgeschrieben hatte.

Ein Agent kann jetzt selbst einen vorschlagen. Die Hürde ist bewusst hoch — ein verifiziertes Ergebnis, also gemergte Arbeit oder ein bewerteter Lauf, der tatsächlich etwas hervorgebracht hat —, und die Einladung sagt das unmissverständlich, denn ein Reflexionsschritt, der bei jedem Lauf feuert, erzeugt einen Katalog selbstbewussten Unsinns.

```bf-figure
{
  "kind": "flow",
  "title": "Wie ein Vorgehen zu etwas wird, dem jeder Agent folgt",
  "steps": [
    { "label": "Ausführen", "note": "Ein Agent erledigt die Arbeit und erreicht ein verifiziertes Ergebnis — gemergt oder committet mit bestandenen Prüfungen.", "hue": "make" },
    { "label": "Reflektieren", "note": "Vor dem Abschluss destilliert er den wiederholbaren Teil: die Schritte, die genauen Befehle und woran man erkennt, dass es funktioniert hat.", "hue": "idea" },
    { "label": "Prüfen", "note": "Der Vorschlag landet als Entwurf, zusammen mit dem Lauf, der ihn geschrieben hat, und den Belegen, die er angeboten hat. Noch hat sich niemandes Prompt geändert.", "hue": "accent", "tag": "ein Mensch entscheidet" },
    { "label": "Befolgen", "note": "Sobald er freigegeben ist, trägt ihn jeder Agent im Workspace ab seinem nächsten Lauf mit.", "hue": "make" }
  ],
  "caption": "Drei Schranken, und die mittlere ist ein Mensch. Ein Agent, der einen Skill direkt veröffentlichen könnte, wäre ein Agent, der aus einem einzigen Lauf heraus und auf eigenes Wort umschreibt, was allen anderen Agenten gesagt wird."
}
```

Was Sie prüfen, ist das ganze Vorgehen, keine Zusammenfassung davon — der Inhalt, der Lauf, der ihn vorgeschlagen hat, und was dieser Lauf als Beleg angeboten hat. Die Freigabe ist der Moment, in dem er verbindlich wird, also ist es der Moment, in dem Sie ihn lesen können.

## Drei weitere Türen, die verschlossen waren

Derselbe Durchgang hat drei Dinge geöffnet, die gebaut, aber unerreichbar waren.

**Bringen Sie Ihren eigenen Tool-Server mit.** Ein vollständiger Model-Context-Protocol-Client lag bereits im Code — dreibeiniges OAuth, Zustimmung pro Tool, verschlüsselte Secrets, ein Relay, damit die Zugangsdaten nie einen Browser berühren —, ohne dass irgendetwas im Produkt ihn aufrief. Ein Mandant konnte einen externen Server nur registrieren, indem er die API von Hand ansprach. Jetzt gibt es ein Panel unter Einstellungen › Integrationen und einen Befehl in der VS-Code-Erweiterung, die beide dieselben Routen nutzen.

**Governance im Editor.** Policy-Pakete wurden bei Cloud- und selbst gehosteten Läufen durchgesetzt. Der Editor hatte den Durchsetzungscode, bekam aber nie Schranken übergeben — eine Regel, die ein Tool in der Cloud blockierte, ließ es in VS Code stillschweigend zu. Beide Editor-Oberflächen lösen jetzt zu Beginn jedes Laufs dieselben kompilierten Schranken auf und verweigern den Start eines Zuges, wenn die Policy nicht gelesen werden kann.

**Einen selbst gehosteten Lauf steuern.** Eine Folgeanweisung an eine laufende On-Premise-Ausführung wurde angenommen, gespeichert und fallen gelassen — zugestellt an eine Chat-Sitzung, in der die aktuelle Engine gar nicht mehr läuft. Jetzt erreicht sie den laufenden Lauf und wird als dessen nächster Zug angewendet.

```bf-figure
{
  "kind": "compare",
  "title": "Gebaut versus erreichbar",
  "columns": [
    { "title": "Vorher", "hue": "idea", "items": ["Ein MCP-Client ohne Aufrufer", "Policy-Leitungen im Editor ohne Schranken", "Steuerbefehle angenommen und verworfen", "Läufe nur in unserer Zeitleiste sichtbar"] },
    { "title": "Jetzt", "hue": "make", "items": ["Einen Server in den Einstellungen oder im Editor registrieren", "Dieselbe Schranke gilt in allen drei Modalitäten", "Ein Steuerbefehl landet als nächster Zug des Laufs", "Spans in dem Collector, den Sie bereits betreiben"] }
  ],
  "caption": "Vier Fähigkeiten, die im Code existierten und für niemanden, der ihn benutzte. Der Abstand zwischen diesen beiden Zuständen ist die ganze Geschichte dieses Releases."
}
```

## Messen, ob irgendetwas davon funktioniert hat

Zwei Dinge haben sich außerdem daran geändert, wie man sieht, was Agenten tun.

Läufe werden jetzt in Ihren eigenen OpenTelemetry-Collector exportiert, sodass die Arbeit der Agenten neben dem Rest Ihres Systems liegt statt nur in unserem — mit dem Zustand dieses Exports gleich daneben, denn ein Collector, der begonnen hat, Spans abzulehnen, sollte das sagen, statt sie still zu verwerfen.

Und Agentenqualität ist jetzt eine Zeitreihe statt einer Anekdote. Die bisherigen Qualitätssignale bewerteten alle den Traffic, der gerade ankam — eine Veränderung von Monat zu Monat konnte also an den Agenten liegen oder an den Tickets dieses Monats. Ein Benchmark ist ein fester Satz von Fällen, jeden Tag gleich bewertet und als Punktzahl und Erwartungsabdeckung über die Zeit aufgetragen.

## Wo es in der Methode sitzt

Der Idea-to-Real-Bogen verläuft Idea → Make → Run → Measure, und jeder Schritt der Methode stellt eine Frage: **Read** — lesen, was bereits wahr ist; **Prove** — es günstig beweisen; dann **Build**.

Alles oben Genannte landet am hinteren Ende dieser Schleife — der Hälfte, die Teams zuverlässig überspringen.

**Read** hat ein Gedächtnis bekommen, das tatsächlich Dinge findet. Der Abruf im Cloud-Pfad war ein Schlüsselwortabgleich oder, schlimmer, ein Embedding-Re-Ranking von zehn Zeilen, die von etwas anderem als der Frage ausgewählt wurden; eine relevante Erinnerung außerhalb dieses Fensters war unerreichbar. Jetzt ist es eine echte semantische Suche, verschmolzen mit dem Schlüsselwortzweig, auf demselben Ranking, das der selbst gehostete Speicher schon immer verwendet hat. Ein Lauf, der liest, was frühere Läufe gelernt haben, ist der erste Schritt der Methode, der so funktioniert wie beschrieben.

**Measure** hat gleich zwei bekommen. Der Benchmark macht „werden die Agenten besser?“ zu einer Frage mit einer Antwort, und der Export lässt diese Antwort dort leben, wo Ihr Team ohnehin hinschaut.

Und die Skill-Schleife ist der Bogen, der sich in sich selbst schließt. Ein Lauf, der einen bewerteten Beleg hervorgebracht hat, hat einen vollen Durchgang von Idea → Make → Run → Measure abgeschlossen. Das in ein Vorgehen zu destillieren, dem der nächste Lauf folgt, macht aus einer Schleife eine Spirale: Das nächste Read beginnt bei dem, was das letzte Measure festgestellt hat, statt bei nichts.

Das war immer der Anspruch. Jetzt ist es etwas, das das Produkt tut.
