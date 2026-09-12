Öffnen Sie Builderforce.ai ohne Anmeldung und teilen Sie ein Board – dann funktioniert es so, wie Teilen überall sonst funktioniert: ein Link, ein Kopieren-Button, abschicken an wen Sie wollen. Die Person öffnet ihn, ist auf Ihrem Board, und Sie beide bearbeiten es gemeinsam.

Nach der Registrierung war damit Schluss.

Dasselbe Panel wurde auf einem Board, das Sie extra gespeichert hatten, zu einem Adressfeld. E-Mail eintippen. Wir verschicken ein Einmal-Token. Die empfangende Person muss sich **mit genau dieser Adresse** anmelden, bevor sie überhaupt etwas sieht – sie braucht also ein Konto, muss im richtigen Postfach nachgesehen haben, und wenn sie sich mit ihrer privaten Adresse registriert hat statt mit der geschäftlichen, die Sie eingetippt haben, schickt der Link sie wieder weg.

Das Teilen im Produkt wurde ausgerechnet an dem Übergang schlechter, für den das Produkt alles aufbietet.

## Jeder gespeicherte Canvas kann jetzt einen Link erzeugen

```bf-figure
{
  "kind": "flow",
  "title": "Vom Board zur nächsten Person darauf",
  "steps": [
    { "label": "Erstellen", "note": "Öffnen Sie auf einem gespeicherten Canvas das Einladungs-Panel, wählen Sie Ansehen, Kommentieren oder Bearbeiten und erhalten Sie eine URL.", "hue": "idea" },
    { "label": "Senden", "note": "Auf jedem Weg, auf dem Sie ohnehin Dinge verschicken. Es ist ein Link – ein Chatfenster, eine Nachricht, eine Kalendereinladung.", "hue": "make" },
    { "label": "Beitreten", "note": "Die Person erfährt, um welches Board es geht und was sie darauf tun darf, und wählt dann: per Name beitreten, anmelden oder ein Konto anlegen.", "hue": "run", "tag": "keine Registrierung nötig" }
  ],
  "caption": "Die E-Mail-Einladung ist nicht verschwunden. Beide Wege liegen im selben Panel, denn welcher passt, hängt davon ab, ob Sie die E-Mail-Adresse der Person kennen oder nur ein Chatfenster offen haben."
}
```

Das Adressfeld gibt es weiterhin, und für den Fall, für den es gebaut wurde, ist es nach wie vor richtig: jemand, den Sie ins Team holen und dessen Postfach Sie kennen. Ein Link ist für den anderen Fall – und das ist der häufigste: die Person, die gerade mit Ihnen im Call ist, der Kunde im Chatverlauf, die Freundin, deren zweite Meinung Sie noch vor dem Mittagessen hören wollen.

```bf-figure
{
  "kind": "screen",
  "frame": "Das Einladungs-Panel auf einem gespeicherten Canvas",
  "ratio": 1.5,
  "regions": [
    { "label": "Per Link einladen", "note": "Zugriff wählen, Link erstellen, kopieren. Er wird nur einmal angezeigt – gespeichert wird nur sein Hash.", "x": 6, "y": 10, "w": 88, "h": 30, "hue": "idea" },
    { "label": "Per E-Mail einladen", "note": "Unverändert. Für die Person, deren Postfach Sie kennen.", "x": 6, "y": 44, "w": 88, "h": 20, "hue": "make" },
    { "label": "Mitglieder und ausstehende Einladungen", "x": 6, "y": 68, "w": 88, "h": 16, "hue": "run" },
    { "label": "Aktive Links · widerrufen", "note": "Jeder Link, den Sie erstellt haben, was er gewährt und wie oft er genutzt wurde", "x": 6, "y": 86, "w": 88, "h": 10, "hue": "accent" }
  ],
  "caption": "Ein Panel, beide Wege. Die Liste der aktiven Links enthält bewusst keine URLs: Gespeichert wird nur ein Hash, also wird ein geleakter Link widerrufen und neu erzeugt, statt erneut ausgelesen zu werden."
}
```

## Wer den Link öffnet, braucht kein Konto

Das ist der entscheidende Teil – und der, den der alte Ablauf überhaupt nicht konnte.

Öffnen Sie den Link, und Sie erfahren, zu welchem Board Sie eingeladen wurden und was genau Sie darauf tun dürfen – ansehen, kommentieren oder bearbeiten –, bevor irgendetwas beansprucht wird. Dann haben Sie drei Möglichkeiten, und die erste lautet *Ohne Konto beitreten*. Namen eintippen. Sie sind auf dem Board.

Keine Vorschau des Boards. **Das Board.** Ihr Cursor ist darauf, Ihre Änderungen werden gespeichert, Ihre Kommentare tragen Ihren Namen, und wer Sie eingeladen hat, sieht Sie ankommen wie jeden anderen Mitwirkenden. Nichts wird zurückgehalten, und nichts ist eine Demo.

