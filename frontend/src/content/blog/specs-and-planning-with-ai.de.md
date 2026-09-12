Die meisten KI-Coding-Tools setzen beim Code an. Sie gehen davon aus, dass Sie bereits wissen, was gebaut werden soll. Builderforce sieht das anders.

Die beste Engineering-Arbeit beginnt mit klarem Denken: Was ist das Problem, wie sieht die Lösung architektonisch aus, und welche einzelnen Arbeitspakete braucht es, um dorthin zu kommen? Builderforce bietet Ihnen für jede dieser Stufen KI-gestützte Werkzeuge – und eine strukturierte **Spec**, die Ihre Überlegungen bis hin zu ausführenden Agents trägt.

![Der Planungsstack verengt sich von der Idee über PRD und Architektur-Spec zu einer JSON-Aufgabenliste und schließlich zu ausführbaren Agent-Aufgaben](/blog/specs-planning.svg)

---

## Der Planungsstack

Builderforce gliedert die Planung in vier Schichten, die jeweils die nächste speisen:

```
Idea / goal (free text)
    │
    ▼
PRD (Product Requirements Document)  ◄── AI-assisted in Brainstorm
    │
    ▼
Architecture Spec                    ◄── AI-assisted in Brainstorm
    │
    ▼
Task list (JSON)                     ◄── AI-generated from spec
    │
    ▼
Executable tasks                     ──► Agent execution on BuilderForce Agents
```

Die Spec ist der Container, der alle vier Schichten an einem Ort zusammenhält.

---

## Start mit Brainstorm

[/brainstorm](/brainstorm) ist die Ideenumgebung – eine KI-gestützte Chat-Oberfläche, gebaut für Produktdenken, nicht fürs Coden.

Öffnen Sie Brainstorm und beginnen Sie mit einem Ziel:

> „Ich möchte ein Feature bauen, mit dem Nutzer ihre Projektaktivität als PDF-Bericht exportieren können.“

Der KI-Assistent hilft Ihnen dabei:

- **Das Ziel zu schärfen** – den Umfang festlegen, Annahmen hinterfragen, Grenzfälle erkennen
- **Das PRD zu entwerfen** – User Stories, Akzeptanzkriterien, nicht-funktionale Anforderungen, Abgrenzungen
- **Die Architektur-Spec zu erstellen** – Komponentenaufteilung, Änderungen am Datenmodell, API-Design, Migrationsaspekte

Wenn Sie mit dem Ergebnis zufrieden sind, klicken Sie auf **Als Spec speichern**, um einen mit Ihrem Projekt verknüpften Spec-Datensatz anzulegen.

---

## Der Spec-Datensatz

Eine Spec liegt unter [/tasks](/tasks) → Tab **Specs**. Jede Spec durchläuft einen Status-Lebenszyklus:

```
draft → reviewed → approved → in_progress → done
```

Die Spec speichert:

| Feld | Inhalt |
|---|---|
| **Ziel** | Ein Satz, der beschreibt, was diese Spec erreicht |
| **PRD** | Vollständiges Product Requirements Document (Markdown) |
| **Architektur-Spec** | Technisches Designdokument (Markdown) |
| **Aufgabenliste** | JSON-Array mit Aufgaben, bereit fürs Board |
| **Status** | Aktuelle Stufe im Freigabe-Workflow |
| **Verknüpfter agentHost** | Welche BuilderForce Agents-Instanz sie ausführt |
| **Verknüpftes Projekt** | Das Projekt, zu dem diese Spec gehört |

---

## Die Aufgabenliste erzeugen

Sobald PRD und Architektur-Spec geschrieben sind, kann Builderforce (oder ein KI-Assistent im Spec-Editor) die **Aufgabenliste** erzeugen – eine strukturierte Aufschlüsselung aller Arbeitsschritte, die für die Umsetzung der Spec nötig sind.

Ein Eintrag in der Aufgabenliste sieht so aus:

```json
{
  "title": "Add PDF export endpoint to the API",
  "description": "Implement POST /api/projects/:id/export/pdf that streams a generated PDF using Puppeteer",
  "priority": "medium",
  "persona": "coder",
  "dependsOn": ["Add PDF template component"]
}
```

Die Aufgabenliste wird im Spec-Editor geprüft. Sie können Aufgaben hinzufügen, entfernen und neu anordnen, Prioritäten anpassen und Personas zuweisen (welche BuilderForce Agents-Rolle die jeweilige Aufgabe übernehmen soll).

---

## Übergabe ans Aufgaben-Board

Sobald die Spec `approved` ist, klicken Sie auf **Aufgaben erstellen**, um die Aufgabenliste auf das Board [Aufgaben](/tasks) zu übertragen. Jeder Eintrag der Liste wird zu einem Aufgabendatensatz im Backlog.

Ab hier folgen die Aufgaben dem normalen Lebenszyklus – sie können triagiert, priorisiert, bestimmten agentHosts zugewiesen und zur Ausführung eingereicht werden. Die Spec bleibt mit jeder Aufgabe verknüpft, sodass Sie jede Aufgabe jederzeit bis zum ursprünglichen PRD zurückverfolgen können.

---

## Spec-Workflows

