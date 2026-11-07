Sie klicken bei einem Ordner auf „Review“. Ein Spinner erscheint. Irgendwo werden Dateien gelesen, zusammengefasst und bewertet, und Sie können nicht erkennen, ob gerade Datei 12 von 40 an der Reihe ist oder alles bei Datei 3 hängt. Scheitert etwas, erfahren Sie es erst am Ende, und das einzige Mittel ist, von vorn anzufangen.

Dazu kam eine zweite Schwäche. Die Karte wurde aus der Kopie des Servers gezeichnet. Sobald Sie sich abmeldeten, ein Ratenlimit erreichten oder die Verbindung verloren, wurde die gerade aufgebaute Karte leer.

Das ist die Lücke: **Ein Review war ein Spinner, in den man nicht hineinsehen konnte, und die Karte verschwand ohne den Server.**

## Die Karte gehört Ihnen und funktioniert offline

Die Wissenskarte wird jetzt aus der Kopie auf Ihrem eigenen Rechner gezeichnet, ob der Arbeitsbereich verknüpft ist oder nicht. Der Server ist ein Replikat, das eine Hintergrundwarteschlange auf dem Laufenden hält. Sie übersteht eine Abmeldung, ein Ratenlimit oder einen Absturz und macht einfach dort weiter, wo sie war. Ein Ordner, den der Server hat, Ihr Rechner aber nicht, wird trotzdem gezeichnet, schreibgeschützt. So sehen Sie, dass er existiert, ohne so zu tun, als hätten Sie ihn.

```bf-figure
{
  "kind": "flow",
  "title": "Woher die Karte jetzt kommt",
  "steps": [
    { "label": "Ihr Rechner", "note": "Die Karte wird aus der lokalen Kopie gelesen, verknüpft oder nicht. Abmelden, offline gehen, ein Limit erreichen: Sie öffnet sich trotzdem.", "hue": "make" },
    { "label": "Hintergrundwarteschlange", "note": "Änderungen warten in einer Warteschlange, die einen Absturz übersteht und von selbst erneut versucht.", "hue": "run" },
    { "label": "Das Server-Replikat", "note": "Holt auf, sobald es kann. Ein Ordner, den nur der Server hat, wird schreibgeschützt gezeichnet.", "hue": "measure", "tag": "eine Kopie, nicht die Quelle" }
  ],
  "caption": "Die Richtung der Wahrheit hat sich umgekehrt: Zuerst wird die lokale Kopie gelesen, der Server folgt."
}
```

## Jedes Review ist ein Lauf, den Sie öffnen können

Review und erneutes Review öffnen jetzt ein Lauf-Panel mit dem Titel „Run details“. Es beantwortet die Fragen, die der Spinner nie beantworten konnte.

```bf-figure
{
  "kind": "screen",
  "frame": "Run details für ein Ordner-Review",
  "ratio": 1.62,
  "regions": [
    { "label": "Phasen-Zeitleiste", "note": "Planen, Extrahieren, Bewerten, Abschließen: wo der Lauf gerade steht", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "run" },
    { "label": "Worker-Bahnen", "note": "An welchen Dateien jeder Thread im Moment arbeitet", "x": 4, "y": 24, "w": 44, "h": 40, "hue": "make" },
    { "label": "Schritte", "note": "Die geordnete Liste, Erledigtes und noch Ausstehendes", "x": 52, "y": 24, "w": 44, "h": 40, "hue": "idea" },
    { "label": "Fehler · Retry", "note": "Was schiefging, mit einem Retry daneben", "x": 4, "y": 68, "w": 44, "h": 26, "hue": "measure" },
    { "label": "Lauf-Verlauf", "note": "Die letzten 20 Läufe dieses Ordners; ein Absturz erscheint als „unterbrochen“", "x": 52, "y": 68, "w": 44, "h": 26, "hue": "accent" }
  ],
  "caption": "Ein Panel für den ganzen Lauf: wo er steht, wer was tut, was scheiterte und was die letzten zwanzig Male geschah."
}
```

**Retry ist keine Abkürzung an den Regeln vorbei.** Es markiert die fehlgeschlagenen Dateien als offen und schickt sie durch den normalen Ablauf aus Planen, Schätzen und Bestätigen. Sie sehen, was der neue Versuch kosten wird, bevor etwas ausgegeben wird, genau wie beim ersten Mal.

**Der Verlauf sagt die Wahrheit über Abstürze.** Jeder Ordner behält seine letzten 20 Läufe. Ein Lauf, der durch einen Absturz abgebrochen wurde, ist als „unterbrochen“ gekennzeichnet, statt stillschweigend zu fehlen. So wissen Sie, dass er nicht fertig wurde, und können ihn wieder aufnehmen.

## Schneller, ohne Ihren Anbieter zu überlasten

Das Lesen der Dateien verteilt sich jetzt auf mehrere Worker-Threads auf Ihrem Rechner, bis zu acht und nie mehr als Ihre Kerne minus eins, damit der Editor reaktionsfähig bleibt. Das Bewerten läuft mit vier Dateien gleichzeitig. Alle diese Aufrufe teilen sich eine einzige Begrenzung: höchstens sechs Modellaufrufe gleichzeitig, und das Limit halbiert sich, sobald ein Anbieter „langsamer“ signalisiert. Parallelität vervielfacht also nie die Last beim Anbieter; sie nutzt nur den Spielraum, den das Limit erlaubt.

Die Ergebnisse sind identisch mit einem seriellen Lauf. Dieselben Dateien werden gleich bewertet, nur früher.

## Wo es in der Methode sitzt

Das ist **Run**, mit einem Fuß in **Measure**. Ein Review ist die Codebasis bei der Arbeit, und ein Lauf, den man beobachten kann, ist ein Lauf, dem man vertrauen und den man abstimmen kann. Der Verlauf und die Fehler, die er festhält, sind die ersten Messwerte dafür, wie gut diese Arbeit läuft, und sie speisen die nächste Idee, was repariert oder erneut geprüft werden soll.

```bf-figure
{
  "kind": "compare",
  "title": "Ein Review, vorher und jetzt",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Ein Spinner ohne Inhalt dahinter", "Fehler erst am Ende bekannt", "Neu anfangen, um sich zu erholen", "Karte leer, wenn der Server nicht erreichbar ist"] },
    { "title": "Jetzt", "hue": "run", "items": ["Phasen-Zeitleiste und Worker-Bahnen", "Fehler aufgelistet, jeder mit Retry", "Retry läuft durch Planen, Schätzen, Bestätigen", "Karte öffnet sich von Ihrem Rechner, verknüpft oder nicht"] }
  ],
  "caption": "Dasselbe Review, mit sichtbarem Innenleben und einer Karte, die nicht mehr von einer Verbindung abhängt."
}
```

## Was Sie heute damit tun können

- **Die Karte ohne Verbindung öffnen**, angemeldet oder nicht, verknüpft oder nicht.
- **Ein Review beobachten** und sehen, an welchen Dateien jeder Worker arbeitet.
- **Nur das Gescheiterte wiederholen**, nachdem Sie die Schätzung gesehen haben.
- **Zurückblicken** auf die letzten 20 Läufe jedes Ordners.

---

**Weiterlesen:** [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas) · [Ihr privates Evermind auf Ihrem Rechner](/blog/your-private-evermind-on-your-machine)
