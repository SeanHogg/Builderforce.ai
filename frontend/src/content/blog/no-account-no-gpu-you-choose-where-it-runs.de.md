Etwas anzufangen war bisher an drei Bedingungen geknüpft, die nirgends aufgeschrieben standen.

Sie brauchten ein **Konto**, denn das Erste, was die Seite tat, war einen Server aufzurufen – und der Server wollte wissen, wer fragt. Sie brauchten eine **GPU**, denn ein Modell auf dem eigenen Rechner auszuführen hieß WebGPU, und einem Laptop ohne passende Grafikkarte wurde höflich nahegelegt, doch die Cloud zu nutzen. Und Sie brauchten ein **Netzwerk**, denn egal, wo Sie hereinkamen: Die Worte, die Sie tippten, gingen irgendwohin.

Keine dieser Bedingungen ist ein Grund, jemanden am Nachdenken zu hindern. Eine Idee um elf Uhr abends, auf einem Arbeitslaptop mit integrierter Grafik, im Zug, ist trotzdem eine Idee. Dieses Release entfernt alle drei Bedingungen und ergänzt, was von Anfang an dazugehört hätte: eine klare Entscheidung darüber, wohin Ihre Worte gehen dürfen.

```bf-figure
{
  "kind": "compare",
  "title": "Was es brauchte, um die erste Frage zu stellen",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Ein Konto anlegen", "Warten, bis der Arbeitsbereich den Server erreicht", "Eine GPU mit WebGPU haben – oder die Cloud nutzen", "Online sein", "Der Voreinstellung vertrauen, wohin Ihre Worte gehen"] },
    { "title": "Jetzt", "hue": "idea", "items": ["Studio oder Rovr öffnen", "Ein Modell auf diesem Gerät antwortet", "Auf der GPU, wenn vorhanden, sonst auf der CPU", "Offline, sobald es heruntergeladen ist", "Nur lokal, Hybrid oder Bestimmtes Modell wählen – und sehen, wann gewechselt wird"] }
  ],
  "caption": "Anmelden lohnt sich weiterhin – Hybrid als Standard, Synchronisierung, verbundene Konten und Erinnerung –, aber es ist jetzt Ihre Entscheidung und keine Schranke vor dem ersten Wort."
}
```

## Eine Frage, auf jeder Oberfläche dieselbe

Öffnen Sie das `/`-Menü im Eingabefeld, wählen Sie **Model (Modell)**, und als Erstes sehen Sie **Modelle ausführen**. Es gibt drei Antworten, und sie bedeuten auf builderforce.ai, in der VS-Code-Erweiterung und im Rovr-Seitenbereich in Chrome dasselbe.

```bf-figure
{
  "kind": "screen",
  "frame": "/-Menü · Modell · Modelle ausführen",
  "ratio": 1.7,
  "regions": [
    { "label": "Nur lokal", "note": "Nur Modelle auf diesem Gerät. Nichts wird an die Cloud gesendet – kein Prompt, keine Live-Verbindung", "x": 3, "y": 8, "w": 94, "h": 22, "hue": "good" },
    { "label": "Hybrid · Empfohlen", "note": "Zuerst dieses Gerät, dann die Cloud, wenn nötig – mit einem Hinweis, wenn das passiert", "x": 3, "y": 36, "w": 94, "h": 22, "hue": "idea" },
    { "label": "Bestimmtes Modell", "note": "Das gewählte Modell läuft immer: ein Cloud-Modell, eines Ihrer verbundenen Konten oder ein lokales Modell", "x": 3, "y": 64, "w": 94, "h": 22, "hue": "make" },
    { "label": "Jederzeit änderbar", "x": 3, "y": 90, "w": 40, "h": 7, "hue": "accent" }
  ],
  "caption": "Drei Antworten statt einer Seite voller Einstellungen. Dieselben drei im Web, in Ihrem Editor und im Browser-Seitenbereich – eine einmal getroffene Wahl bedeutet überall dasselbe."
}
```

