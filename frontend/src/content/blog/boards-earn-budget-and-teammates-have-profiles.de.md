Ein Board konnte in einem Monat hundert Tickets abschließen, und nirgends stand es. Die Arbeit war echt, die Tickets waren Erledigt, und die Zahl, die „Was hat dieses Board verdient?“ beantwortet, existierte nicht. Investoren hatten dasselbe Problem von der anderen Seite: Das Update, das sie lasen, beschrieb das Unternehmen in Sätzen, während die Lieferung, die sie belegte, auf einem Board lag, das sie nie öffnen würden.

Zwei Lücken, eine Wurzel. Lieferung war eine Tatsache an einem Ticket und wurde nie zu einer Tatsache über das Board oder über das Unternehmen.

## Ein Board verdient Budget, wenn seine Tickets auf Erledigt kommen

Jedes Ticket, das in eine Erledigt-Spalte wandert, verdient seinem Board jetzt Budget, in Punkten: die Story Points des Tickets, oder einen Punkt, wenn niemand geschätzt hat. Es geschieht an der einen Stelle, durch die jede Spaltenbewegung läuft; das Ziehen einer Karte, ein fertiger Agentenlauf und ein gemergter Pull Request zahlen also gleich, und ein wieder geöffnetes und erneut geschlossenes Ticket zahlt nur einmal.

```bf-figure
{
  "kind": "flow",
  "title": "Von einem geschlossenen Ticket zu einer Zahl, die ein Board zeigen kann",
  "steps": [
    {
      "label": "Ticket erreicht Erledigt",
      "note": "Auf jedem Weg: Ziehen, Agentenlauf, gemergter Pull Request.",
      "hue": "make"
    },
    {
      "label": "Board verdient Punkte",
      "note": "Seine Story Points, oder einen. Einmal pro Ticket erfasst, ein Wiederöffnen zahlt also nie doppelt.",
      "hue": "run"
    },
    {
      "label": "Meilenstein erreicht",
      "note": "Ein Epic wird abgeschlossen oder ein Release erscheint, und die Einnahmen des Boards dafür werden summiert.",
      "hue": "measure",
      "tag": "zum Investor-Kanal"
    }
  ],
  "caption": "Das Verdienen läuft über dasselbe Hauptbuch, das jeden anderen Kontostand im Produkt hält. Es gibt keine zweite Tabelle, die von der beschriebenen Arbeit abweichen könnte."
}
```

Die Ausgaben stehen daneben, nicht darin. Was die Läufe eines Boards kosten, wird bereits pro Ticket erfasst; das Panel liest also diese Zahl, statt eine zweite Kopie zu schreiben, die der ersten widersprechen könnte.

```bf-figure
{
  "kind": "screen",
  "frame": "Ein Board mit geöffnetem Budget",
  "ratio": 1.62,
  "regions": [
    {
      "label": "Das Board",
      "note": "Spalten und Tickets, genau wie bisher",
      "x": 4,
      "y": 8,
      "w": 56,
      "h": 74,
      "hue": "make"
    },
    {
      "label": "Verdientes Budget",
      "note": "Verdiente Punkte, Laufkosten, erreichte Meilensteine, letzte Einnahmen",
      "x": 63,
      "y": 8,
      "w": 33,
      "h": 74,
      "hue": "run"
    },
    {
      "label": "Board-Leiste",
      "note": "Eine neue Schaltfläche neben „Konfigurieren“",
      "x": 4,
      "y": 88,
      "w": 92,
      "h": 8,
      "hue": "accent"
    }
  ],
  "caption": "Das Budget öffnet sich in einem Seitenpanel über dem Board, die Spalten bleiben beim Lesen sichtbar."
}
```

## Meilensteine, die Investoren erreichen

Ein Meilenstein ist etwas, das einem Board widerfahren ist: ein abgeschlossenes Epic oder ein Release, das seinem Projekt zugeordnet war und erschienen ist. Jeder trägt jetzt die Punkte, die seine Tickets verdient haben, und ein einziger Lesezugriff listet alle seit einem Datum erreichten Meilensteine pro Board. Das Investor-Update baut seinen Lieferabschnitt daraus. Es sagt nicht mehr „wir haben geliefert“, ohne dass ein Board und eine Zahl dahinterstehen.

