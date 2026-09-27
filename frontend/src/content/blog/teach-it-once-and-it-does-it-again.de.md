Jede Woche gibt es eine Aufgabe, die sich weder zu automatisieren noch zu erledigen lohnt.

Den Rechnungsbetrag des Lieferanten in die Buchhaltungs-App übertragen. Die Monatszahl aus einem Programm holen und in ein anderes tippen. Dieselben sechs Felder in einem Formular ausfüllen, das keine API, keinen Export und keine Integration hat – nur ein Fenster, durch das man sich klicken muss. Es sind zehn Minuten, es sind immer dieselben zehn Minuten, und erledigt werden sie nur, wenn ein Mensch davorsitzt.

KI-Werkzeuge versprechen, das für Sie zu tun. Die meisten brauchen eine API, eine Browser-Erweiterung oder ein Modell, das jedes Mal Pixel errät. Keines behält, was es darüber gelernt hat, wie *Sie* die Aufgabe erledigen.

Das ist die Lücke: **Arbeit, die in Desktop-Programmen steckt, ließ sich nicht beibringen – und nichts, das sie lernte, behielt die Lektion.**

## Einmal zeigen

Schalten Sie in Synapse die selbstständigen Agenten ein – bis dahin sind sie aus – und wählen Sie ein Programm. Synapse startet es und beobachtet nur dieses Programm, während Sie die Aufgabe einmal erledigen, so wie immer.

```bf-figure
{
  "kind": "flow",
  "title": "Von einer Vorführung zur Fähigkeit",
  "steps": [
    { "label": "Aufzeichnen", "note": "Synapse startet das Programm und zeichnet die Bedienelemente und Werte auf, die Sie nutzen – kein Tastenprotokoll. Passwortfelder werden nie erfasst.", "hue": "idea" },
    { "label": "Prüfen", "note": "Jeder Schritt mit Screenshot. Überflüssige Klicks entfernen, wählen, welche Werte jedes Mal erfragt werden und wo zuerst gefragt werden muss.", "hue": "idea" },
    { "label": "Train Once", "note": "Die Vorführung wird zur Fähigkeit: Eingaben werden benannte Werte, Geheimnisse Tresoreinträge, Senden und Löschen Freigabeschritte.", "hue": "make", "tag": "eine Vorführung" },
    { "label": "Ausführen", "note": "Auf Anfrage mit neuen Werten oder als Routine, während Synapse im Infobereich läuft. Mit Esc übernehmen Sie jederzeit die Maus.", "hue": "run" }
  ],
  "caption": "Nichts wird zur Fähigkeit, bevor Sie es geprüft haben. Aufgezeichnet wird ein Programm und nur während der Aufzeichnung."
}
```

Aufgezeichnet wird *Bedeutung*, keine Tastenanschläge: „Betrag in Rechnungen auf 250,00 setzen“, „Rechnung senden anklicken“. Deshalb läuft die Fähigkeit auch nächsten Monat, wenn das Fenster woanders liegt und der Betrag ein anderer ist.

## Es fragt vor allem, was sich nicht rückgängig machen lässt