**Nur lokal** ist ein Versprechen, keine Vorliebe. In diesem Modus werden Inhaltsanfragen blockiert, bevor sie das Gerät verlassen, und ebenso Live-Verbindungen – die Kanäle, die sonst eine Leinwand synchronisieren oder einen Lauf an einen Server streamen würden. Kann kein Modell auf diesem Gerät antworten, wird Ihnen das gesagt, und Sie bekommen zwei Wege angeboten: eines herunterladen oder zu Hybrid wechseln. Nichts geht still und heimlich in Ihrem Namen in die Cloud.

**Hybrid** ist der Standard, sobald Sie angemeldet sind. Ein Modell auf Ihrem Gerät übernimmt den Zug zuerst; kann es das nicht, übernimmt das kostenlose Cloud-Kontingent; und wenn dieser Wechsel passiert, sehen Sie einen Hinweis – Sie wissen also immer, von welcher Seite der Linie eine Antwort kam.

**Bestimmtes Modell** ist strikt. Sie wählen ein Modell, und genau dieses Modell läuft – kein Ersatz, kein Rückfall, der sich als das Gewünschte ausgibt. Das ist der Modus für einen Vergleich, einen Benchmark oder eine Aufgabe, bei der Sie einfach wissen, welches Modell Sie wollen.

```bf-figure
{
  "kind": "compare",
  "title": "Wohin Ihre Worte gehen können, je nach Modus",
  "columns": [
    { "title": "Nur lokal", "hue": "good", "items": ["Dieses Gerät", "Blockiert: Inhaltsanfragen", "Blockiert: Live-Verbindungen", "Funktioniert offline"] },
    { "title": "Hybrid", "hue": "idea", "items": ["Zuerst dieses Gerät", "Dann das kostenlose Cloud-Kontingent", "Ein Hinweis beim Wechsel", "Lernt, welche Züge lokal bleiben"] },
    { "title": "Bestimmtes Modell", "hue": "make", "items": ["Genau das gewählte Modell", "Cloud, Ihr eigenes Konto oder ein lokales Modell", "Kein stiller Ersatz"] }
  ],
  "caption": "Der Modus ist die Grenze. Alles andere – welches lokale, welches Cloud-Modell – passiert innerhalb dieser Grenze."
}
```

## Kein Konto, kein API-Aufruf

Studio und Rovr starten jetzt **anonym**. Keine Registrierung und kein Aufruf unserer Server, um anzufangen: Die Seite lädt, ein lokales Modell lädt in Ihrem Browser, und Sie arbeiten. Alles, was Sie in diesem Zustand tun, bleibt auf Ihrem Gerät – weil es nirgendwo anders hin kann.

Die Anmeldung fügt hinzu, was tatsächlich ein Konto braucht: Hybrid als Standard, Synchronisierung über Geräte hinweg, verbundene Anbieterkonten und die Erinnerung an das, was Sie bereits getan haben. Wenn Sie die Cloud ohne Konto möchten, aktiviert die Wahl von **Hybrid** als Gast ein kleines Gastkontingent; das ist der einzige Moment, in dem die Worte eines Gastes das Gerät verlassen – und Sie haben ihn gewählt.

Das baut auf [Erst gestalten, dann registrieren](/blog/create-before-you-sign-up) auf der Leinwand auf. Der Unterschied: Das Modell, das Ihnen antwortet, muss nicht mehr woanders wohnen.

## Keine GPU nötig

Das [letzte Release](/blog/models-that-run-on-your-machine) brachte Modelle, die Sie einmal herunterladen und in der GPU Ihres Browsers ausführen – und sagte ehrlich, dass dafür WebGPU nötig ist. Diese Grenze ist gefallen. Die 1-Bit-Modelle von **Bonsai** laufen jetzt auch auf der **CPU**, verteilt auf mehrere Threads, wo der Browser das erlaubt, in einem Hintergrund-Worker, damit die Seite reaktionsfähig bleibt, während das Modell nachdenkt.

