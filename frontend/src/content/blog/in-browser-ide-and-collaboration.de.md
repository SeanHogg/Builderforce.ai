Eine Entwicklungsumgebung einzurichten gehört zu den Aufgaben, die zwischen 20 Minuten und mehreren Tagen dauern und einem dabei herzlich wenig beibringen. Repo klonen, die richtige Node-Version installieren, Umgebungsvariablen setzen, mit nativen Abhängigkeiten kämpfen, feststellen, dass die README drei Jahre alt ist.

Die In-Browser-IDE von Builderforce macht all das überflüssig. Browser öffnen, Projekt öffnen – und Sie arbeiten in einer echten Node.js-Umgebung, mit Dateisystem, Paketmanager, Dev-Server, Terminal und KI-Pair-Programmer, ohne irgendetwas zu installieren.

![Mockup einer dreigeteilten Browser-IDE mit einem Datei-Explorer, dem Monaco-Code-Editor und einem rechten Bereich, der zwischen Vorschau, Terminal und KI-Chat umschaltet](/blog/in-browser-ide.svg)

---

## So funktioniert es: WebContainers

Die IDE basiert auf **WebContainers** – einer WebAssembly-basierten Node.js-Runtime, die vollständig im Browser-Tab läuft. WebContainers bietet:

- Ein echtes, POSIX-kompatibles Dateisystem (im Arbeitsspeicher, mit Persistenz in R2)
- Eine vollständige Node.js-Runtime mit Unterstützung für native Module
- Die Möglichkeit, `npm install`, `npm run dev`, `npm test` auszuführen – genau wie lokal
- Eine localhost-Netzwerkschicht, die der Browser erreichen kann – Port 3000 Ihres Dev-Servers ist direkt im Vorschaubereich zugänglich

Das ist keine Simulation und keine entfernte VM. Der Code läuft in Ihrem Browser. Der Dev-Server läuft in Ihrem Browser. An der Ausführung selbst ist keinerlei serverseitige Rechenleistung beteiligt.

---

## Die IDE öffnen

Rufen Sie [/ide](/ide) auf und wählen Sie ein Projekt, oder öffnen Sie die IDE direkt von der Detailseite eines Projekts aus.

Die IDE hat ein dreigeteiltes Layout:

```
┌─────────────┬──────────────────────────────┬──────────────┐
│ File        │                              │              │
│ Explorer    │  Code Editor (Monaco)        │  Preview /   │
│             │                              │  Terminal /  │
│  src/       │  // Your code here           │  AI Chat     │
│  ├ app/     │                              │              │
│  ├ api/     │                              │              │
│  └ tests/   │                              │              │
└─────────────┴──────────────────────────────┴──────────────┘
```

### Linker Bereich – Datei-Explorer

Dateien durchsuchen, anlegen, umbenennen und löschen. Der Dateibaum spiegelt das Live-Dateisystem von WebContainers wider – Ihre Änderungen im Editor erscheinen sofort, und Änderungen von Agents (über BuilderForce Agents) erscheinen, sobald sie geschrieben werden.

### Mittlerer Bereich – Monaco-Editor

Der vollständige Monaco-Editor – dieselbe Engine, die auch VS Code antreibt. Sie erhalten:

- Syntaxhervorhebung für alle gängigen Sprachen
- TypeScript-Language-Server (Typprüfung, Autovervollständigung, Go-to-Definition)
- Inline-Markierungen für Fehler und Warnungen
- Tabs für mehrere Dateien mit Anzeige ungespeicherter Änderungen
- Suchen/Ersetzen im gesamten Projekt

### Rechter Bereich – kontextabhängig

Der rechte Bereich wechselt über den Umschalter oben zwischen drei Ansichten:

| Ansicht | Inhalt |
|---|---|
| **Vorschau** | Live-iframe, verbunden mit dem localhost des WebContainers; aktualisiert sich automatisch, wenn Ihr Dev-Server per Hot Reload neu lädt |
| **Terminal** | Vollständiges Terminal, verbunden mit der Shell des WebContainers – führen Sie jeden beliebigen Befehl aus |
| **KI-Chat** | Der KI-Pair-Programmer (siehe unten) |

---

