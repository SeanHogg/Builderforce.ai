Jedes Fehlerüberwachungs-Tool ist eine wunderschöne Sackgasse. Es gruppiert Ihre Abstürze, sortiert sie nach Häufigkeit, zeigt Ihnen einen Stack-Trace – und gibt dann die Arbeit an Sie zurück. Jemand muss ihn trotzdem lesen, die Datei finden, die Korrektur schreiben und den PR öffnen. Das Dashboard ist der Ort, an dem der Bug *stehen bleibt*, nicht der, an dem er *gelöst* wird.

Die **Quality-Säule** von Builderforce.ai schließt diese Schleife. Sie nimmt Fehler wie jedes Observability-Tool auf – und macht dann aus jeder Fehlergruppe eine Aufgabe, die Ihre Agent-Workforce übernimmt und als Pull Request ausliefert.

> Builderforce.ai nimmt Laufzeitfehler aus vielen Quellen auf, gruppiert sie per Fingerprint zu deduplizierten Fehlergruppen und macht aus jeder Gruppe eine Ein-Klick-Fix-Aufgabe, die ein Cloud-Agent übernimmt und als Pull Request ausliefert – vom Absturz zum PR auf einer Oberfläche.

![Pipeline von links nach rechts: Ein Laufzeitfehler fließt in eine Fingerprint-Fehlergruppe, das /quality-Board, eine Ein-Klick-Fix-Aufgabe und einen Cloud-Agent, der einen Pull Request in einem Thread ausliefert](/blog/quality-observability.svg)

## Aufnehmen, wo Ihre Fehler ohnehin leben

Sie müssen nichts herausreißen, was Sie haben. Quality normalisiert fünf Quellen hinter einer kanonischen Ereignisform:

- **Nativ** – das Browser-SDK `@seanhogg/builderforce-quality` erfasst `window.onerror` und unbehandelte Promise-Rejections automatisch, bündelt sie und leert den Puffer per Timer oder beim Ausblenden der Seite über `sendBeacon`, sodass bei der Navigation nichts verloren geht. Fügen Sie ein `<script>`-Tag ein, und Sie melden.
- **OpenTelemetry (OTLP)** – richten Sie Ihren bestehenden OTLP-Exporter auf den Ingest-Endpunkt; Logs auf Fehlerebene und Spans mit Fehlerstatus werden zu Fehlerereignissen.
- **Sentry, PostHog, LogRocket** – verbinden Sie einen Webhook, und die Plattform prüft seine HMAC-Signatur, normalisiert die Payload und führt sie in denselben Strom ein. Sentry-Verbindungen können beim Anbinden historische Issues nachladen.

Jede Quelle landet als dasselbe `NormalizedErrorEvent`, sodass alles Nachgelagerte – Gruppierung, Dashboard, die Korrektur – quellenunabhängig ist.

## Fingerprint-Gruppierung, die Sie nicht überflutet

Rohereignisse sind Rauschen; **Gruppen** sind Signal. Jedes Ereignis erhält einen Fingerprint – einen expliziten, wenn die Quelle einen liefert, sonst abgeleitet aus dem obersten Stack-Frame plus einer normalisierten Meldung (Literale, Hex-Werte, UUIDs und nackte Zahlen entfernt, damit sich derselbe Bug nicht in tausend Gruppen aufspaltet). Ereignisse werden per Upsert in eine Gruppe mit dem Schlüssel `(tenant, project, fingerprint)` eingetragen, erhöhen die Zähler für Vorkommen und exakt unterschiedliche Nutzer, aktualisieren den Beispiel-Stack-Trace und öffnen einen gelösten Bug erneut, wenn er wiederkehrt.

Das `/quality`-Dashboard listet diese Gruppen nach Status und Level auf, mit einem 14-Tage-Trend und der Zahl betroffener Nutzer je Gruppe – Sie triagieren also, was Nutzern tatsächlich wehtut, und keinen Schwall einzelner Ereignisse.

## Der Knopf, der die Korrektur ausliefert

Öffnen Sie eine Gruppe, lesen Sie den Trace und klicken Sie auf **Fix with agent**. Builderforce.ai legt eine Board-Aufgabe an – betitelt nach dem Fehler, priorisiert nach seinem Level (fatal → dringend, error → hoch und so weiter), mit einem Briefing aus Typ, Umgebung, URL, Vorkommens- und Nutzerzahlen und dem Stack-Trace – und startet sofort einen Cloud-Agent. Der Agent liest das Briefing, findet den Code, schreibt die Änderung und öffnet einen Pull Request. Die Fehlergruppe verlinkt auf die Aufgabe, sodass Absturz, Korrektur und PR in einem Thread leben.

Weil sie auf derselben instrumentierten Plattform läuft, ist das Fehlervolumen eine gemessene Ressource (`error_events`), die in dieselbe Verbrauchsansicht einfließt wie Tokens und Ingestion – eine einzige Quelle der Wahrheit dafür, was Sie nutzen, durchgesetzt genau so, wie es angezeigt wird.

## Warum das wichtig ist

Observability, die an einem Dashboard endet, macht Fehler *sichtbar*. Observability, die in eine Agent-Workforce eingebunden ist, lässt sie *verschwinden*. Wenn dieselbe Plattform, die den Absturz sichtbar macht, ihn auch zuweisen, beheben und per PR ausliefern kann, hängt die mittlere Behebungszeit nicht mehr davon ab, wer Bereitschaft hat, sondern davon, wie schnell Ihre Agents arbeiten.

[Plattform-Rundgang →](/product) · [Den Sieben-Schichten-Agent-Stack lesen →](/blog/agent-tech-stack-all-seven-layers) · [Kostenlos loslegen →](/register)
