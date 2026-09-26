Sehen Sie einem Agenten zu, wie er in einem großen Repository eine Aufgabe beginnt, und zählen Sie die Aufrufe bis zur ersten Änderung.

Er sucht per grep nach einem Wort aus Ihrer Anfrage. Das Wort steht nicht im Code – Sie haben das Verhalten beschrieben, der Code nennt es anders. Er listet ein Verzeichnis auf. Er liest eine Datei mit 2.000 Zeilen, um eine Funktion zu finden, dann die falsche Nachbarfunktion, dann wieder die erste Datei, weil das benötigte Fenster aus dem Kontext gerutscht ist. Zehn, zwanzig, dreißig Aufrufe nur zur Orientierung, jeder davon bezahlt, bevor sich irgendetwas ändert.

Dann wechseln Sie zu einem anderen Werkzeug, und es macht alles noch einmal – denn nichts von dem, was es gelernt hat, wurde irgendwo abgelegt, wo ein anderes Werkzeug es lesen könnte.

Das ist die Lücke: **Jedes KI-Werkzeug, das Sie nutzen, fängt bei null an – und jedes fängt für sich allein bei null an.**

## Builderforce Desktop

Builderforce Desktop ist eine kleine App in Ihrer Taskleiste, die einen Index pro Repository führt – auf Ihrem Rechner, aktuell bis zur letzten Speicherung.

```bf-figure
{
  "kind": "flow",
  "title": "Was der Index enthält und wer ihn liest",
  "steps": [
    { "label": "Definitionen", "note": "Jede Funktion, Klasse und jeder Typ, an ihren echten Grenzen geschnitten – die Einheit, die ein Agent tatsächlich lesen will.", "hue": "idea" },
    { "label": "Eine Karte", "note": "Dateien, geordnet danach, wie stark der übrige Code von ihnen abhängt, jeweils mit ihren meistgenutzten Signaturen.", "hue": "idea" },
    { "label": "Suche nach Bedeutung", "note": "Bezeichnerbewusste Stichwörter („membership“ findet resolveMembership) plus lokale Embeddings, zu einem Ranking verschmolzen.", "hue": "make" },
    { "label": "Jedes Werkzeug", "note": "Der VS-Code-Agent, Claude Code, Cursor und jeder MCP-Client lesen denselben Index.", "hue": "run", "tag": "ein Index" }
  ],
  "caption": "Der Datei-Watcher indiziert neu, was Sie speichern – der Index beschreibt den Code, wie er jetzt ist, nicht wie er beim letzten Scan war."
}
```

Sobald die App läuft, ändern sich drei Dinge.

**Der Agent startet orientiert.** Die Grundlage jedes Durchgangs enthält die Repository-Karte, sodass der Agent weiß, welche Module zählen, bevor er eines öffnet. Und er bekommt `semantic_search`: Fragen Sie „Wie gelangen Erstattungen ins Hauptbuch?“, und die Antwort ist die Funktion, die das tut – Pfad, Zeilenbereich, Inhalt – in einem Aufruf.

**Alle Werkzeuge teilen ihn.** Derselbe Index beantwortet den Builderforce-Agenten in VS Code und, über einen einzigen MCP-Eintrag, Claude Code und Cursor. Was Sie einmal einrichten, dient allen.

**Veraltetes Wissen wird erkannt.** Das ist der Teil, von dem wir nicht erwartet hatten, dass er so viel ausmacht.

## Ein Gedächtnis, das weiß, wann es falschliegt

Evermind merkt sich, was frühere Durchläufe über Ihr Projekt gelernt haben: Konventionen, Ursachen, wo Dinge liegen. Dieses Gedächtnis verhindert, dass der zehnte Durchlauf neu herleitet, was der erste bereits herausgefunden hat.

Es kann aber auch auf die schlimmstmögliche Weise falschliegen. Eine Erinnerung wie „Berechtigungen laufen über `resolveMembership()`“ stimmte an dem Tag, an dem sie geschrieben wurde. Drei Wochen später ist die Funktion weg – umbenannt, zusammengeführt, gelöscht – und die Erinnerung ist immer noch selbstsicher, immer noch konkret und jetzt falsch. Ein Agent, der ihr vertraut, sucht nach Code, den es nicht gibt, oder schlimmer: Er baut ihn neu.

```bf-figure
{
  "kind": "compare",
  "title": "Dieselbe abgerufene Erinnerung, vorher und nachher",
  "columns": [
    { "title": "Ohne den Index", "hue": "muted", "items": ["„Nutze resolveMembership() für Berechtigungen“", "Der Agent sucht danach", "Findet nichts oder eine alte Kopie", "Schreibt eine neue neben den echten Code"] },
    { "title": "Mit Builderforce Desktop", "hue": "make", "items": ["„Nutze resolveMembership() für Berechtigungen“", "MÖGLICHERWEISE VERALTET: resolveMembership existiert nicht mehr", "Der Agent prüft zuerst den aktuellen Code", "Aktualisiert die Erinnerung, statt ihr zu folgen"] }
  ],
  "caption": "Jede abgerufene Erinnerung und jeder Projektfakt wird gegen den Live-Index geprüft. Geprüft werden nur Namen, die eindeutig Code sind – Pfade und Bezeichner –, normale Prosa wird nie markiert."
}
```

