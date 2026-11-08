Die meisten Ideen sterben nicht, weil sie schlecht waren. Sie sterben in einer Notiz-App.

Sie haben eine unter der Dusche, beim Spaziergang, mitten in einem Gespräch über etwas ganz anderes. Sie schreiben sie irgendwo auf – in eine Notiz-App, auf die Rückseite eines Kassenbons, in eine Slack-Nachricht an sich selbst –, und dort liegt sie mit vierzig anderen, keine davon weiter als an dem Tag, an dem sie entstanden ist. Sechs Monate später können Sie nicht mehr sagen, welche Sie jemals mit einem echten Kunden getestet haben und welche sich nur *gut anfühlten*.

Beim Canvas war es genau umgekehrt. Er konnte ein recherchiertes Kundensegment, eine Wettbewerber-Battlecard, ein Kundeninterview und ein bewertetes Experiment aufnehmen. Nur für den halbfertigen Gedanken, der all das ausgelöst hatte, gab es keinen Platz.

## Das Ideas-Scratchpad

Jeder Canvas hat jetzt eine vierte Möglichkeit, das Board zu lesen, direkt neben Board: **Ideas**.

```bf-figure
{
  "kind": "screen",
  "frame": "Das Ideas-Scratchpad auf einem Canvas",
  "ratio": 1.62,
  "regions": [
    { "label": "Erfassen", "note": "Gedanken eintippen und auf Capture drücken – die erste Zeile wird zum Titel, die ganze Notiz bleibt erhalten", "x": 4, "y": 8, "w": 92, "h": 20, "hue": "idea" },
    { "label": "Phasen", "note": "Wie viele Ideen in welcher Phase stehen – per Klick filtern", "x": 4, "y": 32, "w": 26, "h": 60, "hue": "accent" },
    { "label": "Ihre Ideen", "note": "Neueste zuerst, jeweils mit Phase, nächstem Schritt und Belegen", "x": 33, "y": 32, "w": 63, "h": 60, "hue": "make" }
  ],
  "caption": "Das Scratchpad ist eine Leseansicht des Boards, kein zweiter Ablageort. Jede erfasste Idee ist eine Karte auf dem Board, sodass Brain sie sieht und Sie sie neben die Arbeit ziehen können, aus der sie wird."
}
```

Eine Idee aufzuschreiben dauert ungefähr so lange, wie sie zu haben. Tippen Sie einen Satz oder drei und drücken Sie **Capture**. Die erste Zeile wird zum Titel der Idee, und die gesamte Notiz bleibt genau so erhalten, wie Sie sie geschrieben haben. Unfertig zu sein ist der Sinn der Sache: Ein Scratchpad, das eine Problembeschreibung verlangt, bevor es eine Notiz annimmt, ist ein Formular – und die Notiz geht verloren.

Danach führt das Scratchpad für Sie Buch. Jede Idee hat eine Phase, und die Phasen sind die, die eine Idee tatsächlich durchläuft:

```bf-figure
{
  "kind": "flow",
  "title": "Das Leben einer Idee",
  "steps": [
    { "label": "Erfasst", "note": "Aufgeschrieben. Mehr wird nicht verlangt.", "hue": "idea" },
    { "label": "Erkundung", "note": "Wird recherchiert – das Problem, wer es hat, wer es sonst noch löst.", "hue": "idea" },
    { "label": "Validierung", "note": "Ein Kundeninterview oder ein Experiment läuft.", "hue": "make" },
    { "label": "Validiert", "note": "Die Belege sagen Ja.", "hue": "run", "tag": "verdient, nicht gefühlt" }
  ],
  "caption": "Drei weitere Phasen sind Ausgänge, und jede bedeutet einen Monat später etwas anderes: Geparkt heißt „jetzt nicht“, Verworfen heißt „die Belege sagten Nein“, und Befördert heißt „daraus wurde etwas“ – ein Projekt, ein Unternehmen, ein Proof."
}
```

## Wo Kundeninterviews ins Spiel kommen

Eine Idee ist nur so gut wie die Gespräche dahinter, deshalb hat jede Idee im Scratchpad einen Button **Plan an interview**. Wenn Sie ihn drücken, passieren drei Dinge gleichzeitig: Eine Kundeninterview-Karte landet auf dem Board, benannt nach der Idee; die Idee vermerkt, dass dieses Interview sie testet; und eine Idee, die nur erfasst war oder erkundet wurde, wechselt in die Validierung.

