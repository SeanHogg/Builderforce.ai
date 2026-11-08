Funktionsübergreifende Arbeit zerfällt meist in werkzeugförmige Fragmente. Der Produktkontext lebt in einem Ticket. Belege von Kunden liegen in einem Dashboard. Der Prototyp liegt in einem Design-Tool. Der Implementierungskontext steckt in VS Code. Und das Gespräch über alle vier findet irgendwo anders statt.

Builderforce Creation Sessions geben diesen Artefakten ein gemeinsames räumliches Zuhause, ohne jeden Beteiligten in denselben Editor zu zwingen.

![Eine hochauflösende, geteilte Creation Session, die eine visuelle Browser-Canvas und einen nativen Code-Editor über einen Prototyp, gemeinsame Objekte, Kommentare, Cursor, Präsenz und Implementierungskontext verbindet](/blog/multiplayer-canvas-hero.webp)

## Eine Server-Session, zwei native Oberflächen

Im Web ist die Creation Canvas der standardmäßige visuelle Arbeitsbereich für Chat, Workflows, Websites, Daten, Modelle, Personen, Agents und optionale Projekte. In der BuilderForce-VS-Code-Erweiterung öffnet sich dieselbe Session in einem vollwertigen Editor-Tab – nicht in einem iframe und nicht in einer schmalen Seitenleiste.

Beide Oberflächen nutzen denselben Session-Graphen, dieselben Objektidentitäten, Berechtigungen, denselben versionierten Command-Vertrag, dieselbe Präsenz und dieselben Kommentare. Die vollständige Aktivitäts-Timeline und spezialisierte Inspektoren stehen weiterhin im Browser zur Verfügung. Ein Web-Nutzer und ein Editor-Nutzer sind Mitwirkende in einer Session, keine Nutzer synchronisierter Kopien.

Die native VS-Code-Oberfläche kann Entwicklungskontext hinzufügen, ohne den Editor zu verlassen:

- aktuelle Dateien oder Auswahlen;
- Repository- und Branch-Kontext;
- Diagnosen und Probleme (Problems);
- eingefügte Terminalausgabe mit Warnung vor Geheimnissen;
- lokale Dienste und Browser-Vorschauen;
- jede gemeinsame Canvas-Objektart aus der nativen Palette.

Ein Product Manager kann im Web Kundenbelege und einen Mockup verbinden, während ein Entwickler aus VS Code die fehlschlagende Diagnose, die relevante Quellcode-Auswahl und die lokale Vorschau anbindet.

![Die Web-Creation-Canvas steuert Kundenbelege, Prototypen, Projekt-Lenses, Aktivität und Inspektoren bei, während der native VS-Code-Tab Dateien, Repository-Kontext, Diagnosen, Terminalausgabe, lokale Dienste und Vorschauen beisteuert; beide nutzen einen Session-Graphen mit gemeinsamen Objektidentitäten, Berechtigungen, Präsenz, Kommentaren, Aktivität und versionierten Commands](/blog/multiplayer-canvas-shared-session.svg)

## Zusammenarbeit ohne Streit um den Viewport

Jedes Mitglied hat einen persönlichen Viewport. Wenn Sie Ihre Canvas verschieben oder zoomen, bewegt sich die der anderen nicht mit. Im Browser zeigt die Präsenz Cursor, Auswahlen, Tippstatus und die genutzte Client-Oberfläche. Das VS-Code-Panel meldet seine aktuelle Auswahl über denselben dauerhaften Präsenzvertrag.

Wenn jemand präsentiert, können Mitwirkende dem Viewport dieser Person bewusst folgen. Beim Verlassen des Folgemodus kehrt die Kontrolle zum Einzelnen zurück. So werden Walkthroughs nützlich, ohne dass aus normaler Zusammenarbeit ein ferngesteuertes Screensharing wird.

Kommentare haften an Objekten. Erwähnungen und Aktivität zeigen, wer Brain zum Handeln aufgefordert hat, wer einen Vorschlag geprüft hat und welche kanonische Ressource sich geändert hat. Rollen unterscheiden die Zugriffsstufen Viewer, Commenter, Editor, Runner und Owner. Die zugrunde liegenden Ressourcenberechtigungen gelten weiterhin – eine Session-Einladung ist keine Abkürzung in ein Projekt, einen Datensatz, einen Agent oder ein Repository, auf das das Mitglied keinen Zugriff hat.

## Eine praxistaugliche Design-zu-Code-Übergabe

Stellen Sie sich ein Team vor, das einen neuen Onboarding-Ablauf prüft:

1. Das Produktteam fügt ein Project-Objekt hinzu und erweitert die Lenses für Kundenfeedback und Delivery.
2. Das Design platziert einen WYSIWYG-Prototyp und seine mobile Variante neben den Belegen.
3. Brain bewertet den Prototyp anhand der gewünschten Features und erstellt ein prüfbares Änderungspaket.
4. Das Team genehmigt einen Mockup und überführt ihn in eine Projekt-Task, die einem Implementierungs-Agent zugewiesen ist.
5. Ein Entwickler öffnet dieselbe Session in VS Code und ergänzt das relevante Repository, die Komponentenauswahl, Diagnosen und die lokale Vorschau.
6. Der Agent führt gemäß der Freigaberichtlinie des Projekts aus. Build-Status und Ausgabe erscheinen wieder in der Session.

Niemand muss nachträglich rekonstruieren, warum die Aufgabe existiert. Beleg, Entscheidung, Artefakt, Implementierungskontext und Ausführungshistorie bleiben verbunden.

## Sicheres Erkunden mit Branches und Checkpoints

Benannte Checkpoints bewahren aussagekräftige Review-Zustände. Ein Session-Branch ermöglicht ein unabhängigeres Experiment – zum Beispiel eine andere Informationsarchitektur oder Modell-Pipeline. Kehrt der Branch zurück, zeigt Builderforce eine explizite Merge-Prüfung Objekt für Objekt. Der Prüfer kann für jedes übereinstimmende Objekt die Branch-Version verwenden oder die Eltern-Version beibehalten.

Freihandzeichnungen, Notizen und wiederverwendbare Frames unterstützen die unordentliche räumliche Arbeit rund um formale Artefakte. Marketplace-Pakete liefern strukturiertere Ausgangspunkte für Kampagnen, Produkt-Discovery, Daten-Storys, Stand-ups, Modellbauten und Executive Reviews.

## Aus der Übergabe wird ein gemeinsames Lagebild

„Übergabe“ impliziert, dass ein Team fertig wird und ein anderes beginnt. Eine Multiplayer-Creation-Session unterstützt ein besseres Modell: Mitwirkende fügen den Kontext hinzu, der ihrer Arbeit eigen ist, während die gemeinsame Canvas die Beziehungen bewahrt und Brain hilft, darüber hinweg zu schlussfolgern.

Der Browser bleibt der zugänglichste Ort, um Geschäftskontext zu sammeln. VS Code bleibt der richtige Ort für die detaillierte Implementierung. Builderforce verbindet beide, ohne eines von ihnen auf ein Transkript zu reduzieren.

[Eine geteilte Creation Session starten →](/create/new)