## Der KI-Pair-Programmer

Der KI-Chat-Bereich ist eine dialogorientierte Oberfläche, die Ihren aktuellen Projektkontext vollständig kennt:

- **Geöffnete Dateien** – die KI weiß, was Sie gerade ansehen
- **Dateibaum** – sie versteht die Projektstruktur
- **Terminalausgabe** – sie sieht Fehler Ihres Dev-Servers oder Test-Runners
- **Git-Verlauf** – sie hat Zugriff auf die letzten Commits

Fragen Sie sie alles im Kontext Ihrer Arbeit:

> „Diese Komponente rendert zu oft neu. Kannst du herausfinden, warum, und eine Lösung vorschlagen?“

> „Schreib einen Test für das Utility `parseDate`, der Randfälle abdeckt.“

> „Die API liefert einen 500er. Der Fehler steht oben im Terminal – was ist falsch?“

Die KI kann Ihre Dateien direkt bearbeiten (mit Ihrer Zustimmung), Befehle im Terminal ausführen und dabei erklären, was sie gerade tut.

---

## Zusammenarbeit in Echtzeit

Laden Sie eine Teamkollegin oder einen Teamkollegen in Ihre IDE-Session ein, und Sie arbeiten gleichzeitig in derselben Umgebung.

Die Zusammenarbeit basiert auf **Yjs** – einer CRDT-basierten Bibliothek für Echtzeit-Synchronisierung – über ein WebSocket-Relay auf Basis eines Builderforce Durable Object:

- **Cursor-Präsenz** – Sie sehen, wo sich der Cursor jeder beteiligten Person befindet
- **Live-Bearbeitung** – Änderungen erscheinen in Echtzeit, ohne Konflikte
- **Chat** – ein Chat-Kanal in der Seitenleiste der IDE-Session
- **Gemeinsames Terminal** – Befehle, die eine Person ausführt, sind für alle sichtbar

Es gibt keinen „Owner“ – alle Beteiligten haben gleichberechtigten Zugriff auf Dateisystem, Terminal und Editor. Der zugrunde liegende Zustand des WebContainers ist für alle Teilnehmenden konsistent.

An Collaboration-Sessions können sowohl Menschen als auch Agents teilnehmen. Arbeitet ein BuilderForce Agents-Agent am selben Projekt, kommen seine Dateiänderungen als Live-Änderungen im Editor an – Sie sehen dem Agent beim Schreiben von Code zu, im selben Fenster, in dem Sie ihn reviewen.

---

## Anbindung an BuilderForce Agents

Die IDE und BuilderForce Agents sind zwei Wege, mit demselben Projekt zu arbeiten. Die IDE ist die browsernative Oberfläche; BuilderForce Agents ist die selbst gehostete agentische Runtime. Gemeinsam haben sie:

- **Dasselbe Dateisystem** – BuilderForce Agents synchronisiert seinen Workspace mit Builderforce; die IDE liest aus dem synchronisierten Stand
- **Dasselbe Task-Board** – Aufgaben, die im Aufgabenbereich der IDE angelegt werden, sind dieselben Aufgaben, die BuilderForce Agents ausführt
- **Denselben Chatverlauf** – Nachrichten, die Sie im Chat der IDE senden, werden an die aktive BuilderForce Agents-Session weitergeleitet; die Antworten von BuilderForce Agents erscheinen in Echtzeit im IDE-Chat

Die IDE ist also nicht bloß ein Code-Editor – sie ist ein **Fenster in die Arbeit des Agents**. Während BuilderForce Agents auf Ihrem Server einen Workflow ausführt, können Sie in der IDE zusehen, wie sich die Dateien ändern, im Chatbereich die Überlegungen des Agents verfolgen und eingreifen, wenn etwas falsch aussieht – ohne den Browser zu verlassen.

---

## Projekt-Setup aus der IDE

Ein neues Projekt von Grund auf starten:

1. Legen Sie unter [/projects](/projects) ein Projekt an → **Neues Projekt**
2. Wählen Sie eine Vorlage (Next.js, Vite + React, Node + Express, leer)
3. Öffnen Sie das Projekt in der IDE – WebContainers initialisiert sich, die Abhängigkeiten werden installiert, der Dev-Server startet
4. Der Vorschaubereich zeigt Ihre laufende App

