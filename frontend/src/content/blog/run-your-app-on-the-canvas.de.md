Bitten Sie um einen SMS-Versender, und vier Karten landen auf dem Board: `backend/server.js`, `frontend/index.html`, eine gerenderte Seite, eine Setup-Notiz. Alle verbunden, alle korrekt, alle einfach da.

Und dann?

Eine Zeit lang lautete die ehrliche Antwort: auf diesem Bildschirm nichts. Das Board konnte eine Anwendung bis ins letzte Detail beschreiben, aber keine ausführen. Der einzige Weg zu einer Live-URL führte über einen Karten-Inspektor, hinter einer Veröffentlichen-Aktion, als Commerce verpackt – drei Klicks tief und unsichtbar, solange Sie nicht genau die richtige Karte ausgewählt hatten. Ein Canvas, der Software bauen, aber nicht ausführen kann, ist ein sehr gutes Notizbuch.

## Die App-Oberfläche

Es gibt jetzt eine vierte Art, ein Board zu lesen – neben der Konversation, dem Graphen und der 3D-Umgebung: **die App**.

```bf-figure
{
  "kind": "flow",
  "title": "Was passiert, wenn Sie zur App-Oberfläche wechseln",
  "steps": [
    { "label": "Sammeln", "note": "Jede Code-Karte auf dem Board wird zu einer Datei. Nicht nur die ausgewählte – alle, in der Struktur, die sie beschreiben.", "hue": "make" },
    { "label": "Zusammenbauen", "note": "Die Einstiegsseite wird gefunden, und die zugehörigen Stylesheets und Skripte werden inline eingebettet, damit eine Vorschau etwas hat, gegen das sie sie auflösen kann.", "hue": "make" },
    { "label": "Ausführen", "note": "Ein funktionierendes Dokument, in einer echten Gerätebreite gerahmt – Build- und Laufzeitfehler gehen zurück an den Assistenten, der den Code geschrieben hat.", "hue": "make", "tag": "auf dem Board" }
  ],
  "caption": "Die Oberfläche liest die ganze Session, nicht eine einzelne Karte. Eine Anwendung, die über sechs Karten verteilt ist, ist ein einziges Artefakt – und genau das konnte bisher nichts auf dem Board ausdrücken."
}
```

Zwei Dinge daran waren schwieriger, als sie aussehen.

```bf-figure
{
  "kind": "screen",
  "frame": "Ein Board, als App gelesen",
  "ratio": 1.62,
  "regions": [
    { "label": "Die laufende Anwendung", "note": "Jede Code-Karte auf dem Board, zusammengebaut und als ein Dokument ausgeliefert", "x": 4, "y": 8, "w": 62, "h": 74, "hue": "make" },
    { "label": "Brain", "note": "Nimmt die Änderung entgegen, sieht den Fehler", "x": 69, "y": 8, "w": 27, "h": 74, "hue": "idea" },
    { "label": "Oberflächen-Umschalter", "x": 4, "y": 88, "w": 30, "h": 8, "hue": "accent" },
    { "label": "Starten · Breiten · Teilen", "x": 38, "y": 88, "w": 58, "h": 8, "hue": "accent" }
  ],
  "caption": "Eine Befehlsleiste für den ganzen Canvas, nicht eine pro Laufzeitumgebung. Die App-Oberfläche steuert Starten und die drei Breiten IN diese Leiste bei, statt darunter eine zweite zu zeichnen."
}
```

**Eine Vorschau braucht einen Ursprung.** Ein Dokument, das man einem Frame übergibt, hat keine Adresse – `href="styles.css"` löst sich also gegen nichts auf, und Sie bekommen eine korrekt aussehende Seite ganz ohne Styling. Der Klassiker unter den Meldungen: „Warum sieht die Vorschau kaputt aus, obwohl der Code stimmt?“ Genau deshalb bettet die Oberfläche die zugehörigen Dateien inline ein.

**Gerätebreiten sind keine max-width.** Desktop, Tablet und Handy waren früher drei Buttons, die nichts Sichtbares änderten, weil dem Frame gleichzeitig gesagt wurde, eine bestimmte Breite zu haben und den Platz auszufüllen – und das Ausfüllen gewann. Schlimmer noch: Selbst wo eine Begrenzung griff, bekam das Dokument dadurch die *kleinere* Breite – seine eigenen Media Queries feuerten also für den Frame, und Ihre „Desktop“-Ansicht renderte das mobile Layout. Die drei Einstellungen legen das Dokument jetzt mit 1280, 834 und 390 echten CSS-Pixeln an und skalieren das Ergebnis in den Rahmen. Sie unterscheiden sich so, wie sich drei echte Geräte unterscheiden – denn genau das sind sie jetzt.

