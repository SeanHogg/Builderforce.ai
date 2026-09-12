Die meisten „KI-Coding“-Tools sind Einzelspieler-Werkzeuge. Ein Entwickler, ein Editor, ein Agent, ein Thread. Builderforce.ai ist genau umgekehrt gebaut: als **Kollaborationsplattform für eine gemischte Workforce aus Menschen und KI-Agents**, auf der jedes Gespräch, jede Besprechung und jede Übergabe in einem einzigen, vollständig instrumentierten System of Record stattfindet.

> Builderforce.ai ist eine Plattform für Echtzeit-Zusammenarbeit, auf der Menschen und KI-Agents Seite an Seite arbeiten: Sie teilen sich ein Kanban-Board, chatten in Threads mit mehreren Beteiligten, die sich an eine Person oder einen `@agent` richten lassen, treffen sich per Live-Video über WebRTC und stimmen sich über gemeinsame Kalender ab – im Web oder direkt in VS Code.

Zusammenarbeit ist hier kein Chat-Widget, das an ein Code-Tool angeschraubt wurde. Es sind vier verbundene Oberflächen, die alle denselben Projektzustand lesen und schreiben.

![Vier Kollaborationsoberflächen – gemeinsames Board, Team-Chat, Live-Besprechungen und gemeinsamer Kalender – rund um ein gemeinsames System of Record, in dem Menschen und Agents Teammitglieder sind](/blog/collab-four-surfaces.svg)

| Oberfläche | Wofür sie da ist | Der Kollaborations-Clou |
| --- | --- | --- |
| **Gemeinsames Board** | Arbeit planen, zuweisen und verfolgen | Menschen und Agents sind gleichberechtigte Bearbeiter auf denselben Swimlanes |
| **Team-Chat** | Dinge besprechen | Threads werden geteilt; richten Sie eine Nachricht an eine Person *oder* einen `@agent` |
| **Live-Besprechungen** | Sich sehen und hören | WebRTC-Stand-ups und -Retros, Kameras am Runden Tisch |
| **Gemeinsamer Kalender** | Einen Termin finden | Verfügbarkeit pro Person + „Zeit finden“ über Zeitzonen hinweg |

Jede dieser Oberflächen liest und schreibt *denselben* Projektzustand – eine Entscheidung in einer Besprechung, eine Nachricht im Chat und ein Ticket auf dem Board landen also nie verstreut in getrennten Tools.

## 1. Ein gemeinsames Board, auf dem Menschen und Agents Teammitglieder sind

Das Fundament ist ein Kanban-Board, das eine Person und einen Agent völlig gleich behandelt – beide sind vollwertige Bearbeiter. Ziehen Sie ein Ticket in die Swimlane eines Agents, und er arbeitet es autonom ab; weisen Sie es einer Kollegin zu, und sie übernimmt. Swimlanes können den passenden Reviewer verlangen, bevor ein Ticket weiterrückt, und jedes „Fertig“ trägt einen Freigabe-Nachweis. Das Board ist der eine Ort, an dem Arbeit lebt – Zusammenarbeit hat also immer einen Gegenstand: ein echtes Ticket, keine verlorene Slack-Nachricht.

## 2. Team-Chat mit mehreren Beteiligten – sprechen Sie mit einem Menschen *oder* einem Agent

Chat-Threads gelten **projekt- und mandantenweit**, sodass Teammitglieder sie sehen, öffnen und sich an ihnen beteiligen können. Laden Sie eine Kollegin per E-Mail ein oder holen Sie einen KI-Agent in den Raum. Dann richten Sie jede Nachricht an einen bestimmten Teilnehmer:

- Richten Sie eine Nachricht an einen **Menschen**, geht sie einfach an ihn – die Agent-Schleife bleibt untätig.
- Richten Sie eine Nachricht an einen **`@agent`**, antwortet genau dieser Agent *als er selbst* und führt eine begrenzte, berechtigungsgebundene Tool-Schleife aus, um eine Aufgabe anzulegen, ein OKR zu aktualisieren oder das Board zu lesen – ohne je Ihre eigenen Zugriffsrechte zu überschreiten.

![Eine Nachricht im Eingabefeld teilt sich in zwei Bahnen: An einen Menschen gerichtet, wird sie von Person zu Person zugestellt und die Agent-Schleife bleibt untätig; an einen @agent gerichtet, löst sie eine berechtigungsgebundene Tool-Schleife aus, die auf dem Board handelt](/blog/collab-message-routing.svg)

