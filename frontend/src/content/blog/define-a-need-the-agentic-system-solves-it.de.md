Unter allem, was Builderforce.ai baut, liegt ein einziger Satz:

> **Jeder Mensch definiert einen Bedarf, und das agentische System löst ihn.**

Dieser Satz klingt einfach – bis man merkt, in wie vielen Formen ein „Bedarf“ daherkommt. Eine Teamleiterin möchte ihre SOPs prüfen lassen und einen schlankeren Prozessablauf vorgeschlagen bekommen. Ein Entwickler möchte einen Agent auf den proprietären Daten des Unternehmens trainieren und einen eigenen Agent aufsetzen, der Support-Anrufe übernimmt. Eine Ingenieurin möchte, dass derselbe Agent in der IDE, auf dem Desktop oder in der Cloud läuft – nach ihrer Wahl, nicht nach der der Plattform. Ein Manager möchte einen Workflow und eine Reihe von Prozessdiagrammen zeichnen und diese Schritte in einen Agent einbetten, der sie ausführt.

Vier verschiedene Menschen, vier verschiedene Bedarfe, vier verschiedene *Modalitäten* – Fließtext, ein Datensatz, ein Prozessdiagramm, eine Persona. Und doch ist das Verb jedes Mal dasselbe: **Mach aus diesem Bedarf einen Agent, der auf der richtigen Oberfläche läuft.**

Dieses gemeinsame Verb ist das ganze Produkt. Wir nennen es das **Compile-Primitiv** – und mit diesem Release ist es kein Diagramm an der Wand mehr. Es ist eine laufende Pipeline, die Sie aufrufen können.

![Das Compile-Primitiv: Ein Bedarf in beliebiger Modalität wird zu einer AgentSpec kompiliert und auf jede Oberfläche ausgerollt](/blog/compile-primitive-spine.svg)

## Die Form eines Bedarfs

Sieht man sich die vier Beispiele genau an, ändern sich tatsächlich nur die *Eingabemodalität* und die *Ausgabeoberfläche*:

| Der Mensch sagt … | Modalität | Wird zu … | Oberfläche |
|---|---|---|---|
| „Prüft unsere SOPs und schlagt einen schlankeren Ablauf vor.“ | Diagnostischer Befund | Ein ausführbarer Verbesserungsprozess | Workflow |
| „Trainiert auf unseren Dokumenten und beantwortet Support-Anrufe.“ | Datensatz / proprietäre Daten | Ein fundierter, eigener Agent | Cloud / Desktop |
| „Lasst meinen Agent direkt hier in meinem Editor laufen.“ | (bestehender Agent) | Derselbe Agent, an einem neuen Ort | IDE |
| „Hier ist das Prozessdiagramm – führt diese Schritte aus.“ | Prozessdiagramm | Ein Agent, der die Schritte ausführt | Cloud / On-Prem |

Alles dazwischen – die Identität des Agents, das Modell, das er nutzt, die Persona, die sein Verhalten prägt, das Wissen, das er abruft, die Richtlinie, die ihn steuert, die Schritte, denen er folgt – ist *jedes Mal dieselbe Art von Ding*. Es ist die Spezifikation eines Agents. Also hat die Plattform genau eine davon: eine **AgentSpec**.

## Das Compile-Primitiv

Zwei reine Funktionen, dazwischen eine kanonische Größe:

```
   NEED  ──▶  compile(need, modality)  ──▶  AgentSpec  ──▶  deploy(AgentSpec, surface)  ──▶  running agent
```

- **`compile`** ist eine Registry von *Modalitäts-Compilern* – je einer für Fließtext, einen Datensatz (plus Ihre proprietären Dokumente), ein Prozessdiagramm, eine Persona, die Befunde einer Diagnose und ein Policy-Paket. Jeder überführt seine Art von Bedarf in dieselbe `AgentSpec`. Das ist die einzige Stelle der Plattform, die Fließtext von Diagrammen und Datensätzen unterscheiden muss.
- **`deploy`** ist eine Registry von *Oberflächen* – IDE, Desktop, Cloud-durable, Cloud-Container und Workflow-Schritt. Es nimmt eine fertige `AgentSpec`, löst über eine gemeinsame DI-Registry die richtige Engine und den passenden Transport für die Oberfläche auf und startet – über `deployAndDispatch` – den Run tatsächlich auf der Maschinerie, die bereits existiert.