```bf-figure
{
  "kind": "devices",
  "title": "Drei Ansichten, drei echte Breiten",
  "devices": [
    { "label": "Desktop", "width": 1280, "hue": "make", "note": "Das Dokument wird mit 1280 angelegt und in den Rahmen skaliert" },
    { "label": "Tablet", "width": 834, "hue": "run", "note": "Seine eigenen Media Queries feuern für 834, nicht für den Rahmen" },
    { "label": "Handy", "width": 390, "hue": "measure", "note": "Das mobile Layout, das Sie tatsächlich ausliefern" }
  ],
  "caption": "Breiten maßstabsgetreu gezeichnet: Der Anteil jedes Rahmens an der Zeile entspricht seiner Breite geteilt durch die Summe aller. Ein begrenzter Rahmen gibt dem Dokument die KLEINERE Breite – deshalb renderte die alte Desktop-Ansicht das mobile Layout."
}
```

## Der Fehler darunter

Beim Bauen sind wir auf etwas gestoßen, das es wert ist, laut ausgesprochen zu werden, weil es Leute stillschweigend ganze Sessions gekostet hatte.

Die App-Oberfläche las den Quelltext einer Code-Karte aus einem Feld. Der Assistent schreibt ihn in ein anderes – das Feld, das sein eigenes Tool mitliefert und das die Kartenvorschau als Erstes liest. Jede Code-Karte, die der Assistent verfasst hatte, sah auf dem Board also perfekt aus und trug **nichts** zur App bei. Kein Fehler, keine Warnung, kein leerer Zustand, der sich erklärt: nur „Noch nichts zum Ausführen“ unter einem Board voller Code.

Direkt daneben saß ein zweiter. Jeder Lese- und Schreibzugriff auf Workspace-Dateien fragte beim Server einen leeren Pfad an – wegen eines Routing-Details, das für den Teil der URL mit dem Dateinamen `undefined` zurückgibt. Ein Canvas konnte ein Projekt anlegen und dann nie eine einzige Zeile Code hineinschreiben – vier Tool-Aufrufe, die nacheinander scheiterten, und ein Turn, der mit einem Achselzucken endete.

Beide sind behoben. Wir erwähnen sie, weil eine Feature-Ankündigung, die nur neue Fähigkeiten aufzählt, ein Marketingdokument ist; dass die App-Oberfläche jetzt funktioniert, liegt ebenso an diesen beiden Korrekturen wie an der Oberfläche selbst.

## Wo das in der Methode steht

Bauen ist der dritte Akt, und der teure. [Lesen und Beweisen](/blog/read-prove-build-the-inner-loop) kommen zuerst und kosten nichts – gerade damit die Entscheidung zu bauen eine Entscheidung ist. Aber sobald Sie bauen, ist die Schleife von *etwas ändern* zu *es sehen* das ganze Erlebnis – und jeder Sprung aus dieser Schleife heraus, in ein Terminal, ein Deployment, eine Vorschau-URL, einen anderen Tab, ist eine Stelle, an der Aufmerksamkeit versickert.

```bf-figure
{
  "kind": "compare",
  "title": "Der Weg von der Änderung zum Beleg",
  "columns": [
    { "title": "Die übliche Schleife", "hue": "muted", "items": ["Im Editor ändern", "Speichern", "Auf einen Build warten", "In den Browser wechseln", "Neu laden", "Feststellen, dass das Styling nicht geladen wurde", "Raten, warum"] },
    { "title": "Auf dem Board", "hue": "make", "items": ["Um die Änderung bitten", "Zusehen, wie sich die Karten aktualisieren", "Es in der gewünschten Breite ansehen", "Fehler gehen zurück an den Assistenten, der sie geschrieben hat"] }
  ],
  "caption": "Build- und Laufzeitfehler gehen jetzt zurück an den Agent – ein kaputter Build wird also behoben, statt fertig auszusehen und liegen zu bleiben."
}
```

## Was Sie heute damit tun können

- **Eine Anwendung beschreiben und in derselben Minute ausführen** – Backend, Seite und Assets fügen sich zu einem Ganzen zusammen, das Sie anklicken können.
- **Sie in drei echten Breiten ansehen**, bevor irgendjemand sie auf einem Handy öffnet.
- **Ein Projekt daraus machen**, sobald es keine Skizze mehr ist: Ein Button gibt dem Board eine eigene Laufzeitumgebung, eigene Daten, eigene Leute und eine eigene Webadresse – und die Adresse wird vorab gewählt, statt erst beim Veröffentlichen aufzutauchen.
- **Sie paketieren** – als installierbare Web-App, als Android-Build oder als signierten iOS-Build. Im Paket steckt genau das, was Sie in der Vorschau gesehen haben.

Nichts davon erfordert, das Board zu verlassen, und genau darum geht es. Das Board ist kein Planungsartefakt, das der eigentlichen Arbeit vorausgeht. Es ist der Ort, an dem die Arbeit stattfindet.

---

**Weiterlesen:** [Der Creation Canvas ist kein Chatfenster](/blog/creation-canvas-beyond-chat) · [Erstellen, bevor Sie sich registrieren](/blog/create-before-you-sign-up) · [Entwerfen, bauen, debuggen – ein räumlicher Workspace](/blog/design-build-debug-one-spatial-workspace)

[Öffnen Sie einen Canvas](/create) und bitten Sie um etwas mit einem Backend darin.
