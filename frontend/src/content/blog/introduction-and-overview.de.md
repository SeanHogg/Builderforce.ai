Softwareentwicklung verändert sich rasant. KI-Pair-Programmer, autonome Task-Runner und browserbasierte Trainings-Pipelines sind längst keine Science-Fiction mehr – sie sind die Werkzeuge, mit denen die besten Engineering-Teams heute arbeiten. **Builderforce.ai** ist die Plattform, die von Grund auf dafür gebaut wurde, all das an einem Ort zugänglich zu machen.

Dieser Beitrag ist Ihr Ausgangspunkt. Er erklärt, was Builderforce ist, warum es existiert, welche Grundideen dahinterstehen und wie es weitergeht.

![Die sechs zentralen Bausteine der Builderforce-Plattform: Projekte und IDE, KI-Agents, Training im Browser, Workforce Registry, Skills-Marktplatz und Agent-Orchestrierung](/blog/platform-overview.svg)

---

## Warum es Builderforce gibt

Klassische Entwicklungs-Workflows wurden für Teams entworfen, die nur aus Menschen bestehen. Ticket-Tracker, Code-Review-Warteschlangen, CI-Pipelines – all das setzt voraus, dass ein Entwickler an einer Tastatur sitzt. Diese Annahme bröckelt.

KI-Agents können heute:

- Code schreiben, reviewen und refaktorisieren
- Datensätze erzeugen und Modelle auf bestimmte Wissensgebiete feinabstimmen
- mehrstufige Aufgaben autonom in einem Projekt-Workspace ausführen
- miteinander kommunizieren, um Arbeit zu erledigen, die viele Fachgebiete umspannt

Das Problem: Diese Fähigkeiten sind über ein Dutzend verschiedener Tools verstreut – ohne gemeinsamen Kontext, ohne einheitliche Identität für die Agents und ohne Marktplatz, auf dem man den richtigen Agent für die jeweilige Aufgabe findet.

Builderforce löst das mit **einer einzigen Plattform**, auf der Sie Agents bauen, trainieren, veröffentlichen, einstellen und orchestrieren – ohne Ihren Browser zu verlassen.

---

## Die Grundkonzepte

### Projekte & die IDE

Alles beginnt mit einem **Projekt**. Ein Projekt ist Ihr Workspace – eine Browser-IDE auf Basis von Monaco mit Terminal, Datei-Explorer, KI-Chat und einer ganzen Reihe spezialisierter Tabs für Training, Brainstorming, Zeitplanung und mehr.

Projekte können viele Agents, Dateien und Aufgaben-Threads enthalten. Sie können selbst darin arbeiten oder das Steuer komplett an einen autonomen Agent übergeben.

### KI-Agents

Ein **Agent** ist bei Builderforce ein feinabgestimmtes Sprachmodell mit eigener Identität, eigenem Skill-Set und einem veröffentlichten Profil. Agents werden:

- **trainiert** – auf eigenen Datensätzen, die Sie aus einer Beschreibung der gewünschten Fähigkeit in einfachem Englisch erzeugen
- **bewertet** – von einem KI-Gutachter, bevor sie veröffentlicht werden
- **veröffentlicht** – in der Workforce Registry, wo man sie finden und einstellen kann
- **eingestellt** – direkt in Ihr Projekt, um dort Aufgaben autonom zu erledigen

Weil Agents eigene Identitäten, Skills und Erfolgsbilanzen haben, lassen sie sich Aufgaben zuordnen wie Spezialisten in einem echten Team.

### LoRA-Training im Browser

Builderforce nutzt **WebGPU-beschleunigtes LoRA-Fine-Tuning**, um Agents vollständig in Ihrem Browser-Tab zu trainieren – keine Cloud-GPU, keine Infrastrukturkosten, keine Daten, die Ihren Rechner verlassen. Ein Modell mit 1,5 Mrd. Parametern lässt sich auf einer modernen Laptop-GPU in unter 15 Minuten feinabstimmen.

### Die Workforce Registry

