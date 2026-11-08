Der Canvas konnte bereits die statischen Teile eines Launches erzeugen: die Seite, den Text, die Bilder, das Deck. Den Teil, den sich die Leute tatsächlich ansehen, konnte er nicht erzeugen.

Wer um „einen 30-Sekunden-Spot für die Bäckerei“ bat, bekam ein Storyboard: eine ordentliche Tabelle mit Einstellungen, jede mit der Beschreibung eines Clips, den es nicht gab. Daraus ein Video zu machen, hieß: mit der Tabelle weggehen, ein Video-Tool suchen, die Einstellungen einzeln generieren, herunterladen und woanders zusammenschneiden. An diesem Punkt starben die meisten Ideen, und die meisten blieben Storyboards.

Jetzt wird das Storyboard gerendert.

## Ein Clip, eine Szene, ein Film

Die kleinste Einheit ist ein **Clip**. Beschreiben Sie eine Einstellung, etwa *Dampf steigt von einem Brotlaib auf dem Abkühlgitter, langsame Annäherung, Morgenlicht*, und wenige Minuten später liegt ein echter Videoclip auf dem Board – im Quer-, Hoch- oder Quadratformat.

Die größere Einheit ist eine **Szene**. Beschreiben Sie eine Geschichte, und der Canvas plant sie wie ein Regisseur: wer darin vorkommt, was passiert und wie die Kamera es sieht, aufgeteilt in Einstellungen. Jede Einstellung wird dann als eigener Clip gerendert, nebeneinander.

```bf-figure
{
  "kind": "flow",
  "title": "Von einem Satz zum Schnitt",
  "steps": [
    { "label": "Planen", "note": "Die Geschichte wird zur Einstellungsliste: Handlung, Kamera und Länge für jede Einstellung, wobei die Figuren über alle hinweg konsistent bleiben.", "hue": "idea" },
    { "label": "Rendern", "note": "Jede Einstellung wird als echter Videoclip gerendert, mehrere gleichzeitig. Eine fehlgeschlagene Einstellung sagt, warum, und die übrigen laufen weiter.", "hue": "make" },
    { "label": "Schneiden", "note": "Die gerenderten Einstellungen werden auf einer Video-Timeline in Reihenfolge gebracht, bereit für Musik, Sprecher und Untertitel.", "hue": "make", "tag": "auf dem Board" },
    { "label": "Exportieren", "note": "Laden Sie den Film aus Ihrem Browser herunter oder rendern Sie ihn mit Pro und Teams auf unseren Servern und schließen Sie den Tab.", "hue": "run" }
  ],
  "caption": "Eine Anfrage führt Sie von der Idee zum Schnitt. Brain erledigt jeden Schritt aus einem einzigen Satz, und Sie können an jeder Stelle eingreifen."
}
```

Die Einstellungsliste bleibt als eigenes Objekt auf dem Board, was beim ersten Mal wichtig wird, wenn etwas nicht ganz stimmt. Schaut der Hund in der dritten Einstellung in die falsche Richtung, schreiben Sie diese Einstellung um und rendern sie erneut. Nur diese Einstellung wird neu erzeugt, die anderen behalten die Clips, die Ihnen gefallen haben.

```bf-figure
{
  "kind": "screen",
  "frame": "Eine Szene auf dem Canvas",
  "ratio": 1.62,
  "regions": [
    { "label": "Die Geschichte", "note": "Ein Prompt, ein Format und eine Laufzeit", "x": 4, "y": 8, "w": 34, "h": 40, "hue": "idea" },
    { "label": "Planen · Rendern · Film erstellen", "x": 4, "y": 52, "w": 34, "h": 12, "hue": "accent" },
    { "label": "Einstellungsliste", "note": "Prompt, Länge und Clip jeder Einstellung; eine umschreiben und nur diese rendern", "x": 42, "y": 8, "w": 54, "h": 74, "hue": "make" },
    { "label": "Cloud oder dieses Gerät", "x": 4, "y": 88, "w": 34, "h": 8, "hue": "muted" }
  ],
  "caption": "Cloud-Video nutzt gehostete Modelle und Ihr tägliches Videokontingent. Die Engine auf dem Gerät funktioniert weiterhin und läuft kostenlos und privat in Ihrem Browser."
}
```

## Der Schnitt ist ein ganz normales Video

