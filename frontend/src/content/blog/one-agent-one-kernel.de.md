Beginnen Sie einen Chat mit einem Agenten in VS Code, setzen Sie ihn mitten im Verlauf im Browser fort – und der Agent, der Ihnen dort antwortet, hat dieselben Werkzeuge, folgt denselben Regeln und Schutzmechanismen, und seine Arbeit durchläuft dieselbe Prüfung. Eine Korrektur, die Sie an einer Stelle bekommen, gilt überall.

Das funktioniert nur, wenn das, was Ihnen antwortet, überall dasselbe ist. Lange war es das nicht: Der Editor, die Web-App, Rovr und die On-Prem-Kanäle hatten jeweils ihre eigene Ausführungsschleife, ihre eigene Werkzeuganbindung und – an einem schlechten Tag – vier verschiedene Antworten auf dieselbe Frage.

Jetzt gilt: **Die Oberfläche wechselt, der Agent nicht.** Ein einziger Ausführungskern führt jeden Chat aus, auf jedem Host.

## Eine Schleife, nicht vier

Es gibt jetzt eine einzige Agentenschleife. Die alten Ausführungsschleifen pro Oberfläche sind weg – gelöscht, nicht nur als veraltet markiert –, es gibt also keine zweite Engine, die sich hinter einem Flag versteckt und darauf wartet, auseinanderzudriften. Diese eine Schleife ist der einzige Weg, den ein Turn nehmen kann, ob er in der Chat-Leiste des Editors beginnt, auf dem Web-Canvas, in Rovr im Browser oder in einem Kanal wie Slack.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Schleife hinter jeder Oberfläche",
  "steps": [
    { "label": "Ihr Chat", "note": "VS Code, Web, Rovr oder ein Kanal – die Oberfläche ist eine Ansicht, keine Engine.", "hue": "make" },
    { "label": "Der eine Kern", "note": "Eine einzige Ausführungsschleife und Werkzeugrichtlinie führt jeden Turn aus.", "hue": "run" },
    { "label": "Dieselben Prüfungen", "note": "Dieselben Werkzeuge, dieselben Schutzmechanismen, dieselbe Prüfung – egal, welche Oberfläche Sie genutzt haben.", "hue": "measure" }
  ],
  "caption": "Die Oberfläche zeigt das Gespräch an; der Kern führt es."
}
```

## Warum das wichtig ist

- **Ein Gespräch ist übertragbar.** Am Desktop beginnen, im Browser weitermachen – Zustand, Gedächtnis und Werkzeugzugriff des Agenten kommen mit, weil sie nie an eine Oberfläche gebunden waren.
- **Eine Korrektur ist eine Korrektur.** Härten Sie die Werkzeugrichtlinie einmal, und jeder Host übernimmt sie. Die Fehlerklasse „funktioniert im Editor, aber nicht im Web“ gibt es nicht mehr.
- **Nur eine Sache zu prüfen.** Ein einziges Konformitätsorakel spielt das Referenzszenario gegen die eine Engine ab, sodass „Ist der Agent korrekt?“ eine Antwort hat, nicht vier.

## Wo es in der Methode steht

Das ist die **Make**-Phase, vertrauenswürdig gemacht: Der Agent, der baut, ist überall derselbe, wo Sie ihm begegnen. Zuverlässigkeit, die Sie über Oberflächen hinweg mitnehmen können, ist das, worauf der Rest des Bogens – Run, Measure – aufbauen kann.

## Was Sie heute damit tun können

Öffnen Sie denselben Chat auf zwei Oberflächen und sehen Sie, dass sie übereinstimmen. Verschieben Sie ein Gespräch mitten im Verlauf vom Editor in den Browser. Der Kern ist die Konstante; die Oberfläche ist dort, wo Sie gerade sind.
