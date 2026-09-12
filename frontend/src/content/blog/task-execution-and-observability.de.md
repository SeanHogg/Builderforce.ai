Wenn ein KI-Agent einen Task ausführt, passiert eine Menge. Er plant, ruft Tools auf, schreibt Dateien, delegiert an andere Agents und meldet zurück. Zu wissen, *was* passiert ist, *wann*, *welcher Agent* es getan hat und *ob es geklappt hat*, ist der Unterschied zwischen einem System, dem Sie vertrauen, und einem, das Sie fürchten.

Builderforce verschafft Ihnen diese Transparenz über einen mehrschichtigen Stack: **Tasks**, **Ausführungen**, **Workflow-Telemetrie** und die **Echtzeit-Timeline im Portal**. Dieser Beitrag geht jede Schicht durch.

![Task-Ausführung und Observability: Eine Ausführung durchläuft die Zustände pending, submitted, running und completed oder failed, ihre Spans pro Tool liegen auf einer Timeline, der fehlschlagende Aufruf ist hervorgehoben, dazu aggregierte Dashboard-Kacheln für Gesamtzahl, Abschlüsse, Fehler, Dauer und Tokens](/blog/task-observability.svg)

---

## Das Datenmodell

Um zu verstehen, was Builderforce erfasst, muss man vier zusammenhängende Konzepte kennen:

| Konzept | Was es darstellt |
|---|---|
| **Task** | Eine Arbeitseinheit, definiert in einem Projekt (ein Backlog-Eintrag, ein Feature, ein Bugfix) |
| **Ausführung** | Ein konkreter Versuch, diesen Task auf einer bestimmten BuilderForce Agents-Instanz auszuführen |
| **Workflow** | Eine strukturierte, mehrstufige Orchestrierung, die ein BuilderForce Agents-Agent ausführt, um einen Task abzuschließen |
| **Workflow-Task** | Ein einzelner Schritt innerhalb eines Workflows (z. B. der „Coder“- oder der „Reviewer“-Schritt) |

Ein einzelner **Task** kann im Lauf der Zeit mehrere **Ausführungen** haben (Wiederholungen, erneute Durchläufe). Jede Ausführung ist genau einem **Workflow** zugeordnet, wenn der BuilderForce Agents-Orchestrator einen DAG ausführt, um sie abzuschließen.

---

## Der Lebenszyklus eines Tasks

Tasks durchlaufen eine festgelegte Statusfolge:

```
backlog → todo → ready → in_progress → in_review → done
                                   └─► blocked
```

Tasks verwalten Sie auf der Seite [Tasks](/tasks). Jeder Task erfasst:

- **Priorität** (`low`, `medium`, `high`, `urgent`) – bestimmt, ob automatisch ein Freigabe-Gate ausgelöst wird
- **Zugewiesener AgentHost** – welche BuilderForce Agents-Instanz ihn ausführen soll
- **Persona** – welche Agent-Rolle die Ausführung leiten soll
- **GitHub-PR-URL** – wird automatisch verknüpft, sobald ein AgentHost einen Pull Request erstellt

---

## Der Lebenszyklus einer Ausführung

Wird ein Task zur Ausführung übergeben (über `POST /api/runtime/executions` oder per Dispatch aus dem Portal), entsteht ein **Ausführungsdatensatz**, und über das Relay wird ein `task.assign`-Ereignis an den AgentHost gesendet.

Die Ausführung folgt diesem Zustandsautomaten:

```
pending → submitted → running → completed
                    └─► failed
                    └─► cancelled
```

Der AgentHost meldet jeden Übergang automatisch an Builderforce zurück:

- **running** – gemeldet, sobald der Agent den Task erhält und mit der Verarbeitung beginnt
- **completed** – gemeldet, wenn die Chat-Session des Agents eine finale Antwort liefert
- **failed** – gemeldet, wenn die Session mit einem Fehler endet

Diese Übergänge können Sie in Echtzeit auf der Seite [Timeline](/timeline) verfolgen – die Ausführungskarte aktualisiert sich live, während der AgentHost seinen Status meldet.

---

## Workflow-Telemetrie

Wenn BuilderForce Agents einen orchestrierten Workflow ausführt, um einen Task abzuschließen, erzeugt es **strukturierte Telemetrie-Spans** – einen pro Workflow und einen pro Task-Schritt. Diese Spans erscheinen an zwei Stellen:

### 1. Lokales JSONL (auf dem AgentHost)

```bash
# Every span is written locally on the agentHost
cat .builderforce/telemetry/2026-03-11.jsonl | jq .

# Find slow tasks
cat .builderforce/telemetry/2026-03-11.jsonl | \
  jq 'select(.kind == "task.complete") | {role: .agentRole, ms: .durationMs}' | \
  sort -t: -k2 -n
```

### 2. Builderforce-Portal (in Echtzeit)

Dieselben Spans werden ans Portal weitergeleitet, sobald sie entstehen:

- `workflow.start` → legt einen Workflow-Datensatz auf der Seite [Workflows](/workflows) an
- `task.start` → fügt einen Task-Schritt mit `status: running` hinzu
- `task.complete` / `task.fail` → ergänzt den Schritt um finalen Status und Dauer
- `workflow.complete` / `workflow.fail` → schließt den Workflow-Datensatz

Die Seite „Workflows“ ist damit eine **Live-Ansicht** dessen, was jeder verbundene AgentHost gerade tut. Keine manuellen Abfragen nötig.

---

## Die Seite „Workflows“

Unter [/workflows](/workflows) sehen Sie alle Workflows Ihrer gesamten Flotte.

Sie können filtern nach:

- **Status** – running, completed, failed, pending
- **Workflow-Typ** – feature, bugfix, refactor, planning, adversarial, custom
- **AgentHost** – auf eine bestimmte Maschine eingrenzen

