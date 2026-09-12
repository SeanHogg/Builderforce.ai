Vor einer Woche hat [Sehen, was der Agent geändert hat](/blog/see-what-the-agent-changed-before-you-commit) die eine Hälfte einer Lücke geschlossen. Die andere Hälfte blieb bewusst offen, und der Beitrag hat das auch offen gesagt: kein Commit-Befehl, kein Push-Befehl. Denn was ein lokaler Agent mit Ihrem Remote anstellen darf, ist eine Governance-Entscheidung – und wer die Befehle vor der Entscheidung ausliefert, übergibt Ihnen einen Agent, der aus eigenem Antrieb auf einen geschützten Branch pushen kann.

Die Entscheidung ist gefallen. Das ist daraus geworden.

## Wie es vorher aussah

Hier lohnt es sich, genau zu sein, denn das Problem war nicht „ein Feature fehlte“. Es war schlimmer: Man hatte dem Agent *gesagt*, er könne ausliefern – und er konnte es nicht.

Die Editor-Persona endete mit einem Satz, der sinngemäß lautete: *Nutze `run_command` für git – zum Committen, Pushen und Öffnen eines PR, wenn der Nutzer ausliefern will.* Ein Ratschlag ohne Tool dahinter. Als also jemand einen Agent bat, einen einzeiligen CSS-Fix zu committen und zu pushen, passierte Folgendes:

```bf-figure
{
  "kind": "flow",
  "title": "Eine Anfrage – und jeder einzelne Schritt geht schief",
  "steps": [
    { "label": "„Committe die Änderung und pushe auf main“", "note": "Die Änderung ist bereits gemacht und korrekt", "hue": "idea" },
    { "label": "git_status schlägt fehl", "note": "Der geöffnete Ordner enthält mehrere Checkouts, an seiner Wurzel liegt also kein Repo", "hue": "bad", "tag": "1" },
    { "label": "git_sync_latest lässt sich nicht eingrenzen", "note": "Es nahm überhaupt kein `repo`-Argument an – anders als git_status", "hue": "bad", "tag": "2" },
    { "label": "Durchsucht den Tool-Katalog", "note": "Es gibt keinen Commit-Befehl zu finden; `run_command` war aus dem Turn herausgekürzt worden", "hue": "bad", "tag": "3" },
    { "label": "git add -A && git commit && git push", "note": "Jede Datei eines geteilten Arbeitsverzeichnisses, ungeprüft, direkt auf main", "hue": "bad", "tag": "4" }
  ],
  "caption": "Vier unabhängige Defekte, eine Anfrage. Der letzte ist der gefährliche – und genau der, den die ersten drei unvermeidlich gemacht haben."
}
```

Bei Schritt vier sollte man innehalten. Das Arbeitsverzeichnis enthielt drei geänderte Dateien. Der Agent hatte eine davon angefasst. `git add -A` kennt den Unterschied nicht – und ein Agent, der nie gefragt wurde, ihn zu benennen, ebenso wenig.

## Die Form der Antwort

Drei Tools, und der sichere Weg ist der, der erreichbar ist.

```bf-figure
{
  "kind": "flow",
  "title": "Der Standardweg",
  "steps": [
    { "label": "git_commit", "note": "Nennt die exakten Pfade, die er geändert hat, und den Ticket-Branch, auf den sie gehören – der Branch wird für Sie angelegt", "hue": "make" },
    { "label": "git_push", "note": "Pusht diesen Branch und setzt beim ersten Mal seinen Upstream", "hue": "run" },
    { "label": "open_pull_request", "note": "Öffnet den PR gegen den Base-Branch und kann Reviewer namentlich anfordern", "hue": "prove" },
    { "label": "Ein Mensch liest den Diff", "note": "Und genau darum ging es", "hue": "measure" }
  ],
  "caption": "Als Workflow ist hier nichts neu. Neu ist, dass dies für den Agent der Weg des geringsten Widerstands ist – statt etwas, von dem Sie hofften, dass er es wählt."
}
```

