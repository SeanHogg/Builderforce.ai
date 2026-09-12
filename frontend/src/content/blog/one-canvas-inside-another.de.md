Zeichnen Sie den Offboarding-Flow einmal. Konten sperren, letzte Gehaltsabrechnung, dem Laptop hinterherlaufen, das Team informieren. Sechs Schritte, verbunden, gebaut, laufen nach Zeitplan. Gut.

Jetzt zeichnen Sie den Beförderungs-Flow. Er genehmigt die Gehaltserhöhung, aktualisiert den Vertrag, informiert die Lohnbuchhaltung – und irgendwo in der Mitte offboardet er den externen Mitarbeiter, dessen Rolle durch die Beförderung neu besetzt wird.

Wieder diese sechs Schritte.

Solange der Canvas der Workflow ist, lautete die ehrliche Antwort: neu zeichnen. Und die Kopie, die Sie korrigiert haben, war nie die, die lief. Jemand korrigiert den Lohnabrechnungsschritt im Offboarding-Canvas, und vier andere Canvases machen es weiter auf die alte Art – still, nach Zeitplan, monatelang.

## Ein Canvas ist jetzt ein Schritt

`Run a canvas` ist eine Schrittart wie jede andere. Platzieren Sie ihn, wählen Sie einen Canvas, und der Flow, den Sie anderswo gezeichnet haben, ist eine Karte auf diesem Board.

```bf-figure
{
  "kind": "flow",
  "title": "Beförderung, mit Offboarding darin",
  "steps": [
    { "label": "Gehaltserhöhung genehmigen", "note": "Das Gate, an dem ein Mensch wirklich entscheidet", "hue": "idea" },
    { "label": "Vertrag aktualisieren", "note": "Dokumente, Unterschriften, die Akte", "hue": "make" },
    { "label": "Einen Canvas ausführen · Offboarding", "note": "Sechs Schritte, die auf einem eigenen Board leben, mit eigenem Autor und eigener Historie", "hue": "run", "tag": "hier ein Schritt" },
    { "label": "Lohnbuchhaltung informieren", "note": "Übernimmt, was der verschachtelte Canvas zurückgegeben hat", "hue": "measure" }
  ],
  "caption": "Der verschachtelte Canvas ist keine Kopie und kein Link auf ein Dokument. Er ist der Flow selbst, ausgeführt, mitten in diesem."
}
```

Der Schritt ist ein Wert, keine neue Objektart – dieselbe Regel, nach der eine neue Branche ein `discipline`-Wert ist und kein neues Vokabular. Das heißt: Er wird gezeichnet, verbunden, gruppiert, gebaut und ausgeführt wie der Switch direkt daneben.

## Was er annimmt, wird vom Board abgelesen, nicht deklariert

Das verlockende Design ist eine Vertragskarte auf dem Kind-Canvas: eine Liste von Parametern, eine Liste von Rückgaben, gegen die der Eltern-Canvas bindet. Das ist explizit, es ist stabil – und es geht am ersten Nachmittag schief, an dem jemand einen Schritt hinzufügt. Denn dann gibt es zwei Aussagen darüber, was der Canvas braucht, und die, die ausgeführt wird, ist nicht die, die irgendjemand liest.

Also gibt es keine Vertragskarte. Die Schnittstelle wird aus dem Flow abgeleitet, der tatsächlich gezeichnet ist:

```bf-figure
{
  "kind": "compare",
  "title": "Woher eine Schnittstelle kommt",
  "columns": [
    { "title": "Ein deklarierter Vertrag", "hue": "muted", "items": ["Der Autor schreibt die Parameterliste", "Der Autor schreibt die Rückgabeliste", "Jemand fügt einen Schritt hinzu", "Liste und Flow widersprechen sich", "Der Flow gewinnt – stillschweigend"] },
    { "title": "Vom Board abgeleitet", "hue": "make", "items": ["Ein Schritt, den nichts speist, ist der Punkt, an dem Daten hereinkommen", "Was dieser Schritt als Bedarf deklariert, IST ein Parameter", "Eine Variable, die nachgelagert niemand liest, IST eine Rückgabe", "Fügen Sie einen Schritt hinzu, und die Schnittstelle zieht nach", "Es gibt nichts, das synchron gehalten werden muss"] }
  ],
  "caption": "Dieselbe Regel, der das Board schon folgt, wenn es um ausführbare Abschnitte geht: die Zeichnung fragen, nie eine Markierung, an deren Aktualisierung jemand denken muss."
}
```

Wählen Sie im Schritt einen Canvas, und er zeigt Ihnen sofort, was dieser Canvas annimmt und was er zurückgibt – ohne dass Sie ihn öffnen.

## Eingefroren oder live

