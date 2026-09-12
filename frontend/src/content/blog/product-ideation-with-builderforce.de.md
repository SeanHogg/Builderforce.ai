> **Produkt-Update:** Brainstorm, der Workflow Builder und der IDE-Launcher sind keine eigenständigen Hauptziele für neue Arbeit mehr. Ihre Fähigkeiten erscheinen jetzt als Live-Objekte in einem [Creation Canvas](/creation-canvas). Bestehende Links funktionieren weiterhin, neue Arbeit sollte jedoch in einer Creation Session beginnen.

Jedes Produkt beginnt mit einer Idee und endet – mit etwas Glück – mit etwas Ausgeliefertem. Die Lücke zwischen diesen beiden Momenten ist der Ort, an dem die meisten Ideen sterben: unklare Anforderungen, ausufernder Scope, die falschen Leute an den falschen Aufgaben.

Builderforce ist darauf ausgelegt, diese Lücke zu schließen. Dieser Artikel dokumentiert den ursprünglichen Workflow über mehrere Oberflächen hinweg und erklärt die Konzepte, die zu seinem Nachfolger geführt haben: einer einzigen visuellen Creation Session, in der Brain-Gespräch, Prototypen, Code, Projekte, Tasks und engagierte Agents miteinander verbunden bleiben.

![Ideation-Pipeline von Brainstorm über die Strukturierung in der IDE und die Timeline bis zum Engagieren von Workforce-Agents, Review und Auslieferung](/blog/product-ideation.svg)

---

## Das Szenario

Stellen Sie sich vor, Sie möchten ein **SaaS-Tool bauen, mit dem Freelancer ihre Zeit erfassen und automatisch Rechnungen erstellen**. Sie haben den Keim einer Idee, sonst nichts: keine Spezifikation, kein Design, kein Team.

Machen wir mit Builderforce aus diesem Keim einen umsetzbaren Plan.

---

## Schritt 1: Die Idee mit Brainstorm festhalten und ausbauen

Starten Sie in Ihrem [Dashboard](/dashboard), legen Sie ein neues Projekt an – nennen Sie es *„Freelance Time & Invoice Tool“* – und öffnen Sie den Tab **Brainstorm**.

Brainstorm ist ein KI-moderierter Ideation-Workspace. Anders als ein leeres Dokument macht er aktiv mit: Er stellt Rückfragen, legt Annahmen offen und baut Ihre Idee zu strukturierten Artefakten aus.

### Eine Brainstorm-Session durchführen

Geben Sie Ihre Ausgangsidee in den Brainstorm-Prompt ein:

> „Ein SaaS-Tool, mit dem Freelancer abrechenbare Zeit erfassen und automatisch Rechnungen erstellen. Es soll einfach und mobilfreundlich sein und für Zahlungen mit Stripe integrieren.“

Builderforce antwortet mit einer strukturierten Ausarbeitung:

- **Kernproblem der Nutzer** – Freelancer verlieren Umsatz, weil die Zeiterfassung manuell läuft und das Erstellen von Rechnungen Zeit frisst
- **Zielgruppen** – Solo-Freelancer, kleine Agenturen (2–10 Personen)
- **Zentrale Jobs-to-be-done** – Timer starten/stoppen, Zeit Kunden/Projekten zuordnen, PDF-Rechnungen erzeugen, Zahlungen einziehen
- **Mögliche Differenzierungsmerkmale** – KI-Vorschläge für Stundensätze, automatische Zahlungserinnerungen, Kalender-Sync
- **Risiken und Annahmen** – Akzeptanz von Stripe, mobile Nutzungsmuster, Zahlungsbereitschaft gegenüber kostenlosen Alternativen

### Mit Folgefragen verfeinern

Brainstorm-Sessions sind dialogisch. Sie können weiterbohren:

> „Wer sind die drei wichtigsten Wettbewerber, und wie sollte ich mich abgrenzen?“

> „Was ist die einfachste mögliche v1, die echten Nutzen liefert?“

> „Zerlege das MVP in User Stories.“

Jede Antwort baut auf dem bisherigen Kontext auf, sodass Ihre Ideenfindung kumulativ statt bruchstückhaft verläuft. Nach einer 20-minütigen Session haben Sie in der Regel:

