Sie haben einem Evermind Ihre Codebasis, Ihren Support-Ton, Ihren Hausstil beigebracht. Er hat den Bereitschaftscheck bestanden. Er antwortet im Workspace. Und dann fragt jemand außerhalb des Workspace, ob er ihn ausprobieren darf.

Bis heute war die ehrliche Antwort eine Zip-Datei. Das Export-Panel baute das gesamte Hugging-Face-Repository – Gewichte in safetensors, einen ONNX-Graphen, einen GGUF-Container, die Konfiguration, den Tokenizer und eine Model Card – und gab es Ihnen als Download. Es auf den Hub zu bringen, war Ihre Aufgabe: auspacken, die Kommandozeilen-Tools installieren, einloggen, das Repository anlegen, die großen Dateien richtig hochladen und hoffen, dass die Model Card die Reise übersteht. Das ist ein kleines Softwareprojekt zwischen einem fertigen Modell und den Menschen, die es nutzen könnten.

## Veröffentlichen statt herunterladen

Wählen Sie im Export-Panel **Hugging Face repo**, und darunter öffnet sich ein zweiter Abschnitt: **Auf Hugging Face veröffentlichen**. Benennen Sie das Repository als `owner/name`, fügen Sie ein Hugging-Face-Token mit Schreibzugriff ein, wählen Sie, ob das Repository privat beginnt, und veröffentlichen Sie.

```bf-figure
{
  "kind": "flow",
  "title": "Was passiert, wenn Sie auf Veröffentlichen drücken",
  "steps": [
    { "label": "Exportieren", "note": "Der Server baut dasselbe Repo-Bundle, das der Download liefert: safetensors, ONNX, GGUF, Konfiguration, Tokenizer und Model Card.", "hue": "make" },
    { "label": "Auspacken", "note": "Ihr Browser öffnet das Bundle in die Dateien, aus denen ein Hub-Repository besteht.", "hue": "run" },
    { "label": "Pushen", "note": "Das Repository wird angelegt, falls es nicht existiert, und jede Datei wird hochgeladen, wobei die großen Gewichte so behandelt werden, wie der Hub es erwartet.", "hue": "reach", "tag": "Ihr Token, Ihr Repo" }
  ],
  "caption": "Der Export selbst ist unverändert. Neu ist der letzte Sprung: Er braucht kein Terminal, keinen Login und keinen zweiten Werkzeugsatz mehr."
}
```

Der Link zum neuen Repository erscheint, sobald der Upload fertig ist. Jeder, mit dem Sie ihn teilen, kann das Modell mit den Tools laden, die er ohnehin nutzt.

```bf-figure
{
  "kind": "screen",
  "frame": "Das Export-Panel mit gewähltem Hugging Face",
  "ratio": 1.4,
  "regions": [
    { "label": "Veröffentlichtes Modell", "note": "Jeder Evermind, den der Workspace veröffentlicht hat", "x": 5, "y": 6, "w": 90, "h": 12, "hue": "make" },
    { "label": "Format: Hugging Face repo", "x": 5, "y": 21, "w": 90, "h": 12, "hue": "make" },
    { "label": "Exportieren & herunterladen", "note": "Weiterhin da, für eine Offline-Kopie", "x": 5, "y": 36, "w": 40, "h": 9, "hue": "muted" },
    { "label": "Auf Hugging Face veröffentlichen", "note": "Repository · Ihr Token · privat oder öffentlich", "x": 5, "y": 49, "w": 90, "h": 45, "hue": "reach" }
  ],
  "caption": "Das Veröffentlichen sitzt unter dem Download, statt ihn zu ersetzen. Dasselbe Bundle bedient beides, sodass das, was Sie veröffentlichen, genau das ist, was Sie heruntergeladen hätten."
}
```

## Ihr Token bleibt Ihres

Das Token geht von der Seite direkt zu Hugging Face. Builderforce erhält es nie, speichert es nie und braucht es nie. Das Repository gehört zu Ihrem Hugging-Face-Konto, nicht zu unserem, und Sie können das Token widerrufen, sobald Sie fertig sind. Deshalb braucht das auf unserer Seite auch keine Einrichtung: Es gibt keine Integration zu verbinden und keinen Schlüssel auszuhändigen.

## Wo es in der Methode sitzt

Der Bogen läuft Idea → Make → Run → Measure und dann **Reach**: das, was Sie gemacht haben, vor die Menschen zu bringen, für die es gedacht ist. Ein Modell, das nur innerhalb des Workspace antwortet, der es trainiert hat, wurde von den Menschen gemessen, die es gebaut haben, nicht von jemandem, der es vielleicht haben möchte. Reach ist die Stufe, in der sich das ändert, und bis jetzt begann sie mit einer manuellen Verpackungsarbeit.

```bf-figure
{
  "kind": "compare",
  "title": "Von einem fertigen Modell zu einem, das andere laden können",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Eine Zip-Datei exportieren und herunterladen", "Auspacken", "Die Hub-Kommandozeilen-Tools installieren", "Einloggen", "Das Repository anlegen", "Die Gewichte als große Dateien hochladen", "Prüfen, ob die Model Card angekommen ist"] },
    { "title": "Jetzt", "hue": "reach", "items": ["Hugging Face repo wählen", "Das Repository benennen", "Ihr Token einfügen", "Veröffentlichen"] }
  ],
  "caption": "Die Schritte, die verschwunden sind, waren keine Entscheidungen. Es war Verpackung, und Verpackung ist der Ort, an dem ein fertiges Modell ungeteilt liegen bleibt."
}
```

## Was Sie heute damit tun können

- **Einen trainierten Evermind öffentlich teilen**, unter Ihrem eigenen Hugging-Face-Konto, mit seiner Model Card, in einem Schritt.
- **Privat beginnen** und das Repository für die Welt öffnen, wenn Sie bereit sind.
- **Eine neue Version veröffentlichen** im selben Repository, nachdem Sie dem Modell mehr beigebracht haben. Erneutes Veröffentlichen fügt dem Repository einen neuen Commit hinzu.
- **Die Offline-Kopie behalten**: Der Download ist weiterhin einen Klick entfernt, gebaut aus demselben Bundle.

---

**Weiterführende Lektüre:** [Einen Evermind auf der Creation Canvas bauen und trainieren](/blog/build-and-train-evermind-on-the-creation-canvas) · [Evermind, das sich selbst aktualisierende Modell](/blog/evermind-self-updating-model) · [Im Inneren der Evermind-Architektur](/blog/inside-evermind-architecture)

Öffnen Sie das LLM Studio, exportieren Sie ein veröffentlichtes Modell und wählen Sie **Hugging Face repo**.
