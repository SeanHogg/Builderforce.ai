Entwickler leben in ihrem Editor. Statt Sie herauszuholen, bringt Builderforce.ai deshalb die gesamte Plattform *in* VS Code. Die Extension ist längst mehr als ein Chat-Panel – sie ist eine **Kommandozentrale** für eine gemischte Workforce aus Menschen und KI-Agents, mit Zusammenarbeit, Besprechungen, Live-Status und Modelltraining direkt in der Seitenleiste.

> Die BuilderForce-Extension für VS Code bringt die komplette Plattform in Ihren Editor: Team-Chat mit mehreren Beteiligten, Live-Sitzungsstatus, native Videobesprechungen, eine Evermind-Trainingskonsole, Projekt- und Aufgabenbäume sowie Human-in-the-Loop-Freigaben – so steuern Sie eine ganze agentische Workforce, ohne VS Code je zu verlassen.

![Die BuilderForce-Seitenleiste in VS Code mit ihren Bereichen – Team-Chat in Sitzungen, Projekt & Aufgaben mit Live-Status, Besprechungen, Evermind, Freigaben im Posteingang und Erkenntnisse – neben einem Editorbereich, der die Governance-Garantien auflistet](/blog/vscode-command-center.svg)

Das leistet jeder Bereich der Seitenleiste.

| Bereich der Seitenleiste | Was er leistet |
| --- | --- |
| **Sitzungen** | Team-Chat mit mehreren Beteiligten – Menschen + `@agents`, gezielt adressierte Nachrichten, Avatare |
| **Projekt & Aufgaben** | Ihr Board und Ihre zugewiesene Arbeit, mit Live-Status in jeder Zeile |
| **Besprechungen** | Anstehende und laufende Calls – im Browser oder nativ in einer Webview beitreten |
| **Evermind** | Das selbstlernende Modell Ihres Projekts einsehen und trainieren |
| **Posteingang** | Human-in-the-Loop-Freigaben und Entscheidungen |
| **Erkenntnisse & Diagnose** | Das operative Gesamtbild und Scans per Klick |

## Auf einen Blick sehen, was Sie braucht

Wenn mehrere Agents gleichzeitig laufen, lautet die schwierigste Frage: „Welcher braucht mich gerade?“ Ein einziges serverseitiges Signal beantwortet sie auf jeder Oberfläche. In VS Code blenden sowohl der Baum **Sitzungen** als auch **Projekt & Aufgaben** in jeder Zeile ein Live-Statussymbol ein:

- **Wird ausgeführt** – ein blauer Spinner: Der Agent arbeitet gerade (und arbeitet auch weiter, wenn Sie den Chat wechseln).
- **Wartet auf Ihre Antwort** – eine bernsteinfarbene Markierung mit `❓`: Der Lauf hat bei einer Frage angehalten und wartet auf Sie.
- **Fertig** – ein grünes Häkchen.

![Drei Live-Statuszeilen – ein blauer Spinner für „wird ausgeführt“, ein bernsteinfarbenes Fragezeichen für „wartet auf Ihre Antwort“ und ein grünes Häkchen für „fertig“ – das eine Signal, das einer Sitzung über alle Oberflächen folgt](/blog/vscode-live-status.svg)

Der Status begleitet eine Sitzung überall, wo sie angezeigt wird – so erfassen Sie parallele Läufe sofort.

## Team-Chat mit mehreren Beteiligten in der Seitenleiste

Das Panel „Sitzungen“ ist echter Team-Chat, keine Eingabebox für Einzelkämpfer. Threads werden im gesamten Projekt geteilt, Sie können Menschen und KI-Agents in einen Raum einladen und jede Nachricht an einen bestimmten Teilnehmer richten – sprechen Sie mit einer Kollegin, oder `@mention`-en Sie einen Agent, damit er antwortet und im Rahmen Ihrer Berechtigungen auf dem Board handelt. Teilnehmer erscheinen als farbige Avatare direkt im Baum, sodass Sie sehen, wer in welchem Raum ist.

## Besprechungen nativ beitreten

Der Baum **Besprechungen** listet Ihre anstehenden und laufenden Calls. **Im Browser beitreten** öffnet die authentifizierte Web-Besprechung; **Hier beitreten** startet den Mesh-WebRTC-Videocall *nativ in einer VS-Code-Webview*. Stand-ups, Planungen und Retros finden statt, ohne dass Sie Ihren Code je verlassen.

