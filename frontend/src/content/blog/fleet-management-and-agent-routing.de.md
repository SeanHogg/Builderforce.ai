Eine einzelne BuilderForce Agents-Instanz auf dem Laptop eines Entwicklers ist bereits leistungsstark. Eine Flotte von zehn – jede auf eine andere Art von Arbeit spezialisiert, verteilt über mehrere Maschinen, die Aufgaben an die jeweils am besten geeignete Instanz weiterleitet – ist etwas völlig anderes.

Builderforce.ai ist die Steuerungsebene für diese Flotte. Dieser Beitrag erklärt, wie Sie Instanzen registrieren, Fähigkeiten deklarieren, Aufgaben intelligent routen und Ihr Mesh im Portal überwachen.

![Flotten-Routing: Eine eingehende Aufgabe mit deklarierten erforderlichen Fähigkeiten wird vom Flotten-Router gegen die Online-AgentHosts bewertet und an den am besten passenden Host verteilt, während Offline-Hosts und Hosts mit teilweiser Übereinstimmung übersprungen oder als Fallback vorgehalten werden](/blog/fleet-routing.svg)

---

## Was ist eine AgentHost-Flotte?

Eine **AgentHost-Flotte** umfasst alle BuilderForce Agents-Instanzen, die bei Ihrem Mandanten registriert sind. Jede Instanz ist eine Maschine, auf der das BuilderForce Agents-Gateway läuft – das kann der Laptop eines Entwicklers sein, ein dedizierter Server, ein CI-Worker oder eine Cloud-VM.

Im Builderforce-Portal sehen Sie Ihre Flotte im [Dashboard](/dashboard) und im Detailbereich des AgentHosts. Zu jedem AgentHost werden angezeigt:

- **Status** – online/offline (abhängig davon, wie aktuell der letzte Heartbeat ist)
- **Maschinenprofil** – Hostname, IP, Workspace-Pfad, Tunnel-URL
- **Zuletzt gesehen** – wann der AgentHost zuletzt einen Heartbeat gesendet hat
- **Fähigkeiten** – was der AgentHost nach eigener Angabe kann
- **Zugewiesene Projekte** – welche Projekte mit ihm verknüpft sind
- **Nutzungsstatistik** – aktueller Token-Verbrauch, Anzahl der Ausführungen

---

## Einen neuen AgentHost registrieren

So fügen Sie Ihrer Flotte einen AgentHost hinzu:

1. Gehen Sie zu [Dashboard](/dashboard) → **Add AgentHost**
2. Vergeben Sie einen Namen und einen Slug (z. B. `backend-server-1`)
3. Kopieren Sie den generierten API-Schlüssel – er wird **einmalig** angezeigt und lässt sich später nicht mehr abrufen
4. Setzen Sie auf der Zielmaschine:

```bash
export BUILDERFORCE_AGENTS_LINK_API_KEY=<your-api-key>
export BUILDERFORCE_AGENTS_LINK_URL=https://api.builderforce.ai
builderforce start
```

Der AgentHost registriert sich beim ersten Heartbeat automatisch. Maschinenprofil, Workspace-Pfad und Netzwerk-Metadaten werden aus dem Payload dieses ersten Heartbeats befüllt.

---

## Heartbeats und Präsenz

Ein verbundener AgentHost sendet alle 5 Minuten einen **Heartbeat** über `PATCH /api/agent-hosts/:id/heartbeat`. Der Heartbeat aktualisiert:

- `lastSeenAt` – bestimmt den Online-/Offline-Status
- `connectedAt` – wird beim ersten Heartbeat gesetzt
- `capabilities` – die deklarierten Fähigkeiten (siehe unten)
- `machineProfile` – Hostname, IP, Ports, Tunnel-URL

Ein AgentHost gilt als **online**, wenn sein `lastSeenAt` innerhalb der letzten 10 Minuten liegt. Geht ein AgentHost offline, bleiben ihm zugewiesene Aufgaben in der Warteschlange – sie werden nicht automatisch umgeleitet, es sei denn, Sie konfigurieren einen Fallback.

---

## Deklaration von Fähigkeiten

Fähigkeiten sind das Routing-Vokabular des Mesh. Ein AgentHost deklariert, was er kann; das Portal nutzt diese Angaben, um Aufgaben an den am besten passenden Host zu leiten.

Jeder AgentHost deklariert seine Fähigkeiten im Heartbeat-Payload:

```json
{
  "capabilities": ["chat", "tasks", "relay", "remote-dispatch"],
  "declaredCapabilities": ["typescript", "react", "testing", "refactor"]
}
```

