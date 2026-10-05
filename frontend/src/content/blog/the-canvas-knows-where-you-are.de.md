Messen öffnete sich auf einem Board, auf dem nichts live war.

Sie konnten es jederzeit drücken. Der Canvas wechselte den Tab, bot Einblicke an und wartete auf Zahlen von einer App, die nie bereitgestellt worden war. Bei Reichweite war es genauso: ein Ort für Launch-Beiträge, ohne ein Ziel, zu dem man irgendwen schicken konnte. Die Phasen oben im Canvas (Idee, Bauen, Betreiben, Messen, Reichweite) waren ein Filter dafür, welche Tabs Sie sahen, und mehr nicht. Sie prüften nie, was auf dem Board lag. Außerdem war die Phase eine einzige Einstellung pro Browser: Wer einen Canvas auf Messen stellte, stellte jeden anderen gleich mit um.

Eine Phasenauswahl, die nicht erkennt, ob eine Phase überhaupt möglich ist, ist nur ein Menü. Die Methode dahinter sagt mehr: Man kann nichts messen, was nicht läuft, und man sollte nichts bauen, bevor die Idee aufgeschrieben ist. Das weiß jetzt auch der Canvas.

## Bereitschaft, abgelesen vom Board

Jede Phase liest jetzt das Board, auf dem sie sitzt. Sie nutzt keine Einstellung und keine Checkliste, die Sie ausfüllen. Sie schaut auf die Objekte, die die Arbeit bereits hinterlassen hat:

- **eine Ideenkarte** heißt: Idee ist erledigt;
- **eine App**, also die Code-Karten, die zusammen laufen, heißt: Bauen ist erledigt;
- **eine Bereitstellung mit Adresse** heißt: Betreiben ist erledigt;
- **eine Kennzahl** heißt: Messen ist erledigt.

Jede Phase im Stepper zeigt einen von drei Zuständen: einen Haken, wenn ihr eigenes Ergebnis existiert, ein Schloss, wenn sie zuerst eine frühere Phase braucht, oder nichts, wenn Sie darin arbeiten können. Jeder Canvas behält seine eigene Phase. Haben Sie keine gewählt, öffnet ein Canvas auf der **ersten Phase, die Sie noch nicht erledigt haben**. Ein Board, das schon live ist, wirft Sie also nicht zurück zu Idee.

```bf-figure
{
  "kind": "flow",
  "title": "Der Bogen, abgelesen von einem Board mit Idee und App, aber ohne Bereitstellung",
  "steps": [
    { "label": "Idee", "note": "Eine Ideenkarte liegt auf dem Board.", "hue": "idea", "tag": "✓ erledigt" },
    { "label": "Bauen", "note": "Die Code-Karten laufen als App.", "hue": "make", "tag": "✓ erledigt" },
    { "label": "Betreiben", "note": "Noch keine Bereitstellung mit Adresse. Hier öffnet sich der Canvas.", "hue": "run", "tag": "jetzt" },
    { "label": "Messen", "note": "Liest aus, was eine Live-App tut, braucht also zuerst Betreiben.", "hue": "measure", "tag": "braucht Betreiben" },
    { "label": "Reichweite", "note": "Schickt Menschen zu etwas, das live ist, und empfiehlt vorher eine Kennzahl.", "hue": "reach", "tag": "braucht Betreiben" }
  ],
  "caption": "Es wird nichts Neues gespeichert. Die Bereitschaft ergibt sich aus den Karten, die schon auf dem Board liegen. Sobald eine Bereitstellung landet, wird das Schloss bei Betreiben zum Haken, ohne Neuladen."
}
```

## Ein Schloss, das nie abschließt

Das Schloss ist ein Hinweis, keine Schranke. Drücken Sie auf diesem Board Messen, öffnet sich Messen, und jede Ansicht funktioniert. Was sich ändert, ist, was es Ihnen sagt. Oben im Canvas nennt eine Wegkarte, was fehlt, und den kürzesten Weg dorthin.

```bf-figure
{
  "kind": "screen",
  "frame": "Messen, auf einem Board ohne Live-App",
  "ratio": 1.62,
  "regions": [
    { "label": "Phasen-Stepper", "note": "Idee ✓ · Bauen ✓ · Betreiben · Messen (Schloss) · Reichweite (Schloss)", "x": 4, "y": 4, "w": 56, "h": 9, "hue": "accent" },
    { "label": "Messen · noch 1 Schritt", "note": "Bring die App live, bevor du sie misst. Zu Betreiben · Brain soll sie bereitstellen", "x": 4, "y": 16, "w": 56, "h": 15, "hue": "measure" },
    { "label": "Das Board", "note": "KPI- und Experiment-Karten umrandet, alles andere abgeblendet", "x": 4, "y": 35, "w": 62, "h": 50, "hue": "measure" },
    { "label": "Platz für die erste Kennzahl", "note": "Noch nicht · braucht Betreiben", "x": 70, "y": 35, "w": 26, "h": 26, "hue": "measure", "style": "ghost" },
    { "label": "Befehlsleiste · MESSEN eingefärbt", "x": 4, "y": 89, "w": 92, "h": 8, "hue": "accent" }
  ],
  "caption": "Die Wegkarte ersetzt einen leeren Bildschirm. „Zu Betreiben“ wechselt die Phase, und „Brain soll sie bereitstellen“ schickt Brain die Bitte über denselben Weg wie die Startpunkte. Klappen Sie sie zu einem Chip ein, wenn Sie Platz brauchen. Beim nächsten Öffnen des Canvas ist sie wieder da."
}
```

