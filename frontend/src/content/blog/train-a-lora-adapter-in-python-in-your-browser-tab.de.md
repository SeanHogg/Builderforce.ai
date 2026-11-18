# Trainieren Sie einen LoRA-Adapter in Python, in dem Browser-Tab, in dem Sie ihn gebaut haben

Sie haben die Vermutung, dass ein kleines Modell auf Ihren Daten besser abschneiden würde. Das herauszufinden begann früher mit einem Umweg: eine GPU-Maschine mieten, PyTorch installieren, die Daten hinüberkopieren, das Skript ausführen, die Gewichte zurückkopieren und dann herausfinden, wie man sie irgendwo lädt, wo man sie tatsächlich ausprobieren kann.

Bis die Antwort kam, war die Frage längst kalt.

Dieser Umweg ist jetzt optional. **Ein Python-Trainingsskript in Ihrem Projekt läuft in dem Browser-Tab, in dem Sie es gebaut haben, und der Adapter, den es speichert, wird zu einem Modell, das Sie veröffentlichen und aufrufen können.**

## Was beim Drücken von Run passiert

Deklarieren Sie das Skript als `training`-Dienst in der `builderforce.json` Ihres Projekts — `python train.py`, kein Port. Drücken Sie Run, und das Skript startet im Tab neben dem Rest Ihrer App.

Darin funktionieren `import torch` und `import peft`. Sie laufen über WebGPU auf Ihrer GPU, mit derselben Engine wie der Trainer im Browser. Das Skript protokolliert seinen Loss mit `bfwc.training.log(step, loss)`. Wenn es fertig ist, speichert es seinen Adapter mit pefts `save_pretrained` in `bfwc.training.artifact_dir()`. Wenn Sie es vorher stoppen, fordert die Laufzeit es zu einem Checkpoint auf: Ein Skript, das `bfwc.training.checkpoint_requested()` prüft, speichert und beendet sich sauber.

```bf-figure
{
  "kind": "flow",
  "title": "Von einem Trainingsskript zu einem Modell, das Sie aufrufen können",
  "steps": [
    { "label": "Trainieren", "note": "Ihr train.py läuft im Tab: import torch und peft, über WebGPU auf Ihrer GPU.", "hue": "make", "tag": "im Tab" },
    { "label": "Speichern", "note": "Das Skript speichert seinen LoRA-Adapter, am Ende oder wenn Sie es stoppen. Die Sicherung bleibt in Ihrem Browser.", "hue": "run", "tag": "im Tab" },
    { "label": "Veröffentlichen", "note": "Das Trainings-Panel lädt die Sicherung als lauffähiges Modellpaket, das Sie veröffentlichen, aufrufen und benchmarken können.", "hue": "measure" }
  ],
  "caption": "Ein Skript, ein gespeicherter Adapter, ein Modell, das Sie aufrufen können. Trainingsdaten und Gewichte verlassen Ihren Tab erst, wenn Sie veröffentlichen."
}
```

Öffnen Sie das Trainings-Panel, wählen Sie den Dienst unter **Adapter aus einem Python-Trainingsdienst** und laden Sie seinen gespeicherten Adapter. Von da an ist es dasselbe Artefakt, das ein Trainingslauf im Panel erzeugt. Veröffentlichen Sie es, testen Sie einen Prompt dagegen und benchmarken Sie es auf zurückgehaltenem Text, genau wie bei einem im Panel trainierten Adapter.

## Wofür es gebaut ist und wofür nicht

Dies ist ein Werkzeug für kleine, schnelle Experimente, und die Grenzen sind real:

- **WebGPU ist für GPU-Geschwindigkeit erforderlich.** Ohne WebGPU läuft dasselbe Skript auf der CPU, was weit langsamer ist.
- **Nur kleine Modelle.** Der Browser hält das Basismodell und den Adapter im Speicher Ihres Tabs.
- **Nur LoRA-Adapter.** Der Adapter zielt auf das Token-Embedding der Evermind-Modelle des Browsers, das Modul, auf das Browser-Modelle Adapter laden. In Ihrem Skript heißt das: ein `nn.Linear` namens `embed_tokens`, das das Token-Embedding einer Evermind-Basis hält; ein fertiges Python-Evermind-Modell ist noch nicht enthalten. Vollständige Fine-Tunes und andere Zielmodule sind nicht vorgesehen.
- **Die Basis kommt mit dem Adapter.** Eine Sicherung kann ihre eigene Basis mitbringen (`base_model.safetensors` und `tokenizer.json`); andernfalls wählen Sie im Panel den Basis-Checkpoint und den Tokenizer, auf denen trainiert wurde.

Große Modelle gehören weiterhin ins Cloud-Training. Dies ist für den Schritt davor: herauszufinden, ob die Daten überhaupt etwas bewirken.

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Wege, eine Fine-Tuning-Idee zu testen",
  "columns": [
    { "title": "Eine GPU-Maschine mieten", "hue": "muted", "items": ["Eine Maschine bereitstellen und PyTorch installieren", "Die Daten hoch- und die Gewichte zurückkopieren", "Herausfinden, wie man das Ergebnis lädt", "Für jede Stunde zahlen, die sie herumsteht", "Richtig für große Modelle"] },
    { "title": "Im Tab trainieren", "hue": "run", "items": ["Run auf Ihrem Trainingsskript drücken", "Die Daten bleiben in Ihrem Browser", "Die Sicherung lädt direkt ins Panel", "Keine Cloud-Rechenleistung zum Trainieren", "Richtig für kleine Modelle und LoRA"] }
  ],
  "caption": "Die GPU-Maschine bleibt das richtige Werkzeug für große Läufe. Sie ist nur nicht mehr der Preis für eine erste Antwort."
}
```

## Wo es in der Methode sitzt

Idea to Real ist ein Bogen — **Idea → Make → Run → Measure** — mit einer Schleife darin: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Eine Fine-Tuning-Idee ist ein Beweis wie jeder andere. Der günstigste Weg, sie zu beweisen, ist ein kleiner Adapter auf einem kleinen Modell, ausgeführt dort, wo Sie ohnehin sind, und bewertet an Text, den das Modell nie gesehen hat.

Training im Tab legt diesen Beweis in die Run-Stufe. Der Benchmark im Panel ist die Measure-Stufe: Perplexität und Genauigkeit auf zurückgehaltenem Text, sodass Sie mit einer Zahl statt nach Gefühl entscheiden.

## Was Sie heute damit tun können

- **Ein Python-Trainingsskript im Tab ausführen** mit `import torch` und `import peft`, über WebGPU auf Ihrer GPU.
- **Es stoppen, ohne die Arbeit zu verlieren.** Ein Skript, das auf eine Checkpoint-Anforderung prüft, speichert, bevor es sich beendet.
- **Die Sicherung in ein Modell verwandeln**, das Sie veröffentlichen, aufrufen und benchmarken können, aus dem Trainings-Panel heraus.
- **Die Daten lokal behalten.** Die Trainingsdaten und der gespeicherte Adapter bleiben in Ihrem Browser, bis Sie sich entscheiden zu veröffentlichen.
- **Zum Cloud-Training wechseln**, wenn sich die Idee ein größeres Modell verdient hat.

---

**Weiterlesen:** [Ihre Full-Stack-App läuft jetzt in dem Browser-Tab, in dem Sie sie gebaut haben](/blog/your-full-stack-app-now-runs-in-your-browser-tab) · [Local-first-KI mit WebGPU im Browser](/blog/local-first-ai-webgpu-in-the-browser) · [Read, Prove, Build: die innere Schleife](/blog/read-prove-build-the-inner-loop)

[Öffnen Sie ein Projekt](/create), fügen Sie seiner `builderforce.json` einen Trainingsdienst hinzu und drücken Sie Run.
