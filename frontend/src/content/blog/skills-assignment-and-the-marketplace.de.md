Die eingebauten Fähigkeiten eines Agents sind sein Ausgangspunkt. Mit Skills erweitern Sie diese Fähigkeiten – Sie bringen Fachwissen, API-Integrationen, strukturierte Workflows und Spezialverhalten ein, ohne das zugrunde liegende Modell neu zu trainieren.

Builderforce bietet zwei Wege, Skills auf Ihre Agents zu bringen: den **Skills-Marktplatz** (von der Community veröffentlicht, zum Durchstöbern und Zuweisen) und **eigene Skills** (Sie bauen sie, sie gehören Ihnen). Beide folgen demselben Zuweisungsmodell, und beide werden beim Start automatisch in Ihre BuilderForce Agents-Instanzen geladen.

![Das Skill-System: Skills im Marktplatz durchstöbern oder veröffentlichen, auf Mandanten-, AgentHost-, Projekt- oder Task-Ebene zuweisen – wobei Task-Zuweisungen Vorrang haben –, und das zusammengeführte Set wird beim Start in die Skill-Registry jedes AgentHosts geladen](/blog/skills-marketplace.svg)

---

## Was ist ein Skill?

Ein Skill ist eine strukturierte Erweiterung von Fähigkeiten. Im einfachsten Fall ist ein Skill ein **Fragment des System-Prompts**, das einem Agent bestimmtes Wissen oder bestimmte Anweisungen mitgibt. Anspruchsvollere Skills enthalten:

- **Tool-Definitionen** – strukturierte Funktionssignaturen, die der Agent aufrufen kann (z. B. ein GitHub-API-Skill, der `create_pr`, `add_comment`, `merge_branch` definiert)
- **Workflow-Vorlagen** – Schritt-für-Schritt-Runbooks, denen der Agent folgt (z. B. ein Incident-Response-Skill, der den Ablauf Triage → Diagnose → Behebung → Kommunikation festlegt)
- **Fachwissen** – eingebettetes Referenzmaterial, das der Agent bei der Inferenz nutzt (z. B. ein `typescript-strict`-Skill, der die TypeScript-Konventionen Ihres Teams enthält)

Ist ein Skill geladen, verhält sich der Agent so, als hätte er alles darin schon immer gewusst. Kein zusätzliches Prompting nötig.

---

## Der Skills-Marktplatz

Unter [/skills](/skills) finden Sie die von der Community veröffentlichten Skills.

Jeder Skill-Eintrag zeigt:

| Feld | Beschreibung |
|---|---|
| **Name und Slug** | Eindeutige Kennung für die Zuweisung (`org/skill-name`) |
| **Beschreibung** | Was der Skill dem Agent beibringt |
| **Kategorie** | Grobe Domänen-Kennzeichnung (Entwicklung, Betrieb, Marketing usw.) |
| **Tags** | Detaillierte Fähigkeits-Tags zum Filtern |
| **Version** | Aktuell veröffentlichte Version |
| **Downloads** | Wie oft der Skill zugewiesen wurde |
| **Likes** | Qualitätssignal aus der Community |
| **Autor** | Wer ihn veröffentlicht hat |

### Durchstöbern und Filtern

Die Marktplatz-Suche unterstützt:

- **Volltext** – durchsucht Name, Beschreibung und Tags
- **Kategoriefilter** – nach Domäne eingrenzen
- **Tag-Filter** – Skills mit bestimmten Fähigkeits-Tags finden
- **Sortierung** – nach Downloads, Likes oder Neuheit

### Einen Skill veröffentlichen

Wenn Sie für Ihre Agents einen Skill gebaut haben, von dem andere Teams profitieren könnten:

1. Gehen Sie zu [/skills](/skills) → **Skill veröffentlichen**
2. Tragen Sie Name, Slug, Beschreibung, Kategorie und Tags ein
3. Fügen Sie Ihre Skill-Definition ein (System-Prompt-Fragment, Tool-Schemas oder Workflow-Vorlage)
4. Klicken Sie auf **Veröffentlichen**

