Jeden Morgen verlässt ein Team genau das, worüber es spricht, um darüber zu sprechen.

Das Board ist auf dem einen Bildschirm. Der Stand-up auf einem anderen – ein Meetingraum, ein runder Tisch, ein Raster aus Gesichtern –, und jemand teilt seinen Bildschirm, damit alle das Board sehen, das sie gerade verlassen haben. Fünfzehn Minuten später navigieren alle dorthin zurück, wo sie ohnehin schon waren.

Das ist kein Videokonferenz-Problem. Es ist ein Formproblem: Ausgerechnet das Ritual, dessen einziges Thema die Arbeit vor Ihnen ist, war das eine Ritual ohne Zuhause auf dieser Arbeit.

## Der Raum

Es gibt jetzt eine fünfte Art, ein Board zu lesen – neben der Konversation, dem Graphen, der 3D-Umgebung und der App: **den Raum**.

```bf-figure
{
  "kind": "screen",
  "frame": "Ein Board, als Raum gelesen",
  "ratio": 1.62,
  "regions": [
    { "label": "Der Kreis", "note": "Alle in der Session, um einen Tisch stehend. Ihre eigene Figur steht mit allen anderen im Bild.", "x": 4, "y": 8, "w": 66, "h": 62, "hue": "make" },
    { "label": "Die Wand", "note": "Die neuesten Objekte der Session, mit dem echten Bild, das jedes davon erzeugt hat", "x": 12, "y": 12, "w": 50, "h": 22, "hue": "idea" },
    { "label": "Wer da ist", "note": "Hervorgehoben für Leute im Raum, abgedunkelt für Leute auf dem Board", "x": 73, "y": 8, "w": 23, "h": 74, "hue": "accent" },
    { "label": "Oberflächen-Umschalter", "x": 4, "y": 88, "w": 30, "h": 8, "hue": "accent" },
    { "label": "N von M hier", "x": 38, "y": 88, "w": 32, "h": 8, "hue": "accent" }
  ],
  "caption": "Auf das ganze Board bezogen, wie die Oberflächen App und Einblicke: Das Thema des Raums ist die ganze Session, also gibt es keine Karte, über die man ihn betritt – und wer ihn ohne Auswahl anklickt, bekommt trotzdem eine Antwort."
}
```

Drücken Sie Raum, und das Board wird zu einem Ort. Ihr Team steht im Kreis um einen Tisch. Dahinter, an der Wand, hängen die Objekte der Session – keine Icons davon, sondern die tatsächlich gerenderte Vorschau, die jedes einzelne erzeugt hat. Klicken Sie eines an, und die Karte, für die es steht, wird ausgewählt.

## Jeder bekommt einen Stuhl

Die wichtigste Designentscheidung drehte sich um Abwesenheit.

