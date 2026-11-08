Der größte Grund, warum Teams bei einem Tool bleiben, aus dem sie herausgewachsen sind, ist der Umzug selbst. Jahre an Tickets, eine Projekttaxonomie, die jeder auswendig kennt, Bearbeiter, Sprints, Story Points – die Angst gilt nicht dem neuen Tool, sondern dem Verlust der Historie des alten beim Wechsel. Deshalb behandelt BuilderForce die Migration als vollwertigen Workflow, der bis zum Commit umkehrbar ist, und nicht als einmaligen Import-Button, bei dem man die Daumen drückt.

![Trichterdiagramm: Anbieter mit Migrationsabzeichen – Jira, monday, Rally, GitLab, Bitbucket und GitHub – sowie reine Sync-Quellen speisen einen gestuften siebenstufigen Migrationsassistenten, der ein BuilderForce-Board und eine Live-Sync-Verbindung ausgibt](/blog/migrate-integrate.svg)

## Zwei Wege der Einführung: migrieren, synchronisieren oder beides

Nicht jedes Team will wechseln. Manche wollen komplett umziehen; manche wollen Jira nie verlassen und nur, dass die Daten in BuilderForce fließen, damit ihre Agents und Dashboards darauf reagieren können. Jede Integration unterstützt beides, pro Lauf wählbar:

- **Migrieren** – ein einmaliger Import Ihrer historischen Elemente in BuilderForce-Tasks.
- **Synchronisieren** – eine dauerhafte Verbindung, die weiter abfragt, sodass Änderungen kontinuierlich einfließen. Sie verlassen Ihren Tracker nie.
- **Beides** – die Historie importieren *und* die Live-Verbindung einrichten.

## Alles, was wir anbinden

Die Integrations-Galerie (unter **Settings → Integrations**) ist die Workspace-Zentrale für jedes externe System. Jeder Anbieter ist eine Karte, die Sie verbinden, konfigurieren und beobachten – mit Zugangsdaten, Live-Verbindungen und einem Aktivitäts-/Diagnose-Tab, der jeden Sync-Lauf zeigt.

**Arbeits- und Projektmanagement:** Jira, monday.com, Rally (CA Agile Central), Linear, Asana, ClickUp.

**Quellcodeverwaltung und Issues:** GitHub, GitLab, Bitbucket – *sowohl* ihre Issue-Tracker (wie jedes Board migriert) **als auch** ihre Repositories (für Code, Branches und Pull Requests angebunden).

**IT-Service-Management:** ServiceNow, Freshservice – Incidents und Tickets fließen in die Quality-Ansicht.

**Monitoring und Bereitschaft:** Sentry, PagerDuty – Alerts und Incidents werden zu umsetzbarer Arbeit.

Anbieter, die den Migrationsassistenten unterstützen, tragen ein **Migration**-Abzeichen: heute Jira, monday, Rally, GitLab, Bitbucket und GitHub. Die übrigen werden für die dauerhafte Synchronisierung angebunden.

## Der Migrationsassistent: erst bereitstellen, dann übernehmen

Nichts berührt Ihre echten Projekte, Tasks oder Mitglieder, bevor Sie den Import auslösen. Alles davor liegt in einem Staging-Puffer, den Sie prüfen, anpassen und jederzeit verlassen können:

1. **Verbinden** – wählen Sie die Zugangsdaten und den Modus (migrieren / synchronisieren / beides).
2. **Erkunden** – BuilderForce liest das externe System und stellt dessen Projekte, Elementtypen und Benutzer bereit. Noch keine Schreibzugriffe.
3. **Projekte zuordnen und zusammenführen** – ordnen Sie jedes externe Projekt einem neuen BuilderForce-Projekt zu oder ordnen Sie mehrere *einem* Projekt zu, um sie zu kombinieren. Das klassische Problem „wir haben fünf Jira-Projekte, die eigentlich ein Produkt sind“ sind schlicht fünf Zeilen, die auf dasselbe Ziel zeigen.
4. **Elementtypen zuordnen** – machen Sie aus `Story`, `Bug`, `Epic`, `Defect`, `incident` den passenden BuilderForce-Tasktyp mit Startstatus. Diese Zuordnung wird auch für die laufende Synchronisierung gespeichert, sodass synchronisierte Tasks in der richtigen Spur landen statt in einem generischen Backlog.
5. **Benutzer zuordnen** – laden Sie die externen Bearbeiter ein, die Sie wollen, oder ordnen Sie sie bestehenden Mitgliedern zu. Importierte Elemente behalten ihren Bearbeiter, wenn die Person einem Mitglied zugeordnet ist.
6. **Prüfen** – sehen Sie sich die bereitgestellten Elemente an und deaktivieren Sie alles, was Sie zurücklassen wollen.
7. **Importieren** – Projekte werden angelegt (oder zusammengeführt), Tasks mit Typ, Status, Story Points und Bearbeiter importiert, Benutzer eingeladen und – falls Sie Synchronisierung gewählt haben – Live-Verbindungen erstellt, damit sich das Board selbst aktuell hält.

Da importierte Elemente mit ihrer Quelle verknüpft bleiben, ist die erste Synchronisierung nach einer Migration ein sauberer No-op und kein Duplikat-Sturm.

## Lassen Sie Brain das erledigen

Der gesamte Ablauf steht Brain als Tools zur Verfügung. Sie können einfach sagen:

> „Verbinde Bitbucket – hier sind Access Token und Workspace. Teste es und starte dann eine Migration.“

Brain speichert die Zugangsdaten (verschlüsselt), validiert die Verbindung, startet den Lauf und öffnet das Migrationspanel **links** auf Ihrem Bildschirm – genau dort, wo es neben Brain arbeiten kann, das rechts sitzt. Sie ordnen zu, prüfen und importieren; es kümmert sich um die Installation im Hintergrund. Verbinden, validieren, abgleichen, importieren – im Dialog.

## Warum das wichtig ist

Die Angst vor der Migration ist eine Steuer auf jede gute Entscheidung, die ein Team treffen könnte. Indem BuilderForce alles zwischenspeichert, Sie beim Import kombinieren und neu zuordnen lässt, Personen und Historie bewahrt und „nur synchronisieren, nicht umziehen“ als vollwertige Option anbietet, entfällt diese Steuer. Sie bewerten auf Ihren echten Daten, in Ihrer echten Struktur, ohne dass etwas zerstört wird – und Sie können Ihre Meinung bis zu dem Moment ändern, in dem Sie sich festlegen.
