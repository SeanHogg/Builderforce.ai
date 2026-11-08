Jede Suche beginnt mit derselben Handlung: die Rolle vor Menschen bringen. Auf der Canvas war das die eine Handlung, die eine Stellenanzeige nicht ausführen konnte.

Sie konnten die Stellenausschreibung mit Brain entwerfen, ihr einen echten Datensatz im Workspace geben, einen Stapel Lebensläufe dagegen ranken und die eingegangenen Bewerbungen zählen. Die Karte hatte sogar ein Feld dafür, wo sie veröffentlicht ist – `distribution`, eine Zeile pro Jobbörse, mit Status, Datum und Link. Nichts schrieb dort hinein. Der Workspace lieferte bereits Jobbörsen-Konnektoren für Greenhouse, Lever, Ashby, Indeed, LinkedIn Jobs und einen Karriereseiten-Feed, jeder in der Lage, eine Anzeige anzulegen, und nichts rief sie für eine echte Ausschreibung auf. „Diese Rolle posten“ endete also in einem Dokument, und das Bewerbungsvolumen war null, weil niemandem gesagt worden war, dass die Stelle existiert.

## Verteilen, direkt von der Karte

Eine Stellenanzeigen-Karte hat jetzt ein **Distribute**-Element. Es listet die Jobbörsen auf, die Ihr Workspace verbunden hat, Sie haken die gewünschten an und drücken die Schaltfläche.

```bf-figure
{
  "kind": "flow",
  "title": "Was ein Druck auf Distribute bewirkt",
  "steps": [
    { "label": "Börsen wählen", "note": "Nur Börsen, die Sie verbunden haben, und nur solche, auf denen die Anzeige noch nicht live ist.", "hue": "run" },
    { "label": "Veröffentlichen", "note": "Jede Börse erhält dieselbe Anzeige: Titel, Beschreibung und Anforderungen des Datensatzes plus Standort und Seniorität Ihrer Karte.", "hue": "run" },
    { "label": "Antwort lesen", "note": "Die Antwort der Börse wird auf deren eigene ID für die Anzeige und, wenn sie einen liefert, auf ihren öffentlichen Link gelesen.", "hue": "run" },
    { "label": "Festhalten", "note": "Eine Zeile pro Börse im Workspace: Live mit der ID der Börse oder Fehlgeschlagen mit dem Grund der Börse.", "hue": "measure", "tag": "die Karte liest das" }
  ],
  "caption": "Jeder Aufruf läuft durch dieselbe Konnektor-Laufzeit wie jede andere Integration: Ihre Zugangsdaten pro Workspace, geprüft, protokolliert und auditiert."
}
```

Sie können auch einfach fragen. Sagen Sie Brain, es solle die Rolle posten, und es liest, wo die Anzeige bereits live ist und welche Börsen verbunden sind, fragt Sie, welche genutzt werden sollen, und veröffentlicht erst dann. Das Veröffentlichen setzt den Namen Ihres Unternehmens auf eine öffentliche Börse, daher gilt dieselbe Freigaberegel wie beim Versand einer Kampagne.

```bf-figure
{
  "kind": "screen",
  "frame": "Eine Stellenanzeigen-Karte",
  "ratio": 1.3,
  "regions": [
    { "label": "Die Ausschreibung", "note": "Rolle, Level, Standort, Muss-Kriterien, die Zahl der Bewerber", "x": 4, "y": 6, "w": 92, "h": 34, "hue": "idea" },
    { "label": "Veröffentlicht auf", "note": "Lever: Live, seit 9. Okt., Anzeige ansehen · Indeed: Fehlgeschlagen, Nicht autorisiert", "x": 4, "y": 44, "w": 92, "h": 22, "hue": "run" },
    { "label": "Veröffentlichen auf", "note": "Greenhouse · Ashby · Karriere-Feed", "x": 4, "y": 70, "w": 60, "h": 14, "hue": "accent" },
    { "label": "Auf 2 Börsen verteilen", "x": 4, "y": 87, "w": 44, "h": 8, "hue": "accent" }
  ],
  "caption": "Die Liste, wo sie live ist, wird bei jedem Öffnen der Karte aus dem Workspace gelesen, nicht auf der Karte gespeichert."
}
```

## „Live“ heißt: Die Börse hat es gesagt

Das Schwierige war nicht, sechs APIs aufzurufen. Es war zu entscheiden, was als veröffentlicht gilt.

Ein HTTP 200 ist keine Veröffentlichung. Ashby beantwortet jede Anfrage mit 200 und legt eine Ablehnung in den Body. GraphQL-APIs wie die von Indeed tun dasselbe. Der Job-Posting-Endpunkt von LinkedIn ist ein Batch-Aufruf, dessen Fehler pro Job in einer erfolgreichen Antwort stecken. Ein System, das dem Statuscode vertraut, würde einem Recruiter sagen, eine Rolle sei auf drei Börsen live, obwohl sie es auf einer ist, und die Kandidaten, die suchen, würden nichts finden.

Eine Börse wird deshalb nur dann als **Live** angezeigt, wenn ihre Antwort ihre eigene ID für die Anzeige enthielt. Alles andere wird als **Fehlgeschlagen** angezeigt, mit dem Grund, den die Börse genannt hat. Die Regel wird auch von der Datenbank durchgesetzt: Eine bestätigte Zeile ohne die ID der Börse kann nicht geschrieben werden.

