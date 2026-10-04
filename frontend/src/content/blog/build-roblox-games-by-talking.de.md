Eine Dreizehnjährige mit einer Idee für ein Roblox-Spiel hat zwei Probleme, und nur eines davon heißt Luau.

Das erste ist die Sprache. Roblox-Spiele sind Lua-Skripte, die über die Grenze zwischen Client und Server miteinander reden, und der Weg von „ich will ein Obby, in dem die Plattformen verschwinden“ bis zu funktionierenden `RemoteEvent`s ist weit. KI-Tools für Roblox gibt es, um diese Lücke zu schließen, und meistens klappt das.

Das zweite Problem ist alles rund um die KI. Die heutigen Tools verlangen von jungen Creatorn, eine App herunterzuladen, ein Studio-Plugin zu installieren, einen lokalen Server zu starten, ein Sync-Tool anzuschließen und alle vier am Laufen zu halten: dreißig Minuten bis eine Stunde vor dem ersten Prompt. Danach berechnen sie jeden Versuch, auch die fehlgeschlagenen, und schreiben das, was das Modell geliefert hat, direkt in ein Spiel, das andere Kinder spielen werden.

**Spawn** löst das zweite Problem, damit das erste gelöst wird.

## Eine Sache installieren, dann einfach reden

```bf-figure
{
  "kind": "flow",
  "title": "Von der Installation zum spielbaren Spiel",
  "steps": [
    { "label": "Spawn installieren", "note": "Einmal im Browser anmelden. Spawn schreibt sein Roblox-Studio-Plugin selbst. Kein Besuch im Creator Store, kein Server zum Starten.", "hue": "idea" },
    { "label": "Sagen, was gebaut werden soll", "note": "Spawn liest den geöffneten Ort (Explorer und Skripte), damit Neues zum Vorhandenen passt.", "hue": "make" },
    { "label": "Auf Play drücken", "note": "Fehler aus dem Test gehen zurück an Spawn, und ein Klick bittet es, sie zu beheben.", "hue": "run", "tag": "in Studio" }
  ],
  "caption": "Die App ist die Brücke. Man installiert eine Sache, öffnet Studio und fängt an zu schreiben."
}
```

Die Spawn-App läuft neben Roblox Studio. Beim Start schreibt sie das Spawn-Plugin in den Plugin-Ordner von Studio, mit einem privaten Schlüssel, den nur diese App kennt. Wenn Studio startet, findet das Plugin die App auf demselben Computer und verbindet sich. Kein Rojo-Projekt einzurichten, kein Port zu öffnen, nichts von außerhalb des Rechners erreichbar.

```bf-figure
{
  "kind": "screen",
  "frame": "Spawn neben Roblox Studio",
  "ratio": 1.62,
  "regions": [
    { "label": "Die Unterhaltung", "note": "Sag es mit deinen Worten; Startideen: Obby, Tycoon, Simulator, Rennen, Tower Defense", "x": 4, "y": 10, "w": 40, "h": 70, "hue": "idea" },
    { "label": "Studio-Verbindung und Tokens", "x": 4, "y": 2, "w": 40, "h": 6, "hue": "accent" },
    { "label": "Roblox Studio", "note": "Der Build kommt als echte Teile und Skripte an, ein Rückgängig-Schritt pro Build", "x": 48, "y": 2, "w": 48, "h": 78, "hue": "make" },
    { "label": "Fehler aus meinem Test beheben", "x": 4, "y": 84, "w": 92, "h": 10, "hue": "run" }
  ],
  "caption": "Jeder Build ist etwas, das du im Viewport siehst und im Explorer liest, und dann behältst oder rückgängig machst."
}
```

## Was ein Build eigentlich ist

Spawn tippt nie in Studio. Jeder Build kommt als kurze Liste von Operationen zurück: *erstelle dieses Skript*, *setz dieses Teil mit diesen Eigenschaften hierhin*, *entferne das*. Das Plugin wendet die ganze Liste in einem einzigen Rückgängig-Schritt von Studio an. Gefällt dir ein Build nicht, nimmt Strg+Z alles auf einmal zurück.

