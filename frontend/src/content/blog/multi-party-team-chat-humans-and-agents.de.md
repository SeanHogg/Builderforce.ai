In den meisten KI-Tools bedeutet „Chat“: ein Mensch tippt an ein Modell. Jede Nachricht lässt das Modell laufen; man kann keinen Kollegen in den Raum holen und einfach mit ihm reden, und man kann die Unterhaltung nicht an einen Spezialisten-Agent übergeben, der dann auch *handelt*. Builderforce.ai hat den Chat als **Multi-Party-Zusammenarbeit** neu gebaut – einige Teilnehmer sind Menschen, andere Agents, und Sie entscheiden, für wen eine Nachricht bestimmt ist.

> In Builderforce.ai werden Team-Chat-Threads projektweit geteilt: Laden Sie Menschen per E-Mail und KI-Agents in den Raum ein und richten Sie dann eine Nachricht an einen bestimmten Teilnehmer. Eine Nachricht an einen Menschen ist einfach ein Gespräch mit ihm; eine `@agent`-Erwähnung lässt diesen Agent als er selbst antworten und eine begrenzte, berechtigungsbeschränkte Tool-Schleife ausführen – niemals über Ihren eigenen Zugriff hinaus.

![Ein geteilter Chat-Thread mit einer Teilnehmerleiste, die den Eigentümer, einen per E-Mail eingeladenen Teamkollegen und einen @agent zeigt; eine Nachricht an den Teamkollegen wird von einer Person beantwortet, eine Nachricht an den Agent vom Agent, der Aufgaben anlegt und verknüpft](/blog/chat-shared-thread.svg)

## Chatbot vs. Multi-Party-Team-Chat

| | Typischer KI-Chat | Builderforce-Team-Chat |
| --- | --- | --- |
| **Teilnehmer** | Ein Mensch, ein Modell | Viele Menschen **und** viele Agents |
| **Wer eine Nachricht ausführt** | Jede Nachricht lässt das Modell laufen | Sie richten jede Nachricht an eine Person oder einen `@agent` |
| **Mit einem Kollegen sprechen** | Nicht möglich | An einen Menschen richten – die Agent-Schleife bleibt untätig |
| **Agent handelt** | Antwortet nur mit Text | Führt als er selbst eine beschränkte Tool-Schleife aus (Aufgaben, OKRs, Board) |
| **Zugriff** | k. A. | Der Agent nutzt **Ihre** Rolle + Ihr Token – nie mehr |
| **Sichtbarkeit des Threads** | Privat für Sie | Mit dem Projekt geteilt (oder explizit gesperrt) |

## Threads sind geteilt, keine privaten Silos

Ein Builderforce-Chat ist **global für sein Projekt und seinen Mandanten**. Ein Teamkollege kann ihn sehen, öffnen und beitreten – beim ersten Beitrag wird er automatisch als Mitglied erfasst, sodass der Teilnehmerkreis des Threads real und aktuell ist. Sie können einen Thread auch auf seinen Eigentümer und ausdrücklich eingeladene Mitglieder **sperren**, wenn ein Gespräch privat bleiben soll. Eigentümer behalten die Administrationskontrolle (umbenennen, archivieren, einladen, entfernen, sperren); alle anderen arbeiten zusammen.

## Menschen per E-Mail einladen – auch wenn sie noch nicht im Team sind

Fügen Sie einen Kollegen per E-Mail zu einem Thread hinzu. Ist er bereits in Ihrem Team, erhält er eine In-App-Benachrichtigung (mit optionalem E-Mail-Webhook) und der Thread erscheint in seiner Liste. Ist er **noch kein** Mitglied, legt die Einladung einen ausstehenden Eintrag an, sodass er sich bei der Registrierung automatisch dem Team anschließt und beim ersten Zugriff in den Chat übernommen wird – ein nahtloser Beitritt ohne zusätzlichen Schritt. Eine globale Benachrichtigungsglocke in der oberen Leiste zeigt Chat-Einladungen und Erwähnungen an und führt direkt zum Thread.

## Eine Nachricht an den richtigen Teilnehmer richten

Der Kerngedanke: Eine Nachricht hat einen **Empfänger**. Im Composer wählen Sie „An: <Name>“ (oder beginnen einfach mit `@name`), und Builderforce leitet den Zug entsprechend weiter:

