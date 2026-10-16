Der größte Teil eines Arbeitstages findet nicht in einem Editor oder auf einem Canvas statt. Er findet in Browser-Tabs statt: die Spesenabrechnung, das Lieferantenportal, die Buchung, die zwölf Seiten, die Sie überfliegen, um eine Entscheidung zu treffen, das Formular, das Sie diesen Monat zum vierten Mal ausfüllen.

Der Agent von Builderforce konnte in VS Code Code schreiben und auf einem Board bauen. Im Browser konnte er gar nichts. Sie haben Text aus einer Seite kopiert, ihn in einen Chat eingefügt, die Antwort gelesen und sind zurückgegangen, um selbst zu klicken. Der Assistent wusste sehr viel und konnte dort, wo die Arbeit tatsächlich lag, keinen Finger rühren.

Genau diese Lücke schließt Rovr.

## Was Rovr ist

Rovr ist der eigene Assistent von Builderforce für den Browser – eine Chrome-Erweiterung, die sich als Seitenleiste neben der Seite öffnet, auf der Sie gerade sind. Sie sagen ihm, was Sie brauchen. Es liest die Seite, findet die richtigen Felder und Schaltflächen, füllt aus, wechselt zwischen Tabs und erledigt die Aufgabe Schritt für Schritt – und sagt Ihnen dabei, was es getan hat.

```bf-figure
{
  "kind": "screen",
  "frame": "Chrome mit Rovr neben der Seite",
  "ratio": 1.6,
  "regions": [
    { "label": "Die Seite, an der Sie arbeiten", "note": "Rovr liest und bedient sie – nur auf Websites, die Sie erlaubt haben", "x": 3, "y": 8, "w": 62, "h": 86, "hue": "run" },
    { "label": "Unterhaltung", "note": "Sie fragen; Rovr antwortet und handelt", "x": 68, "y": 8, "w": 29, "h": 44, "hue": "idea" },
    { "label": "Bestätigungskarte", "note": "Absenden, kaufen, senden, Passwort: Sie sagen Ja", "x": 68, "y": 55, "w": 29, "h": 16, "hue": "accent" },
    { "label": "Aktionen · Aufgaben · Playbooks", "x": 68, "y": 74, "w": 29, "h": 20, "hue": "measure" }
  ],
  "caption": "Eine Seitenleiste neben der Seite statt darüber. Die Unterhaltung, das Protokoll dessen, was Rovr getan hat, und die entstandenen Aufgaben liegen am selben Ort."
}
```

Drei Dinge unterscheiden Rovr von einem Chatfenster, das zufällig neben einem Browser steht.

**Es protokolliert jede Aktion.** Jede Seite, die es liest, jeder Klick, jedes ausgefüllte Feld und jeder Schritt, den Sie abgelehnt haben, landet in einem Aktionsprotokoll: was es getan hat, auf welcher Seite und mit welchem Ergebnis. Sie können jederzeit darin zurückblättern, und es reist mit dem Chat – das Protokoll, das Sie im Browser sehen, ist dasselbe, das Ihr Team in Builderforce sieht.

**Sie können ihm sagen, wie Dinge erledigt werden.** Playbooks sind Anweisungen in Ihren eigenen Worten – *wenn ich „meine Spesen einreichen“ sage, öffne die Spesen-Website, füge jeden Beleg aus meinem Posteingang hinzu und halte vor dem Absenden an.* Passt eine Anfrage, folgt Rovr Ihren Schritten, statt zu improvisieren. Playbooks werden über Ihr Chrome-Profil synchronisiert und begleiten Sie in jeden Browser, in dem Sie angemeldet sind.

**Es fragt, bevor etwas Wichtiges passiert.** Rovr arbeitet nur auf Websites, die Sie erlaubt haben, und fragt, wenn es zum ersten Mal eine neue braucht. Alles, was ein Formular absendet, etwas kauft, eine Nachricht sendet oder veröffentlicht, etwas löscht oder ein Passwort oder eine Kartennummer berührt, wartet auf Ihr Ja in der Seitenleiste. Seiteninhalte gelten als Information, nie als Anweisung: Eine Webseite, die Rovr auffordert, Sie zu ignorieren, ist nur eine Webseite, die etwas Seltsames sagt.

## Standardmäßig privat, online wenn es hilft

Rovr führt sein Modell zuerst auf Ihrem eigenen Computer aus. Wenn Synapse, Ollama oder FreeToken läuft, gehen Ihre Anfragen dorthin: kein Konto nötig, kein Zähler, nichts verlässt Ihren Rechner. Braucht ein Schritt mehr, als Ihr lokales Modell leisten kann – etwa eine lange Aufgabe mit vielen Werkzeugen –, übergibt Rovr diesen Schritt unsichtbar an die Cloud-Modelle von Builderforce, bevor Sie ein Wort der Antwort gesehen haben.

