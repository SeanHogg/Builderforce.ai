Einen Besuch anzusehen sagt Ihnen, was schiefgelaufen ist. Es sagt Ihnen nicht, was Sie ändern sollen, was die Änderung wert ist oder ob die Änderung, die Sie ausgeliefert haben, überhaupt etwas bewirkt hat.

Genau dort hören die meisten Website-Daten auf. Eine Heatmap mit einem roten Fleck auf der Überschrift. Ein Trichter, der bei Schritt zwei abbricht. Vierzig Aufnahmen von Leuten, die am selben Formular aufgeben. Alles wahr, und nichts davon eine Entscheidung. Jemand muss daraus noch eine Änderung machen, raten, ob sie zählt, das Briefing schreiben, sie bauen lassen und dann — meistens nie — prüfen, ob sich die Zahl bewegt hat.

Insights erledigt diese Arbeit jetzt mit Ihnen. Die Startseite ist kein Dashboard mehr. Sie ist eine kurze Liste von Korrekturen.

## Die Korrekturen, nach Rang

Jede Korrektur beginnt bei etwas, das Besucher auf Ihrer Website tatsächlich getan haben: ein Anteil der Besucher, der wütend auf ein Element klickt, ein Fehler, der in den meisten Besuchen auftaucht, die bei einem Schritt abbrechen, eine Überschrift, die Leute anklicken, als wäre sie ein Link, der Haupt-Button unterhalb der Stelle, an der die meisten aufhören zu scrollen, Telefone, die weit unter dem Desktop konvertieren, ein Release, das schlechter lief als das davor. Diese Befunde stammen aus Regeln über Ihre eigenen Aufnahmen, nicht aus der Meinung eines Modells. Die KI fasst nur einen belegten Befund in Worte und entwirft die Änderung; ein Satz, den sie nicht an die Belege binden kann, wird verworfen.

