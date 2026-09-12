Sie bitten um einen Fix. Der Agent arbeitet, kommentiert, wird fertig und sagt: *Die Dateiänderung wurde lokal vorgenommen – committen und pushen müssen Sie manuell.*

Und dann?

Die Änderung ist real. Sie liegt genau jetzt auf Ihrer Platte. Und bis zu diesem Release hat nichts in BuilderForce das gesagt. Der Chat zeigte einen abgeschlossenen Turn. Die Ticket-Leiste darüber zeigte einen Task in Arbeit. Jeder Bereich der Seitenleiste – Sitzungen, Chats, Projekt & Tasks, Posteingang – machte weiter, als hätte nichts das Dateisystem berührt. Die einzige Spur der Änderung war ein Satz in einem Transkript, dem Sie vertrauen mussten, und der einzige Weg zum Code bestand darin, selbst an die Source-Control-Ansicht von VS Code zu denken und sie aus dem Gedächtnis mit dem Gespräch abzugleichen.

Ziemlich seltsam für ein Tool, dessen ganze Prämisse lautet, dass Agents Arbeit erledigen, die Sie überprüfen können.

## Was es jetzt gibt

Zwei Oberflächen, die dieselbe Antwort lesen.

```bf-figure
{
  "kind": "screen",
  "frame": "Der Editor nach einem Agent-Turn, der Code angefasst hat",
  "ratio": 1.62,
  "regions": [
    { "label": "Änderungen", "note": "Ein neuer Bereich in der Seitenleiste. Zähler-Badge, eine Zeile pro Datei, ein Klick öffnet den Diff.", "x": 3, "y": 22, "w": 32, "h": 30, "hue": "make" },
    { "label": "Sitzungen · Projekt · Posteingang", "note": "Unverändert", "x": 3, "y": 54, "w": 32, "h": 34, "hue": "muted" },
    { "label": "Aktivitätsleiste", "note": "Das Badge des Bereichs wird hierher hochgereicht – sichtbar auch bei geschlossenem Panel", "x": 0, "y": 8, "w": 3, "h": 84, "hue": "accent" },
    { "label": "Leiste für ausstehende Änderungen", "note": "3 nicht committete Änderungen · Prüfen", "x": 38, "y": 14, "w": 58, "h": 9, "hue": "make" },
    { "label": "Ticket-Leiste", "note": "Die Tickets, an denen dieser Chat arbeitet", "x": 38, "y": 25, "w": 58, "h": 12, "hue": "idea" },
    { "label": "Das Gespräch", "x": 38, "y": 39, "w": 58, "h": 49, "hue": "idea" }
  ],
  "caption": "Die Leiste sitzt über der Ticket-Leiste, weil Sie genau dorthin schauen, wenn ein Turn endet. Der Bereich in der Seitenleiste ist für die Momente, in denen Sie das nicht tun."
}
```

**Ein Bereich „Änderungen“ in der BuilderForce-Seitenleiste.** Eine Zeile pro geänderter Datei, mit dem, was mit ihr passiert ist, und dem Repository, in dem sie liegt. Klicken Sie auf eine Zeile, öffnet sich der Diff-Viewer des Editors – keine Darstellung eines Diffs, sondern der echte, mit seiner gesamten Navigation und der Möglichkeit, die rechte Seite zu bearbeiten. Der Bereich trägt ein Zahlen-Badge, und VS Code reicht View-Badges bis zum Symbol in der Aktivitätsleiste hoch – ausstehende Arbeit ist also auch bei eingeklapptem Panel sichtbar.

**Eine Leiste für ausstehende Änderungen im Chat**, direkt über der Ticket-Leiste. Sie nennt die Anzahl, klappt zur Dateiliste auf und öffnet dieselben Diffs über denselben Befehl. Ist das Arbeitsverzeichnis sauber, rendert sie gar nichts – keinen Leerzustand, keinen Platzhalter. Ein Signal, das ständig auf dem Bildschirm steht, ist kein Signal.

Beide werden aus derselben Abfrage gespeist – und das ist wichtiger, als es klingt.

## Das Zählen ist der schwierige Teil

