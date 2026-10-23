# BuilderForce sitzt jetzt im Agent-Chat-Bereich von VS Code – direkt neben Ihrem Code

VS Code hat jetzt einen eigenen Platz für Coding-Agents. Die sekundäre Seitenleiste rechts enthält Chat, Claude Code und Codex, jeweils in einem eigenen Tab. Dort tippen Sie, und der Code, den der Agent ändert, bleibt daneben im Editor geöffnet.

BuilderForce war in dieser Reihe nicht vertreten. Der Chat öffnete sich als **Editor-Tab** und nahm damit genau den Platz ein, den Ihr Code brauchte. Wer einem Agent beim Ändern einer Datei zusehen wollte, musste den Editor von Hand teilen oder ständig zwischen Unterhaltung und Code wechseln.

Jetzt hat BuilderForce einen eigenen Tab in dieser Reihe.

```bf-figure
{
  "kind": "screen",
  "frame": "VS Code mit BuilderForce im Agent-Chat-Bereich",
  "ratio": 1.78,
  "regions": [
    { "label": "Seitenleiste", "note": "Sitzungen, Arbeit, Posteingang, Zustand", "x": 2, "y": 6, "w": 18, "h": 88, "hue": "muted" },
    { "label": "Ihr Code", "note": "Die Datei, die der Agent ändert – in voller Breite", "x": 22, "y": 6, "w": 46, "h": 88, "hue": "make" },
    { "label": "Chat · Claude Code · Codex · BuilderForce", "x": 70, "y": 6, "w": 28, "h": 8, "hue": "accent" },
    { "label": "BuilderForce", "note": "Dieselbe Unterhaltung, dieselben Läufe und Freigaben wie überall sonst", "x": 70, "y": 16, "w": 28, "h": 78, "hue": "idea" }
  ],
  "caption": "Der Editor behält den Code, der Agent-Chat-Bereich die Unterhaltung. Nichts muss gegen etwas anderes eingetauscht werden."
}
```

## Ein Chat, an einem Ort

Das ist kein zweiter Chat. Der Tab führt dieselbe Unterhaltung, die Sie im Web sehen: dasselbe Transkript, dieselben Tool-Freigaben, dieselbe Modellwahl, derselbe Projektbezug. Ein Lauf geht weiter, während der Tab verborgen ist, denn der Agent läuft in der Erweiterung, nicht im Tab.

Jeder Weg in einen Chat landet jetzt in diesem Tab: der Befehl **Chat öffnen**, eine Sitzung aus der Sitzungsliste, *An dieser Aufgabe arbeiten* vom Board und ein Prompt aus Project 360. „Öffne meinen Chat“ führt damit immer an dieselbe Stelle.

```bf-figure
{
  "kind": "flow",
  "title": "Jeder Weg hinein, ein Ort zum Ankommen",
  "steps": [
    { "label": "Fragen", "note": "Chat öffnen, eine Sitzung in der Seitenleiste, eine Aufgabe, ein Prompt aus Project 360", "hue": "idea" },
    { "label": "Ankommen", "note": "Der BuilderForce-Tab im Agent-Chat-Bereich kommt mit dieser Unterhaltung nach vorn", "hue": "make", "tag": "neben Ihrem Code" },
    { "label": "Zusehen", "note": "Änderungen landen im Editor daneben; Freigaben und die Änderungs-Anzeige bleiben im Blick", "hue": "run" }
  ],
  "caption": "Boards öffnen sich weiterhin im Editor, denn eine Canvas braucht die Breite. Wer lieber einen Editor-Tab pro Unterhaltung möchte, bekommt das weiterhin über die Einstellung für Sitzungs-Tabs."
}
```

In VS Code-Versionen vor 1.106, die noch keinen Agent-Chat-Bereich haben, erscheint derselbe Tab stattdessen in der BuilderForce-Seitenleiste.

## Wo das in der Methode sitzt

Bauen ist der dritte Akt, nach [Lesen und Beweisen](/blog/read-prove-build-the-inner-loop), und dort zählt die kurze Schleife von *um eine Änderung bitten* bis *die Änderung sehen* am meisten. Jeder Sprung aus dieser Schleife kostet Aufmerksamkeit: ein Tab-Wechsel, eine von Hand eingerichtete Teilung, eine Unterhaltung, die genau die Datei verdeckt, die sie bearbeitet.

```bf-figure
{
  "kind": "compare",
  "title": "Einem Agent beim Ändern Ihres Codes zusehen",
  "columns": [
    { "title": "Chat als Editor-Tab", "hue": "muted", "items": ["Der Chat nimmt den Platz des Editors ein", "Den Editor von Hand teilen oder ständig wechseln", "Die geänderte Datei ist einen Klick entfernt", "Jeder Einstieg konnte seinen eigenen Tab öffnen"] },
    { "title": "Chat im Agent-Chat-Bereich", "hue": "make", "items": ["Code in voller Breite im Editor", "Die Unterhaltung immer daneben", "Freigaben und Änderungen im Blick, während Sie den Diff lesen", "Jeder Einstieg landet im selben Tab"] }
  ],
  "caption": "Derselbe Chat, dieselben Läufe. Geändert hat sich, wo er sitzt."
}
```

Machen, Ausführen und Messen finden auf der Plattform statt. Wenn die Arbeit Code auf Ihrem eigenen Rechner ist, passiert das Machen in Ihrem Editor, und jetzt sitzt der Agent, der es erledigt, im Agent-Chat-Bereich des Editors direkt neben Ihrem Code.

## Ausprobieren

Aktualisieren Sie die BuilderForce-Erweiterung, laden Sie VS Code neu und öffnen Sie den Agent-Chat-Bereich. BuilderForce hat dort einen eigenen Tab neben Chat, Claude Code und Codex. Oder führen Sie **BuilderForce: Chat öffnen** aus, dann öffnet er sich dort.

---

**Weiterlesen:** [Lesen, Beweisen, Bauen: die innere Schleife](/blog/read-prove-build-the-inner-loop) · [Kein Konto, keine GPU, kein Netzwerk](/blog/no-account-no-gpu-you-choose-where-it-runs)