Jede Korrektur trägt eine Wirkungsspanne, berechnet aus Ihren eigenen Besuchern — die Leute, die auf das Problem gestoßen sind, gegen die, die es nicht sind. Wenn es zu wenige Besuche gibt, um etwas zu sagen, sagt sie genau das, statt eine Zahl zu erfinden. Die Liste ist nach Wirkung gegen Aufwand sortiert, sodass die billige, wahrscheinliche Änderung über der teuren, spekulativen steht.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — Insights · Korrekturen",
  "ratio": 1.5,
  "regions": [
    { "label": "Korrekturen, nach Rang", "note": "Wirkung gegen Aufwand, höchste zuerst", "x": 4, "y": 6, "w": 32, "h": 88, "hue": "measure" },
    { "label": "Vorher", "note": "Die Seite, wie sie ist, nummeriert, wo Besucher hängen bleiben", "x": 39, "y": 6, "w": 28, "h": 56, "hue": "muted" },
    { "label": "Nachher", "note": "Dieselbe Seite mit der gerenderten Änderung", "x": 69, "y": 6, "w": 27, "h": 56, "hue": "make" },
    { "label": "Wirkungsspanne", "note": "Aus Ihren eigenen Besuchern, oder „zu wenige Besuche, um es zu sagen“", "x": 39, "y": 66, "w": 28, "h": 28, "hue": "accent" },
    { "label": "Beheben · Testen · Nachfassen · Ticket", "note": "Eine Aktion, dann ein Urteil beim nächsten Release", "x": 69, "y": 66, "w": 27, "h": 28, "hue": "run" }
  ],
  "caption": "Aufnahmen, Heatmaps und Trichter sind weiterhin da. Sie sind die Belege hinter einer Korrektur, von ihr aus erreichbar, nicht der Ort, an dem Sie anfangen."
}
```

## Die Seite, wie sie ist und wie sie wäre

Neben dem, was Besucher getan haben, prüft Insights Ihre wichtigen Seiten bei jedem Release: Einstiegsseiten, Trichterschritte, Beweisseiten und Ihre meistbesuchten Routen. Jede wird in Desktop- und Telefonbreite erfasst und auf Suchgrundlagen, Inhalt, Performance und Barrierefreiheit geprüft — eine fehlende Beschreibung, mehr als eine Hauptüberschrift, ein vager Handlungsaufruf, kein Grund, Ihnen oberhalb des Falzes zu vertrauen, ein langsames Hero-Bild, schwer lesbarer Text, zu kleine Tippflächen. Ihre Suchdaten werden genutzt, wenn Sie sie verbunden haben, und nie erfunden, wenn nicht. Die Erfassung füllt nie ein Formular aus und meldet sich nie an.

Ein Befund, der aus dem Betrachten des Screenshots stammt, wird nur gezeigt, wenn er auf ein echtes Element der Seite und eine gemessene Tatsache darüber zeigt, und er ist als beobachtet gekennzeichnet.

Dann wird die Änderung gezeichnet. Nicht beschrieben — gerendert, auf Ihrer Seite, vorher und nachher.

```bf-figure
{
  "kind": "compare",
  "title": "Dieselbe Seite, vor und nach der Änderung",
  "columns": [
    { "title": "Wie sie ist", "hue": "muted", "items": ["① Die Überschrift liest sich wie ein Link, und Leute klicken darauf", "② Der Haupt-Button liegt unterhalb der Stelle, an der die meisten aufhören zu scrollen", "③ Kein Grund, Ihnen vor dem Falz zu vertrauen", "④ Grauer Text auf hellem Hintergrund"] },
    { "title": "Wie sie wäre", "hue": "make", "items": ["① Die Überschrift ist schlichter Text mit einem klaren Versprechen", "② Der Button rückt nach oben, in Sicht", "③ Ein Beleg steht neben dem Button", "④ Ein Kontrast, der besteht"] }
  ],
  "caption": "Die Nummern links entsprechen Markierungen auf der erfassten Seite. Rechts ist diese Seite mit angewendeter Änderung, kein Entwurf davon. Suchänderungen erscheinen als das Ergebnis, das Leute sehen würden."
}
```

## Vom Befund zum Urteil

Eine Korrektur, die Sie sehen können, ist immer noch eine, die niemand gemacht hat. Deshalb kommt jede mit einem Weg, sie umzusetzen — und keiner davon erreicht die Produktion von allein.

- **Beheben.** Auf einer Website, die Sie bei uns hosten, nimmt ein Coding-Agent die Änderung vor, und Sie erhalten ein Vorschau-Release. Ein Mensch veröffentlicht es.
- **Testen.** Führen Sie die Änderung als A/B-Test aus: Besucher werden aufgeteilt, jeder sieht beständig eine Version, und der Test endet nach einer Regel, die Sie vorab festlegen, nicht nach einem gut aussehenden Nachmittag.
- **Nachfassen.** Wenn das Problem Sie bekannte Besucher gekostet hat — jemand, der beim Preis gezögert oder den Checkout verlassen hat —, nehmen Sie sie in eine Nachfass-Sequenz auf, nach Ihren eigenen Vertriebsregeln.
- **Ticket.** Legen Sie es mit den Belegen auf das Board.
- **An eine KI übergeben.** Wenden Sie es im Canvas-Composer an, oder kopieren Sie einen Verbesserungs-Prompt, geschrieben für einen Coding-Agenten oder für den Website-Baukasten, den Sie nutzen.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Korrektur, von Anfang bis Ende",
  "steps": [
    { "label": "Befund", "note": "Etwas, das Besucher getan haben, oder eine gemessene Tatsache über die Seite. Belegt, nicht geraten.", "hue": "measure" },
    { "label": "Verordnung", "note": "Die Änderung, der Grund, eine Wirkungsspanne aus Ihren eigenen Besuchern und die Änderung auf die Seite gezeichnet.", "hue": "idea" },
    { "label": "Anwenden", "note": "Beheben, Testen, Nachfassen oder Ticket — oder im Composer anwenden, an einen Coding-Agenten geben oder den Prompt kopieren.", "hue": "make", "tag": "ein Mensch entscheidet" },
    { "label": "Nächstes Release", "note": "Von selbst erkannt. Die Seite wird erneut erfasst und bewertet.", "hue": "run" },
    { "label": "Urteil", "note": "Gewirkt, keine Wirkung oder schlechter. Schlechter bei einer veröffentlichten Korrektur bietet ein Zurücksetzen an.", "hue": "measure", "tag": "gemessen" }
  ],
  "caption": "Das Verzeichnis zeigt jedes Release mit den Korrekturen, die es ausgeliefert hat, und was sie bewirkt haben. Eine Korrektur ohne Urteil ist noch offen."
}
```