**`git_commit` verlangt, dass Sie die Pfade auflisten.** Nicht als Formalie. Ihr Arbeitsverzeichnis teilen Sie sich – mit sich selbst, dem Menschen davor, mitten im Gedanken, mit zwei weiteren Dateien offen und halb bearbeitet. `git add -A` fegt diese in den Commit des Agents und in dessen Pull Request, und plötzlich steckt Ihre fremde Arbeit im Review eines anderen. Ein Agent, der nicht sagen kann, welche Dateien er geändert hat, hat beim Committen nichts verloren – also lässt das Tool ihn nicht darum herumkommen.

**Commits auf dem Base-Branch werden abgelehnt.** Übergeben Sie `branch`, wechselt das Tool auf diesen Ticket-Branch und legt ihn an, falls er noch nicht existiert. Lassen Sie ihn weg, während Sie auf `main` sind, erhalten Sie eine Fehlermeldung, die die Lösung benennt – statt eines git-Fatals.

**`open_pull_request`** pusht den Branch zuerst, falls er keinen Upstream hat, und öffnet den PR dann über Ihr eigenes `gh`-Login – es wird kein Token durch den Agent geschleust, denn die Maschine hat bereits eines. Ist `gh` nicht installiert, meldet das Tool, dass der Branch committet und gepusht ist, und gibt Ihnen den Branch-Namen. Genau das ist der Unterschied zwischen einem fehlgeschlagenen Tool und verlorener Arbeit.

## Ein Push auf main ist ein erklärter Akt

Sie können es weiterhin tun. Es kann nur nicht mehr versehentlich passieren – oder auf Initiative eines Agents.

```bf-figure
{
  "kind": "compare",
  "title": "„Pushe das auf main“",
  "columns": [
    { "title": "Vorher", "hue": "bad", "items": ["Kein Tool – fällt auf eine rohe Shell zurück", "`git add -A` staget, was eben da ist", "Direkt auf den Base-Branch", "Die Freigabeabfrage lautet: run: git add -A && git com…", "Nichts bot einen Pull Request an, weil nichts es konnte"] },
    { "title": "Jetzt", "hue": "good", "items": ["Der Agent bietet zuerst einen Pull Request an und sagt, warum", "Nur die Pfade, die er nennt, werden gestaget", "Abgelehnt, solange `allowBaseBranch` nicht gesetzt ist", "Die Abfrage lautet: push to the BASE BRANCH (main) — skips pull-request review", "Sie genehmigen genau diesen Akt – oder eben nicht"] }
  ],
  "caption": "Die mittlere Zeile ist die Governance-Entscheidung. Die vierte macht sie zu einer echten – eine Freigabe, die man nicht lesen kann, ist keine Freigabe."
}
```

Jedes dieser Tools verändert etwas, deshalb laufen sie über dasselbe Freigabe-Gate wie `write_file` und `delete_file`. Dieses Gate gab es schon; was ihm fehlte, war etwas, das sich zu lesen lohnt. `git_push` in einem Bestätigungsdialog verrät Ihnen nichts über das eine, was Sie abwägen müssen. *Push to the BASE BRANCH (main) — skips pull-request review* verrät Ihnen alles.

Außerdem hängen sie an einer neuen Capability `git.write` statt an `shell`. Das klingt nach Buchhaltung, ist es aber nicht: Auch die Cloud-Oberflächen haben Shells, und sie veröffentlichen bereits über einen völlig anderen Mechanismus – ein Schreibvorgang dort **ist** ein Commit, und der Run öffnet seinen Pull Request, wenn er endet. Ihnen einen zweiten, nicht implementierten Weg zum selben Akt zu geben, würde Tools einblenden, für die ihre Runtime keinen Handler hat – und das scheitert mitten im Run. Eine Capability, eine Oberfläche, ein Weg zum Veröffentlichen pro Lane.

## Der leise Fix darunter

Warum der Agent überhaupt nach `run_command` gesucht hat, verdient einen Namen – denn es handelt sich um eine Klasse von Bugs, nicht um einen Einzelfall.

