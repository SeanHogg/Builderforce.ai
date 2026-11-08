Jedes Team hat eine kurze Liste von Dingen, ohne die eine Änderung nicht fertig ist. Das README erwähnt das neue Flag. DONE.md hält fest, was ausgeliefert wurde. Der Linter ist grün. Niemand pusht mit einem fehlschlagenden Test auf main.

Sie könnten es dem Agenten jedes Mal sagen, aber Sie würden es vergessen. Ihr Teamkollege wüsste gar nicht, dass er es sagen muss. Und eine Anweisung, die in einen Chat getippt wird, endet mit diesem Chat, sodass die nächste Session von vorn beginnt.

Diese Liste gehört zum Repository, nicht zu der Person, die gerade tippt. Deshalb lebt sie jetzt dort.

## Workspace-Hooks

Fügen Sie Ihrem Repository eine Datei hinzu, `.builderforce/hooks.json`:

```json
{
  "hooks": [
    { "on": "stop", "prompt": "Update README.md and DONE.md with the work completed in this session." },
    { "on": "stop", "command": "npm run lint" },
    { "on": "preTool", "tool": "git_push", "command": "npm test" },
    { "on": "postTool", "tool": "write_file|edit_file", "command": "npx prettier --check ." }
  ]
}
```

Jeder Agent-Run in diesem Workspace folgt ihr nun, egal ob er im BuilderForce-Panel oder im integrierten Chat von VS Code startet.

```bf-figure
{
  "kind": "flow",
  "title": "Wo jeder Hook in einem Run auslöst",
  "steps": [
    { "label": "preTool", "note": "Vor einem passenden Tool-Aufruf. Ein fehlschlagender Befehl verweigert den Aufruf, und der Agent sieht, warum.", "hue": "make" },
    { "label": "postTool", "note": "Nach einem erfolgreichen Aufruf. Die Ausgabe einer fehlschlagenden Prüfung geht zusammen mit dem Ergebnis an den Agenten zurück.", "hue": "make" },
    { "label": "stop", "note": "Der Run steht kurz vor dem Ende. Ein Prompt wird einmal übergeben. Eine fehlschlagende Prüfung hält den Run an, bis sie besteht.", "hue": "run", "tag": "vor dem Release" },
    { "label": "runEnd", "note": "Nachdem der Run beendet ist. Ein Befehl für Benachrichtigungen, Berichte und Aufräumarbeiten.", "hue": "measure" }
  ],
  "caption": "Stop-Hooks laufen, bevor der Agent committet und pusht, sodass alles, was sie verlangen, etwa Doku, eine Changelog-Zeile oder eine Lint-Korrektur, im selben Commit ausgeliefert wird."
}
```

Ein **Prompt** ist eine Anweisung in einfachen Worten, die der Agent mit seinen eigenen Tools ausführt. Ein **Command** ist eine Prüfung, die im Workspace-Root läuft und deren Ausgabe entscheidet, was als Nächstes passiert. Standardmäßig feuern Stop-Hooks nur bei Runs, die Code geändert haben, sodass eine Frage zur Codebasis den Agenten nicht losschickt, Ihr README umzuschreiben. Setzen Sie `"when": "always"`, wenn Sie einen bei jedem Run wollen.

Dauerhafte Richtlinien, die nicht an einen Zeitpunkt gebunden sind, gehören in `.builderforce/rules.md`, zum Beispiel „use pnpm“, „every migration gets a rollback“ oder „write tests in Vitest“. Sie werden in die Anweisungen jedes Runs eingelesen, unterhalb der Governance-Gates Ihrer Organisation und oberhalb von allem anderen.

