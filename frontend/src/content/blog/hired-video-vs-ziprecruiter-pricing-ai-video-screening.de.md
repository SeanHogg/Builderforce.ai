## Die Kennzahlen im Überblick

**ZipRecruiter (2026):** Standard ca. 299–399 $/Monat pro Stellen-Slot. Premium ca. 419–519 $. Pro ca. 719–899 $. Individuell angeboten nach Branche, Standort und Slot-Volumen.

**Builderforce Pro:** ein monatlicher Pauschalpreis mit vergünstigter Jahresoption. Die aktuellen Zahlen und die Limits der Tarife stehen auf der [Preisseite](/pricing).

Der Preisunterschied beträgt in der Einstiegsstufe etwa das 30-Fache *pro Slot*. ZipRecruiters slotbasierte Preisgestaltung ist die tragende Annahme: Je mehr Rollen Sie besetzen, desto stärker skaliert sie.

## KI-Matching: ZipRecruiter vs. Builderforce

**ZipRecruiter** nutzt einen KI-Matching-Algorithmus, der Ihre Stelle an über 100 Partnerseiten syndiziert und Top-Kandidaten zur Bewerbung einlädt. Die „KI-gematchten Einladungen“ sind das zentrale Wertversprechen.

**Builderforce** nutzt eine KI-Matching-Oberfläche plus einen aktiven Sourcing-Agenten. Der AI Recruiter Agent v2 (`/api/recruiter/agent/intake` + `/source`) lädt Kandidaten nicht nur zur Bewerbung ein – er sourct sie aus der Lebenslauf-Datenbank, bewertet jeden gegen die Rolle und entwirft personalisierte Ansprache.

Der Unterschied: ZipRecruiters KI ist *passiv* (sie wartet darauf, dass gematchte Kandidaten zusagen). Builderforces KI ist *aktiv* (sie holt sie). Bei Rollen, für die die besten Kandidaten nicht aktiv auf Jobsuche sind, gewinnt aktives Sourcing.

## Video-Screening: ZipIntro vs. Live-Screening-Sessions

**ZipIntro (ZipRecruiter):** Der Recruiter wählt ein Zeitfenster, ZipRecruiter matcht Kandidaten und lädt sie zu aufeinanderfolgenden kurzen Videogesprächen in einem einzigen Block ein. Das Aushängeschild von ZipRecruiter für 2026.

**Live-Screening-Sessions (Builderforce):** Derselbe Workflow. Der Recruiter legt Fenster und Slot-Länge fest, übermittelt Kandidaten über `/sessions/:id/schedule`, Kandidaten sagen über einen tokenisierten öffentlichen Link zu oder ab, aufeinanderfolgende Slots werden geliefert.

Die wichtigsten Unterschiede:
- **Kosten.** ZipIntro ist in ZipRecruiter Pro enthalten (ca. 719 $+/Monat). Live-Screening-Sessions sind in Builderforce Pro enthalten; den aktuellen Preis finden Sie auf der [Preisseite](/pricing).
- **Kandidatenpool.** ZipIntro matcht automatisch aus ZipRecruiters Kandidatendatenbank. Builderforces Ablauf erwartet derzeit, dass Sie Kandidaten explizit per POST übermitteln – typischerweise aus einem vorherigen Lauf des AI Recruiter Agent. Automatisches Matching aus dem Agenten steht auf der Roadmap (Gap Register #1208).
- **Meeting-Infrastruktur.** ZipIntro hostet das Videogespräch. Builderforce nutzt Ihre Meeting-URL (Zoom / Meet / Whereby). Schlankerer Infrastruktur-Fußabdruck, mehr Tool-Auswahl. Natives WebRTC steht auf der Roadmap (Gap Register #1210).

## Verbreitung: Spielt die Reichweite eine Rolle?

ZipRecruiters Pitch ist die Verbreitung: einmal posten, an über 100 Partnerseiten syndizieren. Das ist für allgemeine Rollen tatsächlich wertvoll, doch der Nutzen konzentriert sich auf die ersten drei Börsen (Indeed, Google for Jobs, Glassdoor) – die langen Ausläufer der übrigen 97+ Seiten tragen kaum etwas bei.

Builderforce verteilt an Google for Jobs und an die eigene aktive Kandidatenbasis. Bei spezialisierten Rollen (Engineering, Design, Produkt, Vertrieb, Führungsebene) schneidet die gezielte Builderforce-Zielgruppe oft besser ab als das diffuse Streuen über 100 Börsen.

Entscheidungsregel: Wenn Ihre Rolle generisch ist und hohes Volumen hat, lohnt sich ZipRecruiters Verbreitung den Aufpreis. Wenn Ihre Rolle spezialisiert und qualitätskritisch ist, ist Builderforces tieferer Workflow pro Rolle der bessere Hebel.

## Wann Sie was wählen

**Wählen Sie ZipRecruiter, wenn:** Sie 1–3 generische Rollen pro Quartal besetzen und die Verbreitung das Wertversprechen ist; Sie verwaltete Syndizierung über 100+ Börsen ohne manuelles Cross-Posting möchten; das Budget nicht die bindende Einschränkung ist.

**Wählen Sie Builderforce, wenn:** Sie 5+ Rollen pro Quartal besetzen (die Slot-Preise von ZipRecruiter werden dann prohibitiv); Sie KI-gesteuertes Sourcing + Scoring + Ansprache + Nachfassen in einem Workflow wollen; Sie einen monatlichen Pauschaltarif statt Slot-Preisen möchten; ZipIntro reizvoll ist, aber 719 $/Monat speziell dafür nicht.

**Nutzen Sie beide:** Schalten Sie Ihre am schwersten zu besetzende Rolle auf ZipRecruiter Pro für die Verbreitung, wickeln Sie alle anderen Rollen auf Builderforce ab und führen Sie Ihr gesamtes Video-Screening über Builderforce-Live-Screening-Sessions durch.

## Häufig gestellte Fragen

### Ist Builderforce Live Screening so schlüsselfertig wie ZipIntro?

Der Recruiter-Workflow hat dieselbe Form: Fenster festlegen, Kandidaten einplanen, Zusage-Ablauf, aufeinanderfolgende Slots. Die wesentliche Reifelücke ist das automatische Matching – ZipIntro füllt den Block automatisch aus der eigenen Kandidatenbasis; Builderforce erwartet heute, dass Sie Kandidaten aus einem vorherigen Lauf des AI Recruiter Agent per POST übermitteln, mit automatischem Matching auf der Roadmap.

### Was berechnet ZipRecruiter pro Video-Screening?

ZipIntro ist in ZipRecruiter Pro enthalten (ca. 719–899 $/Monat pro Stellen-Slot). Builderforce-Live-Screening-Sessions sind im Pauschaltarif Pro enthalten.

### Kann ich meine ZipRecruiter-Kandidaten nach Builderforce exportieren?

ZipRecruiter bietet keine vollständige API für Kandidatenlisten, aber die Builderforce-Chrome-Erweiterung kann Kandidatenprofile extrahieren, auf die Sie in Ihrem ZipRecruiter-Dashboard Zugriff haben, und sie in Ihren Talentpool übertragen.

---

**Probieren Sie es aus:** [Builderforce für Recruiter](/hires) auf Builderforce.
