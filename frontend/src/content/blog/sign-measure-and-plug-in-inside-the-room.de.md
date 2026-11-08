Drei Dinge auf dem Canvas waren fertig und ließen sich nicht erreichen.

**Das Approval-Gate.** Bitten Sie den Assistenten, ein Budget umzuschichten, und er erfasst jede Zahl, die er verschiebt: wer sie verschoben hat, von wo, wohin und warum. Handlungen, die das Haus verlassen oder auf die sich später jemand verlässt – eine Kampagne versenden, eine Rechnung ausstellen, ein Budget freigeben –, sind abgesichert, und ein Agent kann seine eigene Änderung nicht freigeben. Dieser Teil funktionierte. Der Teil, der nicht funktionierte: Es gab keinen Ort, an dem ein Mensch sehen konnte, was wartet, und es abnehmen konnte. So füllte sich das Protokoll, die abgesicherten Handlungen blieben blockiert, und „Wer hat diese Zahl freigegeben?“ hatte eine ehrliche Antwort, mit der niemand etwas anfangen konnte.

**Die Metrik-Schicht.** Eine Metrik auf dem Canvas ist eine *Definition* – Quelle, Filter, Aggregat, Ziel, welche Richtung als gut gilt – und keine Zahl, die jemand in eine Kachel getippt hat, sodass sich zwei Kacheln namens „MRR“ nicht widersprechen können. Die Engine, die eine ganze Menge davon auf einmal auswertet, abgeleitete Verhältnisse eingeschlossen, hatte keine Karte. Jede Definition war korrekt, und man konnte keine davon gemeinsam sehen.

**Widgets von Drittanbietern.** Ein Integrator konnte über die API ein Widget registrieren, seine Berechtigungen deklarieren und es auf einem Board platzieren. Im Browser hängte nichts es ein. Der Vertrag existierte auf beiden Seiten, und das Rechteck in der Mitte war leer.

Alle drei leben jetzt im Room, der einen räumlichen Oberfläche des Canvas, neben den Menschen und der Session.

```bf-figure
{
  "kind": "screen",
  "frame": "Der Room mit seinen Stationen",
  "ratio": 1.62,
  "regions": [
    { "label": "Approval-Desk", "note": "Was auf eine Unterschrift wartet, auf der Vorderseite gezählt", "x": 3, "y": 14, "w": 22, "h": 40, "hue": "prove" },
    { "label": "Die Session und ihre Menschen", "note": "Das Board auf dem Tisch, das Team drumherum", "x": 30, "y": 22, "w": 38, "h": 52, "hue": "idea" },
    { "label": "Metrik-Board", "note": "Zuerst, was hinter dem Ziel liegt, jede Zahl mit ihrem Beleg", "x": 72, "y": 14, "w": 22, "h": 40, "hue": "measure" },
    { "label": "Widget auf einem Ständer", "note": "Ein Drittanbieter-Tool, live auf der Vorderseite", "x": 72, "y": 58, "w": 22, "h": 30, "hue": "run" },
    { "label": "Stationsliste", "note": "Jede Station, einen Tastendruck entfernt", "x": 3, "y": 58, "w": 22, "h": 30, "hue": "accent" }
  ],
  "caption": "Jede Station steht im Room wie ein Werk: Sie können sie überallhin ziehen, der Room merkt sich, wo Sie sie gelassen haben, und ihre Beschriftung öffnet ein vollständiges 2D-Panel. Dieselbe Liste steht neben dem Teilnehmerverzeichnis, sodass jede Station per Tastatur, per Screenreader und auf einem Gerät ohne 3D erreichbar ist."
}
```

## Der Approval-Desk

Der Desk zeigt, wie viele Änderungen warten und worauf. Öffnen Sie ihn, und jedes Objekt listet seine ausstehenden Änderungen so auf, wie ein Reviewer sie lesen muss: das Feld, was es war, was es wurde, wer es geändert hat, wann und woher der neue Wert stammt. Dann entscheiden Sie.

