Sie können eine Idee auf einen Canvas bringen, sie in Objekte hineindiskutieren, das Produkt bauen, es als Unternehmen betreiben und ablesen, ob es funktioniert hat. Dann muss es jemand finanzieren – und bis diese Woche hatte die Plattform keine Tür, durch die ein Investor hätte hereinkommen können.

Der CEO-Platz hatte eine Finanzierungsrunde: die Runde, die Datenräume, die Diligence-Lücken, das Fundraising-Paket. All das setzt voraus, dass der Investor bereits im Raum ist. Nichts stellte ein Unternehmen vor einen Fremden, und nichts erlaubte es dem Fremden, „Ich bin interessiert“ zu sagen, ohne dass ein Gründer ihn zuerst gefunden hätte. Das Unternehmen existierte. Es konnte nur nicht *gefunden* werden.

## Das Unternehmen bekommt ein öffentliches Gesicht

```bf-figure
{
  "kind": "flow",
  "title": "Von einer Unternehmenszeile zur Anfrage eines Investors",
  "steps": [
    { "label": "Listen", "note": "Investors → Listing. Drei Schritte: das Unternehmen, seine Zahlen, wonach es sucht. Jeder Schritt wird unterwegs gespeichert.", "hue": "run" },
    { "label": "Gefunden werden", "note": "Marketplace → Companies. Phase, Branche, Traktion und ob Sie Kapital aufnehmen – gefiltert so, wie ein Investor denkt.", "hue": "reach" },
    { "label": "Rückmeldung erhalten", "note": "Express interest landet in Investors → Interest, neben allen anderen Eingängen, mit den eigenen Triage-Status des CRO.", "hue": "run", "tag": "in Ihrem Workspace" }
  ],
  "caption": "Eine Unternehmenszeile, drei Schreibende. Das Listing ist eine Facette des Unternehmens, das Sie ohnehin führen – kein Profil, das Sie daneben pflegen."
}
```

Das Listing ist kein neues Objekt. Es ist das Unternehmen, das Sie bereits haben – das, dem Ihre Projekte zugeordnet sind, für das das Paket gebaut wird –, mit eingeschaltetem öffentlichem Gesicht. Das ist aus einem Grund wichtig: Die Zahlen, die ein Investor liest, sind die Zahlen, die Sie einmal angegeben haben, und die Runway, die er sieht, wird aus diesen Zahlen mit derselben Formel berechnet wie in der Ansicht Ihres CFO-Platzes. Es gibt nichts zu synchronisieren, weil es nur eine einzige Sache gibt.

```bf-figure
{
  "kind": "screen",
  "frame": "Marketplace → Companies",
  "ratio": 1.62,
  "regions": [
    { "label": "Phasen-Chips", "note": "Von Bootstrapped bis IPO-ready, plus Raising now", "x": 4, "y": 6, "w": 92, "h": 9, "hue": "reach" },
    { "label": "Branche · Geschäftsphase · Sortierung", "x": 4, "y": 17, "w": 92, "h": 7, "hue": "reach" },
    { "label": "Ein gelistetes Startup", "note": "Tagline, Phase, Branche, Gesamtfinanzierung, MRR, Team, Runway-Zustand – und Express interest", "x": 4, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "Ein gelistetes Startup", "x": 35.5, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "Ein gelistetes Startup", "x": 67, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "Für Investoren", "note": "Unternehmen durchstöbern, die Kapital aufnehmen", "x": 4, "y": 79, "w": 44, "h": 16, "hue": "accent" },
    { "label": "Für Startups", "note": "Ihr Profil erstellen", "x": 52, "y": 79, "w": 44, "h": 16, "hue": "accent" }
  ],
  "caption": "Startup-Listings sind eine Familie innerhalb des einen Schaufensters, neben Talenten, Agents und Assets – kein fünfter Marktplatz."
}
```

## Was ein Fremder sieht – und was er nie sieht

