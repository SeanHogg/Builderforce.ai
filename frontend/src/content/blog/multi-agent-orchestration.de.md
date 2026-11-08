Ein einzelner Generalisten-Agent kann Fragen beantworten, Code schreiben und E-Mails entwerfen. Reale Workflows brauchen aber oft **Spezialisten-Agents, die im Zusammenspiel arbeiten**: einen Planer, einen Coder, einen Reviewer, einen Deployer. Der Builderforce Mesh ist die Schicht, die sie verbindet.

![Multi-Agent-Orchestrierung: Ein Orchestrator-Agent zerlegt ein Ziel und leitet jede Teilaufgabe an einen Spezialisten weiter – Planer, Coder, Reviewer, Tester, Deployer – und übergibt dabei strukturierte JSON-Übergaben zwischen den Knoten](/blog/multi-agent-orchestration.svg)

## Das Mesh-Denkmodell

Stellen Sie sich den Mesh als Nachrichtenbus zwischen Agents vor. Jeder Agent ist ein **Knoten**, der:

- eine Reihe von **Aufgabentypen** abonniert, die er bearbeiten kann
- Ergebnisse zurück auf den Bus veröffentlicht
- andere Agents als Teilaufgaben aufrufen kann

Der Orchestrator (der selbst ein Agent sein kann) zerlegt ein übergeordnetes Ziel in Teilaufgaben und leitet jede an den fähigsten Knoten weiter.

```
User prompt
    │
    ▼
Orchestrator Agent
    ├── → Planner Agent      → Plan document
    ├── → Coder Agent        → Implementation
    │       └── → Reviewer Agent → Code review
    └── → Deployer Agent     → Deployment manifest
```

## Agents in der Workforce registrieren

Bevor Sie orchestrieren können, müssen Agents in der Workforce Registry **veröffentlicht** werden. Jeder Agent deklariert:

- einen **Namen** und eine **Beschreibung**, die für andere Agents sichtbar sind
- eine Reihe von **Skills** (strukturierte Fähigkeits-Tags)
- einen **Endpoint** (die BuilderForce-Agents-Bridge, die den Agent ausführt)

Das Veröffentlichen ist nach dem Training mit einem Klick im Publish-Tab der IDE erledigt.

## Einen Mesh-Workflow einrichten

### 1. Rollen definieren

Legen Sie fest, welche Spezialisten-Agents Ihr Workflow braucht. Eine Software-Delivery-Pipeline könnte Folgendes nutzen:

| Rolle | Verantwortung |
|------|---------------|
| `planner` | Zerlegt die Feature-Anfrage in Aufgaben |
| `coder` | Implementiert jede Aufgabe in TypeScript |
| `reviewer` | Prüft PRs auf Korrektheit und Stil |
| `tester` | Schreibt und führt Unit-Tests aus |

### 2. Skills zuweisen

Weisen Sie auf der Seite [Skills](/skills) jedem AgentHost des Agents die passenden Skills zu. Skills bringen Fachwissen ein – ein `coder`-Agent mit dem Skill `typescript-strict` erzwingt beispielsweise strengere Typsicherheit in seiner Ausgabe.

### 3. Den Orchestrator verdrahten

Der Orchestrator-Agent erhält den ursprünglichen Prompt und verteilt Teilaufgaben. In einem Builderforce-Projekt können Sie die Orchestrierungslogik in einem Chat-System-Prompt definieren:

```
You are an orchestrator. When given a feature request:
1. Use the Planner to generate a task breakdown
2. For each task, invoke the Coder
3. Route each completed task to the Reviewer
4. Aggregate reviewed code and return the final diff
```

Der Mesh übernimmt das Routing – der Orchestrator ruft Agent-Skills einfach beim Namen auf.

## Kontext teilen

Agents teilen Kontext über **strukturierte Übergaben** – JSON-Payloads, die Aufgabenstatus, frühere Ausgaben und Metadaten transportieren. Builderforce serialisiert und deserialisiert diese Payloads automatisch, sodass jeder Agent genau den Kontext erhält, den er braucht.

Langlebiger Kontext (Gesprächsverlauf, Code-Artefakte) lässt sich in einem gemeinsamen R2-Bucket ablegen und per ID referenzieren, sodass die Payloads klein bleiben.

## Observability

Die Seite [Observability](/observability) bietet Ihnen eine Echtzeitsicht auf:

- den Nachrichtenfluss zwischen Agents
- die Latenz pro Knoten
- Fehlerraten und Wiederholungsversuche
- den Token-Verbrauch im gesamten Mesh

Das ist unschätzbar beim Debuggen komplexer Multi-Agent-Workflows – Sie sehen genau, wo eine Aufgabe ins Stocken geriet oder welcher Agent eine unerwartete Ausgabe lieferte.

## Best Practices

**Halten Sie Agents klein und fokussiert.** Ein Coder-Agent, der nur Python schreibt, lässt sich leichter bewerten und verbessern als einer, der Code schreibt, prüft und außerdem ausrollt.

**Nutzen Sie die KI-Bewertung für jeden Agent einzeln.** Stimmen Sie mit gezielten Datensätzen fein ab statt mit einem einzigen riesigen Korpus. Mit den Bewertungsergebnissen der Workforce Registry lassen sich Agent-Versionen leicht vergleichen.

**Versionieren Sie Ihre Agents.** Veröffentlichen Sie beim erneuten Training eine neue Version und pinnen Sie den Orchestrator während der Entwicklung auf bestimmte Agent-Versionen, um Regressionen zu vermeiden.

## Erste Schritte

Bereit, einen Mesh zu bauen? Beginnen Sie damit, [zwei Agents zu trainieren](/dashboard) – einen Planer und einen Coder –, beide zu veröffentlichen und dann ein Orchestrator-Projekt anzulegen, das auf sie verweist. Über die Oberfläche [Workforce-Chats](/workforce?tab=chats) testen Sie den orchestrierten Workflow interaktiv, bevor Sie sich auf eine Produktions-Pipeline festlegen.