```bf-figure
{
  "kind": "compare",
  "title": "Was die Antwort einer Börse bedeuten kann",
  "columns": [
    { "title": "Als Live festgehalten", "hue": "run", "items": ["Die Börse antwortete mit ihrer ID für die Anzeige", "Ihr öffentlicher Link wird gezeigt, wenn sie einen geliefert hat", "Ein erneuter Druck auf Distribute überspringt sie, sodass die Stelle nie doppelt gepostet wird"] },
    { "title": "Als Fehlgeschlagen festgehalten", "hue": "muted", "items": ["Die Börse lehnte die Anfrage ab", "Sie antwortete mit 200, meldete aber intern einen Fehler", "Sie antwortete mit 200 ohne ID für die Anzeige", "Eine Zugangsberechtigung oder ein Pflichtfeld fehlte"] }
  ],
  "caption": "Eine fehlgeschlagene Börse lässt sich erneut versuchen. Eine live geschaltete bleibt unangetastet, denn ein zweites Anlegen ist bei den meisten Börsen eine zweite Anzeige."
}
```

Diese Entscheidung ist auch der Grund, warum jede Börse vom selben Code behandelt wird. Jeder Konnektor sagt bereits als Daten, wohin jede Eingabe in der Anfrage gehört. Er sagt jetzt auch, wo die Anzeigen-ID und der Link in der Antwort zurückkommen: `data.id` und `data.urls.show` bei Lever, `results.id` bei Ashby, die ID des ersten Elements bei LinkedIn, mit einem Header als Fallback. Eine Börse hinzuzufügen ist ein neuer Eintrag im Katalog, kein neuer Zweig im Publisher, und eine Börse, die uns ihre ID nicht nennen kann, wird nie als Ziel angeboten.

## Bewerber, nach Börse

Die Bewerbungen einer Anzeige waren bereits nach Quelle aufgeschlüsselt. Jetzt erscheint jede Börse, auf der die Anzeige hinausging, in dieser Aufschlüsselung unter ihrem eigenen Namen, mit ihrer echten Zahl. Das schließt null ein, denn „Indeed: 0 nach zwei Wochen“ ist genau die Zahl, die Ihnen sagt, dass eine Börse nicht funktioniert. Sie wegzulassen würde als „dort nie gepostet“ gelesen. Die Börsenzeilen auf der Karte tragen dieselbe Zahl.

Der Abgleich ist exakt. Eine Bewerbung, die als von einer Börse kommend erfasst ist, trägt den Schlüssel dieser Börse, und die eigene ID der Anzeige reist zu jeder Börse mit, damit die Börse sie zurückmelden kann. Eine Freitext-Quelle wie „LinkedIn“, die bei einer Bewerbung eingetippt wurde, bleibt wie sie ist, statt auf die Börse LinkedIn Jobs geraten zu werden, denn ein falsch zugeordneter Bewerber liefert die falsche Antwort auf die einzige Frage, für die diese Aufschlüsselung existiert.

## Wo es in der Methode sitzt

Run. Idea und Make haben die Ausschreibung hervorgebracht: die Rolle, die Messlatte, den Datensatz dahinter. Run ist, wo sie in der Welt zu arbeiten beginnt, und eine Personalsuche beginnt erst zu arbeiten, wenn Kandidaten sie sehen können.

```bf-figure
{
  "kind": "flow",
  "title": "Eine Ausschreibung durch die Methode",
  "steps": [
    { "label": "Idea", "note": "Die Rolle mit Brain auf der Canvas entwerfen", "hue": "idea" },
    { "label": "Make", "note": "Ihr einen echten Datensatz geben; Lebensläufe dagegen ranken", "hue": "make" },
    { "label": "Run", "note": "Auf die Börsen verteilen und sehen, wo sie live ist", "hue": "run", "tag": "neu" },
    { "label": "Measure", "note": "Bewerber pro Börse; welche Börsen still sind", "hue": "measure" },
    { "label": "Reach", "note": "Der Karriere-Feed bringt sie auf jeden Aggregator ohne Partner-API", "hue": "reach" }
  ],
  "caption": "Die Karte bleibt in jedem Schritt ein Griff an den Datensatz: Zahlen, Börsen und Links werden aus dem Workspace gelesen, nie getippt."
}
```

## Was Sie heute damit tun können

- **Eine Rolle auf mehreren Börsen gleichzeitig posten**, von der Stellenanzeigen-Karte oder indem Sie Brain fragen.
- **Sehen, wo sie tatsächlich live ist**, mit einem Link zur Anzeige jeder Börse, wenn die Börse einen liefert.
- **Eine fehlgeschlagene Börse erneut versuchen**, nachdem Sie den genannten Grund behoben haben, ohne irgendwo doppelt zu posten, wo es schon geklappt hat.
- **Börsen nach Bewerbern vergleichen**, einschließlich derer, die noch niemanden hervorgebracht haben.
- **Den Long Tail erreichen** mit dem Karriereseiten-Feed, den jeder Aggregator ohne Partner-API liest.

---

**Weiterführende Lektüre:** [Die Suche delegieren, nicht die Entscheidung](/blog/delegate-the-search-not-the-decision) · [Die App ausführen, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas)

[Öffnen Sie eine Canvas](/create), fügen Sie eine Stellenanzeige hinzu und verbinden Sie unter Integrationen eine Jobbörse.
