Festpreisarbeit scheitert in zwei Richtungen, und jeder, der auf einer der beiden Seiten stand, kennt beide.

Der Auftraggeber zahlt im Voraus, und die Arbeit driftet. Oder der Auftragnehmer liefert, und die Rechnung altert zu einem Gespräch darüber, ob wirklich alles fertig war. Die Abrechnung nach Stunden existiert teilweise, um das zu umgehen, und löst es, indem niemand für ein Ergebnis verantwortlich ist.

Escrow ist die alte Antwort: Geld wird zugesagt, verwahrt und gegen vereinbarte Liefergegenstände freigegeben. Das funktioniert und scheitert meist an der Software statt an der Idee – weil die beiden Seiten auf unterschiedliche Bildschirme schauen, die sich darüber uneins sind, was passiert ist.

## Ein Zeitplan, drei Oberflächen, keine zweite Kopie

```bf-figure
{
  "kind": "flow",
  "title": "Das Leben eines Meilensteins",
  "steps": [
    { "label": "Finanzieren", "note": "Der Auftraggeber sagt den Betrag zu. Bis das geschieht, ist der Meilenstein nicht startbar – der ganze Sinn der Vereinbarung.", "hue": "reach", "tag": "Auftraggeber" },
    { "label": "Liefern", "note": "Der Auftragnehmer markiert ihn als geliefert, mit dem jeweiligen Liefergegenstand.", "hue": "make", "tag": "Auftragnehmer" },
    { "label": "Abnehmen oder nachfragen", "note": "Der Auftraggeber nimmt ab oder fordert Änderungen mit Begründung an. Beides wird aufgezeichnet; keines ist ein Schweigen.", "hue": "run", "tag": "Auftraggeber" },
    { "label": "Freigeben", "note": "Der verwahrte Betrag wird bewegt. Der Saldo, die fünf aufsummierten Gesamtwerte und die Historie stammen alle aus demselben Lesezugriff.", "hue": "measure" }
  ],
  "caption": "Auch die Stornierung ist ein vollwertiger Schritt und verhält sich vor und nach der Finanzierung unterschiedlich – weil das tatsächlich verschiedene Situationen sind und nicht eine Situation mit einem Flag."
}
```

Das Panel, das ein Auftraggeber in seinem Auftrag sieht, das Panel, das ein Arbeitgeber an einer Ausschreibung sieht, und der eigene Meilenstein-Tab des Auftragnehmers sind **eine Komponente**. Nicht drei Implementierungen eines gemeinsamen Designs – eine, an drei Stellen gerendert.

Das ist keine Ordnung um ihrer selbst willen. Es verhindert den klassischen Escrow-Fehler, bei dem der Bildschirm des Auftraggebers *Freigeben* anbietet, während der Server den Meilenstein bereits in einen Zustand versetzt hat, in dem die Freigabe abgelehnt wird – und die klickende Person eine Fehlermeldung erhält, die wie ein Systemfehler klingt und sich wie Betrug anfühlt.

## Die Schaltflächen sind die Entscheidung des Servers

Das ist die Designentscheidung, die man übernehmen sollte, egal was Sie bauen.

Jede Meilenstein-Zeile kommt vom Server mit der Liste der **Aktionen, die dieser Partei in diesem Zustand zur Verfügung stehen**. Das Panel rendert die Schritte, die es erhalten hat. Es kann keinen anbieten, der abgelehnt würde, weil es nicht weiß, wie man einen berechnet.

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Arten zu entscheiden, was eine Schaltfläche anbietet",
  "columns": [
    { "title": "Der Browser berechnet es", "hue": "bad", "items": ["Die Regel lebt an zwei Orten", "Eine dritte Kopie erscheint in der Mobile-App", "Sie driften beim ersten Randfall auseinander", "Der Nutzer begegnet der Abweichung als Fehler"] },
    { "title": "Der Server projiziert es", "hue": "good", "items": ["Eine Maschine entscheidet, eine Maschine urteilt", "Ein neuer Zustand ist eine Server-Änderung ohne UI-Anpassung", "Das Panel kann keinen unmöglichen Schritt anbieten", "Alle Oberflächen sind per Konstruktion einig"] }
  ],
  "caption": "Derselbe Grund, aus dem eine gemeinsame Komponente über ihre eigene Sichtbarkeit entscheidet, statt von dem, der sie rendert, ein `canRelease`-Prop zu erhalten."
}
```

## Ein Angebot kann seinen eigenen Zeitplan vorschlagen

Ein Festpreis ohne Gestalt ist nur eine Zahl, über die man streitet. Ein Angebot kann nun den Zeitplan mitbringen, den es vorschlägt – die Meilensteine, was jeder liefert, was jeder wert ist –, sodass die Verhandlung über den Plan statt über die Gesamtsumme geführt wird. Die Annahme des Angebots nimmt den Zeitplan mit an.

Das verbessert auch das erste Gespräch. „12.000 £“ lädt zum Feilschen ein. „12.000 £, in vier Teilen, deren erster ein funktionierender Import ist, den Sie in Woche zwei auf Ihren eigenen Daten ausführen können“ lädt zu einer Entscheidung ein.

## Wo es einzuordnen ist

Market – verkaufen, kaufen, einstellen, gefunden werden – ist die Phase, nachdem das Ding funktioniert. Escrow ist einer der Mechanismen, die das Kaufen zwischen Parteien möglich machen, die noch keinen Grund haben, einander zu vertrauen – der Normalzustand eines Marktplatzes. Es steht neben dem [kaufmännischen Vokabular](/blog/close-the-deal-on-the-board-you-built-it-on) auf dem Board und den [Rechnungen und Forderungen](/blog/the-founder-back-office-money-ownership-and-paperwork) im Back Office: dasselbe Geld, in drei verschiedenen Abständen zur Arbeit.

---

**Weiterführende Lektüre:** [Schließen Sie den Deal auf dem Board, auf dem Sie ihn aufgebaut haben](/blog/close-the-deal-on-the-board-you-built-it-on) · [Arbeit an einem Ort einstellen, zuweisen und bezahlen](/blog/hire-assign-and-pay-for-work-in-one-place) · [Das Founder Back Office](/blog/the-founder-back-office-money-ownership-and-paperwork)

Stöbern Sie auf dem [Freelance-Marktplatz](/freelancer) oder [öffnen Sie einen Canvas](/create) und umreißen Sie zuerst die Arbeit.