Dazwischen sitzt die `AgentSpec`: Identität, Modell, kompilierte Persona, abgerufenes Gedächtnis, Policy-Gates und (wenn der Bedarf ein Prozess ist) die geordneten Schritte. Viele Formen hinein kompilieren; auf viele Oberflächen hinaus ausrollen; eine Spec in der Mitte. Beide Funktionen sind echter Code – `compile()` und `deploy()` leben in der API, die `AgentSpec` und ihre einzige kanonische Überführung im gemeinsamen Paket `agent-tools`, und eine schlanke HTTP-Eingangstür (`POST /api/compile`, `POST /api/compile/run`) macht die gesamte Pipeline zugänglich.

Die Stärke des Primitivs: Aus vier Bedarfen werden nicht mehr vier Produkte.

![Vier bestehende Eingangstüren, neu verortet als compile()-Adapter, die zu einer AgentSpec zusammenfließen](/blog/compile-four-doors.svg)

„Trainiert auf unseren Daten“ und „Zeichne ein Prozessdiagramm“ sind zwei **compile**-Adapter, die in dieselbe Spec zusammenfließen – Sie können also ein Prozessdiagramm *mit* einem trainierten Modell *mit* einer Persona *mit* einer Governance-Richtlinie haben, und es ist immer noch ein Agent. Das Zusammenführen ist wörtlich gemeint: Jeder Adapter liefert den Ausschnitt der Spec, den er kennt, und die Plattform faltet alles zu einem zusammen. „Lass es in meiner IDE laufen“ und „Lass es in der Cloud laufen“ sind zwei **deploy**-Ziele – der Agent, den Sie trainiert haben, ist der Agent, der in Ihrem Editor läuft, ohne zweiten Build.

## Die Eingangstür für natürliche Sprache

Die Modalität, die der Plattform fehlte, ist die menschlichste von allen: **natürliche Sprache.** „Ein Agent, der Abrechnungs-Tickets triagiert und Fragen zu Erstattungen anhand unserer Help-Center-Dokumente beantwortet“ hatte bisher keinen Ort, an den es gehen konnte. Jetzt gibt es dafür eine Eingangstür unter [`/compile`](/compile): Sie beschreiben den Bedarf in Worten, ein Extraktor überführt ihn in eine `AgentSpec` (Identität, Skills, ein automatisch geroutetes Modell), `deploy()` löst auf, wo er laufen wird, und – wenn Sie auf *Kompilieren & ausführen* drücken – führt die Plattform mit dem kompilierten System-Prompt einen echten ersten Turn über das Gateway aus. Bedarf definieren; zusehen, wie der Agent antwortet.

Wenn der Bedarf *Schritte* statt eines Gesprächs enthält – ein Prozessdiagramm oder den Verbesserungsablauf, den eine Diagnose vorgeschlagen hat –, chattet `compile & run` nicht. Es instanziiert einen echten Workflow: Die kompilierten Schritte werden zu `workflow_tasks`, die die bestehende Claim-and-Relay-Maschinerie ausführt. Derselbe Aufruf `POST /api/compile/run` steht jedem Client zur Verfügung – diese Eingangstür ist also ein Endpunkt, nicht nur eine Seite.

## Warum ein gemeinsames Rückgrat zählt

Wenn Persona, Gedächtnis und Richtlinie *auf der Spec* liegen statt in einer einzelnen Eingangstür, erreichen sie jede Oberfläche automatisch.

![Persona, Gedächtnis und Richtlinie liegen auf der AgentSpec und erreichen jede Oberfläche identisch](/blog/compile-governance-everywhere.svg)

Die Temperatur einer Persona verändert das Verhalten des Agents, egal ob er als Workflow-Schritt oder als Cloud-Agent läuft. Die proprietären Dokumente, auf denen Sie trainiert haben, werden bei der Inferenz abgerufen, ganz gleich, wo der Agent ausgeführt wird – bis hin zu einem ganz normalen OpenAI-SDK-Aufruf, der den Agent über seine Modell-ID anspricht.