Die gestrichelte Karte rechts ist ein Platzhalter, keine Karte. Sie markiert, wo das erste Objekt der Phase hinkommt, und wird nie gespeichert, synchronisiert oder in den Rückgängig-Verlauf aufgenommen. Ist die Phase bereit, bietet sie an, dieses Objekt hinzuzufügen oder Brain es erstellen zu lassen. Ist sie es nicht, sagt sie, worauf die Phase wartet.

## Das Board holt die Phase nach vorn

Die größere Änderung betrifft, wie sich das Board selbst liest. Jede Phase hat die Objektarten, um die es in ihr geht. Idee hat Ideen, Interviews, Experimente, Personas und Risiken. Bauen hat Specs, Seiten, Prototypen und Code. Betreiben hat Bereitstellungen, Releases und Störungen. Messen hat KPIs, Dashboards, Diagramme und Experimente. Reichweite hat Beiträge, Kampagnen, Zielgruppen und Angebote. Diese Karten bekommen einen Ring in der Farbe der Phase. Alles andere tritt zurück.

```bf-figure
{
  "kind": "compare",
  "title": "Dasselbe Board in Messen, mit Phasenfokus aus und an",
  "columns": [
    { "title": "Phasenfokus aus", "hue": "muted", "items": ["Jede Karte in voller Stärke", "Die KPI steht zwischen einer Spec, einer Landingpage und sechs Code-Karten", "Die Zahlen finden Sie nur, indem Sie jeden Titel lesen", "Gut, um das ganze Board neu zu ordnen"] },
    { "title": "Phasenfokus an", "hue": "measure", "items": ["KPI-, Dashboard- und Experiment-Karten umrandet", "Specs, Seiten und Code abgeblendet, aber weiter anklickbar", "Linien zwischen abgeblendeten Karten treten ebenfalls zurück", "Eine ausgewählte Karte ist immer in voller Stärke", "Noch keine Kennzahl? Eine gestrichelte Karte zeigt, wo sie hinkommt"] }
  ],
  "caption": "Phasenfokus ist standardmäßig an und sitzt im •••-Menü des Boards. Nichts wird verschoben: Das Board, das Sie angeordnet haben, bleibt so angeordnet."
}
```

Der Rest des Canvas folgt derselben Phase. Die Befehlsleiste hebt die Gruppe der Phase hervor, in der Sie gerade sind. Die Startpunkte beginnen mit drei Vorschlägen für diese Phase, etwa „Kernkennzahl definieren“ in Messen oder „Launch-Beitrag entwerfen“ in Reichweite, und erst danach folgt der ganze Katalog. Im Raum leuchtet die Station der Phase auf und rückt an die Spitze der Liste. Ist die Phase nicht bereit, steht im Raum eine Schild-Station, die sagt, was fehlt: *Braucht eine Live-App*.

## Zwei neue Orte: Betrieb und Launch

Zwei Phasen hatten keinen eigenen Ort.

**Betrieb** erscheint ab Betreiben. Dort sehen Sie, was dieser Canvas am Laufen hat: jede Bereitstellung mit Umgebung, Version, Adresse und Zeitpunkt; die Releases des Boards; und ob die App live ist. Haben Sie eine App gebaut, aber nicht bereitgestellt, sagt Betrieb das klar und bietet an, Brain die Bereitstellung übernehmen zu lassen.

**Launch** erscheint bei Reichweite. Die Idee beweisen, das Board veröffentlichen, es zum Verkauf anbieten und davon erzählen waren bisher vier getrennte Türen. Launch legt sie auf einer Seite aus, in genau dieser Reihenfolge, weil das die Reihenfolge ist, in der sie passieren sollten.

**Einblicke**, ab Messen, öffnet jetzt mit *Dieses Canvas*: den Kennzahlen, die auf diesem Board definiert sind, die hinter dem Ziel liegenden zuerst, vor den Zahlen, die von anderswo angeheftet sind. Hat das Board noch keine Kennzahl, bietet es an, Brain eine definieren zu lassen.

Eine Sache ging in die andere Richtung. **Die App beginnt jetzt bei Bauen.** In Idee testen Sie, ob irgendwer das Ding will. Ein Prototyp dafür ist eine Experiment-Karte auf dem Board, keine App, die gebaut wird, bevor die Idee geprüft ist.