Ein Verzeichnis, das alles zeigt, ist ein Verzeichnis, in dem sich niemand listet. Deshalb zeigt die Karte, worauf ein Investor seine Entscheidung stützt, und nichts, was einem Gründer beim Veröffentlichen schadet:

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Leser, eine Regel",
  "columns": [
    { "title": "Ein Besucher", "hue": "reach", "items": ["Name, Tagline, Beschreibung", "Finanzierungsphase, Branche, Geschäftsphase", "Gesamtes eingeworbenes Kapital, monatlicher Umsatz, Teamgröße", "Ob das Unternehmen Kapital aufnimmt", "Runway-ZUSTAND – kritisch, beobachten, gesund, profitabel"] },
    { "title": "Ein angemeldeter Leser", "hue": "run", "items": ["Alles, was ein Besucher sieht", "Runway in MONATEN", "Den Investor-Kontakt, den der Gründer zur Veröffentlichung gewählt hat", "Nie den Kassenbestand. Nie die Burn Rate."] }
  ],
  "caption": "Die Stufenregel lebt in einer einzigen Funktion auf dem Server. Verzeichnis und Profilseite laufen beide darüber, sodass keines preisgeben kann, was das andere verbirgt."
}
```

Kassenbestand und Burn Rate sind die beiden Zahlen, die ein Wettbewerber am liebsten lesen würde. Sie bleiben im Workspace. Die Karte zeigt das Runway-Zustandsband – genug, damit ein Investor weiß, ob er sich beeilen sollte –, und ein angemeldeter Leser bekommt die Monate. Ein Klick auf **Express interest** schreibt eine Zeile in den Tenant des Gründers: dieselbe Deal-Flow-Zeile, die die CRO-Warteschlange triagiert, mit der Nachricht des Investors, dem angedachten Instrument und dem Zeitrahmen. Der Gründer wird benachrichtigt, liest sie unter **Investors → Interest** und markiert sie als *im Gespräch*, *investiert* oder *abgesagt*. Wird es ernst, lädt er den Investor in das Unternehmen ein – ein NDA, alle Datenräume –, und der Rest der Runde läuft dort weiter, wo er schon war.

## Runway, mit benannter Herkunft

BurnRateOS zeigte eine einzige Runway-Zahl, und man konnte nicht erkennen, ob sie aus einem Bank-Feed oder einem Formular stammte. Finance öffnet jetzt mit zwei Spalten und beschriftet sie.

```bf-figure
{
  "kind": "screen",
  "frame": "Finance → Runway",
  "ratio": 1.7,
  "regions": [
    { "label": "BEOBACHTET", "note": "Kassenbestand, Netto-Burn, MRR und Monate – aus genehmigten Ausgaben, verarbeiteter Lohnabrechnung und angebundener Buchhaltung, täglich neu berechnet", "x": 4, "y": 6, "w": 45, "h": 44, "hue": "measure" },
    { "label": "ANGEGEBEN", "note": "Kassenbestand, monatliche Ausgaben, Teamkosten, Umsatz – was Sie uns mitgeteilt haben, hier bearbeitbar, mit dem Urteil daneben", "x": 51, "y": 6, "w": 45, "h": 44, "hue": "run" },
    { "label": "Monat für Monat", "note": "Umsatz · Ausgaben · Netto-Burn · Kassenbestand zum Monatsende, für die beobachteten Monate", "x": 4, "y": 54, "w": 92, "h": 40, "hue": "measure" }
  ],
  "caption": "Zwei Herkünfte, nie vermischt. Eine Runway, die aus eingetippten Zahlen berechnet wurde, sagt das neben der Zahl – nicht in einer Fußnote."
}
```

Die Rechnung ist überall dieselbe, wo sie auftaucht – im kostenlosen Rechner auf der Business-Intelligence-Seite, im Onboarding-Schritt des Gründers, auf der Listing-Karte und in der Ansicht des CFO –, weil sie einmal geschrieben und einmal getestet ist. Sie teilt den Kassenbestand durch den *Netto*-Burn. Ein Unternehmen, das 100.000 $ ausgibt und 80.000 $ einnimmt, verbrennt 20.000 $, und die Variante dieser Formel, die durch die Bruttoausgaben teilt, meldet ein Fünftel der tatsächlichen Runway. Das ist der eine folgenschwere Fehler, den man hier machen kann, und der Grund, warum es eine Formel gibt statt vier.

Der Cashflow steht daneben: Einnahmen, Ausgaben, Saldo und Endbestand, Monat für Monat, als Diagramm und als Tabelle, für die Monate, die die Plattform beobachtet hat, und für die Projektion bei Ihrer angegebenen Burn Rate. Sie wählen, welche Reihe angezeigt wird, und die Beschriftung des Diagramms benennt sie.

## Wo es in der Methode steht

Run und Reach – und die Naht zwischen ihnen.

```bf-figure
{
  "kind": "stack",
  "title": "Das Unternehmen auf dem Bogen",
  "bands": [
    { "label": "Idea", "note": "Der Canvas, in den das Produkt hineindiskutiert wurde", "hue": "idea" },
    { "label": "Make", "note": "Die Projekte, die dem Unternehmen zugeordnet sind", "hue": "make" },
    { "label": "Run", "note": "Finance → Runway und Cashflow. Die Zahl des CFO, mit benannter Quelle.", "hue": "run" },
    { "label": "Measure", "note": "Beobachtete Fakten, täglich neu berechnet, neben dem, was Sie angegeben haben", "hue": "measure" },
    { "label": "Reach", "note": "Marketplace → Companies. Das Unternehmen wird gefunden; das Interesse fließt zurück in Run.", "hue": "reach" }
  ],
  "caption": "Das Listing ist eine Reach-Oberfläche, die in Run schreibt. Eine Anfrage ist eingehender Deal Flow, keine Benachrichtigung."
}
```

Run brauchte das, weil ein Unternehmen, das seine Runway nicht benennen kann, nicht sagen kann, wie viel Zeit es für die Kapitalaufnahme hat. Reach brauchte es, weil ein Unternehmen, das nicht gefunden werden kann, überhaupt kein Kapital aufnehmen kann. Das Listing schließt die Schleife auch in die andere Richtung: Die Anfrage eines Investors ist das erste Measure-Signal, das eine Finanzierungsrunde erzeugt – wie viele Leute hingeschaut haben, wie viele nachgefragt haben –, und sie trifft auf demselben Board ein, auf dem das Ding gebaut wird, nach dem sie fragen.

Starten Sie an der Marketplace-Tür, am Rechner oder unter **Investors → Listing**. Drei Schritte später ist das Unternehmen gelistet, seine Runway steht in Finance, und der nächste Fremde, der es findet, kann Ihnen das mitteilen.
