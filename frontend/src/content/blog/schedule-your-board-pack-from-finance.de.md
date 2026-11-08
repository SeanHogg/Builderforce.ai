Das Board Pack zum Monatsabschluss ist jedes Mal dasselbe Deck. Runway, Burn, die drei Kennzahlen, an denen Ihre Branche gemessen wird, eine Zeile zum Hiring und eine zur Finanzierungsrunde. Trotzdem baut es jemand jedes Mal neu. Diese Person exportiert ein Diagramm, fügt es in Folien ein, repariert die Achse, die kaputtgegangen ist, und verschickt es um 23 Uhr am letzten Arbeitstag.

Die Plattform konnte diesen Teil schon. Ein Report-Zeitplan konnte einen Canvas-Frame jeden Monat als Board Pack ausliefern, und ein Cron verschickte ihn. Man konnte diesen Zeitplan nur nicht sehen, nicht ändern und nicht von einer beliebigen Seite des Produkts aus anlegen. Die einzigen Zeitpläne, die jemand finden konnte, waren die des QA-Laufs. Alles andere war eine API-Route und eine Datenbankzeile.

## Der Reports-Tab

Finance hat jetzt einen vierten Tab, nach Runway, Cashflow und Dashboard: **Reports**.

```bf-figure
{
  "kind": "screen",
  "frame": "Finance ▸ Reports",
  "ratio": 1.62,
  "regions": [
    { "label": "Geplante Reports", "note": "Jeder Zeitplan, den dieser Workspace ausliefert: Typ, Rhythmus, Empfänger, nächster Versand", "x": 4, "y": 8, "w": 58, "h": 74, "hue": "run" },
    { "label": "Validierungs-Engagements", "note": "Die Experimente, Dashboards und Collectors, auf denen die Zahlen beruhen", "x": 65, "y": 8, "w": 31, "h": 74, "hue": "measure" },
    { "label": "Neuer Zeitplan", "x": 4, "y": 88, "w": 24, "h": 8, "hue": "accent" },
    { "label": "Bearbeiten · pausieren · löschen, pro Zeile", "x": 32, "y": 88, "w": 64, "h": 8, "hue": "accent" }
  ],
  "caption": "Zwei Bausteine, die jeweils ihre eigenen Daten laden. Keiner wartet auf den Runway-Report, den sich die Tabs Runway und Cashflow teilen."
}
```

Jede Zeile zeigt, was verschickt wird, wie oft, zu welcher Uhrzeit und an wie viele Personen. Außerdem sehen Sie, wann der nächste Versand erfolgt. **Pausieren** stoppt einen Zeitplan, ohne ihn zu verlieren – praktisch für das Quartal, in dem Sie persönlich berichten. **Löschen** verlangt vorher eine Bestätigung. **Bearbeiten** öffnet den Zeitplan in einem Seitenpanel über der Seite, sodass Sie Ihre Position in der Liste behalten.

## Ein Board Pack handelt von etwas

Fünf der sechs Report-Typen beziehen sich auf den gesamten Workspace: das Standup, das Code-Review, der Projektstatus, die Executive Summary und der Portfolio-Rollup. Das Board Pack ist der erste Typ, der *von etwas handelt*: von einem Frame auf einem Ihrer Boards. Deshalb hat das Anlegen einen Schritt, den die anderen nicht haben.

```bf-figure
{
  "kind": "flow",
  "title": "Ein Board Pack planen",
  "steps": [
    { "label": "Board wählen", "note": "Ihre aktiven Boards, dieselbe Liste wie in der Canvas-Galerie.", "hue": "idea" },
    { "label": "Frame wählen", "note": "Nur Frames, die der Server akzeptiert, jeweils mit der Zahl seiner Kacheln.", "hue": "make" },
    { "label": "Rhythmus und Personen", "note": "Täglich, wöchentlich oder monatlich, zur gewählten Uhrzeit, an die Personen auf Ihrer Liste.", "hue": "run", "tag": "in Finance" }
  ],
  "caption": "Die Frame-Liste stammt aus derselben Prüfung, die auch das Speichern ausführt. Ein Frame, den Sie auswählen können, wird auch akzeptiert – nichts schlägt später um 23 Uhr fehl."
}
```

Dieser letzte Punkt ist wichtig. Ein Board Pack ohne Frame würde jeden Monat als „nichts zu senden“ hinausgehen, deshalb lehnt der Server es ab. Ein Frame auf einem Board, das dieser Workspace nicht lesen kann, wird ebenfalls abgelehnt. Die Auswahl bezieht ihre Liste von der Route, die diese Prüfung durchführt, und kann daher keinen Frame anbieten, den das Speichern zurückweisen würde. Das Formular lässt Sie ein Board Pack außerdem erst absenden, wenn Sie einen Frame gewählt haben.

