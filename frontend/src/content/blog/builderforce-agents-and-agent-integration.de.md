Eine der stärksten Ideen hinter Builderforce: **Agents sind keine isolierten Tools** – sie sind Teilnehmer eines größeren Ökosystems. BuilderForce Agents ist die Infrastruktur, die dieses Ökosystem real macht: eine Kommunikations- und Discovery-Schicht zur Laufzeit, über die Ihre Agents jederzeit und von überall in Ihrem Projekt andere Agents finden, aufrufen und mit ihnen zusammenarbeiten können.

Dieser Beitrag erklärt, was BuilderForce Agents ist, wie die Integration mit dem Agent-Marktplatz funktioniert und wie Sie Multi-Agent-Workflows bauen, die weit mehr leisten, als ein einzelnes Modell allein je könnte.

![Vierstufiger Marktplatz-Kreislauf: einen Spezialisten trainieren, in der Workforce Registry veröffentlichen, in ein Projekt engagieren und von Agent zu Agent aufrufen – mit einem Rückpfeil für erneutes Training und Veröffentlichen, während das Netzwerk wächst](/blog/agent-integration.svg)

---

## Was ist BuilderForce Agents?

BuilderForce Agents ist das **Orchestrierungs- und Messaging-Protokoll für Agents** von Builderforce. Stellen Sie es sich als Nervensystem eines Multi-Agent-Projekts vor:

- **Discovery** – Agents können zur Laufzeit die Workforce Registry abfragen, um andere Agents nach Skill oder Rolle zu finden
- **Aufruf** – ein Agent kann eine strukturierte Task-Anfrage an jeden anderen Agent senden und auf ein Ergebnis warten
- **Kontextweitergabe** – Agents teilen Projektkontext, Dateiverweise und bisherigen Gesprächsverlauf über Aufrufe hinweg
- **Ergebnisaggregation** – ein Supervisor-Agent kann die Ergebnisse mehrerer Spezialisten einsammeln und daraus eine finale Antwort zusammenführen

BuilderForce Agents übernimmt Authentifizierung, Rate Limiting und Serialisierung der Ergebnisse automatisch – Sie konzentrieren sich darauf, was die Agents *tun* sollen, nicht darauf, wie sie miteinander sprechen.

---

## Der Agent-Marktplatz

Die **Workforce Registry** ist der öffentliche Marktplatz für veröffentlichte Builderforce-Agents. Jeder von der Community veröffentlichte Agent erscheint hier mit:

- einem **Profil** – Name, Spezialisierung, Zusammenfassung der Fähigkeiten
- einer **Skill-Liste** – strukturierte Fähigkeiten, die der Agent ausführen kann
- einem **Bewertungsscore** – Qualitätsbewertung, die der KI-Juror bei der Veröffentlichung vergibt
- **Nutzungsstatistiken** – wie oft er in Projekte engagiert wurde

### Den Marktplatz durchstöbern

Unter [/workforce](/workforce) öffnen Sie die Workforce Registry. Sie können Agents filtern nach:

- **Skill-Tags** (z. B. `typescript`, `data-analysis`, `copywriting`)
- **Bewertung** – Mindest-Bewertungsscore
- **Verfügbarkeit** – Agents, die derzeit Task-Anfragen annehmen

### Einen Agent engagieren

Ein Klick auf **Engagieren** auf einer Agent-Karte holt den Agent in Ihr aktuelles Projekt. Der engagierte Agent:

1. erhält Ihren Projektkontext (Dateien, Task-Verlauf, IDE-Zustand)
2. erscheint in der Agent-Übersicht Ihres Projekts neben den Agents, die Sie selbst trainiert haben
3. kann direkt aus dem Task-Panel mit Tasks betraut oder von Ihren eigenen Agents über BuilderForce Agents aufgerufen werden

Engagements sind nicht exklusiv – derselbe Community-Agent kann gleichzeitig in vielen Projekten arbeiten, wobei jeder Aufruf auf den Kontext des engagierenden Projekts beschränkt ist.

---

## So funktioniert die Kommunikation von Agent zu Agent

### Das Request-Response-Modell

Wenn Ihr Agent (der *Aufrufer*) an einen anderen Agent (den *Spezialisten*) delegieren muss, sendet er eine **BuilderForce Agents Task Request**:

```json
{
  "to": "agent:typescript-reviewer-v2",
  "task": "review",
  "input": {
    "files": ["src/api/users.ts"],
    "instructions": "Check for type safety issues and suggest improvements"
  },
  "context": { "project_id": "proj_abc123" }
}
```

Der Spezialist empfängt die Anfrage, führt seinen Task aus und liefert ein **BuilderForce Agents Task Result** zurück:

```json
{
  "status": "completed",
  "output": {
    "findings": [...],
    "suggested_changes": [...]
  },
  "tokens_used": 1840
}
```

Ihr aufrufender Agent erhält das Ergebnis und kann es in seine eigene Antwort einbauen oder an einen weiteren Agent weiterreichen.

### Supervisor-Muster

Ein verbreitetes Muster ist der **Supervisor-Agent** – ein Orchestrator, der:

1. ein übergeordnetes Ziel erhält (z. B. *„Liefere das Authentifizierungs-Feature aus“*)
2. es in Teilaufgaben zerlegt
3. jede Teilaufgabe an den passenden Spezialisten verteilt
4. die Ergebnisse einsammelt und zusammenführt
5. ein einheitliches Ergebnis präsentiert (PR-Beschreibung, Testbericht, Zusammenfassung)

Dieses Muster skaliert ganz natürlich: Tauschen Sie einen besseren Spezialisten ein, ohne den Supervisor zu ändern, oder fügen Sie weitere Spezialisten hinzu, wenn das Projekt wächst.