„Wie viele Dateien stehen aus?“ scheint eine Frage mit offensichtlicher Antwort zu sein – und sie hat mindestens vier falsche.

```bf-figure
{
  "kind": "compare",
  "title": "Was eine naive Zählung falsch macht",
  "columns": [
    { "title": "Die naheliegende Umsetzung", "hue": "bad", "items": ["Staged und unstaged, einfach addiert", "Eine gestagte und danach bearbeitete Datei zählt doppelt", "Eine Umbenennung meldet die Datei, die es nicht mehr gibt", "Ein ungelöster Merge-Konflikt sieht aus wie eine gestagte Änderung", "Untracked-Dateien sind unsichtbar – oder sind alles"] },
    { "title": "Was die Zahl bedeuten muss", "hue": "make", "items": ["Eine Zeile pro DATEI, egal, was git gegen sie vermerkt", "Gestagt und danach bearbeitet ist eine ausstehende Änderung, als gestagt markiert", "Eine Umbenennung ist ihr Ziel – die Datei, die existiert", "Ein Konflikt heißt Konflikt, weil die Abhilfe eine andere ist", "Untracked wird aufgeführt und nie als gestagt bezeichnet"] }
  ],
  "caption": "Jeder dieser Punkte ist ein Test in der Suite. Es gibt sie, weil eine Zahl, die sich nicht mit der Source-Control-Ansicht direkt daneben abgleichen lässt, schlimmer ist als gar keine Zahl."
}
```

Die Zuordnung lebt in einem einzigen hostunabhängigen Modul mit achtzehn Tests über genau diese Fälle – einschließlich `AD`, bei dem Sie eine neue Datei gestagt und sie danach gelöscht haben: Die ausstehende Änderung ist dann die Löschung, nicht das Hinzufügen. Alles darüber liest dieses eine Modul: die Seitenleiste, die Chat-Leiste und die Repository-Fakten, die dem Agent selbst zu Beginn eines Turns mitgeteilt werden. Letztere waren im alten Code still und leise falsch – dort wurden die Listen für staged und unstaged addiert –, sodass das Modell „2 nicht committete Dateien“ hören konnte, während eine UI drei anzeigte. Jetzt gibt es eine Zahl.

## Ehrlich bleiben zwischen den Ereignissen

Die Datei-Tools eines Agents schreiben direkt auf die Platte. Sie laufen nicht über die Dokument-API des Editors, also feuert in VS Code nichts, wenn sie ankommen. Eine Oberfläche, die höflich auf eine Benachrichtigung wartet, behauptet dann weiter, es stünde nichts aus, während sich darunter gerade drei Dateien geändert haben.

```bf-figure
{
  "kind": "flow",
  "title": "Alles, was das Arbeitsverzeichnis verändern kann – und was uns davon erzählt",
  "steps": [
    { "label": "Sie bearbeiten und speichern", "note": "Das Speicherereignis des Editors selbst", "hue": "idea" },
    { "label": "Sie stagen, committen oder wechseln den Branch", "note": "Das Repository-Statusereignis der Git-Erweiterung", "hue": "run" },
    { "label": "Ein Agent schreibt eine Datei", "note": "Nichts feuert – also IST das verändernde Tool das Signal, ausgelöst in dem Moment, in dem es erfolgreich ist", "hue": "make", "tag": "die Lücke" },
    { "label": "Ein gemeinsames Abonnement", "note": "Egal, wie viele Chat-Panels und Seitenleisten zusehen: ein Listener und eine gecachte Abfrage hinter allen", "hue": "measure" }
  ],
  "caption": "Der dritte Schritt ist der, der dieses Feature nötig gemacht hat – und der, den ein benachrichtigungsgetriebenes Design übersieht."
}
```

## Wo es in der Methode steht

Das ist **Nachweisen**, und es lohnt sich, genau zu sagen, warum.