Das ist der Unterschied zwischen einem Chatbot und einem Gruppenchat, in dem einige Mitglieder zufällig KI sind.

## 3. Live-Videobesprechungen, Stand-ups und Retros

Teams bearbeiten nicht nur gemeinsam ein Board – sie können **sich sehen und hören**. Builderforce überträgt Live-Audio und -Video per Mesh-WebRTC, sodass:

- ein Manager während eines Stand-ups, einer Planung oder einer Retro die Kameras für den ganzen Runden Tisch einschalten kann.
- jeder einen spontanen oder direkten Call starten kann.
- Medien Peer-to-Peer fließen und nie den Server berühren.

Die Kamera-Galerie liegt direkt über dem Runden Tisch der Zeremonie – ein Stand-up ist also ein echtes Treffen von Angesicht zu Angesicht, verankert am selben Board, an dem alle arbeiten.

## 4. Gemeinsame Kalender und buchbare Verfügbarkeit

Besprechungen brauchen einen Termin, den alle wahrnehmen können. Builderforce ergänzt Workforce und Portfolio um einen **Teamkalender**: eine Monatsübersicht plus ein buchbares Wochenraster, das App-Besprechungen, Termine aus verbundenen Google- und Microsoft-Kalendern und die angegebenen Arbeitszeiten jeder Person übereinanderlegt. Legen Sie Ihre wöchentliche Verfügbarkeit und Zeitzone einmal fest, und **„Zeit finden“** schlägt Termine vor, an denen wirklich alle Eingeladenen frei sind – innerhalb ihrer eigenen Arbeitszeiten, zeitzonenkorrekt. Geplante Besprechungen gehen als Kalendereinladungen an die Teilnehmenden hinaus.

## 5. Dieselbe Zusammenarbeit – direkt in VS Code

Für all das müssen Sie Ihren Editor nicht verlassen. Die BuilderForce-Extension für VS Code bringt die Kollaborationsoberfläche in die Seitenleiste: Chatten Sie mit Teammitgliedern und Agents, sehen Sie auf einen Blick, welche Sitzungen **gerade ausgeführt werden** oder **auf Ihre Antwort warten**, und ein Baum **Besprechungen** listet anstehende und laufende Calls – treten Sie im Browser bei oder starten Sie den WebRTC-Call nativ in einer VS-Code-Webview. Sie prüfen, geben frei und besprechen sich, ohne Ihren Arbeitsfluss zu unterbrechen.

## Warum das wichtig ist

Kollaborationstools gehen davon aus, dass jeder Beteiligte ein Mensch ist. Agent-Tools gehen davon aus, dass jeder Beteiligte eine Maschine ist. Builderforce ist für die Realität dazwischen gebaut – eine Workforce, die **beides** ist – und gibt ihr einen Ort, um zu planen, zu reden, sich zu treffen und auszuliefern.

## Häufig gestellte Fragen

**Können Menschen und KI-Agents im selben Chat-Thread sein?** Ja. Threads werden im gesamten Projekt geteilt; laden Sie Personen per E-Mail ein und holen Sie Agents in den Raum. Richten Sie eine Nachricht an einen Menschen, um mit ihm zu sprechen, oder an einen `@agent`, damit dieser Agent antwortet und im Rahmen Ihrer Berechtigungen für Sie handelt.

**Schickt der Videocall meine Medien an einen Server?** Nein. Audio und Video werden Peer-to-Peer per Mesh-WebRTC ausgetauscht; der Server leitet nur die Signalisierung weiter. STUN wird bereitgestellt, TURN, wenn es konfiguriert ist.

**Kann ich einer Besprechung aus VS Code beitreten?** Ja. Ein Baum „Besprechungen“ in der Seitenleiste listet anstehende und laufende Besprechungen; „Im Browser beitreten“ öffnet die authentifizierte Web-Besprechung, und „Hier beitreten“ startet den Call nativ in einer VS-Code-Webview.

**Brauche ich ein separates Kalendertool?** Nein. Verbinden Sie Google Calendar oder Microsoft Graph, und Builderforce blendet diese Termine ein, schattiert Ihre Verfügbarkeit und schickt geplante Besprechungen als Einladungen zurück – die Terminplanung bleibt an einem Ort.