- **Freigeben** zeichnet jede wartende Änderung an diesem Objekt in Ihrem Namen ab. Die Unterschrift stempelt dieselben Einträge, die die Änderung erzeugt hat, sodass es nie eine Freigabe ohne die Änderung gibt, die sie freigegeben hat.
- **Freigeben und senden** (oder *ausstellen* oder *veröffentlichen*) erscheint nur, wenn Ihre Unterschrift genau das ist, was das Gate für diese Handlung braucht. Es unterschreibt und führt dann die Handlung aus, in dieser Reihenfolge, mit einem Klick.
- **Ablehnen** hält fest, dass jemand hingeschaut und Nein gesagt hat. Die Zahl wird nicht stillschweigend zurückgesetzt, denn das wäre eine zweite, nicht zugeordnete Änderung. Die Handlung bleibt blockiert, bis jemand eine Änderung vornimmt, die er zu unterschreiben bereit ist.

```bf-figure
{
  "kind": "flow",
  "title": "Der Weg einer Zahl von der Änderung zur Handlung",
  "steps": [
    { "label": "Verschoben", "note": "Der Assistent oder ein Widget ändert eine Budgetzeile. Die Änderung wird mit Wer, Von, Zu und Warum erfasst.", "hue": "build" },
    { "label": "Wartet", "note": "Das Gate verweigert die abgesicherten Handlungen des Budgets. Der Desk zählt eine Änderung mehr.", "hue": "prove", "tag": "am Desk" },
    { "label": "Unterschrieben", "note": "Eine Person, die die Änderung nicht vorgenommen hat, gibt sie frei. Sie können Ihre eigene Arbeit nicht freigeben, und ein Agent kann überhaupt nicht freigeben.", "hue": "prove" },
    { "label": "Ausgeführt", "note": "Die Handlung, die die Unterschrift autorisiert hat, läuft, und das Protokoll zeigt, wer dahintersteht.", "hue": "run" }
  ],
  "caption": "Funktionstrennung ist eine einzige Regel, die sowohl das Gate als auch der Desk lesen. Ein Desk, der Sie unterschreiben ließe, was das Gate Ihnen verweigern würde, wäre nur ein Umweg um das Gate."
}
```

Das ist die Kontrolle, die eine Finanzleitung oder ein CMO braucht, bevor sie ein Board an einen Agent übergeben. Es ist auch der Beleg, den ein Auditor verlangt: eine Änderung, die Person, die sie freigegeben hat, und wann – alles in einem Eintrag.

## Das Metrik-Board

Sobald eine Session eine Metrik definiert, steht ein Board im Room. Jede Metrik auf dem Board wird gemeinsam ausgewertet – einfache Aggregate über ihre Datensätze und abgeleitete Verhältnisse wie Bruttomarge oder Net Revenue Retention über die Metriken, aus denen sie bestehen –, sodass die Kacheln nicht auseinanderdriften können.

Es liest sich zuerst als Erkenntnis und erst danach als Kacheln. Metriken hinter dem Ziel kommen zuerst. Metriken, die sich nicht berechnen lassen, nennen den Grund und zeigen nie eine Null, denn eine Marge, die gegen eine fehlende Kostenzeile berechnet wird, liest sich als 100 % und ist die gefährlichste falsche Antwort, die ein Dashboard geben kann. Jede Zahl trägt ihren Beleg: aus wie vielen Zeilen sie berechnet wurde oder von wie vielen Metriken eine abgeleitete Zahl abhängt. Zeitlich aufgelöste Metriken tragen eine Trendlinie.

## Widgets von Drittanbietern auf einem Ständer

Ein Widget, das für Ihren Workspace registriert und auf dem Board platziert wurde, läuft jetzt doppelt: auf seiner Karte auf dem flachen Canvas und auf einem Ständer im Room mit dem Live-Frame auf der Vorderseite. Die Eindämmung ist der Teil, der uns am wichtigsten ist:

```bf-figure
{
  "kind": "compare",
  "title": "Was ein Widget kann und was nicht",
  "columns": [
    { "title": "Es kann", "hue": "run", "items": ["Den Titel des Boards und die Namen seiner Objekte lesen, wenn erlaubt", "Objekte erstellen, bearbeiten und entfernen, wenn erlaubt – über denselben Bearbeitungsweg, den auch ein Mensch nutzt", "Einen kleinen privaten Speicher an seiner eigenen Platzierung führen", "Einen Hinweis auf dem Canvas auslösen"] },
    { "title": "Es kann nicht", "hue": "bad", "items": ["Origin, Cookies oder Speicher des Canvas teilen – es läuft in einer undurchsichtigen Sandbox", "Objektdaten über ID, Art, Titel und Status hinaus sehen", "Eine Platzierung umlenken, einen Freigabemodus ändern oder den Speicher eines anderen Widgets berühren", "Eine geldbezogene Zahl ändern, ohne dass diese Änderung am Approval-Desk wartet"] }
  ],
  "caption": "Jede Nachricht wird in der Reihenfolge des Protokolls geprüft: Sie stammt aus diesem Frame, der Frame liegt noch auf seiner registrierten Adresse, der Typ steht auf der Allowlist, und die Berechtigung wurde bei der Registrierung erteilt. Navigiert der Frame von seiner registrierten Adresse weg, hört das Board auf, ihm zu antworten."
}
```

Die letzte Zeile auf der rechten Seite ist der Punkt, an dem die drei Stationen zusammentreffen. Ein Widget mit Schreibzugriff ist aus Sicht des Gates ein Agent: Seine Änderungen an zugeordneten Feldern werden gegen das Widget erfasst und warten am Desk wie jede andere Änderung.

```bf-figure
{
  "kind": "devices",
  "title": "Das Panel des Desks, in den Breiten, die Menschen tatsächlich nutzen",
  "devices": [
    { "label": "Desktop", "width": 1280, "hue": "prove", "note": "Neben dem Room" },
    { "label": "Tablet", "width": 834, "hue": "measure", "note": "Über dem Room" },
    { "label": "Smartphone", "width": 390, "hue": "run", "note": "Volle Breite, 44-px-Ziele" }
  ],
  "caption": "Das 2D-Panel ist das barrierefreie Äquivalent dazu, an einen Ständer heranzutreten. Es funktioniert auf einem Smartphone und mit grobem Zeigegerät und folgt dem Theme des Betrachters."
}
```

## Wo es in der Methode sitzt

Die Methode ist ein Bogen: **Idea → Make → Run → Measure**. Darin ist [Read → Prove → Build](/blog/read-prove-build-the-inner-loop) der Weg, auf dem Sie von einer Idee zu etwas Gebautem gelangen. Die Schleife schließt sich in *Measure*, wo die Zahl, auf die Sie sich festgelegt haben, mit dem abgeglichen wird, was tatsächlich geschehen ist. Diese drei Stationen sitzen an den beiden Enden dieses Bogens, die bisher keinen Halt hatten:

- **Das Metrik-Board ist Measure** – die Abbruchbedingung, auf die sich ein Nachweis festgelegt hat, gelesen aus denselben Definitionen, die jede Kachel und jeder Report verwendet.
- **Der Approval-Desk ist das Scharnier zwischen Build und Run.** Was ein Agent gebaut hat, wird erst dann zu etwas, auf das sich das Unternehmen verlässt, wenn eine namentlich genannte Person es abgenommen hat.
- **Widgets bringen Ihre eigenen Tools in Run**, eingedämmt, damit ein operatives Board die Systeme nutzen kann, in denen Ihr Team ohnehin arbeitet.

Die Lehrfunktionen des Rooms – für Klassen und Kohorten – kommen auf dieselbe Weise, als Stationen im selben Room.

---

**Weiterlesen:** [Approval-Gates und menschliche Aufsicht](/blog/approval-gates-and-human-oversight) · [Im eigenen Board aufstehen](/blog/stand-up-inside-your-board) · [Den Nachweis bewerten und die Schleife schließen](/blog/grade-the-proof-and-close-the-loop)

[Öffnen Sie einen Canvas](/create), lassen Sie den Assistenten ein Budget entwerfen und gehen Sie dann zum Desk hinüber.
