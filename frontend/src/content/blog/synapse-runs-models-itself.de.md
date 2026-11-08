Synapse führt Modelle jetzt selbst aus. Ollama ist nicht erforderlich.

Bis zu dieser Umstellung bedeuteten lokale Modelle in Synapse, die Laufzeitumgebung von jemand anderem zu installieren, zu hoffen, dass sie im PATH liegt, und mit den GGUF-Typen zu leben, die diese Laufzeit gerade akzeptierte. Das war ein Produkt, das wir nicht kontrollierten, auf dem kritischen Pfad eines Produkts, das wir kontrollieren.

```bf-figure
{
  "kind": "flow",
  "title": "Von der Installation zum Modell im Editor",
  "steps": [
    { "label": "Synapse", "note": "Die Desktop-App startet und überwacht bfi serve. Keine Ollama-Installation.", "hue": "idea" },
    { "label": "bfi", "note": "Die native Engine lädt GGUF – einschließlich PrismML PQ2_0 und PTQ1_0.", "hue": "make" },
    { "label": "desktop.json", "note": "Synapse schreibt ~/.builderforce/desktop.json mit dem Modell-Endpunkt.", "hue": "run" },
    { "label": "VS Code", "note": "Die BuilderForce-Erweiterung erkennt die Provider-ID synapse und listet diese Modelle auf.", "hue": "run" }
  ],
  "caption": "Eine Laufzeit auf dem Rechner. Der Editor findet sie. Ollama liegt nicht auf dem Weg."
}
```

## Warum wir Ollama ersetzt haben

Drei Kosten, alle getragen von der Person, die ein Modell auf dem eigenen Rechner ausführen will.

**Ein Installationsschritt außerhalb unserer Kontrolle.** Fehlte Ollama, verwies die Modell-Ansicht auf die Download-Seite eines anderen. Synapse konnte lokale Inferenz erst starten, wenn dieses andere Produkt vorhanden und gesund war.

**Die Formate, die wir am meisten wollen, liefen darauf nicht.** PrismMLs Ternary Bonsai 2 27B wird als `PQ2_0` / `PTQ1_0` GGUF ausgeliefert – ternäre Blöcke mit 2 Bit und ca. 1,75 Bit. Das Standard-llama.cpp, das Ollama einbettet, lehnt beide Typen ab. Nur ein Fork führte sie aus. Ein Produkt für lokale Modelle, das die Gewichte nicht laden kann, auf die es uns ankommt, ist kein Produkt für lokale Modelle.

**Die Dimensionierung war geraten.** Speicherschätzungen stammten aus einer festen Tabelle mit Bits pro Gewicht. Sie wusste nichts über ternäre Formate, die KV-Kosten hybrider Attention oder den tatsächlichen Overhead der Laufzeit. `bfi fit` schätzt anhand des GGUF, das wir tatsächlich laden.

## Die 2-Bit-Geschichte

`bfi` ist eine reine Rust-Engine in [builderforce-inference](https://github.com/SeanHogg/builderforce-inference). Sie liest GGUF v2/v3, einschließlich PrismMLs `PQ2_0` (Typ 142) und `PTQ1_0` (Typ 143). Das sind die 2-Bit-/ternären Layouts, die Bonsai 2 27B tatsächlich ausliefert – nicht Q2_0 oder TQ1_0, die einen Checkpoint mit Gruppengröße 128 nicht verlustfrei darstellen können.

Synapse überwacht `bfi serve` als Kindprozess: Health-Checks, Backoff, Neustart. Stirbt die Engine, läuft Synapse weiter. Der CPU-Sidecar wird mit der App ausgeliefert. Sie können das CLI auch selbst installieren:

```sh
cargo install --git https://github.com/SeanHogg/builderforce-inference bfi
```

Signierte GitHub-Release-Binärdateien sind noch nicht veröffentlicht. Das wartet auf Signing-Secrets des Eigentümers, nicht auf diese Umstellung.

## VS Code findet es auf dem Rechner

Die BuilderForce-VS-Code-Erweiterung rät keinen Port. Sie liest `~/.builderforce/desktop.json` (Windows: `%USERPROFILE%\.builderforce\desktop.json`; überschreibbar mit `BUILDERFORCE_DESKTOP_DISCOVERY`):

```json
{
  "models": {
    "endpoint": "http://127.0.0.1:…",
    "provider": "synapse"
  }
}
```

Die ID des lokalen Providers lautet `synapse`, niemals `bfi`. Katalog und Installation laufen über Synapse (`GET /v1/synapse/catalog`, `POST /api/pull`). Läuft Synapse nicht, wird die Gruppe nicht dargestellt. Ein vorhandener Ollama-Provider funktioniert weiterhin gegen jeden Ollama-kompatiblen Server, einschließlich eines eigenständigen `bfi serve`.

## Was wir nicht behaupten

Der CPU-Sidecar wird ausgeliefert. Das ist die Umstellung.

Wir haben **nicht** behauptet, dass die GPU auf Metal oder NVIDIA 70 % der Tok/s von llama-bench erreicht. CubeCL-Kernel kompilieren; die Go/No-Go-Messung wurde noch nicht durchgeführt.

Wir haben **nicht** behauptet, dass Bonsai 27B live greedy-identisch zum PrismML-llama.cpp-Fork ist. Fit-Tests bei 32K / 36 GiB bestehen auf der CPU; der Live-Vergleich braucht Gewichte, die wir in CI nicht ausführen.

Diese Punkte bleiben auf der ROADMAP. Dieser Beitrag ist die Umstellung, nicht die Ziellinie.