Wenn Sie eine Spec zur Ausführung einreichen (statt sie in einzelne Aufgaben umzuwandeln), erstellt Builderforce einen **Spec-Workflow** – eine BuilderForce Agents-Orchestrierung, die die gesamte Spec als eine Arbeitseinheit behandelt.

Der Spec-Workflow-Typ `planning` durchläuft:

1. **Planer** – liest Ziel und PRD der Spec und erstellt einen detaillierten Ausführungsplan
2. **Architekt** – prüft die Architektur-Spec und erstellt Umsetzungshinweise
3. **Coder** – setzt auf Basis des Plans die erste Runde an Änderungen um
4. **Reviewer** – prüft den Code gegen die Akzeptanzkriterien der Spec

Jeder Schritt erscheint während der Ausführung im Portal [Workflows](/workflows). Sie können den Agents in Echtzeit dabei zusehen, wie sie die Spec abarbeiten.

---

## Zusammenarbeit an Specs

Specs sind gemeinsame Dokumente – jedes Teammitglied mit Zugriff auf das Projekt kann die Spec lesen, kommentieren und bearbeiten. Der Brainstorm-Chatverlauf bleibt mit der Spec gespeichert, sodass die Begründung hinter Entscheidungen immer sichtbar ist.

Bei Specs, die Produktivsysteme betreffen, fügen Sie vor der Freigabe einen **Reviewer** hinzu. Der Reviewer wird benachrichtigt, und seine Freigabe verschiebt die Spec von `reviewed` nach `approved`. Das ist ein schlankes menschliches Gate vor Arbeitsbeginn – getrennt von den Freigabe-Gates auf Ausführungsebene, die während der Agent-Arbeit greifen.

---

## Integration mit der Quellcodeverwaltung

Wenn die Aufgaben einer Spec abgeschlossen sind und ein Pull Request erstellt wurde, können Sie den PR mit der Spec verknüpfen:

1. Öffnen Sie die Aufgabe, aus der der PR entstanden ist
2. Fügen Sie die GitHub-PR-URL in das Feld **PR-URL** ein
3. Der Status der Spec aktualisiert sich automatisch, sobald der PR gemergt wird

Wenn Sie eine GitHub-Integration zur Quellcodeverwaltung eingerichtet haben (Einstellungen → Quellcodeverwaltung), kann BuilderForce Agents PRs automatisch erstellen und verknüpfen – ganz ohne manuellen Schritt.

---

## Governance und Vorgaben

Das Architekturdokument der Spec ist auch der richtige Ort, um die **Projekt-Governance** festzuhalten – die Regeln, die Ihre Agents bei der Arbeit in diesem Projekt befolgen müssen. Governance-Dokumente werden als Teil des Zuweisungskontexts in die `.builderforce/context.yaml` des agentHost synchronisiert, sodass Agents sie beim Start laden und während der gesamten Ausführung befolgen.

Beispiele für Governance:

- „Jede Datenbankänderung muss eine Migrationsdatei enthalten“
- „Keine direkten Schreibzugriffe auf die Tabelle `users` – nutzen Sie den UserService“
- „Jeder PR muss Tests für neue Funktionalität enthalten“
- „Niemals `eval()` oder den `Function()`-Konstruktor verwenden“

Agents, die mit passenden Skills trainiert sind, interpretieren diese Vorgaben ganz selbstverständlich und wenden sie ohne weitere Aufforderung an.

---

## Best Practices

**Schreiben Sie das PRD vor der Architektur-Spec.** Es ist verlockend, direkt zum „Wie bauen wir das?“ zu springen – doch ein klares PRD zwingt Sie, zuerst „Welches Problem lösen wir?“ zu beantworten. Architekturentscheidungen, die sich aus einer klaren Problemstellung ergeben, liegen deutlich seltener daneben.

**Halten Sie Aufgaben klein und atomar.** Eine Aufgabe, für die ein erfahrener Engineer 4 Stunden braucht, hat die richtige Größe für einen Agent. Größere Aufgaben führen oft zu ausufernden Implementierungen, die schwer zu reviewen und zurückzurollen sind.

**Nutzen Sie Personas in der Aufgabenliste.** Eine `coder`-Aufgabe und eine `reviewer`-Aufgabe für dasselbe Feature stellen sicher, dass sowohl Umsetzung als auch Review stattfinden – nicht nur eines von beiden. Die Aufgabenliste der Spec ist der richtige Ort, um diese Disziplin durchzusetzen.

**Prüfen Sie die Architektur-Spec vor der Freigabe.** Agents setzen bemerkenswert gut um, was Sie beschreiben. Ist die Architektur-Spec falsch, reproduziert die Implementierung den Fehler getreu.

---

## Nächste Schritte

- Öffnen Sie [Brainstorm](/brainstorm) und schreiben Sie Ihre nächste Feature-Spec mit KI-Unterstützung
- Wechseln Sie zu [Aufgaben](/tasks) → Specs, um Ihre aktuellen Planungsdokumente zu sehen
- Lesen Sie [Aufgabenausführung und Observability](/blog/task-execution-and-observability), um zu verstehen, was passiert, sobald Aufgaben erstellt und an Agents übergeben werden
- In [Freigabe-Gates](/blog/approval-gates-and-human-oversight) erfahren Sie, wie Sie menschliche Checkpoints bei der Spec-Freigabe und in der Aufgabenausführung einbauen
