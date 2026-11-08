Jede Evaluierung von Enterprise-KI beginnt als Gespräch über Modelle und endet als Gespräch über vier Dinge, die mit Modellen nichts zu tun haben.

Kunden haben uns nicht um ein besseres Modell gebeten. Sie haben diese Fragen gestellt:

```bf-figure
{
  "kind": "stack",
  "title": "Die vier, in der Reihenfolge, in der sie gestellt werden",
  "bands": [
    { "label": "Kann es unsere Daten lesen?", "note": "Kein Demo-Korpus. Unsere Exporte, unsere Dokumente, unsere Tickets, unsere Richtlinien – in den Formaten, in denen sie tatsächlich vorliegen.", "hue": "idea" },
    { "label": "Wird es über Tenants hinweg Daten preisgeben?", "note": "Nicht „wir filtern nach Kunden-ID“. Was passiert, wenn der Filter fehlt?", "hue": "run" },
    { "label": "Was hat diese Antwort gekostet?", "note": "Pro Antwort, zuordenbar, keine Monatsrechnung mit einer einzigen Zahl.", "hue": "measure" },
    { "label": "Woher wissen wir, dass es besser wird?", "note": "Ein Gate, das eine Änderung bestehen muss, kein Changelog, das behauptet, es sei besser geworden.", "hue": "prove" }
  ],
  "caption": "Ein Anbieter, der drei davon gut beantwortet und bei der vierten abwinkt, bittet Sie, die vierte auf Treu und Glauben hinzunehmen – und die vierte entscheidet, ob das Ding in einem Jahr noch gut ist."
}
```

So sehen die Antworten aus, wenn sie echt sind.

## 1 · Ingestion ist ein Pfad, keine Demo

Der Fehlermodus ist ein System, das Markdown wunderbar liest und alles andere als Anhang behandelt. Reale Korpora sind gemischt: Richtliniendokumente, exportierte Tickets, Tabellen, HTML-Seiten, eine CSV, die jemand vor sechs Jahren aus einem Bericht erzeugt hat.

Eine Pipeline verarbeitet sie alle, und der Unterschied zwischen ihnen ist, welcher Parser lief – nicht, welches Produkt Sie kaufen mussten. Strukturierte Zeilen und unstrukturierte Prosa landen über denselben Pfad im selben Index, wodurch eine Frage aus beiden gleichzeitig beantwortet werden kann.

Details, die sich in der Praxis als wichtig erweisen: die Überschriften-Brotkrumen eines Dokuments zu erhalten, damit ein abgerufener Chunk weiß, woher er stammt, und Zahlen und Booleans aus Tabellen wiederherzustellen, **ohne** bezeichnerartige Zeichenketten zu verstümmeln – eine ID `007` ist nicht die Zahl sieben, und ein System, das anders entscheidet, beschädigt stillschweigend jeden Verweis darauf.

## 2 · Mandantentrennung ist einkompiliert und schlägt geschlossen fehl

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Arten, einen Kunden von den Daten eines anderen fernzuhalten",
  "columns": [
    { "title": "Ein Filter an der Aufrufstelle", "hue": "bad", "items": ["Korrekt in jedem Codepfad, an den jemand gedacht hat", "Ein neuer Codepfad ist eine neue Gelegenheit zum Vergessen", "Der Fehler ist still und sieht aus wie eine gute Antwort", "Sie erfahren es vom Kunden"] },
    { "title": "In den Abruf einkompiliert, geschlossen fehlschlagend", "hue": "good", "items": ["Eine Abfrage ohne Tenant-Scope liefert nichts", "Filter sind DATEN, die der Adapter befolgen muss", "Tenant-übergreifende Lesezugriffe werden DEKLARIERT, nie zufällig", "Das Fehlen eines Scopes ist ein Fehler, kein Platzhalter"] }
  ],
  "caption": "Die Eigenschaft, auf die Sie in einer Demo bestehen sollten: Fragen Sie, was passiert, wenn der Tenant-Scope fehlt. „Alles“ und „nichts“ sind sehr unterschiedliche Produkte."
}
```

## 3 · Kosten und Trace bei jeder Antwort

Ein KI-System, dessen Kosten als einzelne Monatszahl eintreffen, lässt sich nicht steuern. Sie können nicht erkennen, welcher Workflow teuer ist, welches Team ihn antreibt oder ob die Antwort die Token wert war.

Telemetrie pro Antwort – was abgerufen wurde, was aufgerufen wurde, was es gekostet hat – macht daraus etwas, das ein Finanzbereich handhaben und ein Engineering-Team verbessern kann. Sie macht auch die vierte Frage beantwortbar, denn Sie können nicht zeigen, dass eine Änderung eine Verbesserung war, ohne eine Baseline, die Sie bereits aufgezeichnet haben.

## 4 · Ein Evaluierungs-Gate, kein Changelog

Die ehrliche Version von „es wird besser“ ist ein Satz von Fällen, die das System bestehen muss, bevor eine Änderung ausgeliefert wird, bei jeder Änderung ausgeführt, mit sichtbaren Fehlschlägen. Kein Benchmark-Wert in einem Launch-Post – ein Gate in der Pipeline, das *Nein* sagen kann.

Das ist die Frage, die die meisten Anbieter am schlechtesten behandeln, weil sie die einzige ist, die sie einschränkt. Ein Gate, das einen Release blockieren kann, ist ein Gate, das irgendwann einen Release blockieren wird, den jemand wollte.

## Und die langweilige: wie sich Leute anmelden

Enterprise Single Sign-on ist live über OpenID Connect, ausgerichtet auf den Identity Provider, den ein Kunde ohnehin betreibt.

Wir terminieren SAML bewusst nicht selbst. Der schwierige Teil von SAML ist die Verifikation einer signierten Antwort – Kanonisierung, Digest-Validierung, Signaturprüfung, wobei Claims aus dem tatsächlich verifizierten Teilbaum gelesen werden –, und ein Fehler an irgendeiner Stelle dieser Abfolge ist ein Signature-Wrapping-Authentifizierungs-Bypass, dessen entscheidende Eigenschaft ist, dass er genau wie ein funktionierender Login aussieht, bis jemand eine Assertion fälscht. Kunden richten ihren bestehenden IdP auf ein SSO-Gateway ihrer Wahl; nichts in unserem Schema nennt einen Anbieter.

Klar zu sagen, was man bewusst *nicht* implementiert hat, gehört zur Beantwortung von Frage zwei.

---

**Weiterführende Lektüre:** [Evermind – das selbstaktualisierende Modell](/blog/evermind-self-updating-model) · [Einblick in die Evermind-Architektur](/blog/inside-evermind-architecture) · [Sicherheit und Multi-Tenant-Architektur](/blog/security-and-multi-tenant-architecture)

Lesen Sie die [Evermind-Übersicht](/evermind) oder bringen Sie die Fragen in ein [Gespräch](/book-demo) mit.
