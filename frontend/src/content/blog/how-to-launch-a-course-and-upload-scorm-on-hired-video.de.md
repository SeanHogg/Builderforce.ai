## Wer einen Kurs erstellen kann

Die Kurserstellung bei Builderforce steht Creators und Arbeitgebern offen – dieselbe Berechtigungsprüfung (`resolveAuthorEligibility`) regelt sowohl die Erstellung von Kursen als auch von Klassenzimmern. Studierende sind Jobsuchende im Lernmodus; für die Veröffentlichung brauchen Sie kein separates „Dozenten“-Konto.

Ein Kurs ist die richtige Form, wenn Sie strukturiertes Material zum Selbstlernen haben: ein Onboarding-Curriculum, einen Zertifizierungs-Vorbereitungspfad oder einen Skills-Kurs, den Sie verkaufen. Wenn Sie lieber einen Live-Kurs in einer Kohorte mit Aufgaben durchführen möchten, lesen Sie den Leitfaden zum Klassenzimmer – beide nutzen dieselbe Infrastruktur, lösen aber unterschiedliche Aufgaben.

## Schritt 1: Den Kurs anlegen und Module hinzufügen

Öffnen Sie im Creator-Dashboard [Kurse](/training) und legen Sie einen neuen Kurs an. Geben Sie ihm einen Titel, eine Beschreibung und die Zielgruppe. Fügen Sie dann Module hinzu – jedes Modul ist eine Einheit des Curriculums, und Module enthalten Lektionen.

Strukturieren Sie den Pfad, bevor Sie ihn füllen. Lernende sollten Ihre Modulliste lesen und den roten Faden verstehen können: erst Grundlagen, dann Anwendung, dann Bewertung. Die Reihenfolge zählt, weil Lernpfade Voraussetzungen unterstützen – spätere Module können frühere verlangen.

## Schritt 2: Ein SCORM-1.2-Paket hochladen

Wenn Sie Inhalte in einem Tool wie Articulate Storyline, iSpring oder Adobe Captivate erstellt haben, exportieren Sie sie als SCORM-1.2-Paket (eine .zip-Datei) und laden Sie sie als Lektion hoch. Builderforce bringt eine integrierte SCORM-1.2-Laufzeitumgebung mit, sodass Abschluss, Punktzahl und Lesezeichen-Aufrufe des Pakets nativ erfasst werden – ein LMS eines Drittanbieters ist nicht nötig.

SCORM ist die richtige Wahl, wenn Ihre Inhalte interaktiv sind (verzweigte Szenarien, eingebettete Quizze, Drag-and-drop). Für einfache Video- oder Textlektionen brauchen Sie SCORM überhaupt nicht – erstellen Sie sie direkt als Lektionen.

## Schritt 3: Den Abschluss mit dem xAPI-LRS verfolgen

Über SCORM hinaus enthält Builderforce einen xAPI Learning Record Store. Statements („Lernende/r X hat Aktivität Y abgeschlossen“) werden im LRS aufgezeichnet und liefern Ihnen einen dauerhaften, abfragbaren Nachweis darüber, wer was getan hat – über SCORM-Pakete, native Lektionen und Lernpfad-Knoten hinweg.

Genau das gibt einem Abschluss Bedeutung. Wenn Lernende den geforderten Pfad beenden, liegt der Nachweis im LRS vor – die Grundlage für ein Zertifikat, dem Dritte tatsächlich vertrauen können.

## Schritt 4: Ein verifizierbares Zertifikat ausstellen

Nach dem Abschluss kann Builderforce ein mit einem HMAC signiertes Zertifikat ausstellen, dessen Echtheit sich später überprüfen lässt. Inhaber teilen das Zertifikat; ein Prüfer kontrolliert die Signatur und bestätigt, dass es tatsächlich für diese Person und diesen Kurs ausgestellt wurde – es lässt sich nicht durch Bearbeiten eines PDFs fälschen.

Zertifikate fügen sich auch in die Gamification ein: Abgeschlossenes Lernen bringt Punkte und kann Badges freischalten, was Lernende im Pfad in Bewegung hält. Veröffentlichen Sie den Kurs, legen Sie seinen Preis fest (oder machen Sie ihn kostenlos), und Lernende melden sich an, kommen voran und erwerben einen Nachweis, der einer Prüfung standhält.

## Häufig gestellte Fragen

### Brauche ich ein externes LMS, um SCORM zu hosten?

Nein. Builderforce hat eine integrierte SCORM-1.2-Laufzeitumgebung: Sie laden Ihre SCORM-.zip als Lektion hoch, und die Plattform erfasst Abschluss, Punktzahl und Lesezeichen direkt. Außerdem gibt es einen xAPI-LRS für die Nachverfolgung auf Statement-Ebene über alle Lektionstypen hinweg.

### Sind die Zertifikate tatsächlich verifizierbar?

Ja. Zertifikate werden mit einem HMAC signiert, sodass ein Prüfer bestätigen kann, dass das Zertifikat tatsächlich für eine bestimmte Person und einen bestimmten Kurs ausgestellt wurde. Das macht Manipulationen erkennbar – anders als ein einfaches PDF lässt es sich nicht durch Bearbeiten des Textes fälschen.

### Können auch Arbeitgeber Kurse erstellen oder nur Creators?

Beide. Kurs- und Klassenzimmer-Erstellung teilen sich eine Berechtigungsprüfung, daher können Creators wie Arbeitgeber veröffentlichen. So kann ein Unternehmen ein Onboarding- oder Compliance-Curriculum auf derselben Oberfläche aufbauen, auf der ein Creator einen Skills-Kurs verkauft.

---

**Probieren Sie es aus:** [Kurse](/training) auf Builderforce.
