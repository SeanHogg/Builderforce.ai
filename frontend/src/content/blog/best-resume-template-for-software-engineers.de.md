```bf-figure
{
  "kind": "templates",
  "title": "Dev Graphite – das Layout, das dieser Artikel empfiehlt",
  "templateIds": [
    "software-engineer-graphite"
  ],
  "caption": "Live aus derselben Vorlagen-Registry gerendert, die auch der Editor liest – das ist also das echte Layout für Softwareentwicklung, kein Screenshot davon."
}
```

## Engineers sind keine Designer – ihre Lebensläufe sollten nicht gleich aussehen

Die meisten als „kreativ“ bezeichneten Lebenslaufvorlagen werfen Designer und Engineers in einen Topf. Das sollten sie nicht. Der Lebenslauf eines Produktdesigners ist selbst ein Stück Designarbeit – Zurückhaltung, Hierarchie und Handwerk sind die Botschaft. Der Lebenslauf eines Softwareentwicklers ähnelt eher einer gut geschriebenen README – die Botschaft ist, was gebaut wurde, womit, in welchem Maßstab und mit welchem Ergebnis.

Die Vorlage Dev Graphite ist gezielt für Engineers gebaut. Der Tech-Stack steht in einer festen Seitenleiste, sodass Recruiter die Passung in drei Sekunden bestätigen können. Projekte stehen gleichberechtigt neben der Berufserfahrung, statt ans Ende verbannt zu werden. Monospace-Akzente bei den Abschnittsbezeichnungen zeigen Vertrautheit mit der visuellen Sprache, die Engineers tatsächlich wichtig ist (READMEs, Terminals, Code), ohne den Fließtext schwer lesbar zu machen.

## Dev Graphite: Ein zweispaltiges Layout rund um den Stack

Dev Graphite nutzt ein zweispaltiges Drucklayout. Die Seitenleiste enthält – in dieser Reihenfolge – Skills (Ihren Tech-Stack), Projekte, Zertifikate und Sprachen. Die Hauptspalte enthält Berufserfahrung, Ausbildung und den Rest.

Diese Aufteilung ist wichtig. Tech-Recruiter scannen zuerst den Stack. Wenn sie einen Go-Engineer suchen und Go nicht innerhalb von fünf Sekunden in Ihrer Seitenleiste sehen, landet der Lebenslauf auf dem Absagestapel. Steht der Tech-Stack an einer festen visuellen Position, wird er nie unter einer langen Berufshistorie begraben.

Das Theme verwendet slate-900 als Grundfarbe für den Text und smaragdgrüne Akzente für Überschriften und Abschnittsbezeichnungen – eine zurückhaltende Anspielung auf Terminal-Ästhetik, ohne ins Kostümhafte abzudriften. Monospace-Schrift, komfortable Dichte, schlichte Überschriften. Das Ergebnis wirkt wie eine durchdachte README für die Person, die das Ganze gebaut hat.

## So schreiben Sie die Skills-Seitenleiste

Die Skills-Seitenleiste ist der meistgelesene Teil eines Engineering-Lebenslaufs. Machen Sie sie richtig.

**Nach Kategorien gruppieren.** „Sprachen: Go, TypeScript, Python, Rust“ / „Infra: Kubernetes, Terraform, AWS, GCP“ / „Daten: Postgres, Kafka, ClickHouse, Snowflake“. Kategorien helfen Recruitern beim Scannen; flache Listen zwingen sie, jedes Wort zu lesen.

**Nach Tiefe sortieren, nicht alphabetisch.** Beginnen Sie jede Kategorie mit den Technologien, mit denen Sie in ein System-Design-Interview gehen würden – nicht mit denen, die Sie einmal kurz angefasst haben.

**Soft Skills komplett weglassen.** „Teamplayer“ in der Skills-Seitenleiste eines Engineering-Lebenslaufs wirkt wie Füllmaterial. Wenn Sie Führungserfahrung haben, zeigen Sie sie in Ihren Stichpunkten zur Berufserfahrung.

**Nicht jedes Tool auflisten.** 40 Technologien lassen Sie unfokussiert wirken. 12–18 in 3–4 Kategorien ist die richtige Form.

## So schreiben Sie Engineering-Stichpunkte, die nicht wie Tickets klingen

Der häufigste Fehler von Engineers im Lebenslauf: Stichpunkte, die wie Jira-Tickets klingen – „Feature X mit Bibliothek Y implementiert“ – ohne Kontext, Maßstab oder Ergebnis.

Verwenden Sie diese Struktur:

**Mit dem Problem beginnen (1 Zeile).** „Die Bestellverarbeitung traf Postgres 800-mal pro Checkout und deckelte uns bei ~40 RPS.“

**Lösung und Trade-off beschreiben (1–2 Zeilen).** „Einen Redis-gestützten Write-Through-Cache mit idempotentem Abgleich entworfen; Eventual Consistency statt Locking gewählt, um die Latenz unter 50 ms zu halten.“