Und ein Governance-Gate wird *durchgesetzt*, nicht bloß empfohlen. Dasselbe kompilierte Gate wird an der Tool-Nahtstelle jeder Engine ausgewertet – in der dauerhaften Cloud-Schleife, im On-Premise-Runner und in der IDE-Schleife im Editor – über eine gemeinsame Entscheidung `evaluatePolicyGate`. `block` verweigert das Tool und sagt dem Agent, er solle einen anderen Weg nehmen; `require-approval` pausiert den Run, fragt einen Menschen und setzt fort, sobald dieser antwortet. Legen Sie einmal `block` für das Tool `shell` fest, und es stoppt die Shell in Ihrem Editor genauso wie bei einem Cloud-Tick – denn das Gate reist mit dem Agent, nicht mit dem Ort, an dem er läuft. Genau das ist der Sinn, die Richtlinie auf die Spec zu legen statt in eine einzelne Eingangstür: Es kann nicht vorkommen, dass eine Regel auf einer Oberfläche gilt und auf einer anderen nicht, denn es gibt nur eine Regel und nur eine Stelle, an der sie geprüft wird.

Das ist der Unterschied zwischen einer Plattform und einem Haufen Features. Ein Haufen Features hat ein Trainings-Tool, einen Workflow-Builder, einen Persona-Editor und eine Runtime – jedes mit seiner eigenen privaten Vorstellung davon, was ein Agent ist. Eine Plattform hat eine einzige Vorstellung davon, was ein Agent ist, und lässt Sie aus jeder Richtung dorthin gelangen und auf jede Oberfläche weiterziehen.

## Was Sie heute tun können

Das ist keine Vision vom Reißbrett und auch keine halbfertige mehr – das Rückgrat ist durchgängig verbunden:

- **Definieren Sie einen Bedarf in natürlicher Sprache** und erhalten Sie einen laufenden Agent – `/compile` und `POST /api/compile/run`.
- **Kompilieren Sie jede Modalität in eine `AgentSpec`** – Fließtext, einen Datensatz mit Ihren eingelesenen proprietären Dokumenten, ein handgezeichnetes Prozessdiagramm, eine kompilierte Persona, die Befunde einer Diagnose oder ein Policy-Paket – und **stapeln Sie sie** zu einem einzigen Agent.
- **Rollen Sie diese eine Spec aus *und starten* Sie sie.** `deploy()` löst Engine, Transport und Run-Eingabe für jede Oberfläche auf; `deployAndDispatch()` *startet* sie dann – eine Spec mit Schritten wird zu einem laufenden Workflow, eine Cloud-Spec zu einem laufenden Cloud-Agent, dessen Governance-Gates bereits im Payload stecken.
- **Machen Sie aus einer Diagnose Handlung** – ein Reifegrad-Befund wird zu einem geordneten, ausführbaren Verbesserungsprozess kompiliert statt zu einem statischen Bericht.
- **Fundieren Sie einen normalen OpenAI-Aufruf** – sprechen Sie einen trainierten Agent über seine ID `builderforce/workforce-<id>` am Standard-Endpunkt `/v1/chat/completions` an, und er ruft für diese Anfrage Ihre eingelesenen Dokumente ab – dieselbe Fundierung, die auch der dedizierte Chat-Pfad erhält.
- **Steuern Sie über die Spec** – ein einmal festgelegtes `block`- oder `require-approval`-Gate wird an der Tool-Nahtstelle der Cloud-, On-Premise- und IDE-Runner gleichermaßen durchgesetzt: verweigert oder an eine menschliche Freigabe gebunden, nicht nur angewiesen.

Das Compile-Primitiv ist das Rückgrat, und was bereits stand, steht jetzt darauf. „Definiere einen Bedarf, das agentische System löst ihn“ sind nicht länger vier getrennte Türen – es ist eine Tür, die zu jeder Form passt, in der Ihr Bedarf ankommt, und die sich auf jede Oberfläche öffnet, auf der Ihre Arbeit stattfindet.

Sie beschreiben das Ergebnis, in der Sprache, die Ihnen am natürlichsten ist, und eine Workforce aus Agents – gesteuert, fundiert und auf der Oberfläche Ihrer Wahl – macht sich auf den Weg und holt es. Genau das tut die Plattform jetzt.