Veröffentlichte Skills sind sofort im Marktplatz auffindbar. Metadaten und Inhalt können Sie jederzeit aktualisieren; veröffentlichte Versionen werden nachverfolgt, sodass Nutzer sich auf eine bestimmte Version festlegen können.

---

## Skills zuweisen

Ein Skill bewirkt nichts, solange er nicht **zugewiesen** ist – also mit den Agents oder AgentHosts verknüpft, die ihn nutzen sollen. Builderforce arbeitet mit einem zweistufigen Zuweisungsmodell.

### Zuweisungen auf Mandantenebene

Eine **Zuweisung auf Mandantenebene** macht einen Skill für **alle AgentHosts** Ihrer Organisation verfügbar. Nutzen Sie sie für Skills, die jeder Agent haben sollte – Ihre Coding-Standards, Ihre API-Konventionen, Ihr unternehmensspezifisches Tooling.

Mandantenzuweisungen verwalten Sie unter [/skills](/skills) → Tab **Mandantenzuweisungen**:

1. Suchen Sie den Skill-Slug oder fügen Sie ihn ein
2. Klicken Sie auf **Allen AgentHosts zuweisen**
3. Der Skill erscheint beim nächsten Start in der Skill-Registry jedes AgentHosts

### Zuweisungen auf AgentHost-Ebene

Eine **Zuweisung auf AgentHost-Ebene** überschreibt oder ergänzt einen Skill für eine bestimmte BuilderForce Agents-Instanz. So statten Sie einen spezialisierten AgentHost aus – Ihre `frontend-workstation` hat vielleicht React- und Tailwind-Skills, die kein anderer AgentHost braucht.

AgentHost-Zuweisungen verwalten Sie im Detailbereich des AgentHosts → Tab **Skills**:

1. Klicken Sie auf **Skill zuweisen**
2. Suchen und wählen Sie den Skill
3. Die Zuweisung greift beim nächsten Start des AgentHosts

Zuweisungen auf AgentHost-Ebene **überschreiben** Zuweisungen auf Mandantenebene, wenn derselbe Skill-Slug auf beiden Ebenen vorkommt – die AgentHost-spezifische Konfiguration gewinnt.

---

## Wie Skills beim Start geladen werden

Wenn BuilderForce Agents startet und eine Builderforce-Verbindung konfiguriert ist, ruft es die zusammengeführte Skill-Liste ab:

```
GET /api/agent-hosts/:id/skills
```

Zurück kommt die Vereinigungsmenge aus:
1. allen Skill-Zuweisungen auf Mandantenebene
2. allen AgentHost-spezifischen Überschreibungen für genau diesen AgentHost

Das zusammengeführte Set wird in die lokale **Skill-Registry** des AgentHosts geladen und steht den Agents für die gesamte Laufzeit dieses Prozesses zur Verfügung. Legen Sie im Portal eine neue Skill-Zuweisung an, übernimmt der AgentHost sie beim nächsten Neustart.

Welche Skills ein laufender AgentHost geladen hat, sehen Sie in seinen Startlogs:

```
[skill-registry] loaded 4 skill(s): typescript-strict, github-api, test-runner, our-coding-standards
```

Alternativ fragen Sie das Portal über den Tab **Skills** des AgentHosts ab, der den aktuellen Zuweisungsstand anzeigt.

---

## Artefakt-Zuweisungen: das vollständige Scope-Modell

Skills sind eine Art von **Artefakt**. Builderforce nutzt ein einheitliches System für **Artefakt-Zuweisungen**, das für Skills, Personas und Inhalte auf jeder Scope-Ebene funktioniert:

| Scope | Gilt für |
|---|---|
| `tenant` | Alle AgentHosts und Agents der Organisation |
| `agentHost` | Eine bestimmte BuilderForce Agents-Instanz |
| `project` | Jeden AgentHost, der an einem bestimmten Projekt arbeitet |
| `task` | Den Agent, der einen bestimmten Task ausführt |

Die Scope-Auflösung folgt dieser Rangfolge: `task > project > agentHost > tenant`. Ist einem Task ein bestimmter Skill zugewiesen, gewinnt diese Zuweisung – auch wenn die Mandantenzuweisung etwas anderes vorsieht.

