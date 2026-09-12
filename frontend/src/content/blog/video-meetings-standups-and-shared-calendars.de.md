Ein Kanban-Board zeigt Ihnen, *was* passiert. Ein Gespräch von Angesicht zu Angesicht zeigt Ihnen schnell, *warum*. Builderforce.ai bringt jetzt beides an einen Ort: Live-Video- und Audiobesprechungen, die direkt auf dem Board liegen, an dem Ihr Team – Menschen und Agents – ohnehin arbeitet.

> Builderforce.ai führt Live-Videobesprechungen per Mesh-WebRTC direkt auf Ihrem Projekt-Board durch: Kameras in Stand-ups und Retros, spontane und direkte Calls, ein buchbarer Teamkalender mit Verfügbarkeit pro Person und Kalendersynchronisation mit Google und Microsoft – beitretbar im Web oder direkt in VS Code, wobei Medien Peer-to-Peer fließen und nie über den Server laufen.

![Drei Teilnehmer in einem WebRTC-Mesh tauschen Audio und Video direkt aus; der Server leitet nur Signalisierung und STUN weiter, Medien laufen also nie über ihn](/blog/meetings-webrtc-mesh.svg)

## Besprechungsarten auf einen Blick

| Art | Wann Sie sie nutzen | Wer sie starten kann |
| --- | --- | --- |
| **Standup / Planung / Retrospektive** | Wiederkehrende Zeremonien, mit Kameras am Runden Tisch | Der Manager schaltet die Kameras ein; jedes Mitglied kann beitreten |
| **Ad-hoc** | Eine schnelle, ungeplante Abstimmung | Jeder |
| **Direktanruf** | Ein Gespräch unter vier Augen | Jeder |
| **Geplant** | Im Voraus gebucht, als Einladungen in die Kalender gespiegelt | Organisator |

## Kameras am Runden Tisch

Builderforce führt Zeremonien – Stand-ups, Planungen, Retrospektiven – bereits als strukturierten Runden Tisch durch, der am Projekt verankert ist. Jetzt können diese Zeremonien **Kameras und Mikrofone** einschalten. Ein Manager kann das Video für das ganze Team starten, oder jeder kann auf „Mit Kamera beitreten“ klicken und sich selbst in eine Live-Galerie über dem Stand-up einreihen. Weil die Besprechung an der Zeremonie hängt, schauen alle beim Reden auf dasselbe Board.

Dazu kommen ganz normale Calls: Starten Sie eine **Ad-hoc**-Besprechung für eine schnelle Abstimmung oder einen **Direktanruf** mit einer Kollegin. Es gibt eine eigene Oberfläche unter `/meetings` mit einem Planungsdialog, einem Sofortstart und einer Liste laufender und anstehender Besprechungen.

## Peer-to-Peer als Grundprinzip

Medien werden bei Builderforce **von Client zu Client per Mesh-WebRTC** ausgetauscht. Kamera- und Mikrofon-Streams, SDP-Offers/-Answers und ICE-Kandidaten fließen direkt zwischen den Browsern; der Server leitet nur die Signalisierung weiter und stellt STUN bereit (TURN, wenn Sie es konfigurieren). Ihr Video landet nie auf unserer Infrastruktur. Die Aushandlung ist kollisionsfrei, sodass sich zwei Personen, die im selben Moment verbinden, nicht in die Quere kommen.

## Ein Kalender, der weiß, wann alle frei sind

Besprechungen sind nur zu einer Zeit nützlich, die alle tatsächlich wahrnehmen können. Builderforce ergänzt Workforce und das Projekt-Portfolio um einen **gemeinsamen Teamkalender**:

- Eine **Monatsübersicht** und ein **buchbares Wochenraster** in einer Komponente.
- Blendet Ihre App-Besprechungen *und* die Termine Ihrer verbundenen Google- und Microsoft-Kalender ein.
- Schattiert Ihre angegebenen **Verfügbarkeitszeiten**, sodass freie Termine sofort ins Auge fallen.
- Ein Klick auf einen freien Slot bucht ihn, ein Klick auf eine Besprechung tritt ihr bei.

