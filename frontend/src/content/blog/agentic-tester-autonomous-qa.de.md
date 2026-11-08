Testabdeckung verfällt in dem Moment, in dem Sie aufhören, Tests zu schreiben – und niemand schreibt Tests für die Abläufe, die Nutzer tatsächlich am häufigsten durchlaufen. Man schreibt sie für den Code, der leicht zu testen war. Die Lücke zwischen „was wir testen“ und „was Nutzer tun“ ist der Ort, an dem Produktionsfehler leben.

Der **Agentic Tester** ist ein einstellbarer QA-Agent, der gebaut wurde, um diese Lücke selbstständig zu schließen. Richten Sie ihn auf die URL Ihrer App, hinterlegen Sie die Logins, die er verwenden soll, und er erkennt anhand der realen Nutzung, was wichtig ist, schreibt die Tests, führt sie nach Zeitplan in einem echten, authentifizierten Browser aus und legt seine Funde direkt auf Ihrem Board ab.

> Der Agentic Tester ist ein autonomer QA-Agent: Er priorisiert anhand realer Nutzungs-Heatmaps, was getestet wird, erzeugt Playwright-Specs, steuert nach Zeitplan einen echten, authentifizierten Browser durch Ihre meistgenutzten Abläufe und legt die gefundenen Bugs auf Ihrem Board ab, damit ein Fix-Agent sie aufgreift.

![Pipeline von links nach rechts: Eine Nutzungs-Heatmap priorisiert die meistgenutzten Abläufe, ein LLM erzeugt eine Playwright-Spec, ein containerisierter Browser meldet sich an und durchläuft den Ablauf per nächtlichem Cron, Funde werden als priorisierte Board-Aufgaben angelegt, und ein Fix-Agent öffnet einen Pull Request](/blog/agentic-tester-qa.svg)

## Er testet, was Nutzer tatsächlich tun

Die meisten Test-Suites sind eine Vermutung darüber, was wichtig ist. Der Agentic Tester vermutet nicht – er beobachtet. Aus Ihrer App erfasste Journey-Events werden zu einer **Nutzungs-Heatmap** der Routen- und Element-Zonen gerankt, mit denen Menschen am meisten interagieren, nach Aktualität gewichtet. Plant er eine Exploration, greift er zuerst auf die heißesten Zonen zurück, innerhalb eines von Ihnen festgelegten Budgets. Die Abläufe mit der meisten Abdeckung sind die Abläufe, in denen Ihre Nutzer zu Hause sind.

## Er schreibt seine Playwright-Tests selbst

Aus einem Ablauf erzeugt der Generator mit einem LLM eine ausführbare **Playwright-Spec** und löst dabei auf, mit welchen Persona-Zugangsdaten er sich anmeldet. Sie können ihn auch einen deterministischen Plan direkt aus der Heatmap erstellen lassen, ganz ohne Modellkosten. In beiden Fällen ist das Ergebnis echter Browser-Automatisierungs-Code – kein brüchiges Record-and-Replay-Skript –, der pro Projekt gespeichert und versioniert wird.

## Er meldet sich an und steuert einen echten Browser

Die Exploration läuft in einem containerisierten Harness. Er übernimmt eine eingereihte Exploration, erhält Ziel, Plan und die Secrets der Persona und **meldet sich als echter Nutzer an** – er tippt Zugangsdaten in Ihr Login-Formular, statt die Authentifizierung zu umgehen. Dann arbeitet er den Plan ab: Er navigiert durch Routen, klickt, füllt aus und prüft – und erfasst dabei Konsolenfehler, Seitenfehler, fehlgeschlagene Netzwerkanfragen, fehlgeschlagene Assertions und Abstürze. Zugangsdaten werden pro Projekt verschlüsselt gespeichert, und das Lesen des Passworts einer Persona ist eine Entwickler-geschützte, protokollierte Aktion.

Führen Sie ihn bei Bedarf aus oder legen Sie einen **Cron-Zeitplan** fest, damit er Ihre meistgenutzten Abläufe jede Nacht durchläuft.

## Er legt den Bug an – und ein Fix-Agent greift ihn auf

Hier hört er auf, ein Test-Runner zu sein, und wird Teil der Belegschaft. Funde werden anhand eines Fingerprints dedupliziert und nach der Hitze der Zone gerankt, die sie aufgedeckt hat. Ist Auto-Routing aktiviert, wird jeder Fund ab Ihrer Schweregrad-Schwelle zu einer **Board-Aufgabe** – aus dem Fund betitelt und priorisiert, mit Route, Selektor, Fehler und Details beschrieben – und in eine Fix-Lane gelegt. Dieser Lane-Eintrag löst **denselben Auto-Run-Trigger aus wie ein Ziehen auf dem Board durch einen Menschen**: Ein Fix-Agent liest die Aufgabe, behebt den Code und öffnet einen PR. Wird das Issue geschlossen, wird der Fund als behoben markiert.

Der Kreislauf läuft Ende zu Ende ohne einen Menschen in der Mitte – aber jeder Schritt steht auf dem Board, sodass ein Mensch an jedem Gate eingreifen kann.

## Qualität, die Sie wirklich sehen können

Da sowohl Funde (entkommene Defekte) als auch CI-Fehlschläge (abgefangene Defekte) auf der Plattform landen, fließt der Agentic Tester in einen echten **Qualitätstrend** mit Modell- und Agent-Zuordnung ein – so sehen Sie, ob Ihre Software im Lauf der Zeit zuverlässiger oder unzuverlässiger wird, und nicht nur, ob der Lauf der vergangenen Nacht bestanden wurde.

[Die Plattform entdecken →](/product) · [Task-Ausführung & Observability →](/blog/task-execution-and-observability) · [Kostenlos loslegen →](/register)