Sobald das Interview ausgearbeitet ist – die Fragen, die Schmerzpunkte, die die Person ungefragt genannt hat, die wörtlichen Zitate –, zählt die Idee es mit. Jede Idee zeigt ihre Belege in klaren Worten: *getestet durch 2 Interviews und 1 Experiment* oder *ungetestet – sprechen Sie mit jemandem, bevor Sie bauen*. Nennt eine Idee ein Interview, das nicht auf dem Board liegt, sagt sie das, statt es mitzuzählen.

Und ganz oben im Scratchpad steht die eine Zahl, auf die es sich zu reagieren lohnt: wie viele Ihrer offenen Ideen noch niemand mit einem Kunden getestet hat.

```bf-figure
{
  "kind": "compare",
  "title": "Ideen aufbewahren vs. verfolgen",
  "columns": [
    { "title": "Eine Notiz-App", "hue": "muted", "items": ["Vierzig Ideen, alle im selben Zustand", "Keine Aufzeichnung, wen Sie gefragt haben", "„Validiert“ heißt: Es fühlt sich immer noch gut an", "Mit der Arbeit anzufangen heißt, die Idee woandershin zu kopieren"] },
    { "title": "Das Ideas-Scratchpad", "hue": "idea", "items": ["Jede Idee hat eine Phase", "Interviews und Experimente sind mit der Idee verknüpft, die sie testen", "Validiert heißt: Die Belege sagten Ja", "Die Idee ist schon eine Karte auf dem Board, auf dem die Arbeit stattfindet"] }
  ],
  "caption": "Der Unterschied liegt nicht darin, wo die Worte gespeichert sind. Er liegt darin, ob „Haben wir mit jemandem darüber gesprochen?“ eine Antwort hat."
}
```

## Wo es in der Methode steht

Idea to Real läuft über **Idea → Make → Run → Measure**, und der erste Akt ist absichtlich der günstigste: [Read und Prove](/blog/read-prove-build-the-inner-loop) kommen vor Build, damit die Entscheidung zum Bauen eine Entscheidung ist und kein Schwung.

Das Scratchpad ist die Eingangstür zu diesem ersten Akt. **Capture** ist der Moment vor Read – die Idee muss irgendwo existieren, bevor sie jemand recherchieren kann. **Exploring** ist Read: Brain kann jede Idee auf dem Board aufgreifen und das Problem, das Segment und den Wettbewerb darum herum recherchieren. **Validating** ist Prove: das Kundeninterview oder Experiment, das aus einer Annahme eine Tatsache macht, und der günstigste der [acht Wege, eine Idee Wirklichkeit werden zu lassen](/blog/eight-ways-to-make-an-idea-real). Nur eine Idee, die beides durchlaufen hat, sollte zu etwas **Promoted** werden, das Sie bauen.

Diese Phase brauchte das, weil sie die einzige Stelle war, an der die Methode kein Objekt hatte. Alles danach hatte eines – Proofs, Projekte, Releases, Metriken. Die Idee selbst lebte in der App, die gerade offen war, als Sie sie hatten.

## Was Sie heute damit tun können

- **Eine Idee in Sekunden erfassen**, von jedem Canvas aus, in einem Satz, ohne vorher zu entscheiden, was sie ist.
- **Alle Ideen auf einen Blick sehen**, neueste zuerst, mit einem Klick nach Phase gefiltert.
- **Das Kundeninterview, das eine Idee testet, mit einem Klick planen**, in beide Richtungen verknüpft.
- **Sehen, welche Ideen tatsächlich getestet sind** – und bei wie vielen offenen Ideen noch niemand mit einem Kunden gesprochen hat.
- **Brain jede Idee recherchieren lassen**, die auf dem Board liegt, denn jede Idee ist bereits eine Karte, die es lesen und ausfüllen kann.

---

**Weiterführende Lektüre:** [Read, Prove, Build – die innere Schleife](/blog/read-prove-build-the-inner-loop) · [Acht Wege, eine Idee Wirklichkeit werden zu lassen](/blog/eight-ways-to-make-an-idea-real) · [Vom Kundenfeedback zu zehn Mockups](/blog/customer-feedback-to-ten-mockups)

[Öffnen Sie einen Canvas](/create), klicken Sie auf Ideas und schreiben Sie die Idee auf, die Sie schon lange testen wollten.
