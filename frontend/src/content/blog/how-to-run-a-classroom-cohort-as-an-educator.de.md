## Kohorten vs. selbstgesteuerte Kurse

Bei einem selbstgesteuerten Kurs ist die lernende Person allein mit dem Material. Eine Klassenzimmer-Kohorte ist eine *Gruppe*, die gemeinsam nach Zeitplan durch das Material geht, während eine Lehrkraft Aufgaben verteilt und den Fortschritt beobachtet. Kohorten schaffen Verbindlichkeit und Tempo – die beiden Dinge, die Abschlussquoten am stärksten verbessern.

Bei Builderforce ist eine Lehrkraft ein Creator oder Arbeitgeber; ein Studierender ist ein Jobsuchender im Lernmodus. Keines von beidem ist eine neue Rolle – die Kohortenebene sitzt auf den Konten, die Sie bereits haben. Ihre Klassenzimmer finden Sie als Tab auf der Seite „Tools“ unter [/tools?tab=classrooms](/training), und Studierende sehen ihre Seite im Lern-Tab.

## Schritt 1: Ein Klassenzimmer anlegen

Öffnen Sie [Klassenzimmer](/training) und legen Sie eine Kohorte an. Geben Sie ihr einen Namen, eine Beschreibung sowie den Kurs oder Lernpfad, um den sie aufgebaut ist. Die Kohorte ist der Container – sie enthält die Mitglieder und die Aufgaben, die Sie ihnen stellen.

Legen Sie die Form vorab fest: eine Kohorte mit festem Start, bei der alle gemeinsam beginnen, oder eine rollierende Kohorte, der Studierende bei der Anmeldung beitreten. Kohorten mit festem Start erzeugen die stärkste Verbindlichkeit untereinander; rollierende Kohorten sind im großen Maßstab leichter zu betreiben.

## Schritt 2: Studierende einschreiben

Fügen Sie der Kohorte Mitglieder hinzu. Die Mitgliedschaft wird explizit erfasst, und der Zugriff im gesamten Klassenzimmer wird durch dieselbe `canActFor`-Berechtigungsnaht geregelt, die auch der Rest der Plattform nutzt – eine Lehrkraft handelt also in ihrer eigenen Kohorte und kann nicht in die einer anderen eingreifen.

Halten Sie Kohorten klein genug, um Aufmerksamkeit zu geben. Die Verbindlichkeit, die Kohorten wirksam macht, hängt davon ab, dass die Lehrkraft tatsächlich den Fortschritt jedes Studierenden sieht; ab einer gewissen Größe funktioniert das nicht mehr, teilen Sie einen großen Zulauf also auf mehrere Kohorten auf, statt einen riesigen Raum zu bilden.

## Schritt 3: Lernaufgaben verteilen

Aufgaben sind der Hebel der Lehrkraft. Weisen Sie der Kohorte ein Modul, eine Lektion oder einen ganzen Pfad mit Fälligkeitsdatum zu. Studierende sehen die Aufgabe in ihrem Lern-Tab; Sie sehen, wer sie abgeschlossen hat.

Aufgaben sind die Brücke zwischen Inhalt und Tempo. Ein selbstgesteuerter Kurs sagt „hier ist das Material“. Eine Aufgabe sagt „schließen Sie Modul 2 bis Freitag ab“ – und genau diese Änderung bringt eine Kohorte gemeinsam durch das Curriculum, statt auseinanderzudriften.

## Schritt 4: Die Analytics beobachten

Das Klassenzimmer zeigt zwischengespeicherte Kohorten-Analytics – Abschlussquoten, wer im Rückstand ist, wo Studierende stocken. Nutzen Sie sie, um früh einzugreifen: Wer bis zur zweiten Fälligkeit noch nicht angefangen hat, braucht einen Anstoß, bevor er sich ganz abkoppelt.

Da der Abschluss über denselben xAPI-LRS läuft, der auch Kurse trägt, beruhen die Analytics auf echten Aufzeichnungen, nicht auf Selbstauskünften. Wenn die Kohorte fertig ist, stellt dieselbe Zertifikatsmaschinerie, die selbstgesteuerte Kurse antreibt, verifizierbare Nachweise für Ihre Studierenden aus.

## Häufig gestellte Fragen

### Ist „Lehrkraft“ ein separater Kontotyp?

Nein. Eine Lehrkraft ist ein Creator oder Arbeitgeber, und ein Studierender ist ein Jobsuchender im Lernmodus. Die Kohortenebene sitzt auf bestehenden Konten – es gibt keine neue Rolle, für die Sie sich anmelden müssten.

### Wo finde ich meine Klassenzimmer?

Klassenzimmer befinden sich als Tab auf der Seite „Tools“ unter /tools?tab=classrooms, nicht als eigener Eintrag in der Seitenleiste. Studierende sehen ihr eingeschriebenes Lernen unter /tools?tab=learning.

### Wie wird der Zugriff zwischen Kohorten gesteuert?

Über die Berechtigungsprüfung canActFor der Plattform. Eine Lehrkraft handelt nur auf den Mitgliedern und Aufgaben ihrer eigenen Kohorte und kann nicht in eine Kohorte eingreifen, die ihr nicht gehört – so bleiben die Daten der Studierenden dem richtigen Klassenzimmer zugeordnet.

---

**Probieren Sie es aus:** [Klassenzimmer](/training) auf Builderforce.