Der Katalog umfasst rund 440 Tools. Etwa 64 davon werden pro Turn angeboten, ausgewählt nach lexikalischer Relevanz für Ihre Anfrage. `run_command` teilt keinen Wortstamm mit „commit the change and push to main“ – also wurde es genau in dem Turn weggekürzt, der es brauchte. Der Agent las seine eigenen Anweisungen, suchte das dort genannte Tool und fand es nicht.

Alle neun git-Tools sind jetzt bedingungslos fest verankert, neben den Datei-Tools. Relevanz ist ein vernünftiges Kriterium, um zwischen Domänen zu wählen. Sie ist kein vernünftiges Kriterium dafür, ob der Agent den Workspace anfassen darf, in dem er sitzt.

## Wo es in der Methode steht

Das ist der **Bauen**-Schritt von [Lesen, Nachweisen, Bauen](/blog/read-prove-build-the-inner-loop), der endlich sein eigenes Ende erreicht – und die Übergabe **Bauen → Betreiben** auf dem Bogen [Idee → Bauen → Betreiben → Messen](/blog/idea-make-run-measure-menu-as-methodology).

Das vorige Release hat die Übergabe *sichtbar* gemacht: Code lag auf der Platte, nichts war committet, und jetzt konnten Sie das sehen und jeden Diff lesen. Aber sichtbar heißt nicht passierbar. Sie konnten die Arbeit prüfen und mussten das Tool dann verlassen, um sie weiterzubewegen – der Bogen hatte also genau dort eine Naht, wo eine Methode nahtlos sein soll, und jede lokale Änderung wurde stillschweigend zu einem manuellen Schritt, an den jemand denken musste.

Geschlossen wird die Lücke nicht durch „der Agent kann jetzt pushen“. Sondern dadurch, dass der Weg aus Bauen standardmäßig in **Nachweisen** mündet – ein Pull Request, ein Diff, ein Reviewer – statt in Betreiben, mit übersprungenem Review. Auf einen Ticket-Branch zu committen und einen PR zu öffnen, ist genau einen Schritt langsamer als ein Push auf `main`, und dieser Schritt ist der, in dem ein Mensch sich die Änderung ansieht. Den geprüften Weg zum Standard zu machen, ist das ganze Argument.

Ein Push auf den Base-Branch bleibt möglich, weil er manchmal wirklich richtig ist – und eine Methode, die etwas anderes behauptet, wird umgangen. Er kostet Sie nur einen Satz, in dem Sie das sagen, und eine Abfrage, die Ihnen zeigt, was Sie genehmigen.

## Was Sie heute damit tun können

- **Bitten Sie um eine Änderung und dann darum, sie auszuliefern** – und erhalten Sie einen Ticket-Branch und eine Pull-Request-URL zurück, keinen Shell-Befehl, den Sie prüfen müssen.
- **Verlassen Sie sich darauf, dass nur Ihre Änderung drin ist**, denn der Agent musste die Dateien benennen.
- **Sagen Sie „push to main“ und bekommen Sie stattdessen ein Review angeboten** – und trotzdem Ihren Push, wenn Sie bestätigen, dass Sie es so meinten.
- **Fordern Sie Reviewer namentlich an** für den Pull Request, den der Agent öffnet.
- **Arbeiten Sie in einem Ordner mit mehreren Checkouts**, den jetzt jedes git-Tool beherrscht: Übergeben Sie `repo`, und jedes Tool greift auf das richtige zu. `git_sync_latest`, `git_undo` und `git_redo` konnten das vorher nicht und scheiterten an der Workspace-Wurzel, ohne dass irgendetwas den Grund benannt hätte.

---

**Weiterlesen:** [Sehen, was der Agent geändert hat – bevor Sie committen](/blog/see-what-the-agent-changed-before-you-commit) · [Freigabe-Gates und menschliche Aufsicht](/blog/approval-gates-and-human-oversight) · [VS Code als Kommandozentrale Ihrer agentischen Workforce](/blog/vs-code-command-center-for-your-agentic-workforce)

Installieren Sie die [BuilderForce-Erweiterung für VS Code](https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai), bitten Sie einen Agent, etwas zu reparieren – und dann, es auszuliefern.