Legen Sie Ihre **wöchentlichen Arbeitszeiten und Ihre Zeitzone** einmal fest, und **„Zeit finden“** schlägt Termine vor, an denen *alle* Eingeladenen frei sind – ohne überschneidende Besprechung und innerhalb der Arbeitszeiten jeder einzelnen Person, zeitzonenkorrekt berechnet. Schluss mit dem E-Mail-Pingpong auf der Suche nach einem Termin.

![Ein Wochenraster über mehrere Zeitzonen mit den Arbeitszeiten und belegten Blöcken von drei Personen; der Solver hebt den einen Termin hervor, an dem alle frei sind](/blog/meetings-find-a-time.svg)

## Bringen Sie Ihren eigenen Kalender mit

Verbinden Sie **Google Calendar** oder **Microsoft Graph** pro Person mit einem einzigen OAuth-Ablauf. Geplante Builderforce-Besprechungen werden als echte Kalendertermine mit Einladungen an die E-Mail-Adressen der Teilnehmenden gespiegelt, und Ihre anstehenden externen Termine erscheinen direkt unter `/meetings`. Ein Ort für alles, keine doppelte Eingabe.

## Von überall beitreten – auch aus Ihrem Editor

Einladungen sind Deep Links hinter einem Login (`/meetings?join=<id>`), und der Beitritt ist **berechtigungsgebunden**: Nur der Organisator, eingetragene Teilnehmende, Manager oder Mitglieder des Projekts der Besprechung können beitreten – mandantenübergreifender Zugriff ist gesperrt. Und Sie müssen nicht einmal im Browser sein. Die VS-Code-Extension ergänzt einen Baum **Besprechungen** in der Seitenleiste mit anstehenden und laufenden Calls:

- **Im Browser beitreten** öffnet die authentifizierte Web-Besprechung.
- **Hier beitreten** startet den WebRTC-Call nativ in einer VS-Code-Webview – so verlassen Sie für ein Stand-up nie Ihren Editor.

## Worum es geht

Stand-ups, Planungen und Retros sind die Momente, in denen sich ein Team ausrichtet. Indem Builderforce sie als Live-Video *direkt auf dem Board* durchführt – mit einem Kalender, der die tatsächliche Verfügbarkeit aller respektiert, und einem Beitritts-Button in VS Code –, schließt es die Lücke zwischen „Meeting-Tool“ und „der Arbeit“. Das Gespräch und die Tickets, um die es geht, sind endlich am selben Ort.

## Häufig gestellte Fragen

**Nutzt Builderforce einen Videodienst eines Drittanbieters?** Nein. Video und Audio laufen per Mesh-WebRTC direkt zwischen den Teilnehmenden. Der Server leitet nur die Signalisierung weiter und stellt STUN bereit (plus optional TURN); Ihre Medien fließen Peer-to-Peer.

**Wie funktioniert „Zeit finden“?** Jede Person gibt ihre wöchentlichen Arbeitszeiten und eine Zeitzone an. Der Verfügbarkeits-Solver schlägt Termine vor, an denen keine eingeladene Person eine überschneidende Besprechung hat und die Zeit innerhalb ihrer Arbeitszeiten liegt – korrekt über Zeitzonen hinweg berechnet.

**Kann ich meinen bestehenden Kalender synchronisieren?** Ja – verbinden Sie Google Calendar oder Microsoft Graph pro Person. Ihre externen Termine werden im Teamkalender eingeblendet, und geplante Besprechungen werden als Einladungen zurückgespiegelt.

**Wer kann über einen Einladungslink einer Besprechung beitreten?** Nur berechtigte Personen: der Organisator, eingetragene Teilnehmende, Manager oder Mitglieder des Projekts der Besprechung (bei einer Projektbesprechung) bzw. des Mandanten (bei einer mandantenweiten Besprechung). Der Link setzt einen Login voraus, und mandantenübergreifende Beitritte sind gesperrt.

**Kann ich einer Besprechung beitreten, ohne einen Browser zu öffnen?** Ja. Über den Baum „Besprechungen“ in VS Code treten Sie im Browser bei oder starten den Call nativ in einer VS-Code-Webview.