```bf-figure
{
  "kind": "flow",
  "title": "Wo ein lokales Modell läuft, je nach Oberfläche",
  "steps": [
    { "label": "builderforce.ai", "note": "Studio und die Leinwand: die GPU, wenn WebGPU verfügbar ist, sonst die CPU, immer in einem Hintergrund-Worker.", "hue": "idea" },
    { "label": "Rovr", "note": "Der Chrome-Seitenbereich führt dieselben Modelle auf dieselbe Weise aus – zuerst die GPU, die CPU, wenn keine da ist.", "hue": "run" },
    { "label": "VS Code", "note": "Die Erweiterung nutzt die GPU des Editor-Panels, wenn es eine hat, und läuft sonst auf der CPU in der Erweiterung selbst.", "hue": "make", "tag": "beide Wege" }
  ],
  "caption": "Dasselbe Modell und dieselbe Auswahl auf allen dreien. Ein Laptop mit integrierter Grafik, ein abgeriegelter Arbeitsrechner und ein virtueller Desktop können jetzt ein Modell ausführen."
}
```

Eine CPU ist langsamer als eine gute GPU; das muss niemand schönreden. Aber ein Modell, das auf dem Rechner, den Sie haben, in ein paar Sekunden antwortet, schlägt eines, das sich auf dem Rechner, den Sie nicht haben, gar nicht erst laden lässt. Für eine Umformulierung, eine Zusammenfassung, eine Frage zu einer Seite oder einen ersten Planentwurf reicht es völlig – und es ist von Grund auf privat.

Wie die Engines im Browser selbst gebaut sind, lesen Sie in [Local-first-KI im Browser, richtig gemacht](/blog/local-first-ai-webgpu-in-the-browser).

## Ein Hybrid, das lernt, welche Züge lokal bleiben

Ein naives „lokal zuerst“ hat offensichtliche Kosten: Jeder Zug, den das lokale Modell nicht bewältigt, ist ein Zug, bei dem Sie warten, bis es scheitert, bevor die Cloud zum Zug kommt. Passiert das oft genug, fühlt sich Hybrid langsamer an als die Cloud allein.

Also lernt Hybrid. Ein kleiner Prädiktor auf Ihrem Gerät beobachtet, wie Ihre eigenen Züge ausgehen – welche das lokale Modell bewältigt hat und welche es weitergereicht hat – und schickt mit der Zeit die Züge, bei denen er ohnehin ein Scheitern erwartet, **direkt in die Cloud**, ohne den Umweg.

```bf-figure
{
  "kind": "flow",
  "title": "Ein Zug im Hybrid-Modus",
  "steps": [
    { "label": "Vorhersagen", "note": "Aus Ihren eigenen Ergebnissen gelernt, auf Ihrem Gerät: Schafft das lokale Modell diesen Zug?", "hue": "prove" },
    { "label": "Lokal", "note": "Wenn ja, antwortet dieses Gerät. Nichts verlässt es.", "hue": "good" },
    { "label": "Kostenlose Cloud", "note": "Wenn nein – oder wenn der lokale Versuch nicht durchkommt –, übernimmt das kostenlose Kontingent.", "hue": "run" },
    { "label": "Hinweis", "note": "Sie sehen den Wechsel, jedes Mal.", "hue": "accent", "tag": "nie still" }
  ],
  "caption": "Der Prädiktor lernt aus dem, was mit Ihren Zügen passiert ist, und bleibt auf Ihrem Gerät. Je länger Sie Hybrid nutzen, desto weniger Züge warten auf einen lokalen Versuch, der nie funktionieren konnte."
}
```

Dahinter stehen zwei kleinere Änderungen. Wenn ein Zug tatsächlich in die Cloud geht, **kommen kostenlose Modelle zuerst, sobald sie einem kostenpflichtigen gleichwertig sind** – eine Kontoeinstellung, abgeleitet davon, ob Sie eigene Anbieterschlüssel verbunden haben, und jederzeit änderbar. Und **Insights** markiert jetzt **Laufanomalien**: Läufe, die weit mehr gekostet, weit länger gedauert oder weit mehr Tool-Fehler hatten als die Läufe davor – damit ein Ausreißer etwas ist, das Sie sehen, und nicht etwas, das Sie auf einer Rechnung finden.