Das Urteil ist der Teil, den die meisten Tools weglassen. Eine Korrektur oder ein Ticket wird danach beurteilt, wie sich Besucher auf der Route vor und nach dem Release verhalten haben, das sie enthielt. Ein Test wird nach seinen Varianten beurteilt. Ein Nachfassen wird nach den Aufgenommenen gegen die beurteilt, die passten und nicht aufgenommen wurden. Die Antwort ist eines von drei Wörtern — gewirkt, keine Wirkung, schlechter —, und „schlechter“ bei einer Änderung, die Sie veröffentlicht haben, kommt mit einem Weg zurück.

## Wo es in der Methode sitzt

Die Methode hat einen Bogen — **Idee → Machen → Ausführen → Messen → Reichweite** — und eine innere Schleife aus drei Akten: **Lesen, Beweisen, Bauen**. [Sehen Sie, warum Besucher gehen](/blog/see-why-visitors-leave) hat Aufnahmen auf Messen gelegt, als Note auf einen Beweis. Korrekturen sind die andere Hälfte: die Brücke von Messen zurück zu Machen.

- **Beheben ist Machen.** Es ist ein Bauen, beschränkt auf einen belegten Befund, mit einer Vorschau, die ein Mensch veröffentlicht.
- **Testen ist ein Beweis.** Eine Kill-Bedingung, eine Stichprobe, eine Abbruchregel — dieselbe Form wie jeder Beweis auf der [Liste, billigster zuerst](/blog/eight-ways-to-make-an-idea-real), ausgeführt auf der Seite, die Sie schon haben.
- **Das Urteil ist wieder Messen.** Das nächste Release wird danach benotet, was Besucher getan haben, nicht danach, ob die Änderung ausgeliefert wurde.
- **Ein Fehlschlag ist das nächste Lesen.** Wenn ein Beweis verfehlt, wird der Grund, den er nennt, selbst zu einem Befund, und Sie lesen die Idee erneut mit diesem Grund in der Hand.

```bf-figure
{
  "kind": "flow",
  "title": "Von Messen zurück zu Machen, und wieder herum",
  "steps": [
    { "label": "Messen", "note": "Aufnahmen, Heatmaps und die Seitenprüfung liefern belegte Befunde.", "hue": "measure" },
    { "label": "Machen", "note": "Beheben: eine Änderung, ein Vorschau-Release, ein Mensch veröffentlicht.", "hue": "make", "tag": "Bauen" },
    { "label": "Beweisen", "note": "Testen: ein A/B-Test mit einer Abbruchregel, festgelegt, bevor er beginnt.", "hue": "prove", "tag": "ein Beweis" },
    { "label": "Messen", "note": "Das nächste Release wird erkannt und benotet: gewirkt, keine Wirkung, schlechter.", "hue": "measure", "tag": "Urteil" },
    { "label": "Lesen", "note": "Der genannte Grund eines verfehlten Beweises wird das Nächste, woran Sie die Idee lesen.", "hue": "read" }
  ],
  "caption": "Idee → Machen → Ausführen → Messen ist der Bogen. Korrekturen sind, wie Messen aufhört, ein Bericht zu sein, und anfängt, die nächste Änderung zu sein."
}
```

[Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop) ist die innere Schleife. [Den Beweis benoten](/blog/grade-the-proof-and-close-the-loop) ist, wo die Zahl aufgeschrieben wird. Dies ist, was Sie mit der Zahl tun, sobald sie aufgeschrieben ist.

Installieren Sie Insights, setzen Sie das Snippet auf Ihre Website oder schalten Sie die Aufnahme für eine gehostete App ein, und die ersten Korrekturen kommen, sobald es Besuche gibt, aus denen sie gelesen werden können.

---

**Weiterlesen:** [Sehen Sie, warum Besucher gehen](/blog/see-why-visitors-leave) · [Den Beweis benoten](/blog/grade-the-proof-and-close-the-loop) · [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop) · [Idee, Machen, Ausführen, Messen](/blog/idea-make-run-measure-menu-as-methodology)

[Eine Leinwand öffnen](/create) und das Erste beheben, was Ihre Besucher Ihnen gesagt haben.
