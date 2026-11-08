Ein Review hängt bei „Judging“ fest. Sie sehen es. Sie können einen Screenshot davon machen. Und Sie haben keine Ahnung, welche von viertausend Dateien dafür verantwortlich ist.

Das ist die Lücke. Das Symptom lebt auf einem Bildschirm, die Ursache in einer Codebasis, und nichts verbindet beides außer dem, der sich zufällig erinnert. Also greift man zu einem Graphen, der jede Datei als Punkt zeichnet, und die Punkte sagen nichts. Ein Bild aus Tausenden von Knoten ist keine Antwort auf „Wo läuft das hin?“. Es ist dieselbe Wand aus Dateien, nur mit schönerem Hintergrund.

## Eine Karte, gezeichnet wie ein Nahverkehrsnetz

Die Knowledge-Ansicht zeigt eine Codebasis jetzt so, wie eine Stadt ihre Bahnen zeigt: als **Linien**. Jede Linie beginnt an einem Einstiegspunkt, einer Route, einem Bildschirm oder einem Job, führt durch die Schichten, die sie passiert, und endet bei den Speichern und externen Diensten, die sie berührt. Sie lesen einen Pfad statt eines Haufens.

```bf-figure
{
  "kind": "screen",
  "frame": "Die Knowledge-Ansicht als Karte",
  "ratio": 1.62,
  "regions": [
    { "label": "Fragezeile", "note": "Eine Frage eingeben oder einen Screenshot einfügen", "x": 4, "y": 6, "w": 92, "h": 9, "hue": "idea" },
    { "label": "Linien von jedem Einstiegspunkt", "note": "Einstiegspunkte, durch die Schichten, zu Speichern und externen Diensten", "x": 4, "y": 19, "w": 62, "h": 60, "hue": "make" },
    { "label": "Was das zeigt", "note": "Die Befunde zum ausgewählten Pfad", "x": 69, "y": 19, "w": 27, "h": 60, "hue": "measure" },
    { "label": "Ansichten", "note": "Map, System, Graph, Mind map, Tower 3D, Heat, List, Sequence", "x": 4, "y": 84, "w": 46, "h": 10, "hue": "accent" },
    { "label": "Overlays", "note": "Jede Messgröße kann Farbe, Größe, Ring, Linienbreite oder Puls steuern", "x": 53, "y": 84, "w": 43, "h": 10, "hue": "accent" }
  ],
  "caption": "Eine Oberfläche. Dieselbe Codebasis lässt sich als Karte, N-Tier-System, Graph, Mindmap, 3D-Turm, Heatmap, Liste oder Sequenz lesen, ohne von vorn zu beginnen."
}
```

Sie können Fragen stellen, statt Lenses auszuwählen. **Wohin läuft es?** **Was ist falsch?** **Was hat keinen Test?** **Welche Muster gibt es hier?** **Was hat sich geändert?** Jede Frage stellt Ansicht und Overlay für Sie ein, sodass die Antwort das Erste ist, was auf dem Bildschirm erscheint.

## Den Screenshot einfügen

Das ist der Teil, der den Nachmittag verändert. Ziehen Sie den Screenshot in die Fragezeile. Ein Vision-Modell liest den darin sichtbaren Text. Dann übernimmt eine einfache Suche: Sie gleicht diesen Text mit Ihren Übersetzungskatalogen und Ihrem Quellcode ab, findet die Dateien und geht noch einen Import weiter. Die Ansicht filtert sich auf den Code hinter dem, was Sie gesehen haben.

```bf-figure
{
  "kind": "flow",
  "title": "Vom hängenden Bildschirm zu den Dateien dahinter",
  "steps": [
    { "label": "Einfügen", "note": "Ein Screenshot des bei Judging hängenden Reviews kommt in die Fragezeile.", "hue": "idea" },
    { "label": "Lesen", "note": "Ein Vision-Modell liest die sichtbaren Wörter. Nichts sonst wird geraten.", "hue": "idea" },
    { "label": "Abgleichen", "note": "Die Suche bildet diese Wörter über die Übersetzungskataloge und den Quellcode auf Dateien ab, plus einen Import-Schritt weiter.", "hue": "make" },
    { "label": "Kennzeichnen", "note": "Jeder Treffer sagt, wie er gefunden wurde: exakt, Katalog oder Import.", "hue": "make", "tag": "Sie können es beurteilen" },
    { "label": "Diagnostizieren", "note": "Übergeben Sie den Pfad und seine Befunde an den Agent, der mit seinen eigenen Tools arbeitet.", "hue": "run" }
  ],
  "caption": "Der Abgleich ist deterministische Suche, nicht die Meinung eines Modells. Das Modell liest nur die Pixel, und jeder Treffer sagt Ihnen, warum er auf der Liste steht."
}
```

Diese Kennzeichnung ist der Punkt. Ein **exakter** Treffer ist die Zeichenkette selbst, im Code gefunden. Ein **Katalog**-Treffer kam über die Übersetzungsdateien – der übliche Grund, warum ein Wort auf dem Bildschirm kein Wort im Quellcode ist. Ein **Import**-Treffer ist ein Nachbar, einen Schritt entfernt. Sie erkennen einen sicheren Treffer von einem plausiblen, bevor Sie eine Minute darauf verwenden.