Vorlagen führen `npm install` automatisch aus, wenn der Container zum ersten Mal initialisiert wird. Bei jedem weiteren Öffnen wird der letzte Stand des Dateisystems aus R2 wiederhergestellt – Ihre Session macht also genau dort weiter, wo Sie aufgehört haben.

---

## Integration der Quellcodeverwaltung

Für Projekte mit konfigurierter Source-Control-Integration bringt die IDE eine eingebaute Git-Unterstützung mit:

- **Statusleiste** – zeigt den aktuellen Branch und nicht committete Änderungen
- **Commit-Bereich** – stagen, committen und pushen, ohne die IDE zu verlassen
- **PR-Erstellung** – einen Pull Request direkt aus der IDE öffnen, wenn Ihre Arbeit fertig ist
- **Branch-Wechsel** – Branches auschecken, Feature-Branches anlegen, mergen

In der IDE committete Änderungen lösen die Verzeichnissynchronisierung von BuilderForce Agents aus – der lokale Workspace des AgentHosts wird angeglichen, sodass IDE und lokaler Agent-Zustand synchron bleiben.

---

## Wann die IDE, wann BuilderForce Agents?

| Nutzen Sie die IDE | Nutzen Sie BuilderForce Agents |
|---|---|
| Dateien direkt erkunden und bearbeiten | Lange autonome Workflows ausführen |
| Pair Programming mit der KI an einem konkreten Problem | Aufgaben im Batch über ein ganzes Projekt hinweg ausführen |
| Von Agents erzeugte Diffs reviewen und freigeben | Aufgaben abarbeiten, die aus dem Portal verteilt werden |
| Zusammenarbeit in Echtzeit mit dem Team | Unbeaufsichtigte Arbeit über Nacht |
| Kurze Terminalbefehle ausführen | Dauerhaft laufende Hintergrunddienste |

Beide sind dafür gemacht, zusammen genutzt zu werden – starten Sie ein Feature in der IDE mit KI-Unterstützung, übergeben Sie die Umsetzung an einen BuilderForce Agents-Workflow und reviewen Sie die Ergebnisse in der IDE, wenn der Agent fertig ist.

---

## Best Practices

**Lassen Sie bei Frontend-Arbeit den Vorschaubereich offen.** Das sofortige Feedback der Hot-Reload-Vorschau ist eine der größten Verbesserungen im Workflow der Browser-IDE – ignorieren Sie es nicht zugunsten des Terminals allein.

**Nutzen Sie das Terminal für einmalige Befehle, den Agent für wiederkehrende Muster.** Wenn Sie `npm test` mehr als dreimal ausführen, um dasselbe Problem zu debuggen, beschreiben Sie den Fehler im KI-Chat und lassen Sie ihn die Iterationsschleife übernehmen.

**Committen Sie in der IDE häufig.** Kleine, häufige Commits geben Ihnen und BuilderForce Agents einen sauberen Verlauf, mit dem sich arbeiten lässt. Große, nicht committete Änderungsmengen verwirren Agents, die den Git-Verlauf als Kontext lesen.

**Weisen Sie das IDE-Projekt einer BuilderForce Agents-Instanz zu.** Mit einem angebundenen AgentHost ist die IDE leistungsfähiger – der KI-Chat im rechten Bereich kann dann an die vollständige Agent-Runtime verteilen, nicht nur an das Modell im Browser.

---

## Nächste Schritte

- Öffnen Sie ein Projekt in der [IDE](/ide) und erkunden Sie das dreigeteilte Layout
- Laden Sie jemanden aus Ihrem Team zur Zusammenarbeit ein – teilen Sie die Session-URL aus dem IDE-Header
- Lesen Sie [BuilderForce Agents und Agent-Integration](/blog/agents-and-agent-integration), um zu verstehen, wie BuilderForce Agents erweitert, was Sie in der IDE bauen
- Lesen Sie [WebGPU- und LoRA-Training](/blog/webgpu-lora-explained), wenn Sie Modelle direkt im Browser auf Ihre Codebasis feinabstimmen möchten
