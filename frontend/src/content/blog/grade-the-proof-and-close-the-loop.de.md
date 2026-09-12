Fragen Sie ein Team, was es im letzten Quartal ausgeliefert hat, und Sie bekommen eine Liste. Fragen Sie, was es gelernt hat, und Sie bekommen eine Geschichte – aus dem Gedächtnis erzählt, von wem auch immer gerade im Raum sitzt. Die Liste steht irgendwo geschrieben. Das Gelernte fast nie.

Diese Asymmetrie ist keine Faulheit. Sie entsteht, wenn ein Tool Artefakte erfasst und nichts die Antworten. Jedes Projektmanagementsystem der Welt kann Ihnen sagen, dass etwas geliefert wurde. Nur sehr wenige können sagen, ob es funktioniert hat – und fast keines kann sagen, welche Zahl Sie vorab als Entscheidungskriterium vereinbart hatten.

## Ein Nachweis ohne Abbruchkriterium ist ein Launch mit Zusatzschritten

[Von der Idee zur Realität](/blog/idea-to-real-the-operating-methodology) hat drei Akte – Lesen, Nachweisen, Bauen –, und der mittlere ist der mit der Meinung. Eine Idee zu lesen, ist günstig. Bauen ist es nicht. Zu entscheiden, welcher Nachweis es wert ist, geführt zu werden, ist die folgenreichste Entscheidung im ersten Monat von allem – und die [acht Wege, eine Idee real zu machen](/blog/eight-ways-to-make-an-idea-real), gibt es genau dafür, dass diese Wahl eine Wahl ist und keine Voreinstellung.

```bf-figure
{
  "kind": "bars",
  "title": "Die acht Nachweise, nach ihren Kosten",
  "max": 5,
  "rows": [
    { "label": "Demo-Video", "value": 1, "note": "ein Nachmittag", "hue": "prove" },
    { "label": "Klickbarer Prototyp", "value": 2, "note": "Tage", "hue": "prove" },
    { "label": "Smoke-Test", "value": 2, "note": "Tage · veröffentlicht eine Adresse", "hue": "prove" },
    { "label": "Wizard of Oz", "value": 2, "note": "Tage · ein Mensch hinter dem Vorhang", "hue": "prove" },
    { "label": "Telefonleitung", "value": 3, "note": "eine Woche · eine echte Nummer, die Menschen anrufen", "hue": "build" },
    { "label": "Proof of Concept", "value": 3, "note": "eine Woche", "hue": "build" },
    { "label": "Pilot", "value": 4, "note": "Wochen · echte Nutzer, echter Einsatz", "hue": "build" },
    { "label": "Live-System", "value": 5, "note": "Wochen echter Engineering-Arbeit", "hue": "build" }
  ],
  "caption": "Jede Option wird immer angeboten – das ist ein Rat, was Sie ZUERST angehen sollten, kein Filter. Eine zu verstecken, würde aus einer Empfehlung ein Urteil machen."
}
```

Jeder dieser acht trägt Erfolgskriterien, die Sie festlegen, *bevor* Sie bauen: 25 Anmeldungen bei 500 Besuchern, 90 % Erfolgsquote über 20 Durchläufe, vier von fünf Pilotnutzern, die die Aufgabe ohne Hilfe abschließen. Diese Zahl ist das Abbruchkriterium – das Ergebnis, das das Projekt stoppen würde.

```bf-figure
{
  "kind": "flow",
  "title": "Wo die Zahl gesetzt und wo sie bewertet wird",
  "steps": [
    { "label": "Nachweisen", "note": "Den Nachweis wählen. Die Kriterien aufschreiben: die Zahl, bei der Sie aufhören würden. Kostet nichts, baut nichts.", "hue": "prove", "tag": "setzt das Kriterium" },
    { "label": "Bauen", "note": "Den Nachweis durchführen. Ein Smoke-Test, ein Wizard-of-Oz-Versuch, eine Telefonleitung, ein Pilot – was auch immer die Kriterien tatsächlich erfordern.", "hue": "build", "tag": "kostet" },
    { "label": "Messen", "note": "Bewerten. Erreicht, verfehlt oder abgebrochen – mit der Zahl, die entschieden hat, und dem Datum, an dem Sie es entschieden haben.", "hue": "measure", "tag": "schließt den Kreis" }
  ],
  "caption": "Kriterium und Bewertung liegen bewusst an entgegengesetzten Enden der Schleife. Ein Kriterium, das nach dem Ergebnis geschrieben wird, ist kein Kriterium, sondern eine Bildunterschrift."
}
```

Bis vor Kurzem hat Builderforce die ersten beiden gut gemacht und den dritten schlicht fallen lassen. Eine Umsetzung erfasste, was gebaut wurde – die Dateien, die Tickets, die Live-URL – und sonst nichts. Die Konsolen, die den Nachweis durchführten, kannten die Antwort: Die Nachfragekonsole des Smoke-Tests zählte die Anmeldungen, das Proof-of-Concept-Harness bewertete jeden Durchlauf. Beide berechneten ein Urteil, zeigten es auf dem Bildschirm an – und warfen es beim Neuladen weg.

Die Plattform konnte also sagen: *Sie haben einen Smoke-Test durchgeführt.* Sie konnte nie sagen: *Er ist gescheitert, und Sie haben das Ding trotzdem gebaut.*