Die erste Menge (`capabilities`) ist die Protokolloberfläche von BuilderForce Agents. Die zweite (`declaredCapabilities`) ist Ihr eigenes Vokabular – welche Labels Sie auch immer zur Kategorisierung von Arbeit verwenden.

### Abfrage nach Fähigkeit

Von jedem AgentHost aus (oder über das Portal) können Sie fragen: *„Welcher AgentHost in der Flotte eignet sich am besten für diese Arbeit?“*

```
GET /api/agent-hosts/fleet/route?requires=typescript,testing
```

Die Antwort liefert den am besten passenden Online-AgentHost für die angegebenen Fähigkeiten, wobei AgentHosts bevorzugt werden, die alle angefragten Fähigkeiten deklarieren.

---

## Smartes Routing mit `remote:auto`

Ihre eigentliche Stärke spielen deklarierte Fähigkeiten beim **automatischen Routing** in BuilderForce Agents-Workflows aus.

Geben Sie in einem Workflow `remote:auto[caps]` als Agent-Rolle an, fragt der verteilende AgentHost die Flotte ab, findet den besten Treffer und leitet die Aufgabe weiter:

```yaml
# .builderforce/workflows/feature-build.yaml
steps:
  - role: planner
    description: "Break down the feature into tasks"

  - role: remote:auto[typescript,react]
    description: "Implement the UI components"

  - role: remote:auto[testing]
    description: "Write unit tests for the implementation"

  - role: reviewer
    description: "Review the complete implementation"
```

Der Schritt `remote:auto[typescript,react]` wird an den Online-AgentHost der Flotte verteilt, der diese beiden Fähigkeiten am besten abdeckt. Ist dieser AgentHost ausgelastet, wird der nächstbeste gewählt.

---

## Manuelles Routing mit `remote:<id>`

Für Fälle, in denen Sie deterministisches Routing wollen – etwa Frontend-Aufgaben immer auf einer bestimmten Workstation –, verwenden Sie direkt den Slug oder die numerische ID des AgentHosts:

```
remote:frontend-workstation
remote:42
```

Damit wird die Bewertung nach Fähigkeiten umgangen und direkt an diesen AgentHost verteilt. Ist er offline, schlägt die Aufgabe sofort fehl, statt auf einen anderen Host auszuweichen.

---

## Der AgentHost-Detailbereich

Klicken Sie im [Dashboard](/dashboard) auf einen beliebigen AgentHost, um seinen Detailbereich zu öffnen. Er hat mehrere Tabs:

### Chat
Ein Live-Terminal in die aktive Chat-Session des AgentHosts – Sie können Aufgaben senden, gestreamte Antworten verfolgen und dem Agent in Echtzeit bei der Arbeit zusehen.

### Sessions
Der Verlauf aller Sessions, die auf diesem AgentHost gelaufen sind, mit Startzeit, Dauer und Token-Verbrauch. Ein Klick auf eine Session zeigt ihr vollständiges Transkript.

### Projekte
Welchen Projekten dieser AgentHost zugewiesen ist. In diesem Tab können Sie Projekte zuweisen und die Zuweisung aufheben.

### Skills
Die aktuell auf diesem AgentHost geladenen Skills – sowohl Zuweisungen auf Mandantenebene als auch AgentHost-spezifische Überschreibungen. Änderungen hier werden beim nächsten Neustart des AgentHosts wirksam (Skills werden beim Start abgerufen).

### Workspace
Das Verzeichnis, das dieser AgentHost mit Builderforce synchronisiert hat – Dateiinventar, Sync-Status und Zeitstempel der letzten Synchronisierung.

### Nutzung
Token-Verbrauch pro Session, Auslastung des Kontextfensters und Compaction-Ereignisse. Hilfreich, um ein ausuferndes Kontextfenster zu erkennen, bevor es zum Problem wird.

### Debug
Rohes Maschinenprofil, Netzwerk-Metadaten, Status der Relay-Verbindung und die letzten 20 Heartbeat-Payloads. Die erste Anlaufstelle, wenn ein AgentHost unerwartet offline ist.

---

## Projektzuweisung

Ein AgentHost ohne zugewiesenes Projekt hat keinen Kontext – er weiß nicht, welche Codebasis, welche Regeln oder welches Gedächtnis er laden soll. Weisen Sie jedem AgentHost mindestens ein Projekt zu:

