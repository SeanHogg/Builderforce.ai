Sie ziehen einen fünfseitigen Lebenslauf als PDF auf ein Board. Zurück bekommen Sie ein Dateisymbol mit dem Hinweis **„Text nicht extrahierbar“** – und einen Assistenten, der Sie höflich bittet, den Text des Dokuments, das er gerade in der Hand hält, zu kopieren und einzufügen.

Das war eine echte Meldung, und sie verdient eine ordentliche Erklärung. Denn „das Tool konnte mein PDF nicht lesen“ ist eine dieser Beschwerden, die nach Schlamperei klingt und fast immer etwas ganz Bestimmtes bedeutet.

## Warum ein PDF, das Sie lesen können, für ein Programm unlesbar ist

Ein PDF speichert keinen Absatz. Es speichert Anweisungen, Formen an bestimmten Koordinaten zu zeichnen. Sind diese Formen Buchstaben, bringt die Datei meist eine eingebettete Schrift mit – und um die Datei klein zu halten, **reduzieren** die meisten modernen Exportfunktionen diese Schrift auf eine Teilmenge: Sie enthalten nur die tatsächlich verwendeten Glyphen, neu durchnummeriert.

Die Zeichenkette in der Datei lautet also nicht mehr `Hello`. Sie ist eine Liste von Glyphen-Indizes in eine private Tabelle, meist hexadezimal notiert, die nur in Verbindung mit genau dieser Teilschrift „Hello“ bedeuten.

```bf-figure
{
  "kind": "compare",
  "title": "Was die Bytes in einer gezeichneten Zeichenkette wirklich sind",
  "columns": [
    { "title": "Ein PDF von etwa 2005", "hue": "muted", "items": ["Text aus echten Zeichen gezeichnet", "Naive Extraktion funktioniert", "Genau davon gehen die meisten einfachen Reader aus"] },
    { "title": "Ein PDF aus Google Docs, Word oder Pages", "hue": "make", "items": ["Teilschrift, Glyphen-Indizes", "Hexadezimal notiert, nicht als Buchstaben", "Wörtlich gelesen, wird daraus Zeichensalat", "Eine Lesbarkeitsprüfung verweigert zu Recht die Anzeige"] }
  ],
  "caption": "Der Reader war nicht kaputt. Er hat ein Nummerierungsschema gelesen, als wäre es das Alphabet."
}
```

Die Übersetzungstabelle war die ganze Zeit in der Datei – jede solche Schrift bringt eine Zeichenzuordnung mit, die festlegt, welcher Glyphen-Index für welches Zeichen steht. Sie auszulesen ist die Lösung, und genau deshalb kommen Exporte aus den drei Textverarbeitungen, die Menschen tatsächlich nutzen, jetzt als Text an statt als Rauschen.

## Die Hälfte ganz ohne Text

```bf-figure
{
  "kind": "flow",
  "title": "Was mit einer Datei passiert, die Sie auf ein Board ziehen",
  "steps": [
    { "label": "Textebene lesen", "note": "Glyphen-Indizes werden über die eigene Zeichenzuordnung der Schrift aufgelöst – genau das macht einen modernen Export lesbar statt zu Zeichensalat.", "hue": "read" },
    { "label": "Lesbarkeit prüfen", "note": "Eine Seite, die zu Rauschen dekodiert, wird ABGELEHNT statt angezeigt. Eine selbstsicher falsche Transkription ist schlimmer als eine ehrliche Lücke.", "hue": "prove" },
    { "label": "Fehlschläge eskalieren", "note": "Keine Textebene oder eine verschlüsselte Datei: Das Seitenbild geht an ein Modell, das Dokumente lesen kann, und kommt transkribiert zurück.", "hue": "build" },
    { "label": "Original behalten", "note": "Angemeldet landet es im Speicher; abgemeldet reist es mit dem Board – so bleibt die Eskalation auch später noch möglich.", "hue": "measure" }
  ],
  "caption": "Die Tür zur Eskalation stand die ganze Zeit offen, und nichts hat sie genutzt: Unlesbare Dateien wurden aufbewahrt und nie erneut versucht."
}
```

Dann gibt es die andere Sorte: eine Seite ohne Text, weil sie nie welchen hatte. Ein abfotografierter Vertrag. Der Scan einer unterschriebenen Vereinbarung. Ein Lebenslauf, den jemand ausgedruckt, unterschrieben und wieder eingescannt hat. Eine verschlüsselte Datei, die jede Extraktion rundweg verweigert.

