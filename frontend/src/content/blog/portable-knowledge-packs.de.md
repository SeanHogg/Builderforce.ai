Ein Knowledge-Review erarbeitet etwas, das hart verdient ist: einen Graphen dessen, was eine Codebasis tatsächlich bedeutet – ihre Systeme, Fakten, Beziehungen und die Abwägungen dahinter. Bisher lebte dieses Verständnis an einem einzigen Ort und stand nur einem Werkzeug zur Verfügung. Denselben Ordner in einem zweiten Host erneut zu prüfen hieß, die vollen Kosten noch einmal zu zahlen – und zwei Hosts konnten zu unterschiedlichen Ergebnissen kommen.

Diese Lücke ist jetzt geschlossen: **Das Verständnis, das Ihr Review belegt hat, war in dem Host gefangen, der es ausgeführt hat.** Jetzt lässt es sich packen und mitnehmen.

## Ein portables Paket, kein Haufen Dateien

Die Einheit ist das portable Wissenspaket – eine `.bfpack`-Datei auf der Festplatte. Es enthält die geprüften Fakten, die Befunde und die Abwägungen und ist bewusst modellunabhängig: Es sind keine Embeddings eingebettet, jeder Nutzer leitet die Vektoren also per Hash aus dem Kartentext neu ab. Was ein Paket vertrauenswürdig macht, reist als Herkunftsnachweis mit: wer es geprüft hat, mit welchem Bewertungsmodell, nach welcher Richtlinie und wann.

```bf-figure
{
  "kind": "flow",
  "title": "Review rein, Paket raus",
  "steps": [
    { "label": "Einen Ordner prüfen", "note": "Das Review baut einen Graphen aus Systemen, Fakten und Beziehungen auf und hält die Abwägungen fest.", "hue": "make" },
    { "label": "Das Paket erstellen", "note": "Ein Befehl macht aus dem geprüften Graphen ein portables .bfpack, inklusive Herkunftsnachweis.", "hue": "run" },
    { "label": "Jeder Agent ruft ab", "note": "Die eine Nahtstelle PackRegistry → Abruf bedient Chat, Synapse, Web und den Evermind-Turn im Canvas.", "hue": "measure" }
  ],
  "caption": "Ein Review, ein Paket, jeder Nutzer – kein zweiter Abrufpfad."
}
```

## Eine Nahtstelle, jeder Nutzer

Es gibt genau einen Weg, aus einem Paket abzurufen: die Nahtstelle `PackRegistry` → `PackRetrievalPort`. VS-Code-Chat, das Kontextpaket, Synapse, `knowledge.ask` im Web und der Evermind-Turn im Canvas laufen alle darüber. Ein neuer Nutzer fügt eine Registry-Implementierung hinzu – nie eine zweite Zusammenführung oder einen zweiten Abrufpfad –, sodass die Frage „Welches Wissen hat das Modell gesehen?“ immer genau eine Antwort hat.

Laden Sie ein Paket in ein Projekt hoch, wird es dort zu einer Wissenswurzel: Seine Fakten kommen zu denen des Projekts hinzu und speisen dessen Evermind, und wenn Sie es entfernen, verschwindet nur, was es mitgebracht hat.

## Warum das wichtig ist

- **Einmal zahlen, überall nutzen.** Teuer ist das Review. Packen heißt, Sie zahlen es einmal, und das Verständnis steht jedem Host und jedem Modell zur Verfügung.
- **Vertrauen wird mitgeliefert, nicht behauptet.** Der Herkunftsnachweis wird beim Packen festgehalten und bei der Auswahl angezeigt – „Geprüft von … mit …“ –, sodass die Glaubwürdigkeit eines Pakets eine Tatsache ist und keine Behauptung.
- **Eine Antwort darauf, was das Modell wusste.** Eine einzige Abruf-Nahtstelle macht den Kontext hinter einer Antwort reproduzierbar.

## Wo es in der Methode steht

Das ist **Make**, das sich zu **Measure** aufzinst: Das Review ist die Investition, das Paket der Ertrag, und der Abruf ist die Art, wie der Rest der Plattform ihn nutzt.

## Was Sie heute damit tun können

Prüfen Sie einen Ordner, erstellen Sie ein Paket und sehen Sie zu, wie dasselbe geprüfte Wissen in Chat, Synapse und Canvas antwortet. Laden Sie ein Paket in ein Projekt hoch und sehen Sie, wie seine Fakten in das Evermind des Projekts einfließen.
