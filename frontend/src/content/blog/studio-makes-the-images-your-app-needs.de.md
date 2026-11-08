> **Update, 4. Oktober 2026:** Sie sehen jetzt jedes Bild und jeden Videoclip, *bevor* er in Ihre App gelangt. Das Media-Panel zeigt, was der Agent erzeugt hat, und wartet darauf, dass Sie **Verwenden**, **Nochmal versuchen** oder **Verwerfen** wählen. Siehe „Sie sehen es zuerst“ weiter unten.

Sie bitten um eine Landingpage für eine Bäckerei im Viertel. Das Layout stimmt, der Text stimmt, und der Speisekarten-Bereich funktioniert. Das Hero-Bild ist ein graues Kästchen mit „1200 × 600“ in der Mitte.

Oder es ist schlimmer: Der Agent wollte keine Lücke lassen und hat aus dem Gedächtnis einen Stockfoto-Link geschrieben. Heute lädt er vielleicht. Dann nicht mehr, und das Erste, was jemand auf Ihrer Website sieht, ist ein Symbol für ein defektes Bild.

Bisher hatte jede App, die Studio gebaut hat, diese Lücke. Der Agent konnte Code schreiben, aber kein Bild erzeugen, sodass der sichtbarste Teil eines ersten Entwurfs immer der unfertigste war.

## Der Agent erzeugt das Bild

Der Agent von Studio hat jetzt ein Bild-Tool. Braucht die Seite ein Hero-Bild, eine Illustration, ein Produktfoto oder einen Hintergrund, beschreibt der Agent das gewünschte Bild und bekommt eines zurück. Die Beschreibung umfasst Motiv, Stil, Farbpalette und Komposition. Auch das Format wählt er: quadratisch, breit für ein Banner oder hochkant für einen Smartphone-Bildschirm. Dann setzt er das Bild dorthin, wo es hingehört: in ein `<img>`, einen CSS-Hintergrund oder das Social-Preview-Tag.

```bf-figure
{
  "kind": "flow",
  "title": "Von „braucht ein Hero-Bild“ zu einem Bild auf der Seite",
  "steps": [
    { "label": "Agent beschreibt es", "note": "„Warme Bäckerei-Schaufensterfront im Morgengrauen, weiches Licht, breites Banner.“", "hue": "idea" },
    { "label": "Bild wird erzeugt", "note": "Passend zur Beschreibung erzeugt, in dem Format, das das Layout braucht.", "hue": "make" },
    { "label": "In Ihrem Workspace gespeichert", "note": "Einmal gespeichert, mit dauerhaftem Link: nichts läuft ab, und nichts zeigt auf den Server eines anderen.", "hue": "make", "tag": "dauerhafter Link" },
    { "label": "In den Code geschrieben", "note": "Der Link kommt in das img-Tag oder das Stylesheet, und die Vorschau zeigt ihn.", "hue": "run" }
  ],
  "caption": "Der Agent nutzt das Tool von selbst, sobald ein Layout ein Bild braucht; Sie können auch ausdrücklich eines anfordern."
}
```

Das Bild wird in Ihrem Workspace gespeichert, bevor der Agent es verwendet. Sie bekommen nie einen Link auf die temporäre Datei eines Anbieters, die in einer Stunde verschwinden kann, oder einen Inline-Blob, der Ihre Quelldateien aufbläht. Die Vorschau zeigt das Bild sofort, und es bleibt nach dem Veröffentlichen erhalten.

## Was sich in einem ersten Entwurf ändert

```bf-figure
{
  "kind": "compare",
  "title": "Die Bäckerei-Landingpage, erster Entwurf",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Graue Platzhalterkästen mit Pixelmaßen darin", "Aus dem Gedächtnis geratene Stockfoto-Links, einige defekt", "„Durch Ihr Bild ersetzen“-Kommentare im Code", "Ein Entwurf, der unfertig aussieht, sodass niemand das Layout beurteilt"] },
    { "title": "Jetzt", "hue": "make", "items": ["Ein Hero-Bild, das zum Briefing passt", "Produktfotos im Speisekarten-Bereich, in einem einheitlichen Stil", "Dauerhafte Links im Code, gespeichert in Ihrem Workspace", "Ein Entwurf, der aussieht wie das echte Ergebnis"] }
  ],
  "caption": "Gleicher Prompt, gleiches Layout. Der Unterschied ist, ob sich die Seite so beurteilen lässt, wie sie tatsächlich aussehen wird."
}
```

Ein Bild zu ändern funktioniert wie jede andere Änderung in Studio. Sagen Sie „mach das Hero zu einer Abendaufnahme mit eingeschaltetem Licht“, und der Agent erzeugt ein neues Bild und tauscht den Link aus. Der Durchgang wird als Version gespeichert, das alte Bild ist also nur eine Wiederherstellung entfernt.

