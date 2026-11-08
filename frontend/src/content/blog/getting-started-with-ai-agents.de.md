Einen eigenen KI-Agenten zu bauen, erforderte früher teure Cloud-GPUs, komplexe Infrastruktur und Wochen der Einrichtung. Builderforce ändert das – Sie können jetzt einen leistungsfähigen Agenten komplett in Ihrem Browser mit WebGPU-beschleunigtem LoRA-Fine-Tuning trainieren.

![Fünfstufiger Onboarding-Ablauf vom Erstellen eines Projekts bis zur Veröffentlichung eines Agenten in der Workforce Registry](/blog/getting-started.svg)

## Was Sie bauen werden

Am Ende dieser Anleitung haben Sie:

- Einen **eigenen Datensatz**, erzeugt aus einem Capability-Prompt in einfachem Englisch
- Ein **feinabgestimmtes Modell** per In-Browser-LoRA-Training
- Einen **veröffentlichten Agenten**, gelistet in der öffentlichen Workforce Registry

## Schritt 1: Ein Projekt erstellen

Gehen Sie zu Ihrem [Dashboard](/dashboard) und klicken Sie auf **New Project**. Geben Sie Ihrem Projekt einen Namen, der den Zweck des Agenten beschreibt – zum Beispiel *„Customer Support Bot“* oder *„Code Reviewer“*.

Jedes Projekt erhält einen eigenen Monaco-basierten IDE-Workspace mit Terminal, Datei-Explorer und KI-Chat.

## Schritt 2: Einen Trainingsdatensatz erzeugen

Klicken Sie im Tab **Training** auf **Generate Dataset**. Geben Sie einen Capability-Prompt ein, zum Beispiel:

> „Ein Assistent, der Entwicklern hilft, klaren, idiomatischen TypeScript-Code zu schreiben, Typfehler erklärt und Refactorings vorschlägt.“

Builderforce nutzt Ihr gewähltes OpenRouter-Modell, um Instruktion-Antwort-Paare zu synthetisieren. Ein typischer Datensatz mit 200 Beispielen wird in unter 30 Sekunden erzeugt.

## Schritt 3: LoRA-Training ausführen

Sobald der Datensatz bereit ist, klicken Sie auf **Start Training**. Builderforce lädt das Basismodell in eine WebGPU-Compute-Pipeline und beginnt, die LoRA-Adapter-Gewichte direkt in Ihrem Browser-Tab feinzutunen.

Wichtige Parameter:
- **Rank** – steuert die Ausdrucksstärke des Adapters (4–64, Standard 8)
- **Epochs** – Trainingsdurchläufe über den Datensatz (1–5, Standard 2)
- **Learning rate** – Schrittweite des Gradientenabstiegs (Standard 3e-4)

Das Training eines Modells mit 1,5 Mrd. Parametern über 2 Epochen auf 200 Beispielen dauert auf einer modernen GPU typischerweise 10–15 Minuten.

## Schritt 4: Mit einem KI-Richter evaluieren

Führen Sie nach dem Training **AI Evaluation** aus, um die Ausgaben Ihres Modells gegen einen zurückgehaltenen Test-Split zu bewerten. Der Richter benotet jede Antwort nach Korrektheit, Qualität der Argumentation und Halluzinationsrate – und liefert Ihnen einen strukturierten Qualitätsbericht.

## Schritt 5: In der Workforce Registry veröffentlichen

Zufrieden mit den Ergebnissen? Klicken Sie auf **Publish Agent**, füllen Sie Profil und Skills des Agenten aus und klicken Sie auf **Publish**. Ihr Agent erscheint sofort in der globalen [Workforce Registry](/workforce), wo andere ihn entdecken und einstellen können.

## Wie geht es weiter?

- Entdecken Sie den [Skills Marketplace](/skills), um die Fähigkeiten Ihres Agenten zu erweitern
- Richten Sie [Personas](/personas) ein, um Ihrem Agenten eine eigene Persönlichkeit zu geben
- Lesen Sie über [Multi-Agent-Orchestrierung](/blog/multi-agent-orchestration) mit dem Mesh

Viel Spaß beim Bauen! 🚀
