Sie können eine Idee auf einen Canvas bringen, sie zu Objekten ausdiskutieren, das Ding bauen, es als Unternehmen betreiben und ablesen, ob es funktioniert hat. Dann muss es jemand kaufen.

Bis diese Woche hatte die linke Leiste darauf eine ehrliche Antwort – für genau eine Art von Konto. Der **Sales Hub** – Pipeline, Kampagnen, Wochenziele, Berichte, Auszahlungen, das Vertriebskit – war eine Zeile, die Sie nur sahen, wenn Sie sich als Vertriebspartner von Builderforce registriert hatten. Alle anderen, auch jede Gründerin und jeder Gründer, die gerade etwas auf der Plattform ausgeliefert hatten, bekamen eine Leiste mit *Idee · Bauen · Betreiben · Messen*, danach ein Marktplatz-Angebot in die Hand gedrückt und viel Glück gewünscht.

Das ist keine fehlende Funktion. Es ist eine fertige Funktion hinter der falschen Tür.

## Was den Zugang tatsächlich versperrt hat

Eine Zeile. Der Dienst, der die Frage beantwortet, *wessen Vertriebs-Workspace das ist*, verlangte einen Kontotyp, bevor er einer Person ihren eigenen aushändigte:

```
if (requested === current.id) return current.accountType === 'sales' ? { … } : null;
```

Jede Zeile, die der Hub berührt – Kontakte, Kampagnen, Ziele, Empfehlungen, Provisionsregeln –, ist bereits über `ownerUserId` zugeordnet. Zwischen Konten wurde nie etwas geteilt. Die Prüfung schützte niemandes Daten; sie entschied, wer eine eigene Pipeline haben durfte. Die Öffnung war also das Entfernen einer Schranke, nicht die Ausweitung eines Geltungsbereichs – und der kontoübergreifende Lesezugriff blieb exakt so eng wie zuvor: Ein Superadmin kann weiterhin nur den Workspace eines Plattform-Vertriebspartners öffnen, niemals die private Pipeline eines Kunden.

```bf-figure
{
  "kind": "compare",
  "title": "Derselbe Hub, zwei Nutzergruppen",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": [
      "Vertriebspartner, die Builderforce selbst verkaufen",
      "Ein Superadmin, der die Zahlen eines Vertriebspartners liest",
      "Alle anderen: keine Zeile, keine Pipeline, kein Empfehlungslink"
    ] },
    { "title": "Jetzt", "hue": "reach", "items": [
      "Jedes Konto, in seinem eigenen Workspace",
      "Ein Superadmin, der die Zahlen eines Vertriebspartners liest – unverändert",
      "Ein Hub, eine Definition der Conversion-Rate, ein Bericht"
    ] }
  ],
  "caption": "Ein zweiter Hub für Gründer wäre eine zweite Definition von „gewonnen“ gewesen, die nur darauf wartet, der ersten zu widersprechen."
}
```

## Was Sie beim ersten Öffnen bekommen

Sechs Unteransichten, allesamt längst tragfähig, weil Vertriebspartner ihr Geschäft schon damit betreiben:

```bf-figure
{
  "kind": "stack",
  "title": "Sales Hub",
  "bands": [
    { "label": "Überblick", "note": "Wochenziele im Abgleich mit dem, was tatsächlich passiert ist – Ansprachen, Kontakte, Termine.", "hue": "reach" },
    { "label": "Leads", "note": "Die Pipeline. Sieben Phasen, ein Deal-Wert, eine Wahrscheinlichkeit, ein erwartetes Abschlussdatum.", "hue": "reach" },
    { "label": "Berichte", "note": "Anmeldungen, Conversions, konvertierter Umsatz, verdiente Provision – ein Bericht, egal wer ihn liest.", "hue": "measure" },
    { "label": "Auszahlungen", "note": "Verdient im Vertriebsbereich, ausgezahlt aus dem Hauptbuch – verfügbar ist die Rechnung dazwischen.", "hue": "run" },
    { "label": "Posteingang", "note": "Das verbundene Postfach, direkt neben der Pipeline, die es bearbeitet.", "hue": "reach" },
    { "label": "Vertriebskit", "note": "Die Unterlagen – und der Empfehlungslink, der Ihnen eine Anmeldung zuordnet.", "hue": "reach" }
  ],
  "caption": "Nichts davon ist neuer Code. Es ist derselbe Hub, auf dem das Vertriebspartnerprogramm von Builderforce lief – jetzt im Besitz der Person, die ihn gerade ansieht."
}
```

