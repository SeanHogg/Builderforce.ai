## Der alte Workflow vs. der Agent-Workflow

**Der alte Workflow.** Sie schreiben eine boolesche Suche von Hand. Sie scrollen durch 200 Profile. Sie nehmen 15 in die engere Wahl. Sie formulieren für jede Person eine Ansprache von Hand. Sie stellen sich eine Kalendererinnerung für ein Follow-up in drei Tagen, eine weitere für sieben. Die zweite vergessen Sie. Die Hälfte Ihrer Kandidaten hört nie wieder etwas von Ihnen. Der ganze Prozess dauert zwei Stunden – für eine einzige Stelle.

**Der Agent-Workflow.** Sie fügen ein Briefing in einfacher Sprache ein – „wir suchen einen Senior Staff Infrastructure Engineer mit fundierter Erfahrung in Go und Kubernetes für ein Fintech in der Series C in NYC, 7+ Jahre“ – und der Agent liefert eine gerankte Kandidatenliste, eine personalisierte Ansprache für jede Person und eine geplante Follow-up-Sequenz. Fünf Minuten, eine Stelle.

Der AI Recruiter Agent ersetzt nicht Ihr Urteilsvermögen – er beseitigt die Tipparbeit zwischen Ihrem Urteil und der abgeschickten Nachricht.

## Schritt 1: Intake (Briefing → strukturierte Kriterien)

Rufen Sie `POST /api/recruiter/agent/intake` mit `{ briefText: "…" }` auf. Der Agent analysiert das Briefing und gibt strukturierte Kriterien zurück:

```json
{
  "jobTitle": "Senior Staff Infrastructure Engineer",
  "skills": ["go", "kubernetes", "terraform"],
  "location": "New York, NY",
  "experienceYears": 7,
  "maxCandidates": 20,
  "source": "brief"
}
```

Haben Sie bereits eine Stellenanzeige, übergeben Sie `{ jobId: "<uuid>" }`, und der Agent leitet dieselbe Struktur aus dem Datensatz der Stelle ab – Titel, Skills, Standort, wobei die Berufserfahrung aus der Beschreibung erschlossen wird.

Dieser Intake-Schritt ist das, was LinkedIn als Semantic Sourcing vermarktet: Statt `(go OR golang) AND kubernetes AND "New York"` zu tippen, beschreiben Sie die Stelle in normaler Sprache. Ist kein LLM-Schlüssel konfiguriert, läuft der Agent in einem rein heuristischen Modus – die Oberfläche liefert also immer eine brauchbare Kriterienstruktur. Das ist praktisch für die lokale Entwicklung und für eine kontrollierte Herabstufung, wenn der Modellanbieter ausfällt.

## Schritt 2: Sourcing (Kriterien → gerankte Kandidaten + Entwürfe für die Ansprache)

Leiten Sie die Intake-Antwort an `POST /api/recruiter/agent/source` weiter. Der Agent erledigt in einem einzigen Durchlauf drei Dinge:

1. **Sourcing** – er gleicht Kandidaten aus der Lebenslauf-Datenbank per Schlüsselwort mit den Skills aus den Kriterien ab.
2. **Bewertung** – er schickt jeden Kandidaten mit dem Kontext der Stelle durch das LLM und erhält einen Passungswert von 0–100 samt einer Begründung in einem Satz.
3. **Entwurf der Ansprache** – er erstellt für jeden Kandidaten eine personalisierte Ansprache für LinkedIn oder E-Mail in drei Sätzen, die sich auf den tatsächlichen Werdegang der Person bezieht, nicht auf eine generische Vorlage.

Der Durchlauf wird in `recruiter_agent_runs` gespeichert, sodass Sie ihn später über `GET /api/recruiter/agent/runs/:id` wieder aufrufen können. Die Ergebnisse sind absteigend nach Wert sortiert – prüfen Sie die Top 10, verwerfen Sie die unpassenden und gehen Sie mit dem Rest zu Schritt 3.

## Schritt 3: Follow-ups planen (verlässliche Taktung)

Bei manuellen Follow-ups gehen in 90 % der Recruiting-Workflows Kandidaten verloren. Die dritte Superkraft des Agents ist, sie dauerhaft festzuhalten.

