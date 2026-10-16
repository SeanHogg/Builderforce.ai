Zwischen einem Agenten, der Code schreibt, und einem Agenten, der Code ausliefert, liegt ein stiller Unterschied. Der erste übergibt Ihnen Dateien. Der zweite übergibt Ihnen Dateien, die kompilieren, deren Tests bestehen und deren Abhängigkeiten sich tatsächlich installieren lassen.

Bis heute war das Brain auf dem Canvas und im Studio-Arbeitsbereich die erste Sorte. Es konnte ein Backend, eine Seite und eine Testdatei schreiben, und zwar gut, aber es konnte keine davon ausführen. Das Prüfen blieb also an Ihnen hängen. Sie öffneten die Vorschau, fanden den Typfehler, kopierten ihn zurück in den Chat, warteten auf eine Korrektur und fingen von vorne an. Der Agent war zuversichtlich; der Beweis war Ihre Aufgabe.

Genau diese Lücke schließt sich jetzt. Das Brain führt seinen eigenen Code aus.

## Was das Brain jetzt kann

Bitten Sie um eine Änderung an einem Build, und das Brain kann echte Befehle dagegen ausführen: `npm install`, um ein Paket hinzuzufügen, `npm test`, um die Tests laufen zu lassen, `npm run build`, um zu bündeln, `tsc`, um die Typen zu prüfen. Es sind dieselben Befehle, die Sie in ein Terminal tippen würden. Schlägt einer fehl, liest das Brain die Ausgabe, korrigiert den Code, den es gerade geschrieben hat, und führt den Befehl erneut aus. Wenn es Ihnen sagt, dass die Änderung fertig ist, hat sie die Prüfung bereits bestanden.

```bf-figure
{
  "kind": "screen",
  "frame": "Ein Build auf dem Canvas, während das Brain seine eigene Änderung prüft",
  "ratio": 1.6,
  "regions": [
    { "label": "Dateien", "note": "Das Brain bearbeitet sie und beweist dann die Änderung", "x": 3, "y": 8, "w": 30, "h": 86, "hue": "make" },
    { "label": "Ausgabe", "note": "npm install · npm test · npm run build · tsc", "x": 36, "y": 8, "w": 30, "h": 54, "hue": "prove" },
    { "label": "Vorschau", "note": "Die laufende App bleibt hier, in echten Breiten", "x": 69, "y": 8, "w": 28, "h": 86, "hue": "run" },
    { "label": "Brain", "note": "„Datumsauswahl hinzugefügt. 14 Tests bestanden, Build sauber.“", "x": 36, "y": 66, "w": 30, "h": 28, "hue": "idea" }
  ],
  "caption": "Die Änderung, der Beweis und die laufende App auf einem Board. Sie lesen ein Ergebnis, keine Vermutung."
}
```

Alles läuft in Ihrem Browser. Builderforce hat eine eigene Laufzeitumgebung im Browser, [BuilderForce WebContainers](/blog/builderforce-webcontainers-open-source), auf der bereits die Live-Vorschau läuft. Die Befehle des Brain laufen in derselben Umgebung, auf denselben Dateien, im selben Tab. Nichts wird an einen Build-Server geschickt, und es muss keine Maschine bereitgestellt werden. Dateien, die ein Befehl ändert, etwa eine aktualisierte `package.json` oder eine generierte Quelldatei, werden in Ihr Projekt zurückgespeichert; installierte Pakete und Build-Ausgaben bleiben dort, wo sie hingehören, außerhalb Ihres Quellcodes.

Weil es in Ihrem eigenen Browser läuft, funktioniert es schon, bevor Sie ein Konto haben. Starten Sie ein Gast-Board, beschreiben Sie eine App, und das Brain beweist auch dort seine eigene Arbeit.

```bf-figure
{
  "kind": "flow",
  "title": "Wie das Brain eine Änderung abschließt",
  "steps": [
    { "label": "Schreiben", "note": "Das Brain bearbeitet die Dateien des Builds für das, worum Sie gebeten haben.", "hue": "make" },
    { "label": "Ausführen", "note": "Es installiert, testet, baut und prüft Typen in Ihrem Browser.", "hue": "prove", "tag": "in Ihrem Tab" },
    { "label": "Korrigieren", "note": "Ein Fehler kommt als echte Ausgabe zurück; es behebt die Ursache und führt erneut aus.", "hue": "build" },
    { "label": "Ihnen sagen", "note": "Sie erfahren von der Änderung, sobald sie bestanden hat, mit dem, was ausgeführt wurde.", "hue": "measure", "tag": "geprüft" }
  ],
  "caption": "Die Schleife, die eine sorgfältige Entwicklerin vor einem Review durchläuft, durchlaufen vom Brain, bevor es Ihnen antwortet."
}
```

Zwei Grenzen sollten Sie vorab kennen. Pakete, die native Add-ons oder Systemprogramme brauchen, laufen nicht im Browser, und das Brain sagt Ihnen, wenn eines davon das Problem ist, statt so zu tun, als wäre nichts. Und die App selbst läuft weiterhin in der Live-Vorschau, nicht als Befehl: Ein Dev-Server endet nie, also beweist das Brain mit Befehlen, die enden, und überlässt das Laufen der Vorschau, wo Sie es sehen.