Solange die Desktop-App läuft, wird jede Erinnerung, die der Agent abruft, gegen den Index geprüft, bevor der Agent sie sieht. Ein Pfad oder Symbol, das es nicht mehr gibt, wird der Erinnerung als Warnung angehängt. Der Agent überprüft, statt zu gehorchen, und eine veraltete Erinnerung wird korrigiert, statt einen weiteren Monat lang still die Arbeit zu lenken.

## Es bleibt auf Ihrem Rechner

Indizierung, Zerlegung und Embeddings laufen vollständig lokal. Das Embedding-Modell wird einmal heruntergeladen, der Index liegt in Ihrem Benutzerprofil – nie im Repository –, und die App lädt nirgendwohin Code hoch. Der lokale Dienst, den sie betreibt, ist durch einen pro Start erzeugten Schlüssel geschützt, den nur Ihr Benutzerkonto lesen kann, und lehnt Anfragen von Webseiten grundsätzlich ab.

```bf-figure
{
  "kind": "screen",
  "frame": "Builderforce Desktop",
  "ratio": 1.4,
  "regions": [
    { "label": "Indizierte Arbeitsbereiche", "note": "Scan- und Embedding-Fortschritt pro Repository; neu scannen oder entfernen", "x": 4, "y": 8, "w": 92, "h": 44, "hue": "idea" },
    { "label": "Werkzeuge verbinden", "note": "VS Code automatisch; ein Befehl für Claude Code; ein JSON-Block für Cursor", "x": 4, "y": 56, "w": 92, "h": 30, "hue": "run" },
    { "label": "Bleibt lokal", "x": 4, "y": 89, "w": 40, "h": 7, "hue": "accent" }
  ],
  "caption": "Öffnen Sie einen Ordner in VS Code mit der Builderforce-Erweiterung, und er registriert sich selbst – nichts zu konfigurieren."
}
```

Das ist mehr als Komfort. Viele Teams dürfen Quellcode überhaupt nicht an einen gehosteten Index senden – regulierte Arbeit, Kundencode unter NDA, alles Air-Gapped. Ein lokaler Index entscheidet darüber, ob diese Teams codebasis-bewusste Agenten bekommen oder darauf verzichten.

## Wo es in der Methode sitzt

Jede Arbeit auf Builderforce durchläuft dieselbe innere Schleife: [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop). Lesen und Beweisen sind absichtlich kostenlos – mit ihnen entscheiden Sie, ob sich der teure Schritt, das Bauen, lohnt.

Builderforce Desktop ist eine **Lesen**-Funktion, und beim Lesen waren Agenten am schwächsten. Ein Agent, der die Codebasis nicht gut lesen kann, lässt das Lesen nicht aus; er liest schlecht, zu Bau-Preisen – jeder Orientierungsaufruf wird wie ein Bauschritt abgerechnet, jedes erneute Lesen verbrennt Kontext, den die eigentliche Änderung gebraucht hätte. Lesen günstig und genau zu machen, macht den Rest der Schleife ehrlich: Beweisen arbeitet mit dem echten Code, und Bauen beginnt in der richtigen Datei.

Die Prüfung auf veraltetes Wissen schließt eine leisere Lücke im selben Schritt. Zum Lesen gehört auch, zu lesen, was man schon weiß – und eine Erinnerung ist nur so lange Wissen, wie sie noch stimmt.

## Was Sie heute damit tun können

- **Einen Agenten in einem unbekannten Bereich starten** und ihn die Funktion finden lassen, indem Sie beschreiben, was sie tut, statt den Namen zu raten.
- **Claude Code und Cursor mit demselben Index nutzen** wie den Builderforce-Agenten – einmal im Verbinden-Bereich der App hinzufügen.
- **Abgerufenen Erinnerungen mehr vertrauen**, weil eine veraltete Erinnerung es selbst sagt.
- **An Code arbeiten, der das Haus nicht verlassen darf**, und dem Agenten trotzdem volles Wissen darüber geben.

[Builderforce Desktop herunterladen](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) für Windows, macOS oder Linux, dann einen Ordner in VS Code mit der Builderforce-Erweiterung öffnen.

---

**Weiterlesen:** [Lesen, Beweisen, Bauen – die innere Schleife](/blog/read-prove-build-the-inner-loop) · [Die VS-Code-Kommandozentrale für Ihre agentische Belegschaft](/blog/vs-code-command-center-for-your-agentic-workforce) · [Aus dem Editor ausliefern](/blog/ship-from-the-editor-commit-branch-pull-request)