1. Öffnen Sie den AgentHost-Detailbereich → Tab **Projekte**
2. Klicken Sie auf **Assign Project** und wählen Sie das Projekt aus
3. Der AgentHost ruft den aktualisierten Zuweisungskontext bei seinem nächsten Heartbeat ab

Ein AgentHost kann mehreren Projekten zugewiesen sein. Welches Projekt aktiv ist, bestimmt die gerade ausgeführte Aufgabe – der AgentHost lädt den passenden Projektkontext automatisch.

---

## AgentHost-zu-AgentHost-Dispatch

AgentHosts in derselben Flotte können einander Aufgaben direkt delegieren, ohne den Umweg über das Portal. Das ist das **AgentHost-zu-AgentHost-Mesh**.

Jeder Dispatch zwischen AgentHosts ist:

- **HMAC-signiert** – jeder Payload trägt einen Header `X-AgentHost-Signature: sha256=<hex>`; der empfangende AgentHost prüft die Signatur vor der Ausführung
- **Bearer-authentifiziert** – `Authorization: Bearer <apiKey>` bei jeder Anfrage
- **Relay-gestützt** – AgentHosts hinter NAT oder Firewalls erreichen einander über das `AgentHostRelayDO` Durable Object auf Builderforce; ein direkter Netzwerkpfad ist nicht nötig

Die Relay-Topologie sieht so aus:

```
AgentHost A (laptop) ──────────────────────────────► Builderforce relay
                                                      │
                                         dispatches to AgentHost B via relay
                                                      │
                                              AgentHost B (server) ◄───────
```

Keiner der beiden AgentHosts muss aus dem Netzwerk des anderen erreichbar sein. Das Routing übernimmt Builderforce.

---

## Flottenüberblick im großen Maßstab

Für Teams mit vielen AgentHosts zeigt die Flottenansicht im [Dashboard](/dashboard) alle Instanzen in einer einzigen Tabelle. Filtern können Sie nach:

- **Status** – nur online
- **Projekt** – AgentHosts, die einem bestimmten Projekt zugewiesen sind
- **Fähigkeit** – AgentHosts, die ein bestimmtes Fähigkeits-Tag deklarieren

Die Flottenansicht ist die Kommandozentrale Ihres Mesh. Sie wollen die Arbeit auf einem AgentHost pausieren? Setzen Sie seinen Status auf `inactive`. Sie vermuten, dass ein AgentHost sich fehlerhaft verhält? Prüfen Sie sein Tool-Audit-Log. Sie wollen eine neue Skill-Zuweisung an alle AgentHosts ausrollen? Aktualisieren Sie sie auf Mandantenebene, und jeder AgentHost übernimmt sie beim nächsten Start.

---

## Best Practices

**Geben Sie AgentHosts aussagekräftige Namen.** `agentHost-1`, `agentHost-2` wird schnell unübersichtlich. `backend-sean-mbp`, `frontend-ci-worker`, `refactor-server` macht die Flottenansicht auf einen Blick lesbar.

**Deklarieren Sie Fähigkeiten präzise.** Vermeiden Sie Sammelbegriffe wie `general` oder `everything`. Je enger Ihr Fähigkeitsvokabular, desto besser die Entscheidungen beim automatischen Routing. Ist ein AgentHost gut in Python und schwach in TypeScript, deklarieren Sie `python` und nicht `typescript`.

**Weisen Sie jedem AgentHost nach Möglichkeit ein Hauptprojekt zu.** AgentHosts mit vielen Projektzuweisungen laden beim Start mehr Kontext und können Arbeit in den falschen Projektkontext leiten. Ein AgentHost, eine Codebasis – das ist das klarste mentale Modell.

**Überwachen Sie `lastSeenAt` in der Produktion.** Richten Sie einen Grafana-Alarm ein (oder nutzen Sie die Benachrichtigungs-Hooks des Portals, sobald verfügbar), wenn ein AgentHost während der Arbeitszeit länger als 15 Minuten offline ist – das bedeutet meist einen Prozessabsturz oder eine Netzwerkänderung.

---

## Nächste Schritte

- Registrieren Sie einen neuen AgentHost über [Dashboard](/dashboard) → Add AgentHost
- Lesen Sie [Multi-Agent-Orchestrierung](/blog/multi-agent-orchestration), um zu sehen, wie sich `remote:auto` in einen vollständigen Workflow einfügt
- Lesen Sie [Skill-Zuweisung](/blog/skills-assignment-and-the-marketplace), um zu verstehen, wie Sie die AgentHosts Ihrer Flotte mit im Portal verwalteten Fähigkeiten ausstatten
