Sie bezahlen für Kimi. Kimi K3 ist ein starkes Coding-Modell mit einem Kontextfenster von einer Million Token. Sie möchten es für die Arbeit vor Ihnen einsetzen: um eine Änderung zu planen, sie zu schreiben oder beides.

Bisher kostete das mehr Einrichtung als nötig. Kimis Edge lehnt Anfragen von gehosteten Cloud-Plattformen ab, bevor überhaupt ein Zugangsschlüssel gelesen wird. Ein mit Ihrem Workspace verbundenes Kimi-Abo lief deshalb nur, solange eine separate Builderforce-Laufzeitumgebung online war und die Anfragen weiterleitete. Im Editor tauchte Kimi nur auf, wenn Sie zusätzlich die Kimi Code CLI installiert und sich dort angemeldet hatten. In Rovr tauchte es gar nicht auf.

## Kimi wählen – die Anmeldung kommt zu Ihnen

Jetzt ist die Reihenfolge so, wie man sie erwartet. Sie wählen zuerst das Modell, und Builderforce fragt nur dann nach dem Konto, wenn noch keines verbunden ist.

```bf-figure
{
  "kind": "flow",
  "title": "Der erste Kimi-Schritt, von Anfang bis Ende",
  "steps": [
    { "label": "Wählen", "note": "Wählen Sie Kimi K3 in der Modellauswahl von VS Code oder in Rovr unter Einstellungen → Modell.", "hue": "idea" },
    { "label": "Anmelden", "note": "Noch kein Kimi-Konto im Workspace? Kimis eigene Anmeldeseite öffnet sich mit bereits ausgefülltem Code. Bestätigen, fertig – es gibt nichts einzufügen.", "hue": "make" },
    { "label": "Behalten", "note": "Die Verbindung wird in den Integrationen Ihres Workspace gespeichert, sodass Web-App, Editor und Rovr dasselbe Konto sehen.", "hue": "make" },
    { "label": "Ausführen", "note": "Ihr Rechner hält ein kurzlebiges Token und ruft Kimi direkt auf. Editor und Browser sind genau der persönliche Client, für den das Abo lizenziert ist.", "hue": "make", "tag": "auf Ihrem Rechner" }
  ],
  "caption": "Das Konto gehört zum Workspace, das Token liegt auf dem Rechner. Nur Builderforce erneuert die Verbindung, sodass ein zweiter Laptop nie eine bereits ungültige Anmeldung hält."
}
```

Zwei Details sorgen dafür, dass das im Alltag trägt.

**Das Token ist absichtlich kurzlebig.** Ihr Rechner speichert nur ein Zugriffstoken mit fünfzehn Minuten Laufzeit, nie den langlebigen Erneuerungsschlüssel. Kimi tauscht diesen Schlüssel bei jeder Verwendung aus. Erneuern ihn zwei Stellen, hält eine davon immer einen toten Schlüssel. Builderforce erneuert ihn, und jedes Gerät holt sich bei Bedarf ein frisches Token. Editor und Rovr verwenden ein gespeichertes Token auch nach einem Neustart weiter, solange es gültig ist, sodass die meisten Schritte keine zusätzliche Anfrage brauchen.

**K3 entscheiden Sie, nicht ein Automatismus.** Kimi K3 ist in manchen Kimi-Tarifen enthalten und in anderen nicht. Builderforce leitet deshalb nicht stillschweigend jeden Kimi-Schritt an ein Modell, das Ihr Tarif ablehnen könnte. Enthält Ihr Tarif K3, öffnen Sie Einstellungen → Eigene Modelle → Kimi und ziehen K3 nach oben. Editor, Rovr und Cloud-Läufe beginnen dann alle damit und fallen bei Bedarf Ihre Liste hinunter zurück.

```bf-figure
{
  "kind": "compare",
  "title": "Ihr Kimi-Abo nutzen",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Kimi im Web verbinden", "Eine separate Agent-Laufzeitumgebung installieren und laufen lassen, damit sie weiterleitet", "Oder für den Editor die Kimi Code CLI installieren und sich dort anmelden", "Nichts in Rovr"] },
    { "title": "Jetzt", "hue": "make", "items": ["Kimi K3 dort wählen, wo Sie gerade arbeiten", "Eine Anmeldung bestätigen, wenn der erste Schritt danach fragt", "Editor und Rovr rufen Kimi selbst auf", "Eine Verbindung für den ganzen Workspace"] }
  ],
  "caption": "Ist die Kimi Code CLI auf Ihrem Rechner bereits angemeldet, nutzt der Editor weiterhin zuerst diese Anmeldung. Die Workspace-Verbindung sorgt dafür, dass alles andere auch ohne sie funktioniert."
}
```

## Wo es in der Methode steht

Meist geht es um den Akt **Bauen**. Bauen ist der teure Schritt von [Lesen, Nachweisen, Bauen](/blog/read-prove-build-the-inner-loop), und hier entscheidet die Coding-Stärke des Modells, wie viele Durchgänge eine Änderung braucht. Builderforce gibt jedem Schritt bereits eine Rolle: Ein Lauf plant zuerst und übergibt die erste Codeänderung dann an das stärkste Coding-Modell, das Sie verbunden haben. Kimi K3 kann jetzt jede dieser Rollen übernehmen oder beide: günstig planen und mit K3 coden, mit K3 planen und an Claude übergeben, oder alles auf K3 lassen.

Auch für **Lesen und Nachweisen** zählt es. Diese beiden Schritte kosten nichts, damit die Entscheidung zu bauen eine echte Entscheidung ist. Und mit einem Fenster von einer Million Token lässt sich ein ganzes Repository in einem Durchgang lesen, bevor sich jemand auf eine Änderung festlegt.

## Was Sie heute damit tun können

- **Kimi K3 in VS Code wählen**, ohne etwas zusätzlich zu installieren. Die Modellauswahl bietet „Kimi verbinden“ an und lässt Sie danach wählen, welches Kimi-Modell neue Schritte nutzen.
- **Kimi in Rovr nutzen**, dem Browser-Assistenten. Unter Einstellungen → Modell stehen Ihre Kimi-Modelle. Findet ein Kimi-Schritt kein Konto, zeigt der Chat eine Verbinden-Karte statt eines Fehlers.
- **Einmal für den ganzen Workspace verbinden.** Ein im Editor verbundenes Konto erscheint im Web und in Rovr, und umgekehrt.
- **K3 nach oben setzen**, wenn Ihr Tarif es enthält – dann beginnt jede Oberfläche damit.

---

**Weiterlesen:** [Lesen, Nachweisen, Bauen – der innere Kreislauf](/blog/read-prove-build-the-inner-loop)

Öffnen Sie die Modellauswahl in VS Code, wählen Sie **Kimi verbinden** und probieren Sie Ihre nächste Änderung mit K3.