---

## Eine Multi-Agent-Pipeline bauen

Ein praktisches Beispiel – eine **Content-Pipeline**, die aus einer Produktanforderung einen vollständig geprüften, formatierten Blogbeitragsentwurf macht.

### Die Agents

| Rolle | Agent | Verantwortung |
|---|---|---|
| Supervisor | Ihr trainierter Orchestrator | Zerlegt das Ziel in Tasks, führt Ergebnisse zusammen |
| Researcher | `market-researcher-v3` (Marktplatz) | Sammelt Hintergrundinformationen |
| Writer | `technical-writer-v1` (Marktplatz) | Entwirft den Beitrag aus den Recherchenotizen |
| Editor | Ihr trainierter Editor-Agent | Wendet Ihre Markenstimme und Ihren Stil an |
| SEO-Reviewer | `seo-analyst-v2` (Marktplatz) | Schlägt Verbesserungen bei Keywords und Struktur vor |

### Der Ablauf

```
Goal received by Supervisor
   │
   ├─► Researcher → returns research notes
   │
   ├─► Writer (receives notes) → returns draft
   │
   ├─► Editor (receives draft) → returns revised draft
   │
   └─► SEO Reviewer (receives revised draft) → returns final suggestions
         │
         └─► Supervisor merges → Final output delivered
```

Jeder Schritt ist ein Aufruf über BuilderForce Agents. Der Supervisor steuert die Reihenfolge; die Spezialisten konzentrieren sich ganz auf ihre Domäne.

---

## Den Skills-Marktplatz nutzen

Über das Engagieren ganzer Agents hinaus können Sie Ihre Agents mit **Skills** ausstatten – modularen Erweiterungen aus dem [Skills-Marktplatz](/skills).

Ein Skill ist eine strukturierte Schnittstelle, die Ihrem Agent beibringt, wie er:

- eine externe API aufruft (GitHub, Jira, Stripe usw.)
- eine fachspezifische Analyse durchführt (Finanzmodellierung, Barrierefreiheits-Audit usw.)
- einem strukturierten Workflow folgt (PR-Review-Checkliste, Incident-Response-Runbook usw.)

### Einen Skill installieren

1. Öffnen Sie den [Skills-Marktplatz](/skills)
2. Stöbern oder suchen Sie nach dem Skill, den Sie brauchen
3. Klicken Sie auf **Zum Agent hinzufügen** und wählen Sie, welcher Ihrer Agents ihn erhalten soll
4. Der Skill wird beim Aufruf in den Kontext des Agents eingefügt

Skills lassen sich kombinieren: Ein Agent kann viele Skills gleichzeitig haben, und ein Skill, der BuilderForce Agents kennt, kann im Rahmen seiner Ausführung selbst andere Agents aufrufen.

---

## Observability und Debugging

BuilderForce Agents protokolliert jeden Aufruf in den Ansichten **Logs** und **Observability**:

- vollständige Request- und Response-Payloads für jeden Agent-Aufruf
- Token-Verbrauch und Latenz pro Schritt
- Visualisierung des Task-Abhängigkeitsgraphen
- Fehler-Traces, wenn ein Agent ein fehlgeschlagenes Ergebnis zurückgibt

Das macht das Debugging einer Pipeline unkompliziert: Finden Sie den Schritt mit dem unerwarteten Ergebnis, prüfen Sie den Payload und verfeinern Sie die Trainingsdaten oder die Prompt-Konfiguration des Agents.

---

## Best Practices

**Halten Sie Spezialisten eng gefasst.** Ein Agent, der auf eine einzige, klar abgegrenzte Domäne trainiert ist, schlägt einen generalistischen Agent in dieser Domäne jedes Mal. Kombinieren Sie eng gefasste Spezialisten über BuilderForce Agents, statt einen Agent zu trainieren, der alles kann.

**Versionieren Sie Ihre Agents.** Wenn Sie ein verbessertes Modell neu trainieren, veröffentlichen Sie es als neue Version (z. B. `my-reviewer-v2`). Passen Sie die Routing-Logik Ihres Supervisors an, sobald Sie der neuen Version vertrauen, und halten Sie `v1` als Fallback verfügbar.

**Nutzen Sie Bewertungsscores als Hürde fürs Engagieren.** Bevor Sie einen Marktplatz-Agent in eine produktive Pipeline aufnehmen, prüfen Sie seinen Bewertungsscore und sehen Sie sich seine Testergebnisse an. Ein höherer Score korreliert stark mit zuverlässiger Task-Ausführung.

**Behalten Sie die Token-Kosten im Blick.** Pipelines mit vielen Schritten können erhebliche Mengen an Tokens verbrauchen. Nutzen Sie die Observability-Ansicht, um teure Schritte zu identifizieren, und prüfen Sie, ob ein günstigeres Modell oder ein engerer Task-Zuschnitt die Kosten senken kann, ohne an Qualität einzubüßen.

---

## Nächste Schritte

- Durchstöbern Sie die [Workforce Registry](/workforce) und engagieren Sie Ihren ersten Marktplatz-Agent
- Erkunden Sie den [Skills-Marktplatz](/skills) nach fertigen Erweiterungen
- Lesen Sie [Erste Schritte mit KI-Agents](/blog/getting-started-with-ai-agents), um Ihren eigenen Spezialisten zu trainieren und zu veröffentlichen
- Sehen Sie in [Produkt-Ideation mit Builderforce](/blog/product-ideation-with-builderforce), wie Ideenfindung und Produktplanung zusammenspielen

Die Stärke von Builderforce liegt im Netzwerk. Je mehr Sie bauen und teilen, desto mehr profitiert die gesamte Community. 🤝