```bf-figure
{
  "kind": "flow",
  "title": "Wo ein Rovr-Schritt läuft",
  "steps": [
    { "label": "Auf diesem Gerät", "note": "Ein geeignetes lokales Modell übernimmt zuerst. Privat, kostenlos und offline verfügbar.", "hue": "run", "tag": "zuerst" },
    { "label": "Builderforce-Cloud", "note": "Passt nichts Lokales oder scheitert das lokale Modell vor der Antwort, wechselt der Schritt in die Cloud.", "hue": "make" },
    { "label": "Ihr Workspace", "note": "Der Chat, jede protokollierte Aktion und die entstandenen Aufgaben werden mit Builderforce synchronisiert, sobald Sie online sind.", "hue": "measure", "tag": "später ist in Ordnung" }
  ],
  "caption": "Die Entscheidung fällt pro Schritt: Eine Aufgabe kann ihre einfachen Schritte auf Ihrem Rechner beantworten und nur die schweren in die Cloud schicken."
}
```

Und Rovr funktioniert offline. Starten Sie einen Chat im Zug ohne Netz, arbeitet es mit Ihrem lokalen Modell weiter; die Unterhaltung, ihre Aktionen und Aufgaben werden auf Ihrem Gerät gespeichert und eingereiht. Kommt die Verbindung zurück, werden sie der Reihe nach mit Ihrem Workspace synchronisiert – jede genau einmal.

## Aufgaben, die dort landen, wo Ihr Team sie sieht

Wenn Sie Rovr bitten, sich etwas zu merken – *am Freitag beim Vermieter nachhaken*, *die Domain verlängern, bevor sie ausläuft* – oder eine Aufgabe Folgearbeit ergibt, legt es eine Aufgabe im Chat an. Wählen Sie in den Einstellungen ein Projekt, und jede Aufgabe wird in diesem Projekt angelegt und mit der Unterhaltung verknüpft, aus der sie entstanden ist – wer sie übernimmt, sieht genau, woher sie kommt.

```bf-figure
{
  "kind": "compare",
  "title": "Ein Browser-Agent in fremder Cloud – und Rovr",
  "columns": [
    { "title": "Ein entfernter Browser-Agent", "hue": "muted", "items": ["Läuft in einem Browser auf dem Server eines anderen", "Ihre Seiten und Anmeldungen wandern dorthin", "Hört auf, wenn Sie offline sind", "Was er getan hat, liegt in seinem eigenen Verlauf"] },
    { "title": "Rovr", "hue": "run", "items": ["Läuft in Ihrem eigenen Chrome, mit Ihren eigenen Sitzungen", "Zuerst auf Ihrem Rechner; die Cloud nur bei Bedarf", "Arbeitet offline weiter und synchronisiert später", "Jede Aktion protokolliert, mit Ihrem Chat synchronisiert, Aufgaben in Ihren Projekten"] }
  ],
  "caption": "Rovr handelt in dem Browser, in dem Sie bereits angemeldet sind, auf den Websites, die Sie erlauben. Nichts von Ihren Anmeldungen verlässt den Rechner."
}
```

## Wo es in der Methode sitzt

Arbeit auf Builderforce folgt einem Bogen, **Idee → Machen → Betreiben → Messen**, mit derselben inneren Schleife in jedem Akt: [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop). Rovr bringt diese Schleife in den Tab, in dem Sie ohnehin sind.

- **Idee** beginnt dort, wo Ihnen etwas auffällt. Fragen Sie Rovr zur Seite vor Ihnen, und die Frage wird zu einem Chat – mit der Seite als Beleg.
- **Lesen** ist das Erste, was Rovr bei jeder Aufgabe tut: Es sieht sich die Seite an, bevor es sie berührt, und rät nie bei einer Schaltfläche, die es nicht gesehen hat.
- **Beweisen** ist die Bestätigungskarte. Vor allem, was Folgen hat, sehen Sie, was Rovr gleich tun wird und warum es fragt.
- **Betreiben** ist die Aufgabe selbst, Schritt für Schritt ausgeführt, zuerst auf Ihrem Rechner.
- **Messen** sind das Aktionsprotokoll und die Aufgaben. Was passiert ist, wird festgehalten und synchronisiert, sodass der nächste Durchlauf – Ihrer oder der eines Kollegen – dort beginnt, wo dieser aufgehört hat.

## Was Sie heute damit tun können

- **Eine Aufgabe auf einer Website erledigen, ohne selbst zu klicken** – ein Formular ausfüllen, Zahlen von drei Seiten sammeln, die Einstellung finden, die vier Menüs tief versteckt ist.
- **Einmal aufschreiben, wie Sie Dinge erledigt haben möchten** – als Playbook – und Rovr folgt dem jedes Mal.
- **Ohne Verbindung weiterarbeiten** mit einem Modell auf Ihrem eigenen Computer und den Chat synchronisieren lassen, sobald Sie wieder online sind.
- **Aus einer Unterhaltung verfolgte Arbeit machen** – Aufgaben, die Rovr anlegt, landen in Ihrem Projekt, verknüpft mit dem Chat, der sie erzeugt hat.
- **Genau sehen, was passiert ist** – jede Aktion, auf jeder Seite, in der richtigen Reihenfolge, im Browser und in Builderforce.

Fügen Sie Rovr zu Chrome hinzu, melden Sie sich mit Ihrem Builderforce-Konto an (oder lassen Sie es und arbeiten Sie komplett auf Ihrem eigenen Rechner), erlauben Sie eine Website und fragen Sie.

---

**Weiterlesen:** [Local-first-KI mit WebGPU im Browser](/blog/local-first-ai-webgpu-in-the-browser) · [Open Source bei Builderforce](/blog/open-source-at-builderforce) · [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop)