## Was ein Urteil ist

Ein Nachweis erfasst jetzt drei Dinge – und ihre Form ist wichtiger als die Tatsache, dass es sie gibt.

- **Das Urteil** – `met`, `missed` oder `abandoned`. Drei Werte, nicht zwei. Ein Nachweis, den niemand zu Ende geführt hat, ist eine andere Tatsache als ein gescheiterter Nachweis, und beides zusammenzuwerfen, schönt die Bilanz: Teams brechen weit mehr Experimente ab, als dass sie scheitern – und nur eines von beiden sagt etwas über die Idee aus.
- **Die Kennzahl, die entschieden hat** – direkt aus der Konsole übernommen, die sie gemessen hat, nie abgetippt. Eine Zahl, die jemand im Nachhinein eintippt, ist eine Zahl, die dem entspricht, was diese Person inzwischen glaubt.
- **Das Datum der Entscheidung** – getrennt davon gespeichert, wann der Datensatz zuletzt angefasst wurde, damit ein Neubau des Nachweises im nächsten Monat nicht stillschweigend verschiebt, wann Sie die Entscheidung getroffen haben.

Das Erfassen ist ein einziger Button, und er erscheint erst, wenn die Konsole einen entscheidungsfähigen Zustand erreicht: Die Zahl überschreitet den Schwellenwert, oder jeder Durchlauf wurde bewertet. Ein „Urteil erfassen“-Button, der jederzeit verfügbar ist, lädt dazu ein, einen Nachweis zu bewerten, der noch nicht abgeschlossen ist.

## Warum das die Zahl ist, an der wir uns messen lassen

Jede Plattform hat eine Leitkennzahl. Die meisten messen Aktivität: angelegte Projekte, ausgeführte Agents, verbrauchte Tokens. Diese Zahlen steigen, wenn das Produkt genutzt wird – ob der Nutzer etwas davon hatte oder nicht.

Unsere ist der Anteil der Ideen, die einen **bewerteten Nachweis** erreichen – einen Build, dessen Abbruchkriterium tatsächlich gemessen wurde, nicht bloß ein Deliverable, das produziert wurde.

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Arten, über dasselbe Quartal zu berichten",
  "columns": [
    { "title": "Was die meisten Tools zählen", "hue": "muted", "items": ["Angelegte Projekte", "Deployte Dinge", "Geschlossene Tickets", "Stunden an Agent-Zeit", "Alles Zahlen, die steigen, wenn nichts gelernt wird"] },
    { "title": "Was die Methode zählt", "hue": "measure", "items": ["Nachweise, gemessen an festgelegten Kriterien", "Erfasste Urteile mit ihrer Zahl", "Früh verworfene Ideen, auf Basis von Belegen", "Weiterverfolgte Ideen, auf Basis von Belegen", "Zahlen, die sinken können, wenn das Produkt schlecht genutzt wird"] }
  ],
  "caption": "Eine Kennzahl, die nicht sinken kann, wenn es schlecht läuft, ist keine Kennzahl, sondern eine Anzeigetafel."
}
```

Es ist eine bewusst unbequeme Zahl. Sie sinkt, wenn Leute bauen, ohne nachzuweisen – und genau dann wollen wir sie sinken sehen.

## Die Schleife in der Praxis

Das ändert sich dadurch an einem Montag.

Sie fügen ein Briefing ein. Zurück kommt eine Spezifikation – was das Ding leisten muss, welche Fähigkeiten es nennt, welche Grenzen das Briefing selbst gesetzt hat. Acht Nachweise werden dagegen gerankt, der günstigste zuerst, und die Empfehlung sagt, *warum* dieser die Frage beantwortet, die das Briefing eigentlich stellt. Sie wählen einen, schreiben die Zahl auf, bei der Sie aufhören würden, und bauen ihn. Er wird unter einer Adresse veröffentlicht, die Sie jemandem schicken können.

Zwei Wochen später zeigt die Konsole 9 Anmeldungen bei 512 Besuchern – bei einem Schwellenwert von 25. Sie drücken auf Erfassen. Das Urteil lautet `missed`, die Kennzahl ist daneben gespeichert, und das Datum ist heute.

Und dann der nützliche Teil: Diese Antwort geht zurück an Idee. Nicht als Gefühl, dass „das mit der Landingpage nicht so richtig funktioniert hat“, sondern als Zeile, die Sie auf einem Board neben die nächste Version der Idee legen können – und neben die vier anderen Dinge, die Sie in diesem Quartal ausprobiert haben.

Ein Nachweis ohne eine Bedingung, die scheitern kann, ist ein Launch mit Zusatzschritten. Ein Nachweis mit einer Bedingung, die niemand bewertet, ist ein Launch mit Zusatzpapierkram. Der dritte Akt ist es, der die ersten beiden lohnenswert macht.

---

**Weiterlesen:** [Von der Idee zur Realität – die Arbeitsmethode](/blog/idea-to-real-the-operating-methodology) · [Acht Wege, eine Idee real zu machen](/blog/eight-ways-to-make-an-idea-real) · [Lesen, Nachweisen, Bauen – die innere Schleife](/blog/read-prove-build-the-inner-loop)

Beginnen Sie dort, wo die Methode beginnt: [Öffnen Sie einen Canvas](/create) und fügen Sie die Idee ein, über die Sie schon lange diskutieren.