Jeder Workflow-Eintrag lässt sich aufklappen und zeigt seinen Task-DAG – die einzelnen Schritte mit Agent-Rolle, Beschreibung, Dauer und Status. Fehlgeschlagene Schritte zeigen die Fehlermeldung direkt an.

---

## Das Ausführungs-Dashboard

[/observability](/observability) (oder der Dashboard-Link auf jeder Projektseite) zeigt aggregierte Kennzahlen:

| Kennzahl | Was sie misst |
|---|---|
| Ausführungen gesamt | Alle Durchläufe im gewählten Zeitraum |
| Abgeschlossen | Erfolgreich beendete Durchläufe |
| Fehlgeschlagen | Durchläufe, die mit einem Fehler endeten |
| Laufend | Aktuell aktiv |
| Ø Dauer | Mittlere Ausführungszeit (nur abgeschlossene Durchläufe) |
| Token-Verbrauch | Insgesamt verbrauchte Tokens über alle Ausführungen |

Das Dashboard schlüsselt nach Projekt, nach AgentHost und nach Agent-Rolle auf, damit Sie sehen, welche Teile Ihres Systems die meisten Ressourcen verbrauchen oder am häufigsten scheitern.

---

## Tool-Audit-Ereignisse

Jeder Tool-Aufruf eines Agents wird im **Tool-Audit-Log** festgehalten – durchsuchbar unter [Logs](/logs):

```
timestamp   | agentHost     | tool         | duration | status
2026-03-11T | agentHost-7   | read_file    | 42ms     | success
2026-03-11T | agentHost-7   | bash         | 1.2s     | success
2026-03-11T | agentHost-7   | write_file   | 38ms     | success
2026-03-11T | agentHost-7   | bash         | 3.4s     | error
```

Jedes Ereignis enthält die vollständigen Eingabeargumente und das Ergebnis, sodass Sie genau nachvollziehen können, was der Agent in jedem Schritt getan hat. Das ist die tiefste Debugging-Ebene – wenn eine Ausführung fehlschlägt, zeigt Ihnen das Tool-Audit-Log, welcher konkrete Tool-Aufruf die Ursache war.

---

## Ausführungen in Echtzeit streamen

Für Ausführungen, die gerade jetzt wichtig sind, können Sie Live-Updates über den WebSocket-Stream unter `GET /api/runtime/executions/:id/stream` abonnieren. Genau diesen nutzt die Live-Ausführungskarte des Portals unter der Haube – jeder Statusübergang und jedes Telemetrie-Ereignis wird in dem Moment gepusht, in dem es vom AgentHost eintrifft.

Der Stream liefert:

- `status_change`-Ereignisse, während die Ausführung ihre Zustände durchläuft
- `done`-Ereignisse, wenn die Ausführung abgeschlossen ist oder fehlschlägt
- Momentaufnahmen des Token-Verbrauchs aus der laufenden Session

---

## Specs: Wo die Ausführung beginnt

Das übergeordnete Planungsprimitiv in Builderforce ist die **Spec** – ein strukturiertes Planungsdokument, das unter [/tasks](/tasks) im Planungsbereich liegt.

Eine Spec durchläuft diese Stadien:

```
draft → reviewed → approved → in_progress → done
```

Jede Spec enthält:

- **Ziel** – das Vorhaben in einfachen Worten
- **PRD** – das Product Requirements Document (mit KI-Unterstützung aus [Brainstorm](/brainstorm) verfasst)
- **Architektur-Spec** – technisches Design, generiert oder bearbeitet
- **Task-Liste** – ein JSON-Array von Tasks, abgeleitet aus der Spec und bereit, im Task-Board angelegt zu werden

Wechselt eine Spec zu `approved`, wird aus der Task-Liste eine Reihe ausführbarer Tasks. Ab da übernimmt der oben beschriebene Ausführungs-Lebenszyklus.

---

## Best Practices

**Weisen Sie Tasks explizit AgentHosts zu**, wenn Sie eine Flotte betreiben. Ein nicht zugewiesener Task wird an alle verbundenen AgentHosts gesendet – in Ordnung zum Ausprobieren, in der Produktion aber unübersichtlich. Binden Sie Tasks an den AgentHost mit dem passenden Workspace und Modell.

**Setzen Sie Workflow-Typen bewusst ein.** Ein `bugfix`-Workflow läuft über bug-analyzer → coder → test-generator. Ein `feature`-Workflow über planner → architect → coder → reviewer → tester. Wer den richtigen Typ wählt, ruft die richtigen Agent-Rollen in der richtigen Reihenfolge auf – ganz ohne eigene Orchestrierung.

**Prüfen Sie beim Debuggen zuerst das Audit-Log.** Bevor Sie eine fehlgeschlagene Ausführung erneut starten, sehen Sie sich deren Tool-Audit-Ereignisse an. Meist liegt der Fehler in einem einzigen Tool-Aufruf – einem bash-Befehl mit Exit-Code ungleich null oder einem Schreibvorgang, der an fehlenden Berechtigungen gescheitert ist.

---

## Nächste Schritte

- Sehen Sie sich Ihre aktuellen Ausführungen in der [Timeline](/timeline) an
- Prüfen Sie ausstehende Freigaben für Tasks mit hoher Priorität unter [Workforce-Freigaben](/workforce?tab=approvals)
- Erkunden Sie die Seite [Workflows](/workflows), um zu sehen, was Ihre AgentHosts gerade orchestrieren
- Lesen Sie [Freigabe-Gates und menschliche Aufsicht](/blog/approval-gates-and-human-oversight), um zu erfahren, wie Sie riskante Ausführungsschritte absichern