- **An einen Menschen** – die Nachricht ist *für diese Person*. Sie wird gespeichert und zugestellt, lässt das Modell aber **nicht** laufen. Kein Agent wird geweckt; es sprechen nur Menschen miteinander.
- **An einen `@agent`** – dieser Agent **antwortet als er selbst**. Er führt serverseitig eine begrenzte Tool-Schleife über eine kuratierte, nicht destruktive Allowlist aus (Board lesen, Folgeaufgabe anlegen, ein OKR aktualisieren, Spezifikationen und Wissen lesen) – ausgeführt mit **Ihrer** Rolle und Ihrem Token, sodass ein Agent nie etwas tun kann, was Sie nicht auch könnten. Seine Antwort erscheint dem Agent zugeordnet, mit eigenem Namen und Avatar.

![Der Composer leitet eine Nachricht auf eine von zwei Bahnen: an einen Menschen, wo sie von Person zu Person zugestellt wird und die Agent-Schleife untätig bleibt; oder an einen @agent, wo eine berechtigungsbeschränkte Tool-Schleife läuft, die Aufgaben anlegt, OKRs aktualisiert und das Board liest](/blog/collab-message-routing.svg)

Ein Thread kann also eine echte Mischung enthalten: Sie stellen einem Teamkollegen eine Frage und erwähnen dann per `@mention` einen Agent, der die soeben vereinbarten Aufgaben anlegt.

## Gesteuert von Ihren Berechtigungen, nicht denen des Agents

Jede Aktion, die ein eingeladener Agent im Chat ausführt, läuft mit den Berechtigungen des auslösenden Nutzers. Die In-Chat-Allowlist enthält keine Löschvorgänge und keinen Control-Plane-Zugriff. Das Ergebnis ist Zusammenarbeit, der Sie vertrauen können: Ein Agent im Raum ist mächtig genug, um nützlich zu sein, und eng genug begrenzt, um sicher zu sein.

## Dasselbe Erlebnis im Web und in VS Code

Der Multi-Party-Chat wird über alle Oberflächen hinweg geteilt. Der Web-Brain und die VS-Code-Webview nutzen dasselbe Empfänger-Routing, dieselbe Teilnehmerliste und dieselben Avatare – und der native Sessions-Baum zeigt die Teilnehmer jedes Threads als farbige Avatar-Scheiben, sodass Sie auf einen Blick sehen, wer in einem Raum ist. Laden Sie einen Menschen im Web ein, erwähnen Sie einen Agent per `@mention` aus VS Code – es ist eine einzige Unterhaltung.

## Warum das wichtig ist

Echte Arbeit ist ein Gespräch zwischen mehreren Menschen und zunehmend mehreren Agents. Chat als Eins-zu-eins-Verbindung von Mensch und Modell kann das nicht abbilden. Indem Builderforce Threads teilt, Teilnehmer explizit macht und `@agent` zu einem echten, an Ihre Berechtigungen gebundenen Akteur macht, wird Chat zu einem Ort, an dem eine ganze Workforce zusammenarbeitet – und nicht nur zu einem Prompt-Feld.

## Häufig gestellte Fragen

**Kann ich im Chat mit einem Teamkollegen sprechen, ohne eine KI-Antwort auszulösen?** Ja. Richten Sie die Nachricht an einen Menschen (wählen Sie ihn als Empfänger oder beginnen Sie mit `@name`), und sie wird als Person-zu-Person-Nachricht zugestellt – die Agent-Schleife bleibt untätig.

**Was kann ein `@agent` tatsächlich tun, wenn ich ihn erwähne?** Er führt mit Ihrer Rolle und Ihrem Token eine begrenzte Tool-Schleife über eine sichere Allowlist mit Lese- und eingeschränkten Schreibrechten aus (Board lesen, Aufgaben anlegen, OKRs aktualisieren, Spezifikationen und Wissen lesen). Er kann nichts löschen und nicht auf die Control Plane zugreifen, und er kann nie über Ihre eigenen Berechtigungen hinausgehen.

**Kann ich jemanden einladen, der noch nicht in meinem Team ist?** Ja. Die Einladung einer unbekannten E-Mail-Adresse legt eine ausstehende Einladung an; bei der Registrierung wird die Person dem Team hinzugefügt und beim ersten Zugriff automatisch in den Chat übernommen.

**Ist ein Chat privat für mich?** Standardmäßig werden Threads mit Ihrem Projekt geteilt, damit Teamkollegen beitreten können. Sie können einen Thread sperren, sodass nur der Eigentümer und ausdrücklich eingeladene Mitglieder Zugriff haben.

**Funktioniert das in VS Code?** Ja. Die VS-Code-Webview teilt dasselbe Empfänger-Routing, dasselbe Teilnehmermodell und dieselben Avatare wie der Web-Brain – es ist eine Unterhaltung über alle Oberflächen hinweg.
