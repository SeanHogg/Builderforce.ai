Bitten Sie einen Agent, die Ablauflogik von Sessions zu ändern, und sehen Sie zu, was er tatsächlich tut. Er listet ein Verzeichnis. Er liest eine Datei, die sich als die falsche herausstellt. Er sucht nach `expiry`, bekommt vierzig Treffer, liest vier davon, sucht erneut nach `ttl` und findet beim sechsten Versuch die richtige Stelle. Dann – zwanzig Turns später, die Antwort endlich in der Hand – beginnt er mit der Änderung, um die Sie gebeten haben.

Jede dieser Sackgassen steckt noch in seinem Kontext. Die falsche Datei steht vollständig darin. Die Suche mit vierzig Treffern ebenso. Wenn der Agent beim Teil ankommt, der Urteilsvermögen braucht, konkurriert genau dieser Teil um Platz mit einem Verzeichnis-Listing, das er versehentlich gelesen hat.

Das ist kein Denkproblem. Es ist ein Ablageproblem.

## Was ein Sub-Agent ist

Ein Sub-Agent ist ein zweiter Agent, der die Suche **in seinem eigenen Kontext** ausführt und eine einzige Antwort zurückmeldet.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Delegation, von Anfang bis Ende",
  "steps": [
    { "label": "Briefing", "note": "Der Eltern-Agent schreibt eine vollständige Anweisung – der Kind-Agent sieht nichts von seiner Konversation, also muss das Briefing für sich allein stehen.", "hue": "idea" },
    { "label": "Suche", "note": "Der Kind-Agent liest, greppt und denkt in seinem eigenen Transkript, mit einem kleinen, harten Budget. Seine Sackgassen bleiben seine eigenen.", "hue": "make" },
    { "label": "Antwort", "note": "Zurück kommt ein Absatz: exakte Pfade, exakte Namen und ein ausdrückliches „nicht gefunden“, wo das die ehrliche Antwort ist.", "hue": "prove" }
  ],
  "caption": "Der Eltern-Agent zahlt für einen Absatz statt für zwanzig Turns. Womit diese Turns verbracht wurden, gelangt nie in seinen Kontext."
}
```

Die Isolation ist der ganze Sinn. Ein Kind-Agent, der die Konversation des Eltern-Agents teilt, wäre bloß eine teurere Art, einen weiteren Turn zu nehmen.

```bf-figure
{
  "kind": "compare",
  "title": "Dieselbe Aufgabe, zwanzig Turns auseinander",
  "columns": [
    { "title": "Inline suchen", "hue": "muted", "items": ["Das Verzeichnis listen", "Die falsche Datei lesen, vollständig", "Suchen – vierzig Treffer", "Vier davon lesen", "Erneut suchen", "Beim sechsten Versuch finden", "Mit all dem noch im Fenster anfangen zu denken"] },
    { "title": "Die Suche delegieren", "hue": "make", "items": ["Fragen: Wo steckt die Session-Ablauflogik?", "Einen Absatz lesen", "Anfangen zu denken"] }
  ],
  "caption": "Dieselbe Arbeit erledigt. Der Unterschied ist, welcher Agent sie danach mit sich herumträgt."
}
```

## Standardmäßig nur lesend – und schreibend, wenn Sie es sagen

Eine Delegation ist standardmäßig nur lesend, weil eine nicht näher bestimmte Delegation fast immer eine Untersuchung ist. Der Kind-Agent darf lesen, suchen und nachdenken, und ein nur lesender Kind-Agent kann Sie nichts kosten außer Zeit.

Das ist ein Standard, keine Obergrenze. Ein Agent, der die vierzehn Dateien gefunden hat, die alle dieselbe mechanische Änderung brauchen, kann einen Kind-Agent anfordern, der sie vornimmt – und dann fragt jeder Schreibversuch dieses Kind-Agents zuerst **Sie**, namentlich, über denselben Prompt, den auch die Schreibvorgänge Ihres eigenen Agents nutzen. Auto deckt die Schreibvorgänge eines Sub-Agents genauso ab wie die des Eltern-Agents. Ein Governance-Gate, das ein Tool blockiert, blockiert es auch für den Kind-Agent, und eines, das eine Freigabe verlangt, verlangt sie auch bei eingeschaltetem Auto – denn eine Präferenz kann eine kompilierte Richtlinie nicht aufheben. Lehnen Sie ab, kommt die Ablehnung beim Kind-Agent als etwas an, um das er herumarbeiten kann, nicht als Sackgasse.

Genau das hat sich zuletzt geändert. Bis dahin konnte ein Sub-Agent in Ihrem Editor nur lesen – der Freigabe-Prompt wird von dem Chat ausgelöst, dem der Run gehört, und ein verschachtelter Agent hatte keinen Weg dorthin. Ehrlicherweise liefen Kind-Agents deshalb nur lesend, und das wurde auch offen gesagt. Der Prompt ist jetzt aus einer Delegation heraus erreichbar – der Kind-Agent stellt also die Frage, statt dass ihm die Gelegenheit dazu verwehrt wird.

Ein Kind-Agent kann weiterhin keinen eigenen Kind-Agent starten. Das ist kein Tiefenzähler, an dessen Herunterzählen jemand denken muss – die Fähigkeit zu delegieren fehlt schlicht in dem, was ein Kind-Agent mitbekommt, also gibt es nichts, womit er rekursiv werden könnte.

```bf-figure
{
  "kind": "compare",
  "title": "Was eine Delegation anfassen darf",
  "columns": [
    { "title": "Der Kind-Agent kann", "hue": "prove", "items": ["Dateien lesen und auflisten", "Den Verzeichnisbaum durchsuchen", "Projektgedächtnis abrufen", "Im Web suchen", "Schreiben – mit Ihrer Freigabe, pro Datei", "Antworten, einmal, in Prosa"] },
    { "title": "Der Kind-Agent kann nicht", "hue": "bad", "items": ["Etwas schreiben, das Sie nicht freigegeben haben", "Ein Governance-Gate umgehen", "Den Run für einen Menschen anhalten", "Einen Skill vorschlagen", "Einen weiteren Sub-Agent starten"] }
  ],
  "caption": "Verantwortlich bleibt der Eltern-Agent. Er behält jede Entscheidung und Sie jede Freigabe – er zahlt nur nicht mehr für die Suche."
}
```

## Wo das in der Methode steht

[Lesen kommt vor Beweisen, und Beweisen vor Bauen](/blog/read-prove-build-the-inner-loop) – und Lesen ist die Stufe, die sich dadurch verändert.

Lesen ist der günstige Akt der Methode – bis die Codebasis groß wird. Dann ist er nicht mehr günstig: Das Fenster des Agents füllt sich mit dem, was er auf dem Weg zu dem gelesen hat, was er eigentlich brauchte, und wenn er bei Bauen ankommt, denkt er um die Trümmer seiner eigenen Suche herum. Teams erleben das als einen Agent, der in einem kleinen Repo scharf war und in einem echten vage wirkt. Er ist dort nicht weniger fähig. Er ist voller.

Durch Delegation kostet Lesen wieder, was es wert ist. Die Suche findet an einem Ort statt, den der Eltern-Agent nicht mit sich tragen muss, und er kommt mit Platz zum Denken bei Beweisen an – der einzigen Stufe, auf der Denken je der Punkt war.

## Was Sie heute damit tun können

- **Einen Agent etwas finden lassen, ohne dass er seinen Kontext fürs Finden verbraucht.** „Wo ist die Auth-Middleware?“, „Wird dieses Muster noch irgendwo anders verwendet?“, „Was exportiert diese sechshundert Zeilen lange Datei eigentlich?“ – ein Briefing, ein Absatz.
- **Es überall nutzen, wo der Agent läuft.** Der Editor, ein Cloud-Run, ein langlebiger Container und ein GitHub-Actions-Job delegieren alle auf dieselbe Weise – dasselbe Tool, dasselbe Briefing, dasselbe Budget –, sodass eine Gewohnheit, die Sie an einem Ort lernen, überall gilt. Am meisten bringt es auf den beiden langlebigen Oberflächen: Sie haben die Shell und den Checkout, und genau dort ist eine Inline-Suche am teuersten mitzuschleppen.
- **Eine mechanische Änderung schicken, nicht nur eine Frage.** „Benenne dieses Symbol überall um, wo es vorkommt“ ist jetzt eine Delegation – kein Bericht, auf den Sie dann selbst reagieren müssen. Sie geben jede Datei frei, während es passiert.
- **Sehen, was es gekostet hat.** Jede Delegation landet auf der Run-Timeline mit ihrem Label, ihren Turns und der Angabe, ob sie ihr Budget aufgebraucht hat – ein Kind-Agent, der abgeschnitten wurde, sagt das, statt sein letztes Wort als Schlussfolgerung auszugeben.