**Empfänger sind alles, was Sie einfügen.** Kommas, Semikolons, eine Adresse pro Zeile oder `Ann Lee <ann@example.com>`, direkt aus einem Mailprogramm kopiert – alles funktioniert. Alles, was keine Adresse ist, wird Ihnen namentlich zurückgemeldet und nicht stillschweigend verworfen.

**Nach dem Anlegen lässt sich nur ändern, was der Zeitplan tatsächlich ändern kann.** Sie können die Uhrzeit, die Empfänger und den Ein-/Aus-Schalter bearbeiten. Report-Typ, Rhythmus und Frame sind festgelegt, sobald ein Zeitplan existiert, und das Formular sagt das offen, statt Änderungen anzubieten, die verworfen würden. Um einen anderen Frame zu versenden, legen Sie einen neuen Zeitplan an. Das dauert etwa zwanzig Sekunden.

## Die Belege, auf derselben Seite

Neben den Zeitplänen steht eine kleine Karte, die bis jetzt kein Zuhause hatte. Sie listet die Experimente, Validierungs-Dashboards und Feedback-Collectors auf, die Ihr Workspace betreibt. Jeder Eintrag zeigt, worum es sich handelt und welchen Status er hat; bei Collectors steht dabei, wie viele Antworten eingegangen sind.

```bf-figure
{
  "kind": "compare",
  "title": "Was ein Board Pack aussagt – und worauf es beruht",
  "columns": [
    { "title": "Das Pack", "hue": "run", "items": ["Runway und Burn", "Die KPI-Kacheln der Branche", "Hiring und die Finanzierungsrunde", "In festem Rhythmus versendet, unverändert"] },
    { "title": "Die Belege", "hue": "measure", "items": ["Welche Annahmen validiert sind", "Welche noch laufen", "Welche Collectors zuhören", "Wie viele Personen geantwortet haben"] }
  ],
  "caption": "Eine Zahl ohne Experiment dahinter ist eine Vermutung mit Nachkommastelle. Beides nebeneinanderzustellen zeigt Ihnen, welche Zahlen Sie vertreten können."
}
```

## Wo es in der Methode sitzt

Das ist Run, die Stage, in der das Unternehmen sich am Laufen hält – und die Aufgabe hier ist eine Gewohnheit, die nicht davon abhängt, dass jemand daran denkt.

```bf-figure
{
  "kind": "stack",
  "title": "Reporting auf dem Bogen",
  "bands": [
    { "label": "Idea", "note": "Das Board, auf dem der Plan ausdiskutiert wurde", "hue": "idea" },
    { "label": "Make", "note": "Der Frame, den Sie um die Kacheln ziehen, auf die es ankommt", "hue": "make" },
    { "label": "Run", "note": "Finance ▸ Reports. Der Frame geht in festem Rhythmus an die Menschen, die ihn brauchen.", "hue": "run" },
    { "label": "Measure", "note": "Validierungs-Engagements: die Belege, auf denen jede Zahl beruht", "hue": "measure" },
    { "label": "Reach", "note": "Board, Investoren und Team, jeden Monat auf dieselbe Weise erreicht", "hue": "reach" }
  ],
  "caption": "Das Board Pack entsteht auf dem Canvas und wird aus Run ausgeliefert. Der Frame, den Sie am Dienstag bearbeiten, ist der, der am Ersten des Monats ankommt."
}
```

Bisher hatte Run die Zahlen (Runway, Cashflow, das Dashboard der Branche), aber keine Möglichkeit, sie zu *versenden*. Ohne Zeitplan bedeutete Reporting, das Deck jeden Monat neu zu bauen. Mit einem Zeitplan bauen Sie es einmal. Sie bearbeiten den Frame auf dem Board, wenn sich etwas ändert, und der Zeitplan versendet, was der Frame am Tag des Versands zeigt.

## Was Sie heute damit tun können

- **Jeden der sechs Reports planen** – täglich, wöchentlich oder monatlich, zur gewählten Uhrzeit (in UTC), an die Personen auf Ihrer Liste.
- **Ein Board Pack aus einem Canvas-Frame versenden.** Wählen Sie das Board, dann den Frame, und die Kacheln darin gehen in diesem Rhythmus hinaus.
- **Einen Zeitplan pausieren, bearbeiten oder löschen** – aus derselben Liste, ohne die API zu öffnen oder einen Admin zu fragen.
- **Die Belege daneben sehen.** Experimente, Validierungs-Dashboards und Feedback-Collectors stehen auf derselben Seite wie die Reports.

Zum Anlegen und Ändern von Zeitplänen ist eine Manager-Rolle nötig. Wer keine hat, sieht die Bedienelemente deaktiviert – mit der erforderlichen Rolle daneben –, statt dass sie ausgeblendet werden.

---

**Weiterlesen:** [Die Kennzahlen, auf denen Ihre Branche wirklich läuft, mit einem Klick installiert](/blog/install-your-verticals-kpi-dashboard) · [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas)

[Finance ▸ Reports öffnen](/finance?tab=reports) und das Pack planen, das Sie sonst um 23 Uhr bauen würden.