Rufen Sie für jeden Kandidaten, bei dem Sie nachfassen möchten, `POST /api/recruiter/agent/followups/schedule` mit `{ runId, candidateId, dayOffset, body }` auf. Standardmäßig kommt das erste Follow-up nach 3 Tagen, das zweite nach 7 und das letzte nach 14. Passen Sie den Text an oder nutzen Sie den KI-generierten Entwurf.

Ein Cron-Worker (`recruiter-agent-followup`, läuft alle 5 Minuten) setzt fällige Einträge von `pending` auf `sent` und überführt die Erinnerung in Ihren `candidate_interactions`-Feed – so sehen Sie sie in Ihrem Dashboard, sobald der Zeitpunkt gekommen ist. Hat der Kandidat bereits geantwortet, stornieren Sie ein geplantes Follow-up mit `POST /api/recruiter/agent/followups/:id/cancel`.

Genau für diesen Teil verlangt LinkedIn Hiring Assistant Tausende Dollar pro Lizenz. Bei Builderforce ist er Teil des Pro-Tarifs, ohne Aufpreis pro Lizenz – den aktuellen Preis finden Sie auf der [Preisseite](/pricing).

## ROI-Rechnung: Was 5 Minuten pro Stelle einsparen

Konservative Schätzungen für einen Recruiter, der eine Stelle pro Tag besetzt, bei 20 Arbeitstagen im Monat:

- **Manueller Workflow:** ~2 Stunden pro Stelle × 20 Stellen = **40 Stunden / Monat** für Sourcing, Ansprache und Follow-up.
- **Agent-Workflow:** ~5 Minuten pro Stelle × 20 Stellen = **100 Minuten / Monat** für denselben Workflow.
- **Zurückgewonnene Zeit: ~38 Stunden / Monat** für Interviews, Abschlüsse und Teamführung statt für Tipparbeit.

LinkedIn-Charter-Kunden, die Hiring Assistant nutzen, berichten von 62 % weniger geprüften Profilen, über 4 eingesparten Stunden pro Stelle und einer um 69 % höheren InMail-Annahmequote. Der Agent von Builderforce führt denselben Kreislauf im Rahmen des Pro-Tarifs aus – ohne Zusatzgebühr für einen Hiring Assistant.

Der versteckte ROI ist die Follow-up-Taktung. Die meisten Recruiter verlieren mehr Kandidaten, weil sie das Nachfassen vergessen, als durch Absagen. Geplante Follow-ups bringen Ihnen effektiv +30 % oben im Funnel, ohne dass Sie eine einzige zusätzliche Ansprache verschicken.

## Häufig gestellte Fragen

### Verschickt der AI Recruiter Agent die Ansprache automatisch?

Noch nicht – der Agent legt die Nachricht derzeit als Entwurf in Ihrem Feed für Kandidateninteraktionen ab, und Sie versenden sie über den Kanal Ihrer Wahl (E-Mail, LinkedIn, SMS). Der automatische Versand über den Comm Hub steht auf der Roadmap (Gap Register #1206); die aktuelle Architektur hält den Recruiter bewusst in der Schleife, damit eine LLM-Halluzination keinen Kandidaten ohne Prüfung anschreiben kann.

### Was passiert, wenn der LLM-Anbieter ausfällt?

Der Intake-Endpunkt fällt auf eine deterministische Heuristik zurück, die Stelle, Skills (per Wörterbuchabgleich), Standort und Berufsjahre aus dem Briefing extrahiert. Der Sourcing-Endpunkt fällt für jeden Kandidaten auf einen Basiswert plus eine Vorlagen-Ansprache zurück. Die Oberfläche wird eingeschränkt, bricht aber nie mit einem Fehler ab.

### Worin unterscheidet sich das von einer booleschen Suche?

Eine boolesche Suche liefert alle, die auf die Schlüsselwörter passen. Der Agent rankt sie nach einer vom LLM ermittelten Passung, entwirft für jeden eine personalisierte Ansprache und plant Follow-ups – die drei Schritte, die aus einer Suche eine Einstellung machen. Boolesche Suchen können Sie weiterhin schreiben; der Agent setzt darauf auf.

---

**Jetzt ausprobieren:** [AI Recruiter Agent](/hires) auf Builderforce.