Ein Raum, in dem Leute erst erscheinen, wenn sie sich bewegen, ist ein Raum, in dem Sie „Niemand ist beigetreten“ nicht von „Niemand hat bisher etwas gesagt“ unterscheiden können. Deshalb setzt der Raum **das gesamte Team** hinein und markiert, wer tatsächlich da ist: eine hervorgehobene Figur mit hellem Namensschild für jemanden, der gerade im Raum ist, eine abgedunkelte für eine Kollegin, die auf dem Board ist, aber nicht im Raum.

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Antworten auf „Wer ist da?“",
  "columns": [
    {
      "title": "Ein Raum mit eigener Mitgliedschaft",
      "hue": "bad",
      "items": [
        "Der Raum führt eine eigene Liste, wer beigetreten ist",
        "Ein zugeklappter Laptop lässt diesen Eintrag stehen",
        "Teamliste und Raum können sich widersprechen",
        "Anwesenheit wird zu etwas, das man abgleichen muss"
      ]
    },
    {
      "title": "Ein Präsenz-Eintrag, zwei Lesarten",
      "hue": "good",
      "items": [
        "Der Raum besitzt überhaupt keine Mitgliedschaft",
        "Zeiger und Figur reisen im selben Relay-Frame",
        "Wer geht, dessen Figur verschwindet sofort",
        "Board und Raum können sich nicht widersprechen"
      ]
    }
  ],
  "caption": "Ein Cursor auf dem Board und eine Figur im Raum sind dieselbe Frage – wo ist diese Person gerade? –, gestellt von zwei Oberflächen. Also teilen sie sich einen Kanal, statt dass jede ihren eigenen aufbaut."
}
```

Diese Entscheidung ist der Grund, warum der Raum keine neue Tabelle, keine neue Mitgliedschaft und keinen neuen Datensatz brauchte. Er liest die Teamliste, die die Session schon hat, und die Live-Präsenz, die das Board ohnehin transportiert.

Einen Haken gibt es, und er verdient Erwähnung, weil er das Gegenteil davon ist, wie sich ein Cursor verhält. Ein stillstehender Zeiger ist ein veralteter Zeiger, deshalb vergisst das Board ihn nach einer halben Minute. Stillsitzen ist aber genau das, was ein Stand-up *ist* – also wird die Anwesenheit im Raum per leisem Heartbeat immer wieder bestätigt, und sobald Sie gehen, geht Ihre Figur mit.

## Bilder an Wänden

Dieselbe Änderung hat 3D-Umgebungen etwas gegeben, das sie nie hatten: eine Fläche, auf die man etwas setzen kann.

Ein Requisit konnte bisher nur sagen, welche Farbe es hatte, und sonst nichts – deshalb ließ sich nie etwas *darauf anbringen*. Jetzt nimmt jedes Requisit mit flacher Fläche ein Bild auf – ein Foto eines Whiteboards, ein Diagramm, ein Rendering –, und es hängt dort in echtem Maßstab, im Schatten genauso lesbar wie in der Sonne.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Art, eine Fläche zu gestalten, drei Orte, an denen sie auftaucht",
  "steps": [
    { "label": "Gestalten", "note": "Fügen Sie eine Bild-URL auf eine Wand, eine Plattform oder eine Zielzone in der 3D-Umgebung ein", "hue": "make" },
    { "label": "Aufhängen", "note": "Die Wand im Raum nutzt für die Objekte der Session dasselbe Primitiv – mit identischem Lade- und Fehlerverhalten", "hue": "make" },
    { "label": "Zurückfallen", "note": "Ein Bild, das nicht lädt, fällt auf die Eigenfarbe des Requisits zurück statt auf ein schwarzes Quadrat oder eine leere Fläche", "hue": "run", "tag": "eingetragene URLs gehen kaputt" }
  ],
  "caption": "Ein Bild an einer Wand in einer Welt und eine Karte an der Wand im Raum werden von einer Komponente gezeichnet – sie können also weder unterschiedlich aussehen noch unterschiedlich laden oder scheitern."
}
```

Und ein Raum, den man nicht betreten kann, ist schlimmer als ein flacher: Wo WebGL nicht startet, öffnet sich dieselbe Session als gut lesbarer Kreis aus Namen, statt den Dienst zu verweigern.

## Wo das in der Methode steht

Der Raum ist die erste Oberfläche, deren Thema die **Menschen** sind und nicht die Objekte – und das gibt ihm einen ungewöhnlichen Platz auf dem Bogen, denn er macht sich auf verschiedenen Stufen auf verschiedene Weise bezahlt und ist auf keiner davon nutzlos.

Er ist ab **Idee** verfügbar – ein bewusster Bruch mit der Art, wie Einblicke freigeschaltet wird. Einblicke hält sich bis Messen zurück, weil ein Dashboard ohne angepinnte Inhalte schlicht nichts zeigen kann. Ein Raum mit einer Person darin ist ein Raum mit einer Person darin: korrekt, gut lesbar und genau so, wie ein Workshop zehn Sekunden vor Ankunft der zweiten Person aussieht. Ein *Meeting* davon abhängig zu machen, in welcher Stufe sich ein Board angeblich befindet, wäre die falsche Art von Regel – zwei Menschen, die über eine Idee sprechen wollen, sind der Grund für den Raum, kein Argument dagegen.

Wo er am meisten verändert:

- **Idee** – der Workshop. Einen Schritt von der Wand zurückzutreten und zu sehen, wie Dinge gruppiert sind, ist ein räumlicher Akt, den Software plattgemacht hat; hier kommt er zurück.
- **Bauen** – der tägliche Stand-up, und die eine Stufe, auf der der Raum die ganze Antwort ist. Niemand will aus einem Raum heraus Code schreiben. Aber alle wollen fünfzehn Minuten, in denen jedes Gesicht sichtbar ist und die Arbeit des Sprints hinter ihnen an der Wand hängt.
- **Messen** – die Retrospektive, das *räumlichste* Ritual überhaupt: eine Wand, eine Timeline und Menschen, die an der Stelle stehen, an der es schiefging.

Lesen → Beweisen → Bauen besagt, dass die beiden Akte, die entscheiden, ob sich der teure lohnt, beide kostenlos sind. Ein Stand-up ist einer davon. Er kostet nichts, er verändert, was gebaut wird, und er hätte nie erfordern dürfen, das Board zu verlassen.

Drücken Sie **Raum**.
