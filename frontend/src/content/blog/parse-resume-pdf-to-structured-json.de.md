## Das Problem beim Parsen von Lebensläufen

Lebensläufe sind von Natur aus unstrukturiert. Es gibt keinen universellen Standard für Layout, Abschnittsbenennung, Datumsformate oder inhaltliche Gliederung. Ein Lebenslauf nennt die Ausbildung vielleicht zuerst oder zuletzt, verwendet „Work Experience“, „Professional Background“ oder „Career History“ und formatiert Daten als „2020–2023“, „Jan 2020 - Dec 2023“ oder „1/2020 to 12/2023“.

Für jedes System, das Lebensläufe in großem Maßstab verarbeiten muss – ATS-Plattformen, Jobbörsen, HR-Analytik, Recruiting-CRMs –, müssen diese unstrukturierten Daten in ein konsistentes, maschinenlesbares Format überführt werden. Das ist Resume Parsing.

Klassische, auf regulären Ausdrücken basierende Parser scheitern wegen Layout-Varianten bei 20–30 % der Lebensläufe. Moderne KI-gestützte Parser wie das PDF-zu-JSON-Tool von Builderforce erreichen über 95 % Extraktionsgenauigkeit, weil sie den Kontext verstehen und nicht nur Muster abgleichen.

## Das Ausgabeschema

Das PDF-zu-JSON-Tool von Builderforce erzeugt ein sauberes JSON-Objekt mit diesen Feldern auf oberster Ebene:

```json
{
  "basics": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string",
    "website": "string",
    "summary": "string"
  },
  "work": [
    {
      "company": "string",
      "position": "string",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM | Present",
      "highlights": ["string"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "graduationDate": "YYYY"
    }
  ],
  "skills": ["string"],
  "certifications": ["string"]
}
```

Dieses Schema ist mit dem JSON-Resume-Standard kompatibel und lässt sich dadurch leicht in bestehende Tools und Pipelines integrieren.

## So verwenden Sie den Parser

**Interaktiv (Browser):**
1. Öffnen Sie das PDF-zu-JSON-Tool unter Builderforce/tools/pdf-to-json.
2. Legen Sie eine PDF-Datei ab oder fügen Sie den Lebenslauftext ein.
3. Klicken Sie auf „Parse“ – die KI extrahiert strukturierte Daten und zeigt das JSON an.
4. Kopieren Sie das JSON oder laden Sie es als .json-Datei herunter.

Der Parser kommt mit mehrspaltigen Layouts, Tabellen, kreativer Gestaltung und unüblichen Abschnittsüberschriften zurecht. Er funktioniert mit PDFs aus Word, Google Docs, LaTeX, Canva und Design-Tools.

## Häufige Stolpersteine beim Parsen

**Reine Bild-PDFs.** Manche PDFs sind gescannte Bilder, kein Text. Sie benötigen vor dem Parsen OCR. Der Parser von Builderforce enthält OCR für gescannte Dokumente, die Genauigkeit sinkt bei Scans niedriger Qualität jedoch auf ca. 85 %.

**Mehrsprachige Lebensläufe.** Der Parser funktioniert am besten mit englischen Lebensläufen. Die Unterstützung anderer Sprachen verbessert sich, kann aber Nuancen bei Datumsformaten und Abschnittsbenennung übersehen.

**Stark gestaltete Lebensläufe.** Lebensläufe mit Infografiken, Zeitleisten, Skill-Balken und kreisförmigen Layouts verlieren bei der Extraktion etwas an Formatierungsnuancen. Die Daten werden weiterhin erfasst, aber rein visuelle Elemente (etwa ein Skill-Balken „85 % Python-Kenntnisse“) lassen sich womöglich nicht in die JSON-Ausgabe übertragen.

**Zusammengeführte Rollen.** Führt jemand zwei Titel im selben Unternehmen in einer Zeile auf („Senior Engineer → Staff Engineer, 2020–2024“), erzeugt der Parser möglicherweise einen Eintrag statt zwei. Prüfen Sie solche Fälle stichprobenartig.

## Häufig gestellte Fragen

### Welche Dateiformate akzeptiert der Parser?

Das PDF-zu-JSON-Tool akzeptiert PDF- und DOCX-Dateien sowie eingefügten Klartext. PDF-Dateien können textbasiert oder gescannt sein (OCR ist enthalten).

### Ist die Ausgabe mit dem JSON-Resume-Format kompatibel?

Ja. Das Ausgabeschema folgt dem JSON-Resume-Standard (jsonresume.org) mit kleinen Erweiterungen für Zertifizierungen und Skills. Sie können die Ausgabe direkt mit jedem JSON-Resume-kompatiblen Tool oder Theme verwenden.

---

**Probieren Sie es aus:** [PDF zu JSON](/tools/pdf-to-json) auf Builderforce.
