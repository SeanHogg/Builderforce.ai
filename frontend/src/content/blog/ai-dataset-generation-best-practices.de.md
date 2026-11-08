Die Qualität Ihres feinabgestimmten Agents hängt fast vollständig von der Qualität seiner Trainingsdaten ab. Garbage in, garbage out – aber mit ein paar bewusst angewandten Praktiken erzeugen Sie Datensätze, die einen echten Unterschied machen.

![Best-Practice-Pipeline für Datensätze: von einem präzisen Fähigkeits-Prompt über vielfältige Beispiele, Stichprobenprüfung und KI-Bewertung bis zu einem versionierten JSONL-Export, mit einer Iterationsschleife als Rückkopplung](/blog/dataset-generation.svg)

## Beginnen Sie mit einem präzisen Fähigkeits-Prompt

Der Fähigkeits-Prompt ist der Ausgangspunkt für Ihren gesamten Datensatz. Vage Prompts erzeugen generische Datensätze; spezifische Prompts erzeugen gezielte, nützliche.

**Schwacher Prompt:**
> „Ein hilfreicher Coding-Assistent.“

**Starker Prompt:**
> „Ein TypeScript-Assistent, der darauf spezialisiert ist, Legacy-JavaScript in modernes TypeScript zu refaktorisieren. Er erkennt implizite `any`-Typen, ergänzt explizite Annotationen, wandelt CommonJS-`require` in ESM-`import` um und erklärt jede Änderung mit einer Begründung in einem Satz.“

Der Unterschied im resultierenden Datensatz – und im resultierenden Agent – ist dramatisch.

## Streben Sie nach Vielfalt

Ein guter Datensatz deckt die *gesamte Verteilung* der Eingaben ab, auf die Ihr Agent in der Produktion trifft. Nutzen Sie die **Diversitäts-Einstellungen** von Builderforce, um die Variation zu erhöhen bei:

- **Komplexität der Eingabe** – mischen Sie einfache, mittlere und komplexe Beispiele
- **Randfällen** – nehmen Sie fehlerhafte Eingaben, mehrdeutige Anfragen und knifflige Randfälle auf
- **Ton und Format** – variieren Sie den Schreibstil von Fragen und Antworten

Ein Datensatz mit 500 vielfältigen Beispielen übertrifft typischerweise einen mit 2 000 nahezu doppelten Beispielen.

## Verwenden Sie das richtige Modell für die Generierung

Mit Builderforce wählen Sie für die Datensatz-Generierung jedes beliebige OpenRouter-Modell. Allgemeine Orientierung:

| Anwendungsfall | Empfohlene Modelle |
|----------|-------------------|
| Code-fokussierte Datensätze | Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro |
| Reasoning-Datensätze | o1, Claude 3 Opus |
| Allgemeines Instruction-Tuning | Llama 3.1 70B, Mistral Large |
| Kostenbewusste Generierung | Gemini Flash, Llama 3.1 8B |

Für spezialisierte Fachgebiete (Medizin, Recht, Finanzen) kombinieren Sie ein leistungsstarkes Basismodell mit domänenspezifischen Beispielen in Ihrem Fähigkeits-Prompt.

## Prüfen Sie vor dem Training eine Stichprobe

Trainieren Sie nicht ungeprüft auf automatisch erzeugten Daten. Builderforce zeigt Ihnen eine zufällige Stichprobe von 20 Beispielen, bevor Sie sich auf das Training festlegen. Achten Sie auf:

- ✅ Klare, eindeutige Anweisungen
- ✅ Korrekte, ausführliche Antworten
- ✅ Einheitliche Formatierung
- ❌ Halluzinierte Fakten oder Code, der nicht kompiliert
- ❌ Zu kurze oder themenfremde Antworten
- ❌ Duplikate oder nahezu Duplikate

Wirkt mehr als 10–15 % der Stichprobe fehlerhaft, erzeugen Sie mit einem verfeinerten Prompt neu.

## Schichten Sie Datensätze für komplexe Agents

Für Agents, die mehrere Fähigkeiten brauchen, erzeugen Sie **separate Datensätze pro Fähigkeit** und führen sie vor dem Training zusammen. So behalten Sie die Kontrolle über die Mischung:

```
dataset_a: 300 examples for TypeScript refactoring
dataset_b: 200 examples for code explanation
dataset_c: 100 examples for error diagnosis
─────────────────────────────────────────────────
merged:    600 examples, 50% / 33% / 17% split
```

Eine Aufteilung von 50/33/17 gewichtet den Agent in Richtung seiner Hauptaufgabe und hält zugleich die Nebenfähigkeiten scharf.

## Schließen Sie den Kreis mit KI-Bewertung

Führen Sie nach dem Training eine **KI-Bewertung** gegen einen zurückgehaltenen Test-Split durch (Builderforce reserviert automatisch 20 % des Datensatzes). Der Bewertungsbericht zeigt:

- **Korrektheits-Score** – beantwortet die Ausgabe die Anweisung?
- **Reasoning-Score** – ist die Logik stichhaltig?
- **Halluzinationsrate** – enthält die Ausgabe erfundene Fakten?

Liegen die Scores unter dem Ziel, sehen Sie nach, welche *Kategorien* von Beispielen am schlechtesten abgeschnitten haben – das sind die Fähigkeiten, die mehr Trainingsdaten brauchen.

## Iterieren Sie schnell

Die besten Datensätze entstehen iterativ. Ein guter Ablauf:

1. 200 Beispiele erzeugen → trainieren → bewerten
2. Schwachstellen anhand des Bewertungsberichts identifizieren
3. 100 gezielte Beispiele für die Schwachstellen erzeugen
4. Datensätze zusammenführen → neu trainieren → erneut bewerten
5. Wiederholen, bis die Scores Ihre Messlatte erreichen

Jede Iteration dauert mit der In-Browser-Pipeline von Builderforce von Anfang bis Ende etwa 15–20 Minuten.

## Exportieren und versionieren Sie Ihre Datensätze

Exportieren Sie Ihren finalen Datensatz vor dem Training immer als JSONL-Datei. Das gibt Ihnen:

- Ein reproduzierbares Trainingsartefakt
- Die Möglichkeit, später auf einem anderen Basismodell neu zu trainieren
- Einen Ausgangspunkt für künftige Iterationen

Benennen Sie Ihre Exporte aussagekräftig: `typescript-refactor-v1.jsonl`, `typescript-refactor-v2-more-edge-cases.jsonl` und so weiter.

Viel Spaß beim Bauen Ihrer Datensätze! Wenn Sie Fragen haben oder Ihre besten Prompts teilen möchten, kommen Sie in die [Discord-Community](https://discord.gg/9gUsc2sNG6). 🎯