## Wo es in der Methode sitzt

Die Methode heißt [Idea to Real](/blog/idea-to-real-the-operating-methodology): Idee, Bauen, Betreiben, Messen, dann Reichweite. Jede Phase hat jetzt etwas, das auf dem Board liegen muss, bevor die nächste arbeiten kann, und etwas, das sie selbst hinterlässt.

```bf-figure
{
  "kind": "flow",
  "title": "Was jede Phase auf dem Board hinterlässt und was die nächste braucht",
  "steps": [
    { "label": "Idee", "note": "Die Idee lesen und günstig beweisen. Hinterlässt eine Ideenkarte. Ansichten: Chat, Board, Ideen, Raum.", "hue": "idea" },
    { "label": "Bauen", "note": "Nur bauen, was der Beweis verdient hat. Braucht eine Idee, hinterlässt eine App. Fügt App hinzu.", "hue": "make" },
    { "label": "Betreiben", "note": "Es an einen echten Ort bringen. Braucht eine App, hinterlässt eine Bereitstellung mit Adresse. Fügt Betrieb hinzu.", "hue": "run" },
    { "label": "Messen", "note": "Die Zahl des Beweises bewerten. Braucht etwas Live, hinterlässt eine Kennzahl. Fügt Einblicke hinzu.", "hue": "measure", "tag": "hier schließt sich die Schleife" },
    { "label": "Reichweite", "note": "Es zu den Menschen bringen. Braucht etwas Live und warnt, wenn nichts gemessen wird. Fügt Launch hinzu.", "hue": "reach" }
  ],
  "caption": "Jede Phase behält jede Ansicht der Phase davor und fügt ihre eigene hinzu. Eine spätere Phase nimmt nie ein Werkzeug weg."
}
```

**Idee** ist der Ort, an dem [Lesen und Beweisen](/blog/read-prove-build-the-inner-loop) passieren, und beides kostet nichts. Der Canvas bietet hier Ideen und Raum an und hält die App zurück, denn Bauen ist der teure Schritt, und die Methode will, dass er eine Entscheidung ist.

**Bauen** ist Build. Es braucht eine Idee auf dem Board. Fehlt sie, ist der einzige Schritt der Wegkarte „Brain soll sie festhalten“.

**Betreiben** ist der Moment, in dem aus einer Skizze etwas mit Adresse wird. Betrieb ist der Ort, an dem Sie es sich ansehen.

**Messen** ist der Ort, an dem sich die Schleife schließt. Jeder Beweis trägt eine Zahl, die das Projekt stoppen könnte, und diese Zahl wird [hier bewertet](/blog/grade-the-proof-and-close-the-loop). Deshalb braucht Messen etwas, das live ist. Eine Kennzahl über eine App, die niemand erreichen kann, misst nichts.

**Reichweite** braucht ebenfalls etwas Live und *empfiehlt* zusätzlich eine Kennzahl. Sie lässt Sie auch ohne starten, sagt Ihnen aber, dass Menschen zu erreichen, ohne zu messen, Geld im Blindflug ausgeben heißt.

Nichts davon blockiert Sie. Jede Phase öffnet sich, und jede Ansicht funktioniert. Der Unterschied ist, dass der Canvas jetzt weiß, was auf dem Board liegt. Darum kann er Ihnen ehrlich sagen, was fehlt, und anbieten, den nächsten Schritt zu übernehmen.

## Was Sie heute damit tun können

- **Jeden Canvas öffnen und beim nächsten Schritt landen, den Sie noch nicht erledigt haben**, nicht dort, wo der letzte Canvas stehen geblieben ist.
- **Eine Phase drücken, für die Sie noch nicht bereit sind**, und den kürzesten Weg dorthin bekommen, mit einem Druck, damit Brain den ersten Schritt erledigt.
- **Das Board durch die Phase lesen**: Die wichtigen Karten kommen nach vorn, der Rest tritt zurück, bis Sie den Phasenfokus ausschalten.
- **In Betrieb sehen, was läuft**: Bereitstellungen, Releases und ob die App live ist, alles auf dem Board, auf dem Sie sie gebaut haben.
- **Von einem Ort aus starten**: beweisen, veröffentlichen, verkaufen und davon erzählen, in dieser Reihenfolge.

Das Board war schon immer die Aufzeichnung der Arbeit. Jetzt sagt es Ihnen auch, in welcher Phase Sie sind und was als Nächstes kommt.

---

**Weiterlesen:** [Idea to Real: die Methode hinter Builderforce](/blog/idea-to-real-the-operating-methodology) · [Die App auf Ihrem Canvas ist jetzt ein echtes Projekt](/blog/your-canvas-app-is-a-real-project) · [Den Beweis bewerten und die Schleife schließen](/blog/grade-the-proof-and-close-the-loop)

[Öffnen Sie einen Canvas](/create) und drücken Sie Messen, bevor irgendetwas live ist.