## Evermind einsehen und trainieren

Jedes Projekt hat sein eigenes **Evermind** – ein selbstlernendes Modell, das aus der Arbeit Ihres Teams lernt. Jetzt ist es eine vollwertige Ansicht in der Seitenleiste. Öffnen Sie die Evermind-Konsole, um zu sehen, was es gelernt hat (Version, Anzahl gelernter und wartender Einträge, Zeitpunkt des letzten Lernens), steuern Sie das Training (Start von einem veröffentlichten Modell, Lernen verbinden oder einfrieren, ein Lehrermodell wählen), **bringen Sie ihm etwas aus einem Transkript bei**, indem Sie ein Musterbeispiel einfügen, und leeren Sie die Lernwarteschlange bei Bedarf. Manager erhalten die Steuerung; einsehen kann jeder. Dieselbe Konsole erscheint auch im Web – eine Komponente, zwei Hosts.

## Die Bäume, mit denen die Arbeit läuft

Die Extension bringt auch den Rest der Plattform mit:

- **Projekt & Aufgaben** – Ihr Board und Ihre zugewiesene Arbeit, mit demselben Live-Status.
- **Posteingang** – Freigaben und Punkte, die eine Entscheidung brauchen.
- **Erkenntnisse** und **Diagnose** – das operative Gesamtbild und Scans.
- **Ausführen und prüfen** – Aufgaben an Agents übergeben, deren Ergebnisse prüfen und validieren und Human-in-the-Loop-Aktionen genau dort freigeben, wo Sie programmieren.

## Kontrolliert – und in Ihrer Hand

Unterstützte Ausführungspfade in VS Code nutzen die konfigurierten Freigaben der Plattform und die verfügbaren Ausführungsprotokolle. Modellverfügbarkeit und Abrechnung hängen vom aktuellen Katalog, von Zugangsdaten, Tarif und Laufzeitumgebung ab; die Parität zwischen Web und Extension ist je Funktion dokumentiert.

## Warum das wichtig ist

Kontextwechsel sind die Steuer, die Sie für das Managen von Agents zahlen. Jedes Mal, wenn Sie den Editor verlassen, um einen Lauf zu prüfen, eine Frage zu beantworten, einem Stand-up beizutreten oder ein Modell nachzujustieren, verlieren Sie den Faden. Die Kommandozentrale in VS Code schafft diese Steuer ab: Die gesamte Workforce – ihre Chats, ihre Besprechungen, ihr Status und ihr lernendes Modell – ist nur ein Panel von Ihrem Code entfernt.

## Häufig gestellte Fragen

**Kann ich erkennen, welcher Agent mich braucht, ohne jeden einzeln zu öffnen?** Ja. Die Bäume „Sitzungen“ und „Projekt & Aufgaben“ blenden in jeder Zeile einen Live-Status ein – blauer Spinner für „wird ausgeführt“, bernsteinfarbenes `❓` für „wartet auf Ihre Antwort“, grünes Häkchen für „fertig“ – gespeist aus einem einzigen serverseitigen Signal.

**Ist der Chat in VS Code nur ein Dialog zwischen mir und einem Modell?** Nein. Er ist für mehrere Beteiligte gebaut: Threads werden im ganzen Projekt geteilt, Sie können Menschen und Agents einladen und Nachrichten an bestimmte Teilnehmer richten – einschließlich `@agent`-Erwähnungen, die einen Agent antworten und im Rahmen Ihrer Berechtigungen handeln lassen.

**Kann ich Videobesprechungen direkt in VS Code beitreten?** Ja. Über den Baum „Besprechungen“ treten Sie im Browser bei oder starten den WebRTC-Call nativ in einer VS-Code-Webview.

**Kann ich das Modell meines Projekts aus dem Editor heraus trainieren?** Ja. In der Evermind-Ansicht der Seitenleiste sehen Manager, was das Modell gelernt hat, steuern das Training, bringen ihm etwas aus einem eingefügten Transkript bei und leeren die Lernwarteschlange – dieselbe Konsole, die auch im Web erscheint.

**Umgehen Agent-Aktionen in VS Code die Governance?** Unterstützte Ausführungspfade folgen der jeweils konfigurierten Plattformrichtlinie. Prüfen Sie die Funktionsmatrix für die Aktion, die Sie ausführen möchten – die Abdeckung zwischen Web und Extension ist nicht in jedem Fall vollständig.
