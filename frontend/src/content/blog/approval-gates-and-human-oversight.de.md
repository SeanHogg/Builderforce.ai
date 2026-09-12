Autonome Agents sind leistungsfähig. Genau das macht sie ohne die richtigen Leitplanken auch gefährlich. Ein Agent, der Code pushen, Produktivkonfigurationen ändern oder in Ihrem Namen Nachrichten verschicken kann, ist außerordentlich nützlich – bis er etwas tut, das Sie nicht beabsichtigt haben.

Das **Freigabe-Gate**-System von Builderforce.ai löst dieses Problem auf Infrastrukturebene. Sie legen fest, welche Aktionstypen eine menschliche Freigabe brauchen; die Plattform blockiert die Ausführung, bis eine Führungskraft freigibt oder ablehnt; der Agent macht erst weiter, wenn die Entscheidung erfasst ist. Der gesamte Ablauf wird protokolliert.

![Ablaufdiagramm eines Freigabe-Gates: Ein Agent, der eine Aufgabe ausführt, trifft auf ein Gate, das die Ausführung über POST /api/approvals blockiert; eine Führungskraft gibt frei, lehnt ab oder lässt die Frist verstreichen, und jedes Ergebnis wird in einem unveränderlichen Audit-Trail festgehalten](/blog/approval-gates.svg)

---

## So funktionieren Freigabe-Gates

Am Ablauf sind drei Beteiligte beteiligt: der **Agent** (der in BuilderForce Agents läuft), das **Builderforce-Portal** (in dem die Freigabeanfrage einem Menschen angezeigt wird) und die **Führungskraft** (ein Teammitglied mit der Rolle `MANAGER` oder höher).

```
Agent runs a task
    │
    └─► "This action requires approval"
            │
            ▼
    POST /api/approvals ──────────────────────────────────────┐
            │                                                  │
            ▼                                                  ▼
    Agent suspends execution              Portal notifies manager
    (awaiting decision)                   via dashboard + relay push
            │                                                  │
            └──────────────── Manager approves/rejects ────────┘
                                          │
                             approval.decision pushed to agentHost
                                          │
                               ┌──────────▼──────────┐
                               │ approved → continue  │
                               │ rejected → abort     │
                               └──────────────────────┘
```

Die entscheidende Eigenschaft: **Die Ausführung ist tatsächlich blockiert.** Der Agent macht nicht weiter, versucht es nicht erneut und läuft nicht stillschweigend in einen Timeout. Er wartet – bis zu einem konfigurierbaren Timeout – auf eine echte Entscheidung von einem echten Menschen.

---

## Die Freigabeseite

Öffnen Sie die [Workforce-Freigaben](/workforce?tab=approvals), um die offenen, freigegebenen und abgelehnten Gates Ihres Teams zu sehen.

Jede Freigabeanfrage zeigt:

| Feld | Beschreibung |
|---|---|
| **Aktionstyp** | Was der Agent tun wollte (`git.push`, `deploy`, `task.execution` usw.) |
| **Beschreibung** | Die Begründung des Agents in Klartext |
| **Angefragt von** | Welche BuilderForce Agents-Instanz die Anfrage gestellt hat |
| **Angefragt am** | Zeitstempel der Anfrage |
| **Läuft ab am** | Wann die Anfrage ohne Antwort automatisch abläuft |
| **Metadaten** | Strukturierter Kontext (Aufgaben-ID, Priorität, Dateiliste, Kostenschätzung usw.) |

Freigeben oder Ablehnen ist ein einziger Klick. Optional können Sie eine **Review-Notiz** hinzufügen, die zusammen mit der Entscheidung gespeichert wird und im Audit-Log sichtbar ist.

---

## Was ein Freigabe-Gate auslöst

Es gibt zwei Quellen:

### 1. Automatische Gates (von der Plattform erzwungen)

Die Builderforce-Runtime prüft automatisch ein Gate, wenn eine Aufgabe zur Ausführung eingereicht wird und:

- die **Priorität der Aufgabe `high` oder `urgent`** ist

Das ist das Standard-Sicherheitsnetz – Aufgaben mit hohem Einsatz werden immer von einem Menschen geprüft, bevor ein Agent mit der Ausführung beginnt.

### 2. Explizite Gates (vom Agent angefordert)

Agents in BuilderForce Agents können während der Ausführung jederzeit eine Freigabe anfordern, indem sie `requestApproval()` aufrufen:

```typescript
import { requestApproval } from "@builderforce/approval-gate";

const decision = await requestApproval({
  actionType: "git.push",
  description: "Push 42 changed files to the main branch",
  metadata: {
    files: changedFiles,
    branch: "main",
    estimatedRisk: "high",
  },
  timeoutMs: 10 * 60 * 1000, // 10 minute window
});

if (decision !== "approved") {
  throw new Error(`Push not approved: ${decision}`);
}

await git.push("origin", "main");
```