Da hilft keine Zeichenzuordnung, und ein Reader, der verspricht, es trotzdem zu versuchen, liefert Ihnen bereitwillig eine selbstsicher falsche Antwort. Der ehrliche Weg ist deshalb die Eskalation: erkennen, dass die Seite keine Textebene hat, das eigentliche Bild an ein Modell übergeben, das Bilder von Dokumenten lesen kann, und es transkribieren.

Drei Entscheidungen in dieser Eskalation sind es wert, ausgesprochen zu werden, denn genau hier geht diese Art von Funktion normalerweise schief:

- **Es wird transkribiert, nicht zusammengefasst.** Der Aufrufer macht aus dem Ergebnis ein Dokument, das jemand bearbeiten wird. Eine Zusammenfassung, die stillschweigend an die Stelle einer Transkription tritt, ist ein Dokument, das unbemerkt genau die Klausel verloren hat, die Sie gebraucht hätten.
- **Unlesbares wird markiert.** Ein unleserliches Wort kommt als unleserlich markiert zurück, statt geraten zu werden. Eine Vermutung in einem Vertrag ist schlimmer als eine Lücke darin.
- **Das Original bleibt erhalten.** Angemeldet landet die Datei im Speicher, und das Board behält einen Schlüssel. Abgemeldet – ein Board ohne Konto – reisen die Bytes mit dem Board selbst. So oder so bleibt die Eskalation später möglich, was nicht der Fall war, als unlesbare Dateien einfach verworfen wurden.

## Was sich dadurch ändert

```bf-figure
{
  "kind": "stack",
  "title": "Dinge, die jetzt durchlaufen, statt hängen zu bleiben",
  "bands": [
    { "label": "Ein Lebenslauf", "note": "Als PDF oder Word-Datei abgelegt, direkt gelesen und über die Vorlagen-Engine neu gestaltet – ohne Parsing-Konto bei Drittanbietern, ohne Abtippen.", "hue": "reach" },
    { "label": "Ein unterschriebener Vertrag", "note": "Gescannt, transkribiert und auf dem Board neben den Deal gelegt, zu dem er gehört.", "hue": "run" },
    { "label": "Ein Kontoauszug oder eine Rechnung", "note": "In Zahlen übertragen, die Sie neben den Rest Ihrer Finanzen legen können – statt eines Anhangs, den niemand öffnet.", "hue": "run" },
    { "label": "Ein altes Richtliniendokument", "note": "Nur als Bild vorhanden, Jahrzehnte alt – und jetzt durchsuchbarer Text, den Sie in einer Antwort zitieren können.", "hue": "measure" }
  ],
  "caption": "Alle vier laufen über denselben Pfad, denn der Unterschied zwischen ihnen liegt darin, welcher Reader lief – nicht darin, welches Produkt Sie öffnen mussten."
}
```

Dahinter steckt ein größerer Punkt über Produkte, die Ihre Dokumente verwahren. Sobald eine Datei unlesbar irgendwo landet, wird alles, was danach kommt, zur Handarbeit: die Zusammenfassung, die Extraktion, der Vergleich, die Suche. Teams nehmen das meist gar nicht als Dokumentenproblem wahr. Sie merken es als „den Teil haben wir dann doch von Hand gemacht“.

Lesen ist nicht ohne Grund der erste Schritt von [Idea to Real](/blog/idea-to-real-the-operating-methodology). Ein Briefing, ein RFP, ein Vertrag, eine gescannte Seite mit Notizen aus einem Workshop – die Methode beginnt damit, zu verstehen, was Sie tatsächlich gesagt haben, und sie kann gar nicht erst beginnen, wenn eine Datei nur als Symbol ankommt.

---

**Weiterlesen:** [Einen Lebenslauf als PDF in strukturiertes JSON umwandeln](/blog/parse-resume-pdf-to-structured-json) · [So bewerten Sie Ihren Lebenslauf für ATS](/blog/how-to-score-your-resume-for-ats) · [Jedes Diagrammformat, das der Canvas liest](/blog/every-diagram-format-the-canvas-reads)

[Öffnen Sie einen Canvas](/create) und legen Sie die Datei ab, die nirgendwo sonst funktioniert hat.