## Schnelle Antworten auf Ihrem eigenen Rechner

Dasselbe Release macht einfache Fragen schneller und privater. Ist das integrierte Modell von Chrome bereits auf Ihrem Computer, wird ein reiner Chat-Beitrag, bei dem das Brain spricht statt Werkzeuge zu benutzen, direkt auf Ihrem Gerät beantwortet. Ist dieses Modell nicht verfügbar oder kann es nicht antworten, geht der Beitrag an die Cloud-Modelle von Builderforce, ohne dass Sie etwas davon merken.

```bf-figure
{
  "kind": "compare",
  "title": "Wo ein Beitrag des Brain beantwortet wird",
  "columns": [
    { "title": "Auf Ihrem Gerät", "hue": "run", "items": ["Reines Gespräch, ohne Werkzeuge", "Nur wenn das integrierte Modell von Chrome bereits heruntergeladen ist", "Privat und kostenlos", "Dieselbe Stufe antwortet in Rovr, dem Builderforce-Assistenten für Chrome"] },
    { "title": "Builderforce-Cloud", "hue": "make", "items": ["Jeder Beitrag mit Werkzeugen: Dateien bearbeiten, Befehle ausführen", "Jeder Beitrag, für den Sie ein bestimmtes Modell gewählt haben", "Immer wenn das Modell auf dem Gerät fehlt oder nicht antworten kann", "Unbemerkt übernommen, bevor Sie ein Wort gesehen haben"] }
  ],
  "caption": "Ihre Modellwahl hat immer Vorrang. Das Modell auf dem Gerät beantwortet nur Beiträge, die nie nach einem Modell gefragt haben."
}
```

Es wird nie verwendet, wenn Sie selbst ein Modell gewählt haben, und nie für einen Beitrag, der Werkzeuge braucht. Das Brain, das Ihren Code schreibt, ausführt und korrigiert, ist also immer das Modell, das Sie erwarten.

## Wo es in der Methode steht

Arbeit auf Builderforce folgt einem Bogen, **Idee → Machen → Betreiben → Messen**, und jeder Akt hat dieselbe innere Schleife: [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop). Dieses Release legt diese Schleife in die Hände des Brain selbst, genau dort, wo **Machen** in **Betreiben** übergeht.

- **Lesen** ist der Anfang. Bevor das Brain einen Build ändert, liest es dessen Dateien und jetzt auch die echte Ausgabe seiner Befehle. Es arbeitet also mit dem, was der Code tut, nicht mit dem, was es sich vom Code erhofft hat.
- **Beweisen** ist das Neue. Eine Änderung ist nicht fertig, wenn sie geschrieben ist; sie ist fertig, wenn sie sich installieren, bauen und typprüfen lässt und ihre Tests besteht. Das ist der kleinste Beweis, den es gibt, mit demselben Instinkt wie ein **Proof of Concept**: den riskanten Teil isolieren und gegen eine Messlatte prüfen, bevor man darauf aufbaut.
- **Bauen** geschieht auf diesem Beweis. Die nächste Änderung beginnt bei einem Build, von dem man weiß, dass er funktioniert. Eine Sitzung mit zehn Änderungen endet so nicht mit zehn Unbekannten.
- **Betreiben** bleibt dort, wo Sie zusehen können: Die Live-Vorschau führt die App aus, die das Brain gerade bewiesen hat, in echten Gerätebreiten.
- **Messen** bekommt bessere Eingaben. Jede Änderung, die dort ankommt, hat ihre eigenen Prüfungen bereits bestanden. Was Sie messen, ist also die Idee, nicht ein Tippfehler.

## Was Sie heute damit tun können

- **Ein Feature anfordern und eines bekommen, das baut.** Das Brain führt Build und Typprüfung aus, bevor es Ihnen sagt, dass es fertig ist.
- **Tests anfordern, und dass sie bestehen.** Es schreibt die Tests, führt sie aus und korrigiert den Code, bis sie grün sind.
- **Ein Paket beim Namen hinzufügen.** Das Brain führt die Installation aus und aktualisiert `package.json` für Sie, im Browser.
- **Ohne Konto ausprobieren.** Gast-Boards bekommen dieselbe Laufzeitumgebung, weil sie in Ihrem Browser läuft und nirgendwo sonst.
- **Schnelle Antworten lokal bekommen.** Ist das integrierte Modell von Chrome auf Ihrem Rechner, wird einfacher Chat dort beantwortet, privat.

Öffnen Sie ein Board, beschreiben Sie die App, die Sie wollen, und sehen Sie zu, wie das Brain seine eigene Arbeit beweist, bevor es sie Ihnen übergibt.

---

**Weiterlesen:** [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers ist Open Source](/blog/builderforce-webcontainers-open-source) · [Das ist Rovr](/blog/rovr-your-assistant-in-the-browser) · [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop)