```bf-figure
{
  "kind": "compare",
  "title": "Was es braucht, um sich das Board eines anderen anzusehen",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Nach Ihrer E-Mail-Adresse gefragt werden", "Auf die Mail warten", "Sie finden", "Ein Konto anlegen", "Die Adresse bestätigen", "Sich mit genau dieser Adresse anmelden", "Endlich das Board sehen"] },
    { "title": "Jetzt", "hue": "run", "items": ["Den Link öffnen", "Einen Namen eintippen", "Sie sind auf dem Board"] }
  ],
  "caption": "Beide Spalten enden mit demselben Zugriff. Eine davon nach etwa vier Sekunden."
}
```

Weil das eine echte Identität ist und kein Besucherpass, ergibt sich daraus einiges:

- **Den Workspace kostet es nichts Abrechenbares.** Ein Canvas-Mitwirkender war nie ein bezahlter Platz, und ein Gast per Link ist genau das. Für ihn gilt das Mitwirkenden-Limit, das der Plan ohnehin ausweist.
- **Ein Link gewährt Ansehen, Kommentieren oder Bearbeiten – mehr nicht.** Er kann niemals die zwei Rollen vergeben, deren Weitergabe gefährlich wäre: Agents ausführen (was die Tokens des Workspaces verbraucht) und Eigentümerschaft (mit der sich das Board weggeben lässt). Das sind keine Optionen, die eine URL ausdrücken darf.
- **Der Zugriff, den Sie auf das Board gewähren, ist die Obergrenze für alles andere.** Wer zum Kommentieren eingeladen wurde, kann den Workspace drumherum nicht bearbeiten.
- **Ein Konto lässt sich später anlegen.** Öffnen Sie denselben Link angemeldet, und das gerade erstellte Konto bekommt seinen Platz – auf demselben Board, mit demselben Zugriff.

Und widerrufbar ist das Ganze, wie es sich für einen Link gehört: Jeder Link, den Sie erstellt haben, steht im selben Panel – mit dem, was er gewährt, wie viele Leute ihn genutzt haben, und einem Button, um ihn abzuschalten.

## Wo das in der Methode steht

**Lesen** und **Beweisen** sind die ersten beiden Akte, und sie sind die günstigen – mit Absicht, damit die Entscheidung zu bauen eine Entscheidung ist und keine Voreinstellung. Aber beides tut man *mit anderen Menschen*. Die Landschaft zu lesen heißt, dass sich jemand, der sie kennt, ansieht, was Sie gefunden haben. Beweisen heißt, die schärfste Fassung der Idee genau der Person vorzulegen, die Ihnen am ehesten sagt, dass sie falsch ist.

Die Reibung, die das zunichtemacht, liegt weder im Lesen noch im Beweisen. Sie liegt in der Einladung.

```bf-figure
{
  "kind": "compare",
  "title": "Wer das Board tatsächlich sieht",
  "columns": [
    { "title": "Wenn die Einladung ein Konto verlangt", "hue": "muted", "items": ["Die zwei Leute, die schon im Workspace sind", "Wer bereit ist, Ihnen zuliebe ein Konto anzulegen", "Niemand, der es eilig hat", "Niemand, den Sie vor zehn Minuten kennengelernt haben"] },
    { "title": "Wenn es ein Link ist", "hue": "idea", "items": ["Die Person im Call", "Der Kunde im Chatverlauf", "Die Fachexpertin, die Ihnen noch zwanzig Minuten schuldet", "Der Kunde, dem Sie es beweisen wollen"] }
  ],
  "caption": "Der Schritt Beweisen ist nur so viel wert wie die Person, der Sie es zeigen. Eine Einladung, die eine Registrierung kostet, filtert nach Geduld, nicht nach Urteilsvermögen."
}
```

Jede Registrierung, die Sie einer prüfenden Person in den Weg stellen, ist ein Filter – und er filtert nach dem Falschen: Er behält die Leute, die Sie ohnehin mögen, und verliert die, deren Meinung die Idee verändert hätte. Auf dem Board wird aus einer Idee etwas, worüber man streiten kann. Erreichbar sein sollte es für jeden, dem Sie einen Link schicken können.

## Was Sie heute damit tun können

- **Jeden gespeicherten Canvas per URL teilen** – Ansehen, Kommentieren oder Bearbeiten wählen, kopieren, abschicken.
- **Jemanden mit einem Namen beitreten lassen** – keine Registrierung, kein Passwort, ein echter Mitwirkender auf Ihrem Board.
- **Wie bisher per E-Mail einladen**, wenn Sie die Adresse kennen und die Person im Team haben wollen.
- **Jeden Link widerrufen** – im selben Panel, jederzeit, ohne jemanden zu berühren, der bereits beigetreten ist.
- **Aus einem Gast später ein Konto machen** – Konto anlegen und denselben Link öffnen, um den Zugriff mitzunehmen.

---

**Weiterlesen:** [Erstellen, bevor Sie sich registrieren](/blog/create-before-you-sign-up) · [Multiplayer auf dem Canvas, im Browser und in VS Code](/blog/multiplayer-creation-canvas-web-vscode) · [Der Creation Canvas ist kein Chatfenster](/blog/creation-canvas-beyond-chat)

[Öffnen Sie einen Canvas](/create) und schicken Sie jemandem den Link.
