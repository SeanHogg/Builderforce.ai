Sie rendern das Launch-Video auf dem Board. Sie schreiben die Ankündigung einmal. Sie haken X, LinkedIn, Instagram, TikTok an – und YouTube.

Bis jetzt war YouTube das Kästchen, das Nein sagte.

Jedes andere Netzwerk akzeptiert einen Beitrag als einzelne Anfrage: etwas Text, vielleicht einen Link, vielleicht ein Bild, das sich das Netzwerk selbst holt. YouTube nicht. Auf YouTube zu posten heißt, *ihm das Video zu schicken*, jedes einzelne Byte, und ein dreiminütiger Launch-Film ist weit mehr, als eine Anfrage in ihrer Zeit tragen kann. Die ehrliche Antwort war also, YouTube als „nur lesen und messen“ zu markieren: Das Board konnte die Aufrufe Ihres Kanals zeigen, aber der Upload selbst bedeutete einen Gang ins YouTube Studio, einen Download, einen erneuten Upload und eine irgendwo anders herauskopierte Beschreibung.

Damit war das wichtigste Asset eines Launchs das einzige, das nicht mit dem Launch hinausgehen konnte.

## Ein Upload, der die Anfrage überlebt, die ihn gestartet hat

Die Lösung ist keine längere Anfrage. Sie besteht darin, den Upload überhaupt nicht mehr als Anfrage zu behandeln.

```bf-figure
{
  "kind": "flow",
  "title": "Was passiert, wenn eine Kampagne YouTube erreicht",
  "steps": [
    { "label": "Übergeben", "note": "Der YouTube-Beitrag wird zu einem Upload-Job mit eigenem Datensatz: welches Video, welcher Kanal, wie viel YouTube bestätigt hat.", "hue": "reach" },
    { "label": "Ein Stück senden", "note": "Ein paar Megabyte auf einmal, jedes genau damit beschriftet, wo es in der Datei sitzt.", "hue": "reach" },
    { "label": "Fragen, nicht annehmen", "note": "Bevor der Job mehr sendet, fragt er YouTube, wie weit es tatsächlich gekommen ist, und macht von dort weiter.", "hue": "measure" },
    { "label": "Landen", "note": "YouTube gibt das Video zurück. Der Kampagnenbeitrag wird zu einem Link.", "hue": "reach", "tag": "in der Kampagne" }
  ],
  "caption": "Ein kurzer Clip ist in einem Stück fertig. Ein langer Film braucht so viele, wie nötig. Es ist in beiden Fällen derselbe Weg, sodass sich der Fünf-Sekunden-Teaser und die vierzigminütige Keynote nicht unterschiedlich verhalten können."
}
```

Entscheidend ist der dritte Schritt. Ein Cloud-Worker kann jederzeit gestoppt werden. Wird er mitten im Senden eines Stücks gestoppt, vertraut der Job nicht seiner eigenen Vorstellung davon, wie viel hinausgegangen ist. Er fragt YouTube, und YouTube sagt genau, wie viel es hat. Der nächste Versuch beginnt an diesem Punkt. Das Schlimmste, was eine abgebrochene Verbindung kosten kann, ist ein Stück, nie das ganze Video.

Dasselbe gilt für eine schlechte Minute auf YouTubes Seite. Ein vorübergehender Fehler wartet und versucht es erneut, jedes Mal etwas länger. Ein Fehler, den Warten nicht beheben kann, etwa ein erschöpftes Tageskontingent oder eine Verbindung, die neu verbunden werden muss, stoppt sofort und nennt den Grund. Es gibt keine Wiederholung in einer Endlosschleife.

## Was Sie sehen

```bf-figure
{
  "kind": "screen",
  "frame": "Eine Launch-Kampagne auf dem Board",
  "ratio": 1.62,
  "regions": [
    { "label": "Veröffentlicht · X", "note": "Verlinkt auf den Beitrag", "x": 4, "y": 10, "w": 44, "h": 16, "hue": "good" },
    { "label": "Veröffentlicht · LinkedIn", "x": 52, "y": 10, "w": 44, "h": 16, "hue": "good" },
    { "label": "Veröffentlicht · Instagram", "x": 4, "y": 32, "w": 44, "h": 16, "hue": "good" },
    { "label": "Wird hochgeladen · 62 % · YouTube", "note": "Von YouTube bestätigt, nicht geschätzt", "x": 52, "y": 32, "w": 44, "h": 16, "hue": "reach" },
    { "label": "Text · Link · das Video", "x": 4, "y": 56, "w": 92, "h": 36, "hue": "muted" }
  ],
  "caption": "YouTube steht in derselben Liste wie jedes andere Netzwerk. Sein Status lautet erst Eingereiht, dann Wird hochgeladen mit Prozentangabe, dann Veröffentlicht mit Link oder Fehlgeschlagen mit dem Grund."
}
```

