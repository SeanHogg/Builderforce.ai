## Warum „verifizierbar“ das entscheidende Wort ist

Jeder kann in einer Textverarbeitung ein Zertifikat erstellen. Das Problem ist nicht, eines zu erzeugen – sondern einen Arbeitgeber dazu zu bringen, es zu glauben. Ein verifizierbares Zertifikat löst genau das: Es trägt eine kryptografische Signatur, sodass ein Dritter bestätigen kann, dass es tatsächlich ausgestellt wurde, für Sie, für genau diesen Kurs, und nicht verändert wurde.

Builderforce signiert jedes Zertifikat mit einem HMAC. Das unterscheidet einen Nachweis, dem eine Personalverantwortliche vertraut, von einem PDF, das jeder fälschen könnte.

## Schritt 1: Den erforderlichen Pfad abschließen

Melden Sie sich für einen [Kurs](/training) oder Lernpfad an und schließen Sie ab, was er verlangt. Der Abschluss ist kein Selbst-Häkchen – Ihr Fortschritt wird laufend im xAPI Learning Record Store der Plattform erfasst, einschließlich SCORM-Lektionsergebnissen und Lernpfad-Knoten.

Wenn der Pfad Voraussetzungen hat, schalten frühere Module spätere frei, sodass Sie sie der Reihe nach abschließen. Sobald der LRS erfasst hat, dass Sie die Anforderungen erfüllt haben, sind Sie für das Zertifikat berechtigt.

## Schritt 2: Das signierte Zertifikat erhalten

Nach dem Abschluss stellt Builderforce Ihr mit einem HMAC signiertes Zertifikat aus. Die Signatur ist an Ihre Identität und den konkreten Kurs gebunden – ändern Sie ein einziges Zeichen im Inhalt des Zertifikats, und die Signatur passt nicht mehr.

Der Erwerb speist zudem die Gamification: Lernabschlüsse bringen Punkte und können Abzeichen freischalten, sodass das Zertifikat eine von mehreren Belohnungen für den Abschluss ist.

## Schritt 3: Teilen, damit ein Arbeitgeber es verifizieren kann

Wenn Sie das Zertifikat teilen, kann der Empfänger es durch die Verifizierung laufen lassen: Der Prüfer berechnet die Signatur über den Inhalt des Zertifikats neu und bestätigt, dass sie mit dem übereinstimmt, was Builderforce ausgestellt hat. Ein echtes Zertifikat besteht; ein manipuliertes oder gefälschtes fällt durch.

Genau darum geht es. Sie bitten den Arbeitgeber nicht, Ihnen aufs Wort zu glauben – Sie geben ihm etwas in die Hand, das er in Sekunden selbstständig prüfen kann. Verlinken Sie es auf Ihrem Profil, hängen Sie es an eine Bewerbung an oder senden Sie es direkt an eine Personalverantwortliche.

## Häufig gestellte Fragen

### Was macht das Zertifikat „verifizierbar“ und nicht nur zu einem PDF?

Es ist mit einem HMAC signiert. Ein Prüfer berechnet die Signatur über den Inhalt des Zertifikats neu und gleicht sie mit dem ab, was Builderforce ausgestellt hat. Wurde irgendetwas verändert – der Name, der Kurs, das Datum –, stimmt die Signatur nicht überein, sodass Manipulation erkennbar ist.

### Woher weiß die Plattform, dass ich den Kurs wirklich abgeschlossen habe?

Ihr Fortschritt wird in einem xAPI Learning Record Store erfasst, während Sie Lektionen, SCORM-Pakete und Lernpfad-Knoten durcharbeiten. Das Zertifikat wird auf Grundlage dieser Aufzeichnungen ausgestellt, nicht auf Basis eines selbst gesetzten Häkchens.

### Kann ich das Zertifikat auf mein Profil setzen?

Ja. Sie können es auf Ihrem Profil anzeigen, an Bewerbungen anhängen oder den verifizierbaren Link direkt an einen Arbeitgeber senden, der die Echtheit unabhängig bestätigen kann.

---

**Probieren Sie es aus:** [Kurse](/training) auf Builderforce.