```bf-figure
{
  "kind": "screen",
  "frame": "Ein Repository mit Team-Direktiven",
  "ratio": 1.62,
  "regions": [
    { "label": ".builderforce/hooks.json", "note": "Wird beim Tippen gegen ihr Schema geprüft", "x": 4, "y": 8, "w": 44, "h": 40, "hue": "make" },
    { "label": ".builderforce/rules.md", "note": "Dauerhafte Anweisungen für jede Aufgabe", "x": 4, "y": 52, "w": 44, "h": 36, "hue": "idea" },
    { "label": "Agent-Chat", "note": "Bevor Sie fertig sind, bittet dieser Workspace Sie: README.md und DONE.md aktualisieren…", "x": 52, "y": 8, "w": 44, "h": 80, "hue": "run" }
  ],
  "caption": "Beide Dateien sind Klartext in Ihrem Repository: in Pull Requests geprüft, mit dem Code versioniert und für alle identisch, die es klonen."
}
```

## Geteilt und trotzdem sicher

Die Dateien liegen in `.builderforce/`, sodass sie committet werden. Das heißt auch, dass eine Hooks-Datei mit jedem Klon ankommt und ein Command darin auf Ihrem Rechner läuft. Deshalb laufen Commands erst, wenn Sie sie genehmigen, einmal pro Rechner. VS Code zeigt Ihnen die genaue Liste. Wenn jemand einen Command ändert oder einen hinzufügt, werden Sie erneut gefragt. Das Bearbeiten eines Prompts oder der Regeln braucht keine Genehmigung, weil das Text ist, den der Agent liest, wie jede andere Datei im Repository. In einem Workspace, dem VS Code nicht vertraut, läuft nichts.

## Wo es in der Methode sitzt

Hooks gehören zu **Build**, dem dritten und teuren Akt. [Read und Prove](/blog/read-prove-build-the-inner-loop) kosten nichts, weil noch kein Code geändert wurde. Sobald sich Code ändert, ist die Definition of Done eines Teams das, was verhindert, dass ein Run der nächsten Person ein Chaos hinterlässt. In einer lokalen Editor-Session ist der Agent der einzige Reviewer, den die Änderung vor dem Release bekommt, daher müssen die Standards des Teams Teil des Runs selbst sein, nicht eine Erinnerung, die davon abhängt, dass jemand daran denkt.

```bf-figure
{
  "kind": "compare",
  "title": "Eine Änderung abschließen",
  "columns": [
    { "title": "Ohne Hooks", "hue": "muted", "items": ["Der Agent liefert den Code aus", "Jemand bemerkt, dass das README veraltet ist", "Jemand anderes bemerkt, dass Lint rot ist", "Ein Folge-Commit behebt beides", "Der Run des nächsten Teamkollegen wiederholt es"] },
    { "title": "Mit Workspace-Hooks", "hue": "make", "items": ["Der Agent ändert den Code", "Er aktualisiert die Doku, wie gewünscht", "Lint muss bestehen, bevor er fertig sein darf", "Ein Commit liefert alles aus", "Dasselbe für alle im Team"] }
  ],
  "caption": "Die Definition of Done eines Teams wird von einer Gewohnheit zu einem Teil des Runs."
}
```

## Was Sie heute damit tun können

- **Die Doku aktuell halten, ohne zu fragen**: Ein Stop-Prompt macht „README und DONE aktualisieren“ zum Teil jeder Änderung.
- **Eine Prüfung zur Voraussetzung machen**: Ein Stop-Command hält den Run an, bis Ihr Linter oder Type-Check besteht, innerhalb einer begrenzten Zahl von Versuchen.
- **Riskante Aktionen absichern**: Ein preTool-Command kann `git_push` verweigern, bis `npm test` besteht.
- **Unterwegs korrigieren**: Eine fehlschlagende postTool-Prüfung schickt die Beanstandung des Formatters direkt an den Agenten zurück.
- **Alles über git teilen**: Committen Sie `.builderforce/`, und der Agent jedes Teamkollegen folgt denselben Direktiven.

Führen Sie in VS Code **BuilderForce: Edit Workspace Hooks** aus, um eine Starterdatei zu erstellen.

---

**Weiterlesen:** [Approval gates and human oversight](/blog/approval-gates-and-human-oversight) · [BuilderForce vs Claude Code](/blog/builderforce-vs-claude-code) · [Multi-agent orchestration](/blog/multi-agent-orchestration)