- eine klare **Problemstellung**
- eine priorisierte **Feature-Liste**
- eine Reihe von **User Stories**, bereit fürs Backlog
- ein erstes **Risikoregister**

Exportieren Sie die Session als Markdown direkt in den IDE-Workspace Ihres Projekts.

---

## Schritt 2: Den Plan in der IDE strukturieren

Öffnen Sie den Tab **IDE**. Im Datei-Explorer finden Sie den Brainstorm-Export. Nutzen Sie nun den KI-Chat der IDE, um aus dem rohen Markdown strukturierte Projektartefakte zu machen.

### Ein Product Requirements Document erzeugen

Bitten Sie den KI-Chat:

> „Mach aus dem Brainstorm-Ergebnis ein strukturiertes PRD mit den Abschnitten: Überblick, Ziele, Nicht-Ziele, User Stories, technische Rahmenbedingungen und Erfolgskennzahlen.“

Die KI entwirft das PRD direkt im Editor. Sie prüfen, bearbeiten und speichern es als `docs/PRD.md`.

### Eine Skizze der technischen Architektur erzeugen

Fahren Sie im selben Chat-Thread fort:

> „Schlage auf Basis des PRD eine schlanke technische Architektur vor: welche Services wir brauchen, wie sie kommunizieren und wie das Datenmodell aussieht.“

Die Antwort liefert Ihnen ein erstes Architekturdiagramm (als Mermaid-Markup) und einen Vorschlag für den Stack. Speichern Sie es als `docs/ARCHITECTURE.md`.

### Ein Backlog anlegen

Fordern Sie ein Backlog in strukturierter Form an:

> „Wandle die User Stories aus dem PRD in ein Backlog um – als Markdown-Tabelle mit den Spalten: Story-ID, Beschreibung, Priorität (P0/P1/P2), geschätzter Aufwand (S/M/L), Abhängigkeiten.“

Prüfen Sie die Tabelle, passen Sie Prioritäten an und speichern Sie sie als `docs/BACKLOG.md`.

Damit haben Sie eine lebendige Projektdokumentation, die vollständig in der IDE erzeugt und gepflegt wird – ganz ohne separate Tools.

---

## Schritt 3: Die Timeline planen

Wechseln Sie zum Tab **Timeline**. Das ist der visuelle Meilensteinplaner von Builderforce.

Mit Ihrem Backlog in der Hand legen Sie Meilensteine an:

| Meilenstein | Schwerpunkt | Ziel |
|---|---|---|
| **M1 – Kern-Timer** | Timer starten/stoppen, Kunden/Projekten zuordnen | Woche 2 |
| **M2 – Rechnungserstellung** | PDF-Rechnungen erzeugen und herunterladen | Woche 4 |
| **M3 – Stripe-Integration** | Zahlungseinzug und Statusverfolgung | Woche 6 |
| **M4 – Mobiler Feinschliff** | Responsive UI, PWA-Unterstützung | Woche 8 |
| **M5 – Launch** | Beta-Einladungsliste, Onboarding, Preisseite | Woche 10 |

Die Timeline-Ansicht zeigt Ihren Plan im Gantt-Stil. Sie können Meilensteine per Drag-and-drop verschieben und blockierte Elemente markieren. So wird sie zur einzigen verlässlichen Quelle für Ihren Lieferrhythmus.

---

## Schritt 4: Spezialisierte Agents aus der Workforce engagieren

Mit einem klaren Plan stellt sich die nächste Frage: *Wer macht die Arbeit?*

Statt sofort Entwickler einzustellen (oder alles selbst zu machen), verändert hier die [Workforce Registry](/workforce) die Rechnung.

### Einen UX-Research-Agent engagieren

Ihre erste Unbekannte ist das Nutzerverhalten. Bevor Sie eine Zeile Code schreiben, wollen Sie Ihre Annahmen darüber prüfen, wie Freelancer ihre Zeit heute tatsächlich erfassen.

Suchen Sie in der Workforce nach einem **UX-Research**-Agent. Engagieren Sie `ux-researcher-v2` für Ihr Projekt. Weisen Sie ihm einen Task zu:

> „Prüfe das PRD und identifiziere die fünf Annahmen über Nutzerverhalten mit dem höchsten Produktrisiko. Schlage für jede eine schnelle Validierungsmethode vor (Umfrage, Prototyp-Test, Wettbewerbsanalyse usw.).“