Dann übergibt **Mit dem Agent diagnostizieren** den Pfad und alles, was die Karte bereits darüber weiß. Der Agent beginnt nicht mit einer leeren Seite und einem Suchfeld.

## Sehen, was falsch ist, nicht nur, was da ist

Overlays machen eine Messgröße zu einem visuellen Kanal, und jede Messgröße kann jeden Kanal steuern.

```bf-figure
{
  "kind": "compare",
  "title": "Ein Graph aus Punkten und eine Karte, auf der Sie handeln können",
  "columns": [
    { "title": "Ein Graph von allem", "hue": "muted", "items": ["Tausende Knoten", "Farbe bedeutet, was die Legende diese Woche sagt", "Zeigt die Form, nicht das Problem", "Sie durchsuchen die Dateien trotzdem von Hand"] },
    { "title": "Die Karte", "hue": "make", "items": ["Eine Linie pro Einstiegspunkt, sodass Sie einen Pfad lesen", "Anti-Patterns, Komplexität, Abdeckung, Nutzung, Änderungsrate, Änderungen und Eigentümer, jeweils als Farbe, Größe, Ring, Linienbreite oder Puls", "Fragen, die die Ansicht für Sie einstellen", "Ein Screenshot, der auf den Code hinter einem Symptom eingrenzt"] }
  ],
  "caption": "Dieselbe Codebasis. Der Unterschied ist, ob das Bild eine Frage beantwortet oder nur beweist, dass die Codebasis groß ist."
}
```

Rund um die Karte liegen die Panels, nach denen Sie als Nächstes greifen:

- **Sync** zeigt, was auf Ihrem Rechner liegt und was der Server hat, und welche Dateien übersprungen wurden und warum, sodass eine Lücke in der Karte nie ein Rätsel ist.
- **Coverage** zeigt, was keinen Test hat.
- **Patterns** listet die Anti-Patterns im Code auf und wo sie sich häufen.
- **API** verwandelt Ihre Routen in ein OpenAPI-Skelett oder einen Postman-Export.
- **Fix queue** wendet eine deterministische Korrektur für ungenutzten Code an und schreibt andernfalls einen Prompt für den Agent.
- **Simulate** lässt den Agent einen Test schreiben und ausführen, der einen Pfad mit von Ihnen gewählten Werten durchläuft, sodass „Läuft das wirklich dorthin?“ eine echte Antwort bekommt.

## Wo es in der Methode sitzt

[Idea to Real](/blog/idea-to-real-the-operating-methodology) läuft von Idea über Make und Run bis Measure. Diese Fähigkeit betrifft die Handlungen, die entscheiden, ob Geld ausgegeben wird, und die, die es ausgibt.

**Sie lässt Read auf bereits vorhandenem Code funktionieren.** [Read](/blog/read-prove-build-the-inner-loop) fragt, was tatsächlich da ist, und soll kostenlos sein. Bei einem laufenden System bedeutete „was tatsächlich da ist“ bisher Stunden in den Dateien. Die Karte und die Fragezeile machen daraus ein paar Minuten, ohne Agent-Kosten, bis Sie sich dafür entscheiden.

**Sie macht Build günstiger, indem sie es eingrenzt.** Build ist die Handlung, die Geld kostet, und ein auf die falschen Dateien gerichteter Build ist die teuerste Sorte. Ein Screenshot, der den Agent auf den richtigen Pfad bringt, mit angehängten Befunden, bedeutet: Das Geld geht in die Änderung und nicht in die Suche, wohin die Änderung gehört.

**Sie hilft auch bei Run und Measure.** In Run wird ein Symptom auf einem Live-Bildschirm zu einem Pfad. In Measure zeigen dieselben Overlays, was sich geändert hat und was keinen Test hat, sodass Sie sehen, wo sich das System bewegt hat, und nicht nur, dass es das hat.

## Was Sie heute damit tun können

- **Einen Screenshot eines Bugs einfügen** und die Dateien dahinter sehen, jeweils gekennzeichnet, wie sie gefunden wurden.
- **Fragen, wohin eine Anfrage läuft**, von ihrem Einstiegspunkt durch die Schichten bis zu den Speichern und Diensten am Ende.
- **Fragen, was falsch ist, was keinen Test hat und was sich geändert hat**, und die Ansicht erhalten, die es beantwortet.
- **Zwischen acht Ansichten** derselben Codebasis wechseln, ohne die Orientierung zu verlieren.
- **Ihre API exportieren** als OpenAPI-Skelett oder Postman-Collection aus den bereits gefundenen Routen.
- **Ungenutzten Code aufräumen** mit einer deterministischen Korrektur und alles andere als fertigen Prompt an den Agent übergeben.
- **Einen Pfad simulieren** mit Ihren eigenen Werten, bevor Sie ihm vertrauen.

---

**Weiterführende Lektüre:** [Auf einen Ordner zeigen und sehen, was er weiß](/blog/point-it-at-a-folder-and-see-what-it-knows) · [Read, Prove, Build: die innere Schleife](/blog/read-prove-build-the-inner-loop) · [Qualität, Fehler und Ein-Klick-Korrekturen](/blog/quality-error-observability-one-click-fix)

[Öffnen Sie eine Canvas](/create), zeigen Sie auf einen Ordner und fügen Sie den Screenshot ein, den Sie die ganze Zeit anstarren.
