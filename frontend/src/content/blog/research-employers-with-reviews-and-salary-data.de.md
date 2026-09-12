## Tool öffnen und in 10 Minuten einen Check vor dem Angebot durchführen

Öffnen Sie das [Tool zur Arbeitgeberrecherche](/tools/employer-research), und Sie sehen drei Eingabefelder: **Unternehmen**, **Rolle** und **Stadt**. Füllen Sie eine beliebige Kombination aus und klicken Sie auf „Recherche starten“ – das Tool führt die Suche nach Unternehmensbewertungen und die Gehaltsabfrage nach Rolle × Stadt parallel aus und zeigt beide Panels nebeneinander an.

Die meisten Bewerberinnen und Bewerber überspringen diesen Schritt und erfahren von den Schattenseiten des Unternehmens in Woche drei. Das Tool gibt es, damit Sie für denselben Check nicht zwischen drei Tabs hin- und herspringen müssen.

**Minute 1–3 – Bewertungen.** Geben Sie den Firmennamen ein. Das Unternehmens-Panel liefert bis zu 6 Treffer mit Gesamtbewertung und Anzahl der Bewertungen. Klicken Sie bei einem Treffer auf *Bewertungen*, um zur vollständigen Bewertungsseite (`/companies/{slug}/reviews`) zu gelangen und die sechs Teilbewertungen zu lesen: Kultur, Führung, Work-Life-Balance, Vergütung, Karriereentwicklung, Diversität. Liegt eine einzelne Achse mehr als 1,0 unter dem Gesamtdurchschnitt, sollten Sie genau dort in der finalen Runde nachhaken.

**Minute 4–6 – Gehalt nach Rolle × Stadt.** Geben Sie Ihre Zielrolle und die Stadt ein. Das Gehalts-Panel zeigt die Bandbreite aus unterem Wert, Median und oberem Quartil – modelliert aus Rolle, Senioritätsstufe, Region und Arbeitsmodell, mit jedem aufgeführten Multiplikator. So ist die Zahl eine, über die Sie diskutieren können, statt einer, der Sie blind vertrauen müssen. Klicken Sie auf *Vollständigen Gehaltsguide öffnen*, um dieselbe Rolle in allen anderen Städten unter `/salary/{role}/{city}` zu sehen.

**Minute 7–10 – Abgleich.** Durchsuchen Sie auf der vollständigen Bewertungsseite die schriftlichen Bewertungen nach den Stichwörtern *Vergütung* oder *Gehalt*. Eine hohe Vergütungsbewertung kombiniert mit einem marktgerechten Angebot laut Gehalts-Panel ist grünes Licht. Eine niedrige Vergütungsbewertung kombiniert mit einem Angebot unter Marktniveau ist ein klares Signal: verhandeln oder absagen.

## Was die sechs Teilbewertungen tatsächlich bedeuten

Glassdoor arbeitet mit einer einzigen Gesamtbewertung. Builderforce teilt die Bewertung auf sechs Achsen auf, weil Beschäftigte selten ein einheitliches Urteil abgeben:

- **Kultur** – Teamdynamik im Alltag, psychologische Sicherheit, sozialer Umgangston
- **Führung** – Kompetenz und Verlässlichkeit von Führungskräften und Management
- **Work-Life-Balance** – tatsächlich erwartete Arbeitszeiten, Normen für Wochenenden und Rufbereitschaft
- **Vergütung** – Bezahlung im Marktvergleich und Bonusstruktur
- **Karriereentwicklung** – Beförderungstempo, Mentoring, interne Wechselmöglichkeiten
- **Diversität & Inklusion** – Repräsentation und gelebte Chancengleichheit

Bei einer Gesamtbewertung von 4,0 ist die *Form* wichtiger als die Zahl. Eine 4,0 aus (5, 5, 2, 5, 5, 2) ist etwas ganz anderes als eine aus (4, 4, 4, 4, 4, 4). Die erste steht für eine großartige Kultur mit brutalen Arbeitszeiten und einem homogenen Team; die zweite für einen soliden, ausgewogenen Arbeitgeber.

Sortieren Sie Bewertungen beim Lesen nach „Neueste“ – Unternehmen verändern sich schneller, als Jahresdurchschnitte es abbilden.

## Gehaltsguides: Warum die Zahlen anders sind als bei Glassdoor

Die Gehaltsguides von Builderforce basieren auf **aktiven Stellenanzeigen** auf der Plattform, nicht auf anonymen Selbstauskünften. Das hat drei praktische Folgen:

1. **Das Modell ist nachvollziehbar.** Ein zusammengetragener Durchschnittswert nennt Ihnen eine Zahl, aber nicht, wie sie zustande kam. Jede Bandbreite hier weist den Ankerwert und jeden darauf angewandten Multiplikator aus – so können Sie prüfen, ob die Annahme zu Ihrer Region oder Senioritätsstufe die ist, die Sie selbst getroffen hätten.

2. **Die Methode ist transparent.** Jede Gehaltsseite nennt den Ankerwert und die Multiplikatoren hinter der Bandbreite. Über ein Modell, das man einsehen kann, lässt sich argumentieren – über einen undurchsichtigen Durchschnitt nicht. Passt der regionale Multiplikator nicht zu Ihrem Markt, können Sie das mit einem konkreten Einwand sagen.

3. **Die Stadt macht den Unterschied.** `/salary/product-manager/austin` ist eine völlig andere Zahl als `/salary/product-manager/san-francisco`, selbst bei Unternehmen derselben Größenordnung – und der Vergütungs-Benchmark, gegen den Sie verhandeln sollten, ist der auf Stadtebene, nicht der landesweite Durchschnitt.