Wiederverwendung wirft eine Frage auf, auf die es keine allgemein richtige Antwort gibt – also stellt der Schritt sie.

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Arten, vom Canvas eines anderen abzuhängen",
  "columns": [
    { "title": "Snapshot – der Standard", "hue": "make", "items": ["Die Schritte des Kind-Canvas werden beim Bauen in diesen Flow kopiert", "Eine Definition, ein Run, eine Timeline", "Änderungen drüben ändern hier nichts, bis Sie neu bauen", "Was Sie ausgeliefert haben, ist das, was läuft"] },
    { "title": "Live – optional", "hue": "run", "items": ["Dieser Flow speichert eine Referenz auf den eigenen Build des Kind-Canvas", "Der Kind-Canvas wird bei jedem Run dieses Flows neu gelesen", "Den Offboarding-Canvas einmal korrigieren – jeder Aufrufer übernimmt es", "Der Kind-Canvas muss dort mindestens einmal gebaut worden sein"] }
  ],
  "caption": "Eine gemeinsam genutzte Subroutine will Live. Ein Flow, der sich weiterhin so verhalten muss wie zum Zeitpunkt seiner Freigabe, will Snapshot. Beides ist ein Dropdown im Schritt."
}
```

Keine der beiden Bindungen darf still scheitern. Ein Canvas, der sich nicht lesen lässt, einer ohne Schritte, einer mit einem Schritt, dem noch ein Prompt fehlt, ein Canvas, der sich selbst erreicht, und eine Verschachtelung tiefer als fünf Ebenen – all das sind **Ablehnungen**: Der Build stoppt, und die Meldung nennt den Canvas beim Namen. Das ist Absicht, und es ist dieselbe Regel, die der Compiler schon immer auf einen Schritt ohne Aufruf angewendet hat: Ein Flow, der läuft, Erfolg meldet und die Sache nicht erledigt, ist schlimmer als einer, der sich gar nicht erst bauen lässt.

## Wo das in der Methode steht

Komposition gehört zu **Bauen**, dem dritten und teuren Akt – aber was sie tatsächlich verändert, ist das Danach: Betreiben und Messen.

[Lesen und Beweisen](/blog/read-prove-build-the-inner-loop) kommen zuerst, damit die Entscheidung zu bauen eine Entscheidung ist. Bei Komposition geht es darum, dass sich der Build, für den Sie sich bereits entschieden haben, auch dauerhaft lohnt. Ein Prozess, der einmal gezeichnet und wiederverwendet wird, ist ein Prozess, den Sie einmal *verbessern* können: Die Korrektur der Lohnabrechnung landet an einer Stelle, und alles, was davon abhängt, ist beim nächsten Run korrekt – weil die Aufrufer eine Referenz halten statt einer Kopie.

```bf-figure
{
  "kind": "stack",
  "title": "Was jeder Akt davon hat, dass ein Canvas wiederverwendbar ist",
  "bands": [
    { "label": "Bauen", "note": "Den gemeinsamen Teil einmal zeichnen. Der Beförderungs-Flow sagt „dann offboarden“ so, wie er „dann den Brief schicken“ sagt.", "hue": "make" },
    { "label": "Betreiben", "note": "Die verschachtelten Schritte erscheinen in der Timeline des Eltern-Flows, unter dem Namen des Kind-Canvas – ein Run zum Beobachten, ein Freigabe-Gate, ein Ort zum Nachsehen.", "hue": "run", "tag": "live oder eingefroren" },
    { "label": "Messen", "note": "Den gemeinsamen Schritt in seinem eigenen Canvas korrigieren, und jeder Flow, der ihn aufruft, ist beim nächsten Run richtig. Eine Korrektur, nicht sieben.", "hue": "measure" }
  ],
  "caption": "Der Bogen bekommt keine neue Stufe. Er gewinnt, dass dieselbe Arbeit nicht mehr auf jeder Stufe, die sie braucht, neu gezeichnet wird."
}
```

## Was Sie heute damit tun können

- **Jeden Canvas in einen wiederverwendbaren Schritt verwandeln** – kein Export, keine Vorlage, keine Kopie. Es ist der Canvas selbst, in Ausführung.
- **Sehen, was er annimmt, bevor Sie ihn verbinden** – Parameter und Rückgaben, aus dem Kind-Board abgeleitet und im Schritt angezeigt.
- **Wählen, ob er eingefroren oder live ist** – ein Build, über den Sie verlässlich Aussagen treffen können, oder eine gemeinsame Subroutine, die jeder Aufrufer erbt.
- **Bis zu fünf Ebenen tief verschachteln** – Selbstreferenzen oder zu tiefe Ketten werden beim Namen abgelehnt, statt sich erst als hängender Run zu zeigen.

Onboarding, Offboarding, Beschaffungsfreigabe, Incident-Kommunikation, Vertragsverlängerung: Jede Organisation hat acht davon, und jeder taucht in einem Dutzend größerer auf. Es war immer derselbe Flow. Jetzt ist es dasselbe Objekt.

---

**Weiterlesen:** [Der Canvas ist der Workflow](/blog/creation-canvas-beyond-chat) · [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas) · [Freigabe-Gates und menschliche Aufsicht](/blog/approval-gates-and-human-oversight)

[Öffnen Sie einen Canvas](/create), zeichnen Sie den Flow, den alle immer wieder neu zeichnen, und setzen Sie ihn in den nächsten.
