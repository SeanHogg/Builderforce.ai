Zwei Vokabulare, jedes für sich korrekt, nebeneinander und ohne etwas dazwischen.

Hiring besaß den Trichter: Ausschreibung, Screening, Interview, Angebot. People besaß das Beschäftigungsverhältnis: Mitarbeiter, Lebenszyklus, Onboarding, Beurteilungen. Beide Kopfzeilen beschrieben den Übergang zwischen ihnen mit denselben Worten – *„aus einem Angebot wird ein Mitarbeiter“*. Keines führte ihn aus. Das Produkt lieferte zwei Trichter, die eine Handbreit voneinander entfernt endeten, und die Lücke füllte eine Person, die Felder von einem Bildschirm auf den anderen kopierte.

## Die Übergabe und ihre drei Verweigerungen

```bf-figure
{
  "kind": "flow",
  "title": "Angebot → Mitarbeiter, in einem Schritt",
  "steps": [
    { "label": "Unterschriebenes Angebot", "note": "Der Auslöser. Keine mündliche Zusage, kein Angebot im Entwurf – ein unterschriebenes.", "hue": "reach" },
    { "label": "Fakten übertragen", "note": "Titel, Standort und Grundlage aus der Ausschreibung; Skills und Belege vom Kandidaten; Startdatum aus dem Angebot. Nichts erfunden.", "hue": "run" },
    { "label": "Mitarbeiter + Lebenszyklus", "note": "Der Beschäftigungsdatensatz und der Onboarding-Plan, gemeinsam erstellt und mit dem Angebot verknüpft, aus dem sie stammen.", "hue": "measure" }
  ],
  "caption": "Die Übergabe gehört zu KEINEM der beiden Vokabulare. Im Vokabular der Recruiter würde sie Hiring HR-Datensätze verfassen lassen; im Vokabular von HR würde sie HR die Felder der Recruiter lesen lassen. Sie wird einmal deklariert, zwischen ihnen."
}
```

Sie verweigert sich in drei Fällen, und jede Verweigerung ist von der nützlichen Art:

- **Das Angebot ist nicht unterschrieben.** Ein Beschäftigungsdatensatz, der auf einem nicht unterschriebenen Angebot beginnt, ist die Aufzeichnung von etwas, das nicht stattgefunden hat.
- **Es ist keine Person verknüpft.** Ein Mitarbeiter ohne Kandidaten dahinter ist der Ort, an dem ein doppelter Personendatensatz geboren wird.
- **Es gibt kein Startdatum.** Ein Lebenszyklus ohne Ankerdatum hat überhaupt keine Fälligkeitsdaten, sodass jede Onboarding-Aufgabe darin stillschweigend ohne Termin bleibt.

Sie wirft einen Fehler, statt ein halb befülltes Paar zu erzeugen, denn eine halbe Einstellung ist schlimmer als keine – Sie bemerken es drei Wochen später, wenn die Gehaltsabrechnung fragt, wer das ist.

Zusätzlich ist nun jeder bewertete Lebenslauf an einen echten Kandidaten gebunden. Ein Dokument zu bewerten, das niemandem gehört, erzeugt eine Zahl, mit der man nichts anfangen kann, und ein Haufen davon erzeugt eine Shortlist, die niemand zusammenstellen kann.

## Das HR-System lesen, das Sie bereits betreiben

Der Katalog konnte eine Stellenausschreibung nach außen veröffentlichen und einen Gehaltslauf zurücklesen, hatte aber keinerlei Möglichkeit, Ihre **eigenen** Leute zu lesen. Mitarbeiter, Rollenzuweisungen, Kapazität und jede Headcount-Zahl, die die Lieferansichten zeigen, wurden von Hand eingetippt – und „wer arbeitet hier eigentlich“ lebte in einem System, das dieses Produkt nicht erreichen konnte.

```bf-figure
{
  "kind": "stack",
  "title": "Sieben Arten, „wer arbeitet hier“ zu beantworten",
  "bands": [
    { "label": "Workday", "note": "Worker, Organisation, Zuweisungen.", "hue": "run" },
    { "label": "BambooHR · HiBob · Personio", "note": "Die drei des Mittelstands, jedes mit eigener Vorstellung von einem Beschäftigungsdatensatz.", "hue": "run" },
    { "label": "SAP SuccessFactors", "note": "Für die Landschaften, in denen das HR-System älter ist als das Produkt, das es beschreibt.", "hue": "run" },
    { "label": "Greenhouse", "note": "Die ATS-Seite – Kandidaten und Pipelines, gelesen neben den Personen, zu denen sie werden.", "hue": "reach" },
    { "label": "SCIM-2.0-Verzeichnis", "note": "Der generische Reader, für alles, was nicht auf dieser Liste steht.", "hue": "muted" }
  ],
  "caption": "Jede Aktion in der Kategorie ist ein LESEZUGRIFF, und ein Test lässt den Build fehlschlagen, sollte das je nicht mehr stimmen."
}
```

Diese letzte Zeile ist die Designentscheidung, kein Implementierungsdetail. Ein HR-System ist das System of Record für das Beschäftigungsverhältnis von Menschen. Ein Tool, das darauf schreiben kann, ist ein Tool, das stillschweigend das Gehalt, den Titel oder das Austrittsdatum einer Person falsch setzen kann, und der Wirkungsradius davon ist das Leben eines Menschen und kein Dashboard. Nur-Lesen wird erzwungen, getestet und dort angegeben, wo jeder, der integriert, es sehen kann.

## Was sich an einer Headcount-Zahl ändert

```bf-figure
{
  "kind": "compare",
  "title": "Woher eine Kapazitätszahl stammt",
  "columns": [
    { "title": "Getippt", "hue": "bad", "items": ["Richtig am Tag der Eingabe", "Falsch nach dem ersten Abgang", "Niemand weiß, wann sie zuletzt geprüft wurde", "Also vertraut niemand dem darauf aufgebauten Plan"] },
    { "title": "Gelesen", "hue": "good", "items": ["Stammt aus dem System, dem der Fakt gehört", "Bewegt sich, wenn sich die Organisation bewegt", "Trägt ihre Herkunft mit sich", "Ein darauf aufgebauter Plan lässt sich hinterfragen"] }
  ],
  "caption": "Dieselbe Regel wie beim Alter einer Rechnung oder dem Prozentsatz in einer Cap Table: Eine Zahl, die getippt werden kann, ist eine Zahl, die irgendwann der Realität widersprechen wird."
}
```

Beide Hälften gehören zur selben Phase des Bogens: Market heißt *verkaufen, kaufen, einstellen, gefunden werden*, und Run ist das, was geschieht, sobald die Person tatsächlich auf der Gehaltsliste steht. Die Übergabe ist die Naht zwischen ihnen, und sie ist jetzt etwas, das das Produkt ausführt, statt es nur zu beschreiben.

---

**Weiterführende Lektüre:** [Das Founder Back Office](/blog/the-founder-back-office-money-ownership-and-paperwork) · [So bauen Sie ein Organigramm, das aktuell bleibt](/blog/how-to-build-an-org-chart-that-stays-accurate) · [Strukturierte Scorecards und Blind Review](/blog/structured-scorecards-and-blind-review-to-reduce-hiring-bias)

Sehen Sie sich den [Integrationskatalog](/integrations) an oder [öffnen Sie einen Canvas](/create) und stellen Sie den Trichter neben die Arbeit, für die er Personal besorgt.