## Wo es in der Methode steht

Arbeit auf Builderforce folgt einem Bogen, **Idee → Machen → Betreiben → Messen → Erreichen**, und die Schleife, die von der Idee ins Machen führt, ist [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop). Lesen und Beweisen sind die beiden Schritte, die nichts kosten sollen – damit die Entscheidung zu bauen eine echte Entscheidung ist.

Dieses Release macht das buchstäblich wahr, und es sitzt ganz am Anfang des Bogens: bei der **Idee**.

```bf-figure
{
  "kind": "flow",
  "title": "Die ersten beiden Schritte, ohne dass etwas im Weg steht",
  "steps": [
    { "label": "Lesen", "note": "Durchdenken Sie die Idee mit einem Modell auf Ihrem eigenen Rechner – ohne Konto, ohne GPU, ohne Netzwerk, ohne Protokoll irgendwo.", "hue": "read", "tag": "Idee" },
    { "label": "Beweisen", "note": "Machen Sie die günstigen Prüfungen lokal; Hybrid schickt nur die Züge in die Cloud, die es brauchen, kostenlose Modelle zuerst.", "hue": "prove", "tag": "Idee" },
    { "label": "Bauen", "note": "Melden Sie sich an, wenn die Arbeit es verdient – Synchronisierung, verbundene Konten und ein dauerhaftes Projekt warten.", "hue": "build", "tag": "Machen" }
  ],
  "caption": "Lesen und Beweisen sollten immer kostenlos sein. Jetzt sind sie frei von Kosten, von Registrierung und von Hardware-Hürden – und Nur lokal macht sie privat per Regel, nicht per Hoffnung."
}
```

Der teuerste Moment eines Projekts ist nicht das Bauen. Es ist die Idee, die nie eine erste Frage bekommen hat, weil diese Frage eine Registrierung, eine GPU oder eine Verbindung gekostet hätte, die jemand nicht hatte. Diese Kosten aus der Ideenphase herauszunehmen bringt mehr Ideen bis zum Beweisen – und lässt die, die nicht gebaut werden sollten, auffliegen, bevor jemand sie baut. Die Laufanomalien in Insights schließen das andere Ende: Die Läufe, die stattfinden, werden gemessen, und Ausreißer kommen zu Ihnen zurück.

## Was Sie heute damit tun können

- **Ohne Konto anfangen.** Öffnen Sie Studio oder Rovr und stellen Sie Ihre erste Frage; ein Modell auf Ihrem Gerät antwortet.
- **Alles auf Ihrem Rechner behalten, per Regel.** Wählen Sie **Nur lokal**, und nichts wird gesendet – weder Ihre Prompts noch eine Live-Verbindung.
- **Ein Modell auf jedem Laptop ausführen.** Keine GPU, kein Problem: Bonsai läuft auf der CPU im Web, in Rovr und in VS Code.
- **Hybrid die Route wählen lassen.** Zuerst lokal, dann die kostenlose Cloud, ein Hinweis beim Wechsel – und mit der Zeit immer weniger verschwendete lokale Versuche.
- **Ein Modell festlegen, wenn es darauf ankommt.** **Bestimmtes Modell** führt genau das aus, was Sie gewählt haben, ohne stillen Ersatz.
- **Teure Läufe erkennen.** Insights markiert Läufe, die bei Kosten, Dauer und Tool-Fehlern weit außerhalb des Normalen liegen.

Öffnen Sie das `/`-Menü, wählen Sie **Model (Modell)** und legen Sie fest, wie es laufen soll.

---

**Weiterlesen:** [Ein Modell auf Ihrem eigenen Rechner ausführen](/blog/models-that-run-on-your-machine) · [Local-first-KI im Browser, richtig gemacht](/blog/local-first-ai-webgpu-in-the-browser) · [Lernen Sie Rovr kennen](/blog/rovr-your-assistant-in-the-browser) · [Erst gestalten, dann registrieren](/blog/create-before-you-sign-up) · [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop)

[Öffnen Sie Studio](/studio) und fragen Sie etwas – ganz ohne Konto.