Die Prozentangabe ist der Anteil des Videos, den YouTube **bestätigt** hat, nicht der Anteil, den wir gesendet haben. Diese beiden Zahlen können abweichen, und wenn sie das tun, ist die bestätigte die wahre. Die Kampagne bleibt außerdem in Bearbeitung, solange das Video noch hochgeladen wird. Sie nennt sich nicht veröffentlicht, solange YouTube nur einen Teil der Datei hat.

Derselbe Uploader steckt hinter **Auf YouTube veröffentlichen** bei einem Video im Canvas-Editor. Ein kurzes Render ist weiterhin fertig, bevor die Schaltfläche aufhört zu drehen. Ein langes zeigt jetzt, wie viel angekommen ist, läuft weiter, nachdem Sie den Tab schließen, und der Link erscheint am Video, sobald es das nächste Mal jemand öffnet. Lange Renders scheiterten früher allein deshalb, weil sie lang waren. Das passiert nicht mehr.

## Was es braucht

Zwei Dinge, beide einmalig:

- **Ein YouTube-Konto an der Kampagne.** Verbinden Sie es mit den anderen Social-Konten, dann erscheint es als Ziel.
- **Eine YouTube-Upload-Verbindung.** Verbinden Sie YouTube einmal über ein Video auf der Canvas. Damit können Uploads an Ihren Kanal gehen. Hat die Person, die das YouTube-Konto der Kampagne verbunden hat, das getan, wird ihr Kanal verwendet. Hat es niemand getan, oder haben es zwei Personen getan und es ist unklar, wessen Kanal gemeint ist, sagt der Beitrag das, statt zu raten. Ein Launch-Video auf dem falschen Kanal lässt sich nicht still zurücknehmen.

Das Video der Kampagne wird genauso angehängt wie ein Instagram- oder TikTok-Video. Verwenden Sie ein Video vom Board oder fügen Sie einen öffentlichen Link ein. Der Kampagnenname wird zum Videotitel. Der Beitragstext und der Kampagnenlink werden zur Beschreibung.

## Wo es in der Methode sitzt

Jedes Board durchläuft denselben Bogen: **Idea → Make → Run → Measure → Reach**. Reach ist der letzte Schritt, und er ist der, der am ehesten woanders stattfindet: in einem Planungs-Tool, einem Studio-Tab, einem Ordner mit Exporten. Sobald er sich vom Board entfernt, wandert der Nachweis darüber, was hinausging, mit.

```bf-figure
{
  "kind": "compare",
  "title": "Ein Launch-Video hinausbringen",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Auf dem Board rendern", "Die Datei herunterladen", "YouTube Studio öffnen", "Sie erneut hochladen", "Die Beschreibung einfügen", "Den Link von Hand zurückposten", "Nichts auf dem Board weiß, dass es hinausging"] },
    { "title": "Jetzt", "hue": "reach", "items": ["Auf dem Board rendern", "YouTube in der Kampagne anhaken", "Zusehen, wie es neben den anderen Netzwerken hochgeladen wird", "Der Link landet in der Kampagne"] }
  ],
  "caption": "Das Video geht mit der Kampagne hinaus, zu der es gehört, sodass sein Ergebnis neben X, LinkedIn und Instagram steht. Sie sehen, welche Beiträge live sind und wo, ohne nachzufragen."
}
```

Measure und Reach teilen sich eine Schleife. Die Aufrufe des Kanals waren bereits über die YouTube-Feed-Kachel auf dem Board. Jetzt geht auch das Video, das diese Aufrufe erzielt, vom Board aus hinaus, sodass der nächste Schritt, zu beobachten, wie es läuft, am selben Ort beginnt wie der Launch.

---

**Weiterführende Lektüre:** [Videoszenen und Filme auf der Canvas machen](/blog/make-video-scenes-and-movies-on-the-canvas) · [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas)

[Öffnen Sie eine Canvas](/create), rendern Sie das Video und schicken Sie es mit dem Rest des Launchs hinaus.
