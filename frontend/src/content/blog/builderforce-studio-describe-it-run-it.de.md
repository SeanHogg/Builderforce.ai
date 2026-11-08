Sie beschreiben eine kleine App: eine Warteliste-Seite, die Anmeldungen speichert und Ihnen eine E-Mail schickt, sobald sich jemand einträgt. Dreißig Sekunden später gibt es ein Dutzend Dateien, einen Server und ein Formular.

Was danach passiert, ist der entscheidende Teil – und bisher ging er auf eine von drei Arten schief. Das Projekt brauchte einen Server, und die Vorschau konnte keinen ausführen. Der nächste Schritt des Agents zerstörte etwas, das vor einer Minute noch funktionierte, und es gab keinen sauberen Weg zurück. Oder alles funktionierte, und Sie hatten keine Ahnung, wohin die Anmeldungen gehen.

**Builderforce Studio** ist um genau diese drei Momente herum gebaut.

## Ein Fenster, vom Prompt bis zur laufenden App

Öffnen Sie [studio.builderforce.ai](https://studio.builderforce.ai), tippen Sie, was Sie möchten, und Sie befinden sich in einem Workspace mit dem Agent auf der einen und der laufenden App auf der anderen Seite. Für den Einstieg brauchen Sie kein Konto. Die Anmeldung erfolgt bei Bedarf in einem Pop-up, sodass der geschriebene Prompt noch da ist, wenn Sie zurückkommen.

```bf-figure
{
  "kind": "screen",
  "frame": "Ein Studio-Projekt",
  "ratio": 1.62,
  "regions": [
    { "label": "Agent", "note": "Beschreiben Sie die Änderung; jeder Schritt wird zu einer Version", "x": 3, "y": 10, "w": 24, "h": 80, "hue": "idea" },
    { "label": "Vorschau · Code · Datenbank", "note": "Die laufende App, ihr Quellcode und was sie speichert", "x": 29, "y": 10, "w": 46, "h": 62, "hue": "make" },
    { "label": "Terminal · Ausgabe · Probleme", "x": 29, "y": 75, "w": 46, "h": 15, "hue": "run" },
    { "label": "Dateien · Versionen · Veröffentlichen", "x": 77, "y": 10, "w": 20, "h": 80, "hue": "accent" },
    { "label": "Veröffentlichen · GitHub · Teilen", "x": 60, "y": 2, "w": 37, "h": 6, "hue": "accent" }
  ],
  "caption": "Alles, was eine kleine App braucht, in einem Fenster: das Gespräch, das laufende Ergebnis, die Dateien und der Verlauf sowie die Daten."
}
```

## Es läuft – egal, welche Art von App es ist

Vorschauen deckten früher Seiten ab, keine Server. Schrieb der Agent eine Express-API, eine Vue-App oder eine Svelte-App, hatte die Vorschau nichts zu zeigen.

Jetzt läuft alles in Ihrem Browser auf der eigenen Runtime von Builderforce. Die Abhängigkeiten des Projekts werden installiert, sein Server startet, und die Vorschau zeigt seine echten Routen. Vue- und Svelte-Projekte werden genauso in der Vorschau angezeigt und veröffentlicht wie React-Projekte. Das Terminal ist eine echte Shell: `npm install`, `node server.js`, `ls`, `cat`.

```bf-figure
{
  "kind": "flow",
  "title": "Was passiert, wenn Sie auf Ausführen drücken",
  "steps": [
    { "label": "Sofortige Vorschau", "note": "Ein Vite-, React-, Vue-, Svelte- oder statisches Projekt wird direkt aus dem Speicher ausgeliefert, ohne Installationsschritt.", "hue": "make" },
    { "label": "Oder ein eigener Server", "note": "Ein Projekt mit Node-Server führt npm install und npm run dev aus, und die Vorschau folgt dem Port, den es öffnet.", "hue": "make" },
    { "label": "Änderungen erscheinen live", "note": "Jede Änderung, ob von Ihnen oder vom Agent, lädt die Vorschau neu.", "hue": "run", "tag": "im Browser" }
  ],
  "caption": "Keine abgerechnete Session, keine Cloud-Maschine, auf die man warten muss. Der Code läuft auf einer separaten Vorschau-Domain und teilt daher nie Ihre Builderforce-Anmeldung."
}
```

Auch das Veröffentlichen baut die Website im Browser, mit gehashten Assets und relativer Basis, bereit zur Auslieferung unter Ihrer Subdomain. Prüfen führt eine Typprüfung des Projekts durch und baut es. Alles, was fehlschlägt, geht samt Fehlermeldung an den Agent, sodass ein defekter Build repariert wird, statt fertig auszusehen und einfach dazuliegen.

## Jeder Schritt ist eine Version

Wenn der Agent einen Schritt abschließt, werden die Dateien, die er angefasst hat, zu einer Version: *App.tsx, Header.tsx und 2 weitere geändert*. Sie können selbst eine benennen, bevor Sie etwas Riskantes versuchen. Das Wiederherstellen dauert zwei Klicks und sichert zuvor Ihren aktuellen Stand, sodass sich auch eine Wiederherstellung rückgängig machen lässt.

```bf-figure
{
  "kind": "compare",
  "title": "Wenn der nächste Schritt kaputt macht, was funktioniert hat",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Den Agent bitten, es rückgängig zu machen", "Hoffen, dass er sich erinnert, was „es“ war", "Dateien per Augenmaß vergleichen", "Die gute Änderung zusammen mit der schlechten verlieren"] },
    { "title": "In Studio", "hue": "make", "items": ["Versionen öffnen", "Den Schritt vor dem Fehler auswählen", "Wiederherstellen – der aktuelle Stand wird zuvor gesichert", "Von dort aus weitermachen"] }
  ],
  "caption": "Versionen werden aufgezeichnet, während der Agent arbeitet – Sie müssen nicht daran denken, zu speichern."
}
```

## Die Daten der App haben einen Platz

Eine veröffentlichte App behält, was Menschen ihr schicken. Die Ansicht **Datenbank** liegt neben Vorschau und Code:

- **Tabellen.** Jede Sammlung, in die die App schreibt, mit ihren Zeilen, ihrem Endpunkt und ihren Schaltern: für jede Einsendung ein Ticket öffnen, angemeldeten Nutzern erlauben, ihre eigenen Zeilen zurückzulesen. Fügen Sie eine Tabelle hinzu, löschen Sie eine Zeile oder löschen Sie eine Tabelle.
- **Nutzer.** Alle, die sich bei Ihrer App angemeldet haben. Sie melden sich per Einmalcode per E-Mail an, sodass keine Passwörter zu verwalten sind. Sperren Sie jemanden, wodurch er überall abgemeldet wird, oder entfernen Sie ihn.
- **Server-Funktionen.** Die Backend-Handler der App und die Secrets, die sie verwenden. Diese funktionieren schon vor dem Veröffentlichen.

Vor der ersten Veröffentlichung weist die Ansicht darauf hin und öffnet Veröffentlichen. Danach füllt sich alles von selbst.

## Wo es in der Methode steht

Die Arbeit bei Builderforce folgt einem Bogen – **Idee → Machen → Betreiben → Messen** – und jeder Akt durchläuft dieselbe innere Schleife: [Lesen, Belegen, Bauen](/blog/read-prove-build-the-inner-loop).

Studio ist der Akt **Machen**, kurz gemacht. Eine Idee wird in dem Fenster zur laufenden App, in dem Sie sie beschrieben haben, und **Bauen** ist nicht länger der Schritt, an dem Aufmerksamkeit verloren geht: kein Terminal woanders, kein Deploy, auf das man wartet, kein zweiter Tab.

Versionen halten **Bauen** ehrlich. Wenn der Agent etwas ausprobiert, sehen Sie das Ergebnis in der Vorschau, und wenn es falsch ist, gehen Sie einen Schritt zurück. Ausprobieren kostet nichts – so sollte sich eine Schleife anfühlen.

Die Datenbank-Ansicht ist der Ort, an dem **Betreiben** beginnt. Sobald die App live ist, befinden sich die Menschen, die sie nutzen, und das, was sie senden, auf demselben Bildschirm wie der Code, der sie bedient. Das sind auch die ersten Belege, mit denen **Messen** arbeiten kann: wer sich angemeldet hat und was angefragt wurde.

## Was Sie heute damit tun können

- **Von einem Prompt zu einer laufenden App kommen**, Server inklusive, ohne etwas zu installieren.
- **Jeden Agent-Schritt rückgängig machen** – mit zwei Klicks – und die wichtigen Versionen benennen.
- **Die Daten und Nutzer Ihrer App sehen und verwalten**, direkt neben ihrem Code.
- **Veröffentlichen** unter Ihrer eigenen Subdomain oder per Push zu GitHub, direkt aus der Kopfzeile.

Dev-Server von Next.js, Nuxt und SvelteKit laufen noch nicht im Browser; bei diesen sagt Ihnen Ausführen, warum, statt stillschweigend zu scheitern.
