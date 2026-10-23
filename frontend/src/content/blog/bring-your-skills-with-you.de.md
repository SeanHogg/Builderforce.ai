Jemand in deinem Team hat längst aufgeschrieben, wie ihr eine Schemaänderung ausliefert. Es steht in `.claude/skills/ship-a-schema-change/SKILL.md`, daneben ein Skript, das die Guards ausführt, und Claude Code folgt dem jedes Mal.

Bis heute endete dieses Wissen an der Grenze des Tools, für das es geschrieben wurde. Um es in BuilderForce zu bringen, hast du die Anweisungen in ein Textfeld kopiert, das Skript verloren und gehofft, dass niemand eine Kopie ohne die andere ändert. Aus dem Ablauf, der funktionierte, wurden zwei Abläufe, die auseinanderliefen.

Skills sind jetzt ein **Standard**, und BuilderForce spricht ihn. Eine Skill ist ein Ordner: eine `SKILL.md`, die sagt, was sie ist und wann sie gilt, plus die Skripte und Referenzen, auf die sie verweist. Claude Code, Codex und immer mehr Agenten-Tools lesen genau diese Form – das offene [Agent-Skills](https://agentskills.io)-Format –, und jeder BuilderForce-Agent tut es auch, auf jeder Oberfläche.

## Bring den Ordner mit, behalte den Ordner

```bf-figure
{
  "kind": "flow",
  "title": "Der Weg einer Skill hin und zurück",
  "steps": [
    { "label": "Importieren", "note": "Wähle den Ordner, ein .zip davon oder eine einzelne SKILL.md. Vor dem Senden wird gegen den Standard geprüft – Name, Beschreibung, jeder Pfad –, und das Urteil, das du siehst, ist das, zu dem auch der Server kommt.", "hue": "idea" },
    { "label": "Nutzen", "note": "Jeder Agent im Workspace sieht eine Zeile davon: ihren Namen und wann sie gilt. Passt eine Aufgabe, lädt der Agent die Anweisungen; verlangen die Anweisungen ein Skript, lädt er auch das.", "hue": "make", "tag": "überall" },
    { "label": "Mitnehmen", "note": "„Ordner herunterladen“ liefert <name>.zip – dieselbe SKILL.md und dieselben Dateien, bereit für .claude/skills oder .agents/skills. Oder veröffentliche sie, und wer installiert, bekommt genau das, was du ausführst.", "hue": "run" }
  ],
  "caption": "Nichts wird neu abgetippt, nichts geht hinein oder hinaus verloren. Der Ordner, den du importierst, ist der Ordner, den du exportierst."
}
```

Importieren heißt freigeben. Wer eine Skill hereinbringt, steht für sie ein – deshalb gilt sie ab dem nächsten Lauf für jeden Agenten: derselbe Zustand, den die Genehmigung eines Reviewers erzeugt, mit demselben Nachweis, wer es war. Eine Skill, die ein *Agent* vorschlägt, wartet weiterhin als Entwurf, bis ein Mensch sie genehmigt; [diese Schleife bleibt unverändert](/blog/the-run-that-teaches-the-next-one), und die Entwürfe, die sie erzeugt, sind jetzt ebenfalls Standardordner.

Du kannst auch eine im Browser schreiben. **Neue Skill** fragt nach einem Titel, dem Namen, unter dem Agenten sie laden, wann sie gilt, und nach den Schritten. Gespeichert wird eine standardkonforme `SKILL.md` – eine hier entstandene Skill lässt sich also herunterladen und überall sonst nutzen.

## Eine Skill, überall, wo deine Agenten arbeiten

Die entscheidende Frage war nicht „Können wir SKILL.md parsen?“, sondern „Erreicht die Skill den Agenten, der sie braucht – egal, wo er läuft?“ Eine Skill, die in Cloud-Läufen funktioniert und im Editor stillschweigend nichts tut, ist eine Skill, der niemand vertrauen kann.

```bf-figure
{
  "kind": "screen",
  "frame": "Wohin die Skills eines Workspace jetzt reichen",
  "ratio": 1.7,
  "regions": [
    { "label": "Cloud- und Container-Läufe", "note": "Der Katalog im Prompt; die Skill wird geladen, wenn das Ticket passt", "x": 4, "y": 8, "w": 44, "h": 26, "hue": "make" },
    { "label": "Brain – Web, VS Code, Rovr", "note": "Derselbe Katalog, derselbe Loader, mitten im Gespräch", "x": 52, "y": 8, "w": 44, "h": 26, "hue": "idea" },
    { "label": "Creation Canvas und Studio", "note": "Der Assistent des Boards folgt beim Bauen deinem Ablauf", "x": 4, "y": 40, "w": 44, "h": 26, "hue": "make" },
    { "label": "Selbst gehostete Agenten", "note": "Zugewiesene Skills landen als echte Ordner auf der Platte; .claude/skills und .agents/skills werden unverändert geladen", "x": 52, "y": 40, "w": 44, "h": 26, "hue": "run" },
    { "label": "Jeder MCP-Client", "note": "Claude, Cursor und andere, die mit deinem Workspace verbunden sind, bekommen dasselbe Tool", "x": 4, "y": 72, "w": 92, "h": 20, "hue": "accent" }
  ],
  "caption": "Ein einziger Loader hinter allen. Füge eine Skill einmal hinzu, und jede Oberfläche sieht sie im nächsten Zug; keine hält eine eigene Kopie."
}
```

Auf einem selbst gehosteten Agenten kam eine im Portal zugewiesene Skill früher als *Name* an – „dir wurde ship-a-schema-change zugewiesen; falls zufällig eine SKILL.md dafür auf diesem Rechner liegt, folge ihr“. Jetzt wird der Ordner selbst samt Skripten auf die Platte geschrieben und erscheint in der Skill-Liste des Agenten wie eine lokal erstellte. Eine Skill gleichen Namens, die du selbst geschrieben hast, gewinnt immer; die Synchronisierung überschreibt nie einen Ordner, den sie nicht selbst geschrieben hat.

## Fünfzig Skills zum Preis von fünfzig Zeilen

Die beste Idee des Standards: Ein Agent sollte nicht jeden Ablauf mit sich tragen, den er brauchen könnte. Er sieht einen Katalog – eine Zeile pro Skill – und lädt die Anweisungen einer Skill erst, wenn die Aufgabe vor ihm dazu passt. Eine mitgelieferte Referenz wird erst geladen, wenn die Anweisungen auf sie zeigen.

```bf-figure
{
  "kind": "compare",
  "title": "Was ein Lauf mitnimmt, bevor er startet",
  "columns": [
    { "title": "Jede Skill hineinkopiert", "hue": "muted", "items": ["Jeder genehmigte Ablauf, vollständig, in jedem Prompt", "Lange werden mitten im Schritt abgeschnitten", "Skripte nirgends – nur die Prosa darüber", "Mehr Skills, mehr Kosten, in jedem Zug"] },
    { "title": "Der Katalog des Standards", "hue": "make", "items": ["Eine Zeile pro Skill: ihr Name und wann sie gilt", "Die vollständigen Anweisungen, wenn – und nur wenn – die Aufgabe passt", "Mitgelieferte Skripte und Referenzen bei Bedarf", "Eine Bibliothek, die wächst, ohne jeden Prompt wachsen zu lassen"] }
  ],
  "caption": "Skills, die direkt einem Lauf, einem Projekt oder einem Agenten zugewiesen sind, werden weiterhin vollständig mitgegeben – das ist ein stärkerer Vertrag als ein Katalogeintrag, und das bleibt so."
}
```

## Wo es in der Methode sitzt

Skills gehören in den Akt **Build** von [Read · Prove · Build](/blog/read-prove-build-the-inner-loop) – den, der Geld kostet. Read und Prove sind absichtlich günstig, damit die Entscheidung zu bauen eine echte Entscheidung ist. Sobald gebaut wird, ist das Teuerste, was ein Agent tun kann, neu herauszufinden, wie dein Team etwas erledigt, das es schon hundertmal getan hat: welcher Guard läuft, welche Migrationsspur eine Spalte braucht, wie ein Release rausgeht.

Eine Skill ist dieses Wissen, einmal aufgeschrieben. Sie als Standardordner abzulegen, lässt sie mit der Arbeit reisen, statt in einem einzigen Tool zu leben – so ist der Ablauf, den eine Entwicklerin in ihrem Editor verfeinert hat, derselbe, dem der Cloud-Lauf beim nächsten Ticket folgt, und derselbe, dem der Assistent des Boards beim Bauen folgt. Build bleibt der teure Akt; er hört auf, der Akt zu sein, in dem dieselbe Lektion zweimal bezahlt wird.

## Was du heute damit tun kannst

- Einen Skill-Ordner **importieren** – aus Claude Code, aus dem `.agents/skills` eines Repos oder aus dem .zip einer Kollegin, mit Skripten und Referenzen.
- Eine Skill im Browser **schreiben** und eine standardkonforme `SKILL.md` erhalten.
- Jede Workspace-Skill oder jede veröffentlichte Marketplace-Skill als einsatzbereiten Ordner **herunterladen**.
- Eine Skill aus ihrem Ordner im Marketplace **veröffentlichen**, damit Eintrag und das, was Installierende erhalten, nie auseinanderlaufen.
- Jede Skill **nutzen** – in Cloud-Läufen, im Brain im Web, in VS Code und in Rovr, im Creation Canvas und im Studio sowie auf selbst gehosteten Agenten, wo zugewiesene Skills jetzt auf der Platte ankommen.

---

**Weiterlesen:** [Der Lauf, der den nächsten anleitet](/blog/the-run-that-teaches-the-next-one) · [Einmal zeigen, und es macht es wieder](/blog/teach-it-once-and-it-does-it-again) · [Skills, Zuweisungen und der Marketplace](/blog/skills-assignment-and-the-marketplace)

[Öffne die Skills deines Workspace](/skills) und importiere den Ordner, dem dein Team schon vertraut.