Die kommerziellen *Objekte* – Angebote, die sich annehmen lassen, Sequenzen, die bei einer Antwort stoppen, Testphasen mit vorab vereinbarten Kriterien, gemeinsame Aktionspläne – leben seit August auf dem Canvas, und dort bleiben sie auch. Das hier ist die andere Hälfte desselben Arguments: Auf dem Canvas bearbeiten Sie einen bestimmten Deal, im Hub lesen Sie die Gestalt aller Deals auf einmal ab.

## Wo das in der Methode steht

Reichweite. Und Reichweite ist jetzt eine Stufe kürzer auszusprechen.

```bf-figure
{
  "kind": "screen",
  "frame": "Die linke Leiste",
  "ratio": 1.05,
  "regions": [
    { "label": "Idee", "note": "Canvas", "x": 4, "y": 8, "w": 92, "h": 12, "hue": "idea" },
    { "label": "Bauen", "note": "Projekte, Workforce, Qualität, Zuverlässigkeit, Wissen", "x": 4, "y": 22, "w": 92, "h": 12, "hue": "make" },
    { "label": "Betreiben", "note": "Die neun Geschäftsbereiche", "x": 4, "y": 36, "w": 92, "h": 12, "hue": "run" },
    { "label": "Messen", "note": "Erkenntnisse", "x": 4, "y": 50, "w": 92, "h": 12, "hue": "measure" },
    { "label": "Reichweite", "note": "Marktplatz · Entwickler · Sales Hub", "x": 4, "y": 64, "w": 92, "h": 16, "hue": "reach" },
    { "label": "Erweitern", "note": "Entfernt – eine Überschrift über einer einzigen Zeile", "x": 4, "y": 82, "w": 92, "h": 10, "hue": "muted", "style": "ghost" }
  ],
  "caption": "Eine Überschrift mit einem einzigen Link darunter ist ein Etikett, keine Informationsarchitektur."
}
```

Die Leiste hatte früher eine sechste produktive Stufe namens **Erweitern**, und ihr gesamter Inhalt war das Vertriebsprogramm. Die Unterscheidung, die sie traf, war auf dem Papier durchaus real – *Reichweite* heißt, das Produkt vor Menschen zu bringen, *Erweitern* heißt, das Geschäft darauf aufzubauen –, und sie kostete jeden ein weiteres Wort Lesen, bevor er irgendetwas fand.

Außerdem hört diese Unterscheidung in dem Moment auf zu stimmen, in dem eine Gründerin statt eines Vertriebspartners davorsteht. Verkaufen, was man gebaut hat, und dafür gefunden werden sind derselbe Akt in unterschiedlicher Lautstärke. Also hat Reichweite das Erweitern aufgenommen, die Frage des Bogens ist ein wenig länger geworden – *verkaufen, gefunden werden, wachsen* –, und die ganze Methode passt wieder in fünf Wörter. Das ist die Zahl, die ein Mensch wiederholen kann, nachdem er die Leiste ein einziges Mal gelesen hat.

Das ist der Maßstab, an dem sich diese Navigation schon immer messen lassen musste. Das Menü ist die Methode; wenn Sie die Methode nicht aussprechen können, funktioniert das Menü nicht mehr.

## Das Dogfooding-Argument, klar ausgesprochen

Builderforce verkauft seinen eigenen Vertriebspartnern ein Vertriebsprogramm. Es wäre ein seltsames Produkt, das eines verkauft und es den Menschen vorenthält, die darauf Unternehmen aufbauen – und ein noch seltsameres, das ein CRM ausliefert, monatelang den eigenen Umsatz darüber abwickelt und seine Kunden dann bittet, sich ein anderes zu kaufen.

Jede Fähigkeit dieser Plattform ist eine, die die Gründerin, die sie nutzt, irgendwann brauchen wird. Diese hier braucht sie an dem Tag, an dem das, was sie gebaut hat, funktioniert.