Innerhalb von Minuten haben Sie einen strukturierten Research-Plan – ganz ohne UX-Researcher auf der Gehaltsliste.

### Einen Frontend-Architektur-Agent engagieren

Für den technischen Aufbau engagieren Sie einen Spezialisten für **Frontend-Architektur**. Weisen Sie ihm zu:

> „Setze auf Basis des Architekturdokuments ein Next.js-15-Projekt mit TypeScript, Tailwind CSS, Stripe-Integration und einem Supabase-Backend auf. Lege die initiale Dateistruktur und den Routing-Plan an.“

Der Agent liefert ein Starter-Grundgerüst und eine ausführliche Einrichtungsanleitung. Ihr eigener Entwicklungsaufwand sinkt drastisch, weil die strukturellen Entscheidungen bereits getroffen sind.

### Einen Copywriting-Agent engagieren

Ein Produkt ohne Worte ist unsichtbar. Engagieren Sie einen **Copywriter**-Agent und weisen Sie ihm zu:

> „Schreibe Headline, Subline, Feature-Beschreibungen (drei Features) und einen Preisabschnitt für die Landingpage eines Zeiterfassungs-SaaS für Solo-Freelancer. Ton: freundlich, professionell, ohne Fachjargon.“

Feilen Sie in der IDE an den Texten, bis Sie zufrieden sind. Exportieren Sie sie anschließend für die Übergabe ans Design.

### Koordination über das Task-Panel

Je mehr Agents in Ihrem Projekt arbeiten, desto mehr wird das **Task-Panel** zu Ihrer Koordinationszentrale. Jeder Task zeigt:

- welchem Agent er zugewiesen ist
- den aktuellen Status (in der Warteschlange, in Arbeit, abgeschlossen, blockiert)
- Eingabe- und Ausgabeartefakte
- Zeit- und Token-Kosten

Auf einen Blick sehen Sie, ob UX-Research, technisches Grundgerüst und Texte parallel vorankommen – genau so, wie Sie das Sprint-Board eines echten Teams verfolgen würden.

---

## Schritt 5: Prüfen, iterieren und ausliefern

Ideenfindung ist kein einmaliges Ereignis. Während das Projekt voranschreitet:

- **Kehren Sie zu Brainstorm zurück**, wenn Sie an einem Entscheidungspunkt frische Gedanken brauchen
- **Aktualisieren Sie PRD und Backlog** in der IDE, wenn sich Anforderungen ändern
- **Engagieren Sie neue spezialisierte Agents**, wenn neue Kompetenzlücken entstehen
- **Passen Sie die Timeline erneut an**, wenn Sie merken, was länger dauert als erwartet

Der gesamte Zyklus – Ideen entwickeln, planen, zuweisen, bauen, prüfen – findet in einem einzigen Builderforce-Projekt statt. Kein Tool-Wechsel, kein Kontextverlust.

---

## Der Zinseszins-Vorteil

Die entscheidende Erkenntnis: **Jeder Agent, den Sie trainieren, und jede Session, die Sie durchführen, macht die Plattform für Sie klüger.**

- Brainstorm-Sessions werden zu einer durchsuchbaren Wissensbasis Ihres Denkens
- Trainierte Agents verankern die Konventionen und Vorlieben Ihres Teams dauerhaft
- Die von der Community veröffentlichten Agents in der Workforce werden mit der Zeit besser und spezialisierter

Wer seine Ideenfindung hier beginnt, bringt nicht nur dieses Projekt schneller zum Ziel – er baut ein organisationales Gedächtnis auf, das jedes folgende Projekt beschleunigt.

---

## Starten Sie Ihre nächste Idee

1. **[Legen Sie ein neues Projekt an](/dashboard)** und öffnen Sie den Tab Brainstorm
2. Geben Sie Ihre Ausgangsidee ein und lassen Sie die KI sie ausbauen
3. Exportieren Sie in die IDE und strukturieren Sie PRD und Backlog
4. Planen Sie Meilensteine in der Timeline
5. Engagieren Sie spezialisierte Agents aus der [Workforce Registry](/workforce), die parallel umsetzen

Der beste Zeitpunkt zum Starten war gestern. Der zweitbeste ist jetzt. 🚀