Eine Fähigkeit, die **Senden**, **Bezahlen**, **Löschen** oder **Absenden** anklickt, hält an diesem Schritt an und fragt. Das Fenster kommt nach vorn, sagt genau, was es gleich tut, und wartet. Antwortet innerhalb von fünfzehn Minuten niemand, stoppt die Ausführung.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Ausführungen",
  "ratio": 1.5,
  "regions": [
    { "label": "„Monatsrechnung“ braucht Ihre Freigabe", "note": "Der nächste Schritt lässt sich nicht rückgängig machen: „Rechnung senden“ in „Rechnungen“ anklicken", "x": 20, "y": 14, "w": 60, "h": 34, "hue": "accent" },
    { "label": "Protokoll", "note": "Jeder Schritt jeder Ausführung: erledigt, per Position erledigt, freigegeben, abgelehnt, fehlgeschlagen", "x": 4, "y": 54, "w": 92, "h": 40, "hue": "run" }
  ],
  "caption": "Train Once setzt Freigabeschritte anhand der Beschriftung – in allen fünf Produktsprachen – und Sie können beim Prüfen welche hinzufügen oder entfernen."
}
```

Jede Ausführung behält ihr Protokoll – jeden Schritt, wie er erledigt wurde, was Sie entschieden haben –, sodass „Hat die Routine es wirklich abgelegt?“ eine lesbare Antwort hat.

## Ihr Evermind lernt den Ablauf

Das tut kein anderes Werkzeug. Jede gespeicherte Fähigkeit wird auch als der Ablauf aufgeschrieben, den ein Mensch notieren würde – die Aufgabe, dann nummerierte Schritte, Werte als Platzhalter –, und Ihr **privater Evermind** lernt daraus, einmal, auf Ihrem Rechner.

```bf-figure
{
  "kind": "compare",
  "title": "Was mit dem Beigebrachten passiert",
  "columns": [
    { "title": "Automatisierungswerkzeuge", "hue": "muted", "items": ["Ein Skript, das Klicks abspielt", "Weiß nichts über das Warum", "Liegt in den Einstellungen einer App", "Weg, sobald Sie das Werkzeug wechseln"] },
    { "title": "Synapse", "hue": "make", "items": ["Eine Fähigkeit, die nach neuen Werten fragt", "Ein Ablauf, den Ihr eigenes Modell gelernt hat", "Bei Ihren Erinnerungen gespeichert, geteilt von jedem verbundenen KI-Werkzeug", "Einzelnes oder alles jederzeit vergessen"] }
  ],
  "caption": "Vorführungen, Fähigkeiten, Ausführungen und Fakten liegen im selben lokalen Evermind-Speicher, den Ihre Coding-Agenten schon nutzen. Geheimnisse bleiben in der Windows-Anmeldeinformationsverwaltung."
}
```

Es ist derselbe Speicher, in dem sich Ihre Coding-Agenten bereits Fakten merken – alles, was Sie beibringen, liegt neben allem, was sie gelernt haben: auf Ihrem Computer, in Dateien, die Sie sehen können, mit einer Vergessen-Schaltfläche für jedes.

## Wo es in der Methode sitzt

Arbeit auf Builderforce folgt einem Bogen – **Idee → Machen → Betreiben → Messen** – und jeder Akt läuft durch dieselbe innere Schleife: [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop).

Selbstständige Agenten gehören zu **Betreiben**. Dort geschieht wiederkehrende Arbeit entweder verlässlich oder hört unbemerkt auf – und Arbeit in Desktop-Programmen hatte bisher gar keinen Weg dorthin. Eine Aufgabe einmal beizubringen bringt sie auf den Bogen.

In der Schleife ist das Prüfen der Schritt **Beweisen**: Vor dem teuren Akt – ein Programm Maus und Tastatur selbst steuern zu lassen – sehen Sie jeden Schritt, was erfragt wird und wo angehalten wird. Gebaut wird erst danach, und der Freigabeschritt hält das Beweisen genau dort aufrecht, wo ein Fehler nicht rückgängig zu machen ist. **Messen** ist das Protokoll: jede Ausführung, jeder Schritt, jede Entscheidung, festgehalten.

## Was Sie heute damit tun können

- **Eine wiederkehrende Aufgabe in einem beliebigen Windows-Programm beibringen**, indem Sie sie einmal erledigen, und sie mit neuen Werten erneut ausführen.
- **Sie als Routine einplanen** – alle paar Minuten oder jeden Tag um neun – und Synapse sie aus dem Infobereich erledigen lassen.
- **Die unumkehrbaren Schritte bei sich behalten**: Senden, Zahlungen und Löschen warten auf Ihre Freigabe.
- **Ihrem eigenen Modell die gezeigten Abläufe beibringen**, auf Ihrem Rechner, und alles davon vergessen, wann immer Sie wollen.

Aufzeichnen und Wiedergeben funktionieren zuerst unter Windows; macOS und Linux folgen. [Synapse herunterladen](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) und die selbstständigen Agenten auf der Seite „Beibringen“ einschalten.

---

**Weiterlesen:** [Ein lokaler Index für jedes KI-Werkzeug auf Ihrem Rechner](/blog/one-local-index-for-every-ai-tool) · [Lesen, Beweisen, Bauen – die innere Schleife](/blog/read-prove-build-the-inner-loop)