Artefakt-Zuweisungen verwalten Sie unter [/skills](/skills) → **Artefakt-Zuweisungen**. Dort weisen Sie jeden Artefakttyp auf jeder Ebene über eine einzige Oberfläche zu.

---

## Eigene Skills bauen

Skills sind nicht nur etwas für den Marktplatz. Für internes Tooling, proprietäre Workflows oder unternehmensspezifische Konventionen bauen Sie private Skills, die Ihren Mandanten nie verlassen.

Eine Skill-Definition besteht aus drei Teilen:

**1. System-Prompt-Fragment**
```markdown
## Code Style
Always use TypeScript strict mode. Prefer `const` over `let`.
Never use `any` — use `unknown` and narrow with type guards.
All async functions must handle errors explicitly.
```

**2. Tool-Definitionen (optional)**
```json
{
  "name": "create_github_pr",
  "description": "Create a pull request on GitHub",
  "input_schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "branch": { "type": "string" },
      "base": { "type": "string", "default": "main" },
      "body": { "type": "string" }
    },
    "required": ["title", "branch"]
  }
}
```

**3. Metadaten**
```json
{
  "name": "Our TypeScript Standards",
  "slug": "acme/typescript-standards",
  "category": "development",
  "tags": ["typescript", "code-style", "internal"],
  "version": "1.0.0"
}
```

Private Skills (ohne das Flag `public` veröffentlicht) sind nur für Ihren Mandanten sichtbar.

---

## Zeitgesteuerte Skills per Cron

Skills können auch **geplante Jobs** tragen. Haben Sie einen Skill, der eine tägliche Stand-up-Zusammenfassung erstellt, ein wöchentliches Dependency-Audit durchführt oder nächtlich Tests laufen lässt, kombinieren Sie ihn mit einem Cron-Job im [Dashboard](/dashboard) → Tab **Cron**:

```
Schedule: 0 9 * * 1-5   (9am Monday–Friday)
Task: "Run the daily standup summary skill for project X"
```

Der Cron-Poller auf dem zugewiesenen AgentHost ruft den Zeitplan beim Start ab und führt den Task zur richtigen Zeit aus. Keine externe Cron-Infrastruktur nötig.

---

## Best Practices

**Ein Skill, ein Anliegen.** Ein Skill, der TypeScript, Tests, GitHub und Deployment zugleich abdeckt, ist schwer zu pflegen und schwer zu debuggen. Teilen Sie ihn in fokussierte Skills auf (`typescript-style`, `jest-patterns`, `github-actions`) und kombinieren Sie sie über Zuweisungen.

**Versionieren Sie Skills vor dem Update.** Wenn ein Skill-Update das Verhalten von Agents ändern würde, erhöhen Sie vor dem Veröffentlichen die Version. Nutzer, die auf `v1.2` festgelegt sind, bleiben unberührt; wer das neue Verhalten möchte, aktualisiert seine Zuweisung bewusst.

**Testen Sie Skills isoliert, bevor Sie sie mandantenweit zuweisen.** Weisen Sie einen neuen Skill zuerst einem AgentHost zu, lassen Sie ein paar Tasks laufen und prüfen Sie das Ergebnis. Sobald Sie sicher sind, heben Sie ihn auf Mandantenebene.

**Kombinieren Sie Personas mit Skills.** Ein Skill vermittelt Wissen; eine Persona prägt Tonfall und Entscheidungsstil. Die Kombination – ein AgentHost mit Ihrem TypeScript-Skill und Ihrer Persona „Senior Engineer“ – liefert konsistentere, markengerechtere Ergebnisse als jedes von beiden allein.

---

## Nächste Schritte

- Durchstöbern Sie den [Skills-Marktplatz](/skills) und weisen Sie Ihren ersten Community-Skill zu
- Lesen Sie [Multi-Agent-Orchestrierung](/blog/multi-agent-orchestration), um zu sehen, wie mit Skills ausgestattete AgentHosts in einen Workflow passen
- Erkunden Sie [Flottenmanagement](/blog/fleet-management-and-agentHost-routing), um zu verstehen, wie Skills mit den Fähigkeitsdeklarationen auf AgentHost-Ebene zusammenspielen