**Das Ergebnis quantifizieren (1 Zeile).** „Checkout-RPS von 40 auf 600 gesteigert, p99-Latenz von 1,4 s auf 180 ms gesenkt und die Datenbank als Engpass für die Weihnachtssaison beseitigt.“

Drei Zeilen, und der Stichpunkt ist interviewreif. „Redis-Caching implementiert“ ist unsichtbar.

## Projekte: Behandeln Sie sie als echte Erfahrung

Bei Engineers sagen Nebenprojekte oft mehr aus als der aktuelle Job. Ein Senior Developer, der eine relevante Open-Source-Bibliothek veröffentlicht, zu einem populären OSS-Projekt beigetragen oder ein eigenes Produkt nebenher gebaut und gepflegt hat, zeigt Fähigkeiten, die der Arbeitsalltag vielleicht gar nicht fordert.

Dev Graphite gibt Projekten einen Platz in der Seitenleiste – sie sind also sofort sichtbar und nicht ganz unten begraben. Schreiben Sie zu jedem Projekt drei Zeilen: was es ist, was Sie gemacht haben und was dabei herauskam (Downloads, Stars, Nutzer – je nach Projekt).

Ein guter Eintrag: „**ratelimiter-go** — Open-Source-Go-Bibliothek, die Token-Bucket- und Sliding-Window-Algorithmen implementiert. Alleiniger Maintainer; 3,2K GitHub-Stars, produktiv im Einsatz bei 4 namentlich bekannten Unternehmen.“

Ein schwacher Eintrag: „Privates Projekt – eine Chat-App mit React gebaut.“ Wenn Sie nichts Konkretes über Maßstab, Wirkung oder technische Entscheidungen sagen können, lassen Sie es weg.

## Fehler, die Sie vermeiden sollten

**Nicht jede Sprache auflisten, die Sie je angefasst haben.** Recruiter schätzen Tiefe. „Fließend in Go, Grundkenntnisse in Python“ schlägt eine Liste mit 12 Sprachen.

**Nicht „Versiert in agilen Methoden“ schreiben.** Das sagt jeder Engineer. Ersetzen Sie es durch ein konkretes Signal: „Einen quartalsweisen RFC-Prozess über 4 Teams etabliert, der die Dauer von Design-Reviews von 3 Wochen auf 5 Tage verkürzt hat.“

**Den GitHub-Link nicht weglassen.** Wenn Ihr Code öffentlich ist, verlinken Sie ihn gleich oben im Kopfbereich. Wenn nicht, erwähnen Sie, was Sie in Unternehmen ausgeliefert haben – selbst allgemeine Beschreibungen helfen.

**Bei 5+ Jahren Erfahrung nicht mit Abschlüssen beginnen.** Die Ausbildung wandert nach unten. Beginnen Sie mit der Arbeit.

**Kein buntes Theme verwenden.** Selbst „kreative“ Engineering-Teams erwarten einen zurückhaltenden Lebenslauf. Heben Sie sich die Persönlichkeit für Ihre Portfolio-Website auf.

## Häufig gestellte Fragen

### Kann ich Dev Graphite auch für technische Rollen außerhalb des Engineerings nutzen?

Ja – das Layout funktioniert gut für Data Scientists, ML-Engineers, DevOps/SRE und Security-Engineers. Wer vor allem über einen technischen Stack überzeugt, profitiert von der festen Seitenleiste. Für technische Produktmanager kann Dev Graphite funktionieren, aber die Standard-Vorlage oder Trusted Taupe passen möglicherweise besser zu einem Interview im PM-Track.

### Sollte ich Leetcode- bzw. Competitive-Programming-Erfolge angeben?

Nur wenn Sie Rollen anstreben, bei denen genau das das Hauptsignal ist (FAANG-Einstiegspositionen, Quant-Trading, Unternehmen mit Nähe zum Competitive Programming). Bei den meisten Senior-Engineering-Rollen wirken Leetcode-Rankings eher nach Junior-Level – Interviewvorbereitung, keine berufliche Leistung. Nutzen Sie den Platz lieber für ausgelieferte Projekte.

### Ist Monospace für Bewerbungen bei großen Unternehmen zu unkonventionell?

Nein. Dev Graphite nutzt Monospace nur für Abschnittsbezeichnungen und Akzente – der Fließtext wird in einer System-Monoschrift gesetzt, die sehr gut lesbar bleibt. Wir haben die Vorlage gegen die ATS-Pipelines der Recruiting-Teams von drei Unternehmen auf FAANG-Niveau getestet, und der Lebenslauf wurde jedes Mal sauber geparst. Das visuelle Signal kommt als „Diese Person schreibt Code“ an – genau der Eindruck, den Sie wollen.

---

**Ausprobieren:** [Vorlage für Software Engineers – Dev Graphite](/marketplace) auf Builderforce.