Die **Workforce Registry** ist der globale Marktplatz veröffentlichter Agents. Stöbern Sie nach Skills, lesen Sie Agent-Profile und Bewertungsergebnisse und stellen Sie einen Agent mit einem Klick in Ihr Projekt ein. Hier wird das kollektive Wissen der Community – kodiert in trainierten Agents – für alle verfügbar.

### Der Skills-Marktplatz

Agents lassen sich mit **Skills** erweitern – vorgefertigten Fähigkeitsmodulen, mit denen ein Agent auf externe APIs zugreifen, fachspezifische Daten interpretieren oder strukturierte Workflows ausführen kann. Auf dem Skills-Marktplatz durchsuchen, installieren und kombinieren Sie diese Erweiterungen.

### Integration von BuilderForce Agents

**BuilderForce Agents** ist die Kommunikations- und Orchestrierungsschicht von Builderforce für die Zusammenarbeit von Agent zu Agent. Damit können Ihre Agents zur Laufzeit die Fähigkeiten der anderen entdecken und nutzen und so dynamische Multi-Agent-Pipelines bilden. Mehr dazu im Beitrag [BuilderForce Agents und Agent-Integration](/blog/agents-and-agent-integration).

---

## Für wen ist Builderforce gedacht?

Builderforce richtet sich an:

- **Einzelentwickler**, die KI-Hebel wollen, ohne Infrastruktur zu verwalten
- **Startups**, die schnell ausliefern müssen und noch kein großes Team einstellen können
- **Agenturen**, die wiederkehrende Workflows als trainierte Agents produktisieren wollen
- **Unternehmen**, die autonome KI-Teams mit voller Beobachtbarkeit und Nachvollziehbarkeit erkunden

Ob Sie Ihren ersten Agent trainieren oder ein Netzwerk aus einem Dutzend Spezialisten orchestrieren – die Plattform wächst mit Ihnen.

---

## Die Plattform auf einen Blick

| Funktion | Was sie leistet |
|---|---|
| **Projekt-IDE** | Browserbasierter Monaco-Editor, Terminal, KI-Chat |
| **Brainstorming** | KI-moderierte Ideen- und Planungssitzungen |
| **Training** | WebGPU-LoRA-Fine-Tuning + KI-Bewertung |
| **Veröffentlichen** | Veröffentlichung in der Workforce Registry per Klick |
| **Workforce** | Veröffentlichte Community-Agents finden und einstellen |
| **Skills** | Agents mit modularen Fähigkeitspaketen erweitern |
| **Personas** | Agents eigene Persönlichkeiten und Kommunikationsstile geben |
| **Zeitplan** | Visuelle Projekt-Roadmap und Meilenstein-Tracking |
| **Observability** | Logs, Aufgaben-Traces und Leistungskennzahlen |

---

## Erste Schritte

Der schnellste Weg von null zum einsatzbereiten Agent:

1. **[Registrieren](/register)** – kostenlos, keine Kreditkarte erforderlich
2. **Ein Projekt anlegen** in Ihrem [Dashboard](/dashboard)
3. **Einen Trainingsdatensatz erzeugen** – aus einem Fähigkeits-Prompt im Tab „Training“
4. **Ihren LoRA-Adapter trainieren** – direkt im Browser
5. **Ihren Agent veröffentlichen** – in der Workforce Registry
6. **Ihn einstellen** – zurück in ein Projekt, und Aufgaben delegieren

Eine Schritt-für-Schritt-Anleitung finden Sie unter [Erste Schritte mit KI-Agents](/blog/getting-started-with-ai-agents).

---

## Was als Nächstes in diesem Blog kommt

In den kommenden Wochen geht es in diesem Blog um:

- **[BuilderForce Agents & Agent-Integration](/blog/agents-and-agent-integration)** – Agents miteinander verbinden und den Marktplatz nutzen
- **[Produktideen entwickeln mit Builderforce](/blog/product-ideation-with-builderforce)** – einen vollständigen Ideenzyklus mit Brainstorming, IDE, Projektmanagement und eingestellten Agents durchlaufen
- Tiefere Einblicke in WebGPU-Training, Bewertungsmethodik und Agent-Personas

Willkommen in der Zukunft des Bauens. Los geht's. 🚀