Nutzen Sie die Links zu verwandten Städten und Rollen unten auf jeder Gehaltsseite für einen schnellen Perspektivwechsel: „Was zahlt dieselbe Rolle in Seattle?“ oder „Was verdient ein Staff Engineer in dieser Stadt im Vergleich zu einem Principal?“

## Drei Verhandlungsstrategien, die Sie heute einsetzen können

Sobald das Tool beide Panels gefüllt hat, haben Sie genug in der Hand für jede dieser Strategien:

**Strategie 1 – Der Marktverweis.** Zeigt das Gehalts-Panel, dass Ihr Angebot unter dem städtischen Durchschnitt für Ihre Rolle liegt, antworten Sie: „Vielen Dank für das Angebot. Laut aktiven Stellenanzeigen für diese Rolle in {city} liegt der Durchschnitt bei {fmt(avg)}. Ich würde das Gespräch gern an dieser Zahl ausrichten.“ Verweisen Sie auf die URL `/salary/{role}/{city}` hinter dem Button *Vollständigen Gehaltsguide öffnen*. Damit verschiebt sich die Beweislast von „Warum ich mehr möchte“ zu „Warum Ihr Angebot unter Marktniveau liegt“.

**Strategie 2 – Der Schwenk über die Bewertungen.** Liegt die Vergütungsachse auf der Bewertungsseite unter 3,5, akzeptieren Sie, dass Vergütung nicht die Stärke dieses Unternehmens ist – und verhandeln Sie hart über das, was es *ist*. Liegt die Karriereentwicklung bei 4,7, fordern Sie einen klaren Beförderungspfad und ein Review nach 6 Monaten mit festgelegter Gehaltserhöhung. Liegt die Work-Life-Balance bei 4,5, fordern Sie eine ausdrückliche Remote-Work-Zusage.

**Strategie 3 – Das veraltete Angebot auffrischen.** Ist Ihr Angebot 2+ Wochen alt und zeigt das Gehalts-Panel inzwischen ein höheres Marktniveau, schreiben Sie: „Seit unserem letzten Gespräch habe ich mir die aktuellen Gehaltsbänder für vergleichbare Rollen in {city} angesehen. Ich würde das Angebot gern noch einmal besprechen, um es am {percentile}. Perzentil auszurichten.“ Das wirkt am besten in Städten, in denen die Gehaltsguides innerhalb der Zeit, in der Ihr Angebot offen ist, aktualisiert wurden.

Alle drei Strategien funktionieren besser, wenn das Unternehmen merkt, dass Sie Ihre Hausaufgaben gemacht haben. Eine Builderforce-URL aus dem Tool signalisiert, dass Sie sich auf einen öffentlichen Benchmark stützen, nicht auf eine Wunschvorstellung.

## Wann Sie Bewertungen vertrauen sollten – und wann nicht

Vertrauen Sie dem Signal eher, wenn:
- die Zahl der Bewertungen bei **10+** liegt und der veröffentlichte Durchschnitt über die jüngsten Bewertungen stabil ist
- die Teilbewertungen **in sich stimmig** mit den schriftlichen Pros, Contras und Ratschlägen sind
- die Bewertungen von **mehreren Jobtiteln** im Unternehmen stammen, nicht nur aus einem Team

Gewichten Sie das Signal geringer, wenn:
- die Zahl der Bewertungen **unter 5** liegt (eine einzige schlechte Bewertung verzerrt den Durchschnitt)
- dieselbe Beschwerde in **exakt denselben Worten** wiederkehrt (oft eine koordinierte Welle nach Entlassungen)
- alle Bewertungen von **einem einzigen Jobtitel** stammen (vermutlich die schlechte Erfahrung eines Teams, nicht des ganzen Unternehmens)

Widersprechen sich Bewertungen und Gehaltsdaten – gute Bewertungen, aber Bezahlung unter Marktniveau –, ist die häufigste Erklärung ein Unternehmen, das in Equity bezahlt. Fragen Sie im Interview ausdrücklich nach der Höhe der Equity-Zuteilung und dem Vesting-Cliff.

## Häufig gestellte Fragen

### Sind die Unternehmensbewertungen bei Builderforce verifiziert?

Bewertungen sind an authentifizierte Nutzerkonten gebunden (eine Bewertung pro Nutzer und Unternehmen), und Bewertende können ein Abzeichen als verifizierte Beschäftigte erhalten, indem sie beim Bewerten ihre geschäftliche E-Mail-Domain bestätigen. Teilbewertungen werden als numerische Spalten gespeichert, sodass die Plattform Verschiebungen im Durchschnitt prüfen und verdächtige Häufungen markieren kann.

### Woher stammen die Gehaltsdaten?

Sie sind modelliert, nicht zusammengetragen. Ein Basisanker pro Fachgebiet wird nach Senioritätsstufe, Region und Arbeitsmodell angepasst, und jede Seite nennt die angewandten Multiplikatoren. Dadurch ist die Bandbreite reproduzierbar und überprüfbar – dieselben Eingaben ergeben immer dieselbe Zahl – und Sie sollten sie als gut begründeten Ausgangspunkt verstehen, nicht als Messung eines einzelnen Arbeitgebers.

### Was ist der Unterschied zwischen /salary/:role und /salary/:role/:city?

`/salary/:role` aggregiert über alle Städte in den USA und eignet sich als landesweiter Benchmark. `/salary/:role/:city` filtert auf eine Stadt – das ist die Zahl, gegen die Sie tatsächlich verhandeln sollten, denn die Vergütung schwankt zwischen den großen Tech-Hubs um 20–40 %.

---

**Jetzt ausprobieren:** [Arbeitgeberrecherche](/tools/employer-research) auf Builderforce.
