Drei Dinge braucht ein Unternehmen in seinem ersten Jahr, und keines davon ist das Produkt: bezahlt werden, wissen, wem was gehört, und die Dokumente haben, die den ersten beiden überhaupt Bedeutung verleihen.

Meist sind das drei Tools, drei Exporte und eine Tabelle, der längst niemand mehr traut. Hier ist, was sich geändert hat, als daraus Objekte auf demselben Board wurden, auf dem auch die Arbeit liegt.

## 1 · Das Geld, das hereinkommt

Der Finanzbereich war konstruktionsbedingt eine Einbahnstraße. Geld konnte hinausgehen – Auszahlungen, Eingangsrechnungen, Gehälter –, aber nichts konnte welches hereinholen. Rechnungsaktionen wurden angekündigt, abgesichert, freigegeben … und hatten nichts dahinter.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Rechnung, von Anfang bis Ende",
  "steps": [
    { "label": "Stellen", "note": "Gegen ein echtes Kundenkonto – nicht gegen einen Namen, der nach Schreibweise zugeordnet wird.", "hue": "run" },
    { "label": "Altern", "note": "Tage im Verzug werden aus dem Fälligkeitsdatum berechnet. Nie eingetippt, denn eine veraltete Altersstruktur ist schlimmer als gar keine.", "hue": "run", "tag": "berechnet" },
    { "label": "Mahnen", "note": "Eine Stufe einer Mahnleiter, einmal pro Schritt erfasst – so wird derselbe Kunde nie zweimal für dasselbe gemahnt.", "hue": "reach" },
    { "label": "Zahlung erfassen", "note": "Was tatsächlich eingegangen ist, gegenüber dem, was geschuldet war.", "hue": "measure" }
  ],
  "caption": "Forderungsmanagement ohne Aufzeichnung wird doppelt erledigt oder gar nicht. Genau deshalb ist die Mahnleiter pro Rechnung und Schritt eindeutig."
}
```

Die Änderung an den Geschäftspartnern darunter ist die leise. `invoice.customer`, `bill.vendor`, `contract.counterparty` und `placement.client` waren allesamt Freitext, versehen mit der Anweisung, „ihn anhand des Namens einem Unternehmen auf dem Board zuzuordnen“. Drei nahezu identische Anweisungen, drei Gelegenheiten für ein angehängtes „Ltd“, eine zweite Acme zu erzeugen. Jetzt laufen sie über eine gemeinsame Kontosuche – eine Live-Verknüpfung, keine kopierte ID. Wird ein Konto umbenannt, bleiben also nicht vier veraltete Kopien seines alten Namens über Ihre Rechnungen verstreut.

## 2 · Eine Cap Table, die ihr zweites Ereignis übersteht

Hier ist die Form, die fast jede Gründer-Tabelle hat – und warum sie immer bricht.

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Arten, Eigentum zu erfassen",
  "columns": [
    { "title": "Eine Tabelle der Anteilseigner", "hue": "bad", "items": ["Inhaber, Instrument, Anteile, Prozent", "Jedes Ereignis heißt: die ganze Tabelle NEU abtippen", "Eine Aufstockung des Pools zerlegt sie", "Ein Ausscheiden zerlegt sie", "Ein Rückkauf zerlegt sie", "Prozentwerte, die nicht 100 ergeben, samt einer Notiz, die erklärt, warum"] },
    { "title": "Genehmigt, gewährt und Ereignisse", "hue": "good", "items": ["Anteilsklassen = was der Vorstand genehmigt hat", "Zuteilungen = die BEDINGUNGEN einer Gewährung", "SAFEs und Wandeldarlehen als separate Instrumente – nur eines davon verzinst sich", "Eine nur erweiterbare Historie von Ausgaben, Übertragungen, Ausübungen, Einziehungen", "Prozentwerte sind Arithmetik über diese Historie"] }
  ],
  "caption": "Der Optionspool ist eine KLASSE, kein Flag: „Was ist nicht zugeteilt“ heißt genehmigt minus gewährt INNERHALB davon – und das kann ein boolescher Wert nicht ausdrücken."
}
```