Bevor eine Operation dein Spiel erreicht, passiert sie eine Sicherheitsprüfung, und die ist streng bei dem, was in Spielen, die Kinder für Kinder bauen, am meisten zählt:

- **Keine Hintertüren.** Skripte, die ins Internet gehen (`HttpService`), versteckten Code ausführen (`loadstring`, `getfenv`) oder Code per Asset-ID laden (`require(12345)`), werden abgelehnt. Genau mit diesen Tricks übernehmen „Gratis-Modelle“ Roblox-Spiele.
- **Nichts, was du nicht siehst.** Spawn baut aus Teilen, Farben, Materialien, Lichtern, Partikeln und Oberflächen. Es lädt nie ein Bild, einen Sound oder ein Mesh per ID, das du nicht gesehen hast.
- **Passend ab 13.** Der Baukasten hält sich an die Roblox-Community-Standards. Fragst du nach etwas, das die Grenze überschreitet, sagt Spawn das freundlich und schlägt eine Version vor, die okay ist. Diese Antwort kostet nichts.

## Du zahlst nur für Builds, die funktionieren

```bf-figure
{
  "kind": "compare",
  "title": "Wohin das Geld geht",
  "columns": [
    { "title": "Typisches Roblox-KI-Tool", "hue": "muted", "items": ["Lange Einrichtung vor dem ersten Prompt", "Jeder Versuch kostet, auch Fehlschläge", "Modell-Output geht direkt ins Spiel", "Keine Altersgrenze"] },
    { "title": "Spawn", "hue": "make", "items": ["Installiert sein Studio-Plugin selbst", "Fehlgeschlagene oder abgelehnte Builds sind kostenlos", "Jede Operation durchläuft eine Sicherheitsprüfung", "Ab 13, mit einmaliger Altersabfrage"] }
  ],
  "caption": "Ein Build kostet die Tokens, die er wirklich verbraucht hat, und nur dann, wenn er dein Spiel verändert hat."
}
```

Die Spawn-Mitgliedschaft kostet **1,99 $ im Monat**. Gebaut wird mit Tokens, die es in Paketen zu **10, 20, 50 oder 100 $** gibt, und größere Pakete enthalten Bonus-Tokens. Ein typischer Build braucht etwa zwölftausend Tokens, ein 10-$-Paket reicht also für rund achtzig Builds. Das Guthaben ist in der App immer sichtbar. Wenn ein Build fehlschlägt, nicht lesbar ist oder alle seine Änderungen abgelehnt wurden, bleibt das Guthaben unangetastet.

Gekauft wird auf der Website über den Stripe-Checkout, nie in der App. Das ist Absicht: Wer bezahlt, oft ein Elternteil, entscheidet über jede Aufladung.

## Wo es in der Methode steht

Jedes Builderforce-Produkt folgt demselben Bogen: **Idee → Machen → Ausführen → Messen**, mit [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop) als innerer Schleife. Spawn ist dieser Bogen, klein genug für ein erstes Spiel.

**Machen** ist der Build: ein Satz hinein, Teile und Skripte heraus, in dem Ort, den du schon geöffnet hast. **Ausführen** ist der Play-Knopf in Studio, und genau bei diesem Schritt lassen dich die meisten KI-Tools allein. Spawn hört die Ausgabe des Tests mit, sodass aus einem Skript, das in Zeile 40 abstürzt, ein „Beheben“-Knopf wird statt eines Rätsels. **Messen** ist das, was junge Creator am besten können: spielen, merken, was langweilig ist, und nach dem Nächsten fragen. Die Schleife von *Idee* bis *etwas, auf das ich springen kann* dauert eine Minute, und jede Runde zeigt, was das Luau tut, weil die Skripte ordentlich und klar benannt sind, damit man sie lesen kann.

## Loslegen

1. Geh auf [spawn.builderforce.ai](/spawn) und lege dein Konto an (frag deine Eltern).
2. Tritt für 1,99 $ im Monat bei und hol dir ein Token-Paket.
3. Lade die Spawn-App herunter, melde dich an, öffne Roblox Studio und schreib, was du bauen willst.

*Spawn wird von Builderforce.ai entwickelt und ist weder mit der Roblox Corporation verbunden noch von ihr unterstützt.*