[Lesen, Nachweisen, Bauen](/blog/read-prove-build-the-inner-loop) ist die innere Schleife, und Nachweisen ist der günstige Schritt, der entscheidet, ob Bauen richtig war. Ein Agent, der Ihren Code bearbeitet, hat eine Behauptung aufgestellt: *Diese Änderung tut, worum Sie gebeten haben.* Ein Transkript, das das sagt, ist kein Beleg. Der Diff ist der Beleg – und liegt er drei Klicks entfernt in einem anderen Tool, akzeptieren die meisten Menschen in der Praxis die Behauptung, statt sie zu prüfen. Genau so hört ein agentischer Workflow auf, überprüfbar zu sein, und wird zu etwas, dem man entweder pauschal vertraut oder das man aufgibt.

Den Beleg einen Klick von der Behauptung entfernt zu platzieren, ist keine Bequemlichkeit. Es ist das, was die Schleife geschlossen hält.

Es sitzt außerdem an einer bestimmten Nahtstelle des Bogens [Idee → Bauen → Betreiben → Messen](/blog/idea-make-run-measure-menu-as-methodology): der Übergabe aus **Bauen** heraus. Code existiert; nichts wurde bisher committet, betrieben oder gemessen. Diese Übergabe war die einzige Stelle, an der die lokale Editor-Oberfläche überhaupt keine Darstellung hatte – das Board verfolgt ein Ticket, die Cloud-Lane committet jeden Schreibvorgang und öffnet am Ende des Runs einen Pull Request, und lokal wurde die Arbeit schlicht unsichtbar, sobald sie kein Gespräch mehr war, sondern Dateien. Jetzt ist sie sichtbar.

## Was Sie heute damit tun können

- **Wissen Sie, ohne zu fragen, dass ein Turn Code geändert hat** – die Anzahl steht im Chat und auf dem Symbol der Aktivitätsleiste, und sie erscheint in dem Moment, in dem das Tool erfolgreich ist, statt irgendwann, wenn zufällig etwas aktualisiert.
- **Lesen Sie jede Änderung als echten Diff**, im Viewer des Editors, einen Klick entfernt von dem Gespräch, das sie erzeugt hat.
- **Sehen Sie, was bereits gestagt ist**, damit „committen“ keine Überraschungen birgt.
- **Übergeben Sie an Brain, wenn Sie zufrieden sind** – die Titelaktion des Bereichs „Änderungen“ öffnet einen Chat, der darauf vorbereitet ist, den Diff zu prüfen, auf einem Branch zu committen, zu pushen und einen Pull Request zu öffnen – und der Branch-Namen und Titel vorher mit Ihnen abstimmt.

Eines hat dieses Release damals bewusst **nicht** getan: dem Agent einen eigenen Commit- oder Push-Befehl zu geben. Was ein lokaler Agent mit Ihrem Arbeitsverzeichnis und Ihrem Remote tun darf, ist eine Governance-Entscheidung – Branch oder `main`, ob ein Push ein Freigabe-Gate braucht, ob „PR öffnen und Review anfordern“ „pushen“ als Standardabschluss ersetzen sollte –, und die Befehle vor der Entscheidung auszuliefern, hätte bedeutet, einen Agent auszuliefern, der aus eigenem Antrieb auf einen geschützten Branch pushen kann. Der Review-Pfad kam mit Absicht zuerst.

**Seitdem ist diese Entscheidung gefallen, und die Befehle sind ausgeliefert**: `git_commit` (auf einem Ticket-Branch, mit Nennung der exakten geänderten Dateien), `git_push` (lehnt den Base-Branch ab, solange Sie nicht genau diesen Akt genehmigen) und `open_pull_request`. Wie die Governance-Frage beantwortet wurde, lesen Sie in [Aus dem Editor ausliefern](/blog/ship-from-the-editor-commit-branch-pull-request).

---

**Weiterlesen:** [VS Code als Kommandozentrale Ihrer agentischen Workforce](/blog/vs-code-command-center-for-your-agentic-workforce) · [Lesen, Nachweisen, Bauen – die innere Schleife](/blog/read-prove-build-the-inner-loop) · [Freigabe-Gates und menschliche Aufsicht](/blog/approval-gates-and-human-oversight)

Installieren Sie die [BuilderForce-Erweiterung für VS Code](https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai), bitten Sie einen Agent um eine Änderung und sehen Sie zu, wie die Zahl erscheint.