Der Agent pausiert bei `await requestApproval(...)`, bis:
- eine Führungskraft freigibt → Rückgabe `"approved"`
- eine Führungskraft ablehnt → Rückgabe `"rejected"`
- der Timeout abläuft → Rückgabe `"timeout"`

Kein Polling, kein manuelles Nachprüfen – die Entscheidung wird in dem Moment an den agentHost gepusht, in dem die Führungskraft handelt.

---

## Rollenanforderungen

Nur Nutzer mit der Rolle `MANAGER` oder `OWNER` können Gates freigeben oder ablehnen. Viewer und Entwickler sehen offene Freigaben, können sie aber nicht bearbeiten.

Das ist gewollt. Freigabebefugnis ist ein Governance-Instrument – sie sollte bei denselben Personen liegen, die auch Deploy-Zugriff haben, nicht beim ganzen Team.

Teamrollen verwalten Sie unter [Einstellungen → Mitglieder](/settings).

---

## Benachrichtigungen

Trifft eine Freigabeanfrage ein, sieht die Führungskraft sie an drei Stellen:

1. **Im Portal** – das Badge der [Workforce-Freigaben](/workforce?tab=approvals) in der Seitenleiste aktualisiert sich in Echtzeit
2. **Über das Relay** – ist eine Browsersitzung auf der Chat-Ansicht des betreffenden agentHost geöffnet, trifft sofort ein `approval.request`-Ereignis ein
3. **In Messaging-Kanälen** (kommt in Phase 2) – Benachrichtigungen zu Freigabeanfragen per Slack, Telegram und E-Mail

---

## Audit-Trail

Jede Freigabeentscheidung ist dauerhaft und unveränderlich. Das [Audit-Log](/admin) erfasst:

- Wer die Freigabe angefordert hat (agentHost-ID)
- Wer die Entscheidung getroffen hat (Nutzer-ID)
- Wie die Entscheidung lautete und wann sie fiel
- Die Review-Notiz, falls vorhanden

Das ist Ihr Compliance-Nachweis. Wenn ein Deployment schiefgegangen ist und Sie wissen müssen, wer es freigegeben hat und warum, finden Sie es hier.

---

## Timeouts und automatischer Ablauf

Freigabeanfragen haben einen optionalen Zeitstempel `expiresAt`. Läuft eine Freigabe ab:

- wechselt ihr Status zu `expired`
- erhält der wartende Agent die Entscheidung `"timeout"`
- ist der Agent dafür verantwortlich zu entscheiden, ob er abbricht oder es erneut versucht

Der Standard-Timeout in BuilderForce Agents beträgt 10 Minuten für interaktive Agent-Anfragen. Für länger laufende Hintergrund-Workflows können Sie ein längeres Zeitfenster konfigurieren.

---

## Best Practices

**Definieren Sie Aktionstypen als Taxonomie.** Verwenden Sie konsistente Bezeichner wie `git.push`, `deploy.production`, `db.migrate` oder `file.delete-bulk` statt freier Beschreibungen. So bleibt das Audit-Log filterbar, und Sie können später Automatisierungsregeln ergänzen.

**Gaten Sie nach Risiko, nicht nach Häufigkeit.** Nicht jede Aktion braucht eine Freigabe – nur Aktionen mit nennenswertem Schadensradius. Schreibzugriffe auf die Produktion, destruktive Dateioperationen und externe API-Aufrufe, die Geld kosten oder Nachrichten verschicken, sind natürliche Gate-Punkte.

**Halten Sie Freigaben klein.** Eine einzelne Freigabeanfrage sollte genau eine Entscheidung beschreiben. „Diese 42 Dateien pushen“ lässt sich entscheiden. „Das gesamte Deployment durchführen“ nicht – teilen Sie es in Checkpoints auf, die eine Führungskraft sinnvoll prüfen kann.

**Setzen Sie realistische Timeouts.** Ein Agent, der 24 Stunden auf eine Freigabe wartet, die um 9 Uhr morgens eintrifft, ist bei wenig dringenden Workflows in Ordnung. Für nutzernahe Live-Pipelines verwenden Sie kürzere Timeouts mit klar definiertem Fallback-Verhalten.

---

## Nächste Schritte

- Öffnen Sie die [Workforce-Freigaben](/workforce?tab=approvals), um offene Gates auf den agentHosts Ihres Teams zu sehen
- Lesen Sie [Aufgabenausführung und das Portal](/blog/task-execution-and-observability), um zu verstehen, wie Freigaben mit dem Ausführungslebenszyklus zusammenspielen
- In [Multi-Agent-Orchestrierung](/blog/multi-agent-orchestration) finden Sie Muster, die Freigabe-Gates mit mehrstufigen Workflows kombinieren