Einen Film zu erstellen, sperrt ihn nicht in einem Generator ein. Der Schnitt landet als normales Video-Objekt auf dem Board, im selben Timeline-Editor, den Sie für Bildschirmaufnahmen und importiertes Material nutzen. Fügen Sie ein Musikbett hinzu, nehmen Sie einen Off-Kommentar auf, schreiben Sie Untertitel, kürzen Sie eine Einstellung, verschieben Sie die Kapitel. Dann exportieren Sie ihn oder veröffentlichen ihn direkt von derselben Karte aus auf YouTube.

Der Export läuft in jedem Tarif in Ihrem Browser. Mit Pro und Teams können Sie außerdem **auf dem Server rendern**. Der Film wird auf unseren Maschinen gerendert, sodass Sie den Tab schließen können, und das fertige MP4 wartet auf der Karte, wenn Sie zurückkommen.

## Video in den Apps, die Studio baut

Derselbe Generator funktioniert jetzt auch in Studio. Bitten Sie um „eine Landingpage mit einem Hero-Video in Endlosschleife“, und der Agent erzeugt den Clip, speichert ihn in Ihrem Workspace und schreibt seinen dauerhaften Link in das `<video>`-Tag. Sie erhalten eine echte Hintergrundschleife, keinen Link auf ein Beispielvideo, der bei der Veröffentlichung nicht mehr funktioniert.

```bf-figure
{
  "kind": "compare",
  "title": "Video anfragen, vorher und nachher",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Eine Storyboard-Tabelle mit Einstellungen, die es nicht gibt", "Ein Link auf ein Beispielvideo im Hero, der bei der Veröffentlichung bricht", "Fünf Tools und ein Nachmittag, um aus einem Skript einen Schnitt zu machen"] },
    { "title": "Jetzt", "hue": "make", "items": ["Echte Clips für jede Einstellung, auf dem Board gerendert", "Eine generierte Hero-Schleife, die mit der App gespeichert wird", "Ein Satz bis zu einem Film, den Sie bearbeiten, exportieren oder veröffentlichen können"] }
  ],
  "caption": "Der Unterschied ist nicht eine bessere Beschreibung eines Videos. Sie bekommen das Video."
}
```

## Wo es in der Methode steht

Die Arbeit auf Builderforce folgt einem Bogen, **Idea → Make → Run → Measure**, und jeder Akt durchläuft dieselbe innere Schleife: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

Video gehört zu **Make**, zahlt sich aber bei **Prove** aus. Viele Ideen werden erst glaubwürdig, wenn sie sich bewegen: ein Spot, eine Produkt-Walkthrough, die ersten dreißig Sekunden eines Pitchs, ein vertikaler Teaser für die Launch-Woche. Ein Storyboard bittet die Leute, denen Sie die Idee beweisen wollen, sich den Film vorzustellen. Ein Rohschnitt lässt sie darauf reagieren. „Würden Sie darauf klicken?“ ist eine Frage, die Sie jetzt mit dem tatsächlichen Video vor jemandem stellen können, am selben Tag, an dem die Idee entstanden ist.

Es hält auch **Build** ehrlich. Jede Einstellung ist ein eigenes, erneut renderbares Objekt, und der Schnitt ist eine gewöhnliche Timeline, sodass Iterieren heißt, eine Einstellung oder einen Schnitt zu ändern, nicht von vorn zu beginnen. Ist der Schnitt fertig, geht er weiter zu **Run** – als Hero-Schleife einer Seite, als YouTube-Upload oder als Kampagnen-Asset, ohne das Board zu verlassen.

## Was Sie heute damit tun können

- **Einen Clip aus einem Satz erzeugen**, im Quer-, Hoch- oder Quadratformat.
- **Eine Geschichte in einen Kurzfilm verwandeln**: in Einstellungen geplant, jede Einstellung gerendert, auf einer Timeline zusammengeschnitten.
- **Eine Einstellung korrigieren, ohne den Rest neu zu machen**: umschreiben und nur diese Einstellung erneut rendern.
- **Es wie jedes Video fertigstellen**: Musik, Sprecher, Untertitel und Schnitte, dann exportieren, auf dem Server rendern (Pro und Teams) oder auf YouTube veröffentlichen.
- **Brain in einer Zeile um das Ganze bitten** oder Studio um ein Video-Hero in der App bitten, die es gerade baut.

---

**Weiterführende Lektüre:** [Studio erstellt die Bilder, die Ihre App braucht](/blog/studio-makes-the-images-your-app-needs) · [Die App starten, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas) · [Die Creation Canvas ist kein Chatfenster](/blog/creation-canvas-beyond-chat)

[Öffnen Sie einen Canvas](/create) und bitten Sie um einen Dreißig-Sekunden-Spot.
