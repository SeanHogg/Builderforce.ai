# Ihr Audit-Trail kann die Plattform endlich verlassen

Spans von Agentenläufen gingen bereits an Ihren eigenen OpenTelemetry-Collector — Honeycomb, Datadog, Grafana, was immer Sie betreiben. Ihr Audit-Trail konnte nicht. Anmeldungen, Rollenänderungen, API-Schlüssel, Genehmigungen, Tool-Aufrufe von Agenten: alles aufgezeichnet, nichts exportierbar. Ein Sicherheitsteam mit einem SIEM sah Agentenarbeit als Insel — und den Audit-Trail als eine zweite.

Jetzt sind beide Inseln verbunden. Jeder OpenTelemetry-Exporter kann Audit-Ereignisse zusätzlich als OTLP-Logs an den `/v1/logs`-Endpunkt Ihres Collectors senden.

## Wählen Sie Ihre Signale

Ein Exporteur gibt jetzt an, welche Signale er versendet:

- **Nur Traces** — genau das, was Exporteure bisher taten. Für bestehende Zeilen ändert sich nichts.
- **Nur Audit** — der Sicherheits-Trail geht an Ihr SIEM; Lauf-Spans bleiben im Produkt.
- **Beide** — ein Collector, zwei Signale. Spans gehen an `/v1/traces`, Audit-Logs an `/v1/logs`.

## Der Ereignisumfang

Der Sweep deckt die Sicherheitsfläche ab, nach der ein Prüfer fragt: Anmeldungen und Sitzungen, Rollen- und Mitgliedschaftsänderungen, API-Schlüssel-Änderungen, Exporte, Integrationsverbindungen, Genehmigungen und Tool-Aufrufe von Agenten.

Zwei Eigenschaften zählen mehr als die Liste selbst. Die Zustellung ist mindestens einmal (at-least-once) mit der Ereignis-ID als Dedup-Schlüssel, und ein Cursor pro Quelle bedeutet, dass ein fehlgeschlagener Stapel genau dort erneut versucht wird, wo er stoppte — ohne Verlust, ohne Duplikate. Und ein Collector-Ausfall verlangsamt nie eine Anfrage: Der Sweep läuft im Hintergrund, und sobald ein Collector ausfällt, zeigt die Exporteur-Zeile in den Einstellungen genau das auf derselben Gesundheitszeile, die bereits die Span-Zustellung anzeigte.

## Die Grenze

Der Export einer Arbeitsumgebung enthält nur deren eigene Ereignisse. Der Betreiber-Trail — das mandantenübergreifende `admin_audit_log` — wird niemals an eine Arbeitsumgebung exportiert. Ihr SIEM sieht Ihre Arbeitsumgebung, nicht die anderer.

Einrichten unter **Einstellungen → Integrationen → OpenTelemetry-Export**.