## Sie sehen es zuerst

Ein Bild ist eine Geschmacksentscheidung, und der Agent sollte sie nicht allein treffen. Wenn der Agent jetzt ein Bild oder einen Videoclip erzeugt, schreibt er es nicht sofort in die Seite. Das **Media-Panel** gleitet neben Ihrer App auf, zeigt das neue Bild, und der Agent wartet auf Ihre Antwort.

```bf-figure
{
  "kind": "screen",
  "frame": "Studio mit geöffnetem Media-Panel",
  "ratio": 1.62,
  "regions": [
    { "label": "Brain", "note": "Der Agent hat ein Hero-Bild angefordert und wartet auf Sie", "x": 2, "y": 8, "w": 24, "h": 86, "hue": "idea" },
    { "label": "Ihre App", "note": "Unverändert, bis Sie entscheiden", "x": 28, "y": 8, "w": 44, "h": 86, "hue": "run" },
    { "label": "Verwenden · Nochmal versuchen · Verwerfen", "note": "Das neue Bild in voller Größe, mit seinem Prompt zum Bearbeiten", "x": 74, "y": 8, "w": 24, "h": 44, "hue": "make" },
    { "label": "Die Medien dieses Projekts", "note": "Alles bisher Erzeugte, zum Wiederverwenden oder Kopieren", "x": 74, "y": 56, "w": 24, "h": 38, "hue": "accent" }
  ],
  "caption": "Der Agent schreibt den Link erst in Ihren Code, nachdem Sie Verwenden gewählt haben. Nochmal versuchen rendert mit dem von Ihnen bearbeiteten Prompt neu, ohne einen weiteren Umweg über den Chat."
}
```

- **Verwenden:** Der Agent setzt es in die App ein, und das Panel markiert es als in Gebrauch.
- **Nochmal versuchen:** Bearbeiten Sie den Prompt, wenn Sie möchten, und eine neue Version tritt an die Stelle.
- **Verwerfen:** Nichts gelangt in die App, und der Agent fragt, was Sie stattdessen möchten.

Sie können auch selbst aus dem Panel heraus erzeugen, Bilder oder Videoclips, im Querformat, quadratisch oder im Hochformat. Alles, was für das Projekt entsteht, bleibt in dessen Medienbibliothek. Klicken Sie bei einem beliebigen Element auf **In App verwenden**, und der Chat erhält eine fertige Anfrage; Sie sagen nur noch, wohin es kommt.

## Wo es in der Methode sitzt

Die Arbeit auf Builderforce folgt einem Bogen – **Idea → Make → Run → Measure** –, und jeder Akt durchläuft dieselbe innere Schleife: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

Bilder gehören zum Akt **Make**, und am wichtigsten sind sie bei **Prove**. Einen Entwurf beweisen Sie, indem Sie ihn jemandem zeigen: einem Mitgründer, einem Kunden, dem Bäckereibesitzer. Menschen reagieren darauf, wie eine Seite aussieht, bevor sie darauf reagieren, wie sie funktioniert. Ein Layout voller Platzhalter bittet sie, sich die fertige Seite vorzustellen, und die meisten beurteilen stattdessen die Kästchen. Mit echten Bildern bekommt ein erster Entwurf die Reaktionen, die Sie hören müssen.

Es hält außerdem **Build** an einem Ort. Früher bedeutete das Fertigstellen einer Seite, Studio zu verlassen, um zu suchen, herunterzuladen, hochzuladen und Links einzufügen. Jetzt stammen die Bilder aus demselben Gespräch wie der Code, und sie liegen dort, wo die App sie jederzeit erreichen kann.

## Was Sie heute damit tun können

- **Jedes Bild und jeden Clip sehen, bevor Ihre App es tut**: im Media-Panel verwenden, nochmal versuchen oder verwerfen.
- **Eine Seite anfordern und ihre Bilder bekommen**: Hero-Bilder, Illustrationen, Produktfotos und Hintergründe, passend zum Layout erzeugt.
- **Ein Bild ändern, indem Sie die Änderung beschreiben**, und das vorherige aus den Versionen wiederherstellen, falls es Ihnen besser gefallen hat.
- **Veröffentlichen, ohne Bild-Links zu reparieren**: Jedes erzeugte Bild wird mit einem dauerhaften Link in Ihrem Workspace gespeichert.

Erzeugte Bilder verbrauchen Ihre täglichen Bild-Credits, dasselbe Kontingent wie Bilder, die auf dem Canvas entstehen.