## Kolleginnen und Kollegen haben eine Seite, und Erwähnungen wissen, mit wem sie sprechen

Die zweite Lücke war kleiner und menschlicher. Die Persönlichkeit eines Teammitglieds erschien in einem Hover auf dem Board und nirgends, wohin man verlinken konnte. Für eine Person gab es überhaupt keine Seite.

- **Ein Profil für jedes Teammitglied**, unter einer eigenen Adresse: Name, Avatar, Rolle in deinem Arbeitsbereich, Persönlichkeit und eine Zusammenfassung der Arbeit: offene Tickets, in den letzten dreißig Tagen Bearbeitetes, Erledigtes. Sichtbar für Personen im selben Arbeitsbereich und für niemanden sonst.
- **Erreichbar dort, wo man Menschen begegnet**: Die Hovercard auf dem Board und das Mitgliederverzeichnis verlinken darauf.
- **Erwähnungen tragen das Signal.** Tippe `@`, und jede Person in der Liste zeigt eine einzeilige Einschätzung ihrer Persönlichkeit, etwa ihren Typ und ihre stärkste Eigenschaft. Sie stammt aus derselben zwischengespeicherten Zuordnung wie die Hovercard und wird einmal geladen, sodass das Öffnen der Liste und das Tippen darin keine zusätzlichen Anfragen auslösen.

```bf-figure
{
  "kind": "compare",
  "title": "Auswählen, wen man anschreibt",
  "columns": [
    {
      "title": "Vorher",
      "hue": "muted",
      "items": [
        "Eine Liste von Namen",
        "Ein Board öffnen, um zu erfahren, wie jemand arbeitet",
        "Keine Seite, die man einer Kollegin schicken kann"
      ]
    },
    {
      "title": "Jetzt",
      "hue": "make",
      "items": [
        "Namen mit einzeiliger Persönlichkeitseinschätzung",
        "Ein Profil, einen Klick von Hovercard oder Verzeichnis entfernt",
        "Arbeitsübersicht neben der Persönlichkeit"
      ]
    }
  ],
  "caption": "Persönlichkeit prägt den Ton, nicht die Berechtigungen. Wer was tun darf, hat sich nicht geändert."
}
```

```bf-figure
{
  "kind": "devices",
  "title": "Die Profilseite in drei Breiten",
  "devices": [
    {
      "label": "Desktop",
      "width": 1280,
      "hue": "make",
      "note": "Kopfbereich, Arbeitsübersicht und Persönlichkeit in einer Spalte"
    },
    {
      "label": "Tablet",
      "width": 834,
      "hue": "run",
      "note": "Zähler brechen in Zeilen um"
    },
    {
      "label": "Smartphone",
      "width": 360,
      "hue": "measure",
      "note": "Alles stapelt sich; nichts scrollt seitwärts"
    }
  ],
  "caption": "Breiten maßstabsgetreu gezeichnet."
}
```

## Wo es in der Methode sitzt

Builderforce ordnet Arbeit als einen Bogen: Idee, Erstellen, Betreiben, Messen. Diese Änderung berührt die letzten drei, und die Verbindung zwischen ihnen ist der Punkt.

**Erstellen** ist, wo das Board lebt und Tickets erledigt werden; dort verdient ein Board jetzt. **Betreiben** ist, wo Arbeit Geld kostet, und das Budget-Panel stellt das, was ein Board verdient hat, neben das, was seine Läufe gekostet haben. **Messen** ist, wo man herausfindet, ob das alles etwas bedeutet hat, und ein Meilenstein ist die erste Messung, die das Board verlässt: Er erreicht das Investor-Update mit einer Zahl dahinter. Die Personenseite gehört ebenfalls zu Erstellen. Zu wissen, mit wem man arbeitet und wie, gehört zum guten Erstellen.

Zuvor riss der Bogen zwischen Erstellen und Messen: Die Arbeit geschah, der Beleg blieb zurück. Jetzt reist er mit der Arbeit.

---

**Weiterlesen:** [Starte die App, die dein Board gerade gebaut hat](/blog/run-your-app-on-the-canvas) · [Dein privates Evermind auf deinem Rechner](/blog/your-private-evermind-on-your-machine)

[Öffne ein Board](/tasks) und verschiebe ein Ticket auf Erledigt.