Eine Finanzierungsrunde ist eine Aufzeichnung dessen, was *verhandelt* wird – das Instrument, der angestrebte Betrag, die geforderte Bewertung, der Lead-Investor, das geplante Abschlussdatum. Was tatsächlich abgeschlossen wurde, wird aus den Zuteilungen abgeleitet, sodass der Kopf der Runde und das Geld darin nie auseinanderlaufen können. Eine gespeicherte Spalte „eingeworbener Betrag“ wäre eine Summe, der die Zeilen darunter widersprechen können – und an dem Tag, an dem sie es tun, weiß niemand, welche Zahl stimmt.

## 3 · Der Papierkram vor allem anderen Papierkram

Zwei Gründer können sich finden, einig werden, sich die Hand geben – und haben dann keinen Ort, an dem sie das festhalten. Deshalb gibt es die Gründungsdokumente als Vorlagen, die ausgefüllt und zur Unterschrift versendet werden:

- **Gründervereinbarung**
- **IP-Übertragung der Gründer**
- **Vesting-Plan der Gründer**
- **Gegenseitige Geheimhaltungsvereinbarung**

Fehlt ein Pflichtfeld, wird das Dokument *mit Namen* abgelehnt, samt einer Liste dessen, was fehlt. Das klingt pedantisch, bis man die Alternative bedenkt: einen Gedankenstrich in eine Gründervereinbarung zu rendern und jemanden unterschreiben zu lassen. Ein Fehler lässt sich beheben; ein unterschriebenes Dokument mit einer Lücke in der Eigentumsklausel nicht.

Über diese vier hinaus lässt sich jedes Rechtsdokument verschlüsselt verwahren, per Link teilen und unterzeichnen, wobei der Text exakt so eingefroren wird, wie er bei der Unterschrift war. Und ein Datenraum kann die tatsächlichen Dateien enthalten, die eine Due-Diligence-Anfrage verlangt, statt nur der Checkliste, die sie aufzählt – was bis vor Kurzem der Stand war und die leise peinlichste Lücke auf dieser Liste ist.

## Warum das auf demselben Board liegt wie das Produkt

Weil die Alternative das ist, was alle machen: ein Finanztool, das nicht weiß, was Sie bauen, ein Cap-Table-Tool, das nicht weiß, wer daran arbeitet, und ein Signatur-Tool, das beides nicht weiß.

```bf-figure
{
  "kind": "stack",
  "title": "Ein Board, vier Abstände zur Arbeit",
  "bands": [
    { "label": "Die Arbeit", "note": "Karten, Code, Tickets – das, was gebaut wird.", "hue": "make" },
    { "label": "Der Deal", "note": "Angebote, Testphasen, gemeinsame Aktionspläne – was verkauft wird, verbunden mit dem, was es verkauft.", "hue": "reach" },
    { "label": "Das Geld", "note": "Ausgangsrechnungen, Eingangsrechnungen, Mahnwesen, Lohnläufe – berechnet aus den Zeilen, nicht auf eine Karte getippt.", "hue": "run" },
    { "label": "Das Unternehmen", "note": "Eigentum, Instrumente, die Gründungsdokumente, deren Existenz alles andere voraussetzt.", "hue": "measure" }
  ],
  "caption": "Betreiben ist eine ganze Stufe des Bogens – „führe es als Unternehmen“ – und genau die Stufe, für die Sie die meisten Build-Tools zurück an eine Tabelle verweisen."
}
```

---

**Weiterlesen:** [Schließen Sie den Deal auf dem Board ab, auf dem Sie es gebaut haben](/blog/close-the-deal-on-the-board-you-built-it-on) · [Festpreis-Meilensteine und Treuhand](/blog/fixed-price-milestones-and-escrow) · [Idea to Real – die operative Methodik](/blog/idea-to-real-the-operating-methodology)

[Öffnen Sie einen Canvas](/create) und legen Sie die Rechnung direkt neben die Arbeit, für die sie ist.
