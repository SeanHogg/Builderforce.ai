## Wofür die Medienart Podcast gedacht ist

Der Builderforce Creation Canvas ist nicht mehr nur für Video da. Das Studio-Dokument trägt eine `mediaKind` – Video, Podcast, Stimme oder Animation – und die Art „Podcast“ schaltet den Editor in ein Audio-zuerst-Layout: Wellenform-Spuren statt einer visuellen Leinwand, Kapitelmarken statt Szenen und ein Export, der eine saubere MP3 statt eines MP4 erzeugt.

Eine Podcast-Episode ist das richtige Format, wenn Ihre Botschaft besser zu hören als zu sehen ist: eine Karrieregeschichte für Ihr Profil, eine fachliche Erklärung, die Expertise zeigt, oder ein Interview, das Sie als Creator führen. Da dasselbe Dokumentmodell jede Medienart trägt, können Sie mit einem Videoskript beginnen und es in einen Podcast umwandeln, ohne ein Wort neu zu tippen.

## Schritt 1: Das Studio öffnen und die Art Podcast wählen

Öffnen Sie das [Studio](/creation-canvas) und legen Sie ein neues Dokument an. Wählen Sie in der Auswahl für neue Dokumente **Podcast**. Der Editor lädt das Audio-Layout: eine Transportleiste, eine oder mehrere Audiospuren und links ein Skript-Fenster.

Wenn Sie bereits einen Videoentwurf haben, den Sie lieber als Audio einsprechen möchten, öffnen Sie ihn und wechseln Sie in den Dokumenteinstellungen die Medienart – Skript und Kapitelstruktur bleiben erhalten, und die visuellen Ebenen werden im Audio-Export einfach ausgeblendet.

## Schritt 2: Das Skript schreiben oder einfügen

Tippen Sie Ihre Episode in das Skript-Fenster, in Kapitel gegliedert. Jedes Kapitel wird zu einer Marke auf der Timeline, damit Hörer (und Sie beim Schneiden) zwischen den Abschnitten springen können.

Halten Sie Kapitel kurz – jeweils 60 bis 120 Sekunden gesprochenes Audio. Eine 10-minütige Episode umfasst etwa 1.300–1.500 gesprochene Wörter. Der Teleprompter liest während der Aufnahme aus diesem Fenster, schreiben Sie also so, wie Sie sprechen: kurze Sätze, ein Gedanke pro Zeile.

## Schritt 3: Aufnehmen oder KI-Voiceover erzeugen

Es gibt zwei Wege, Audio auf die Spur zu bekommen:

**Selbst aufnehmen.** Klicken Sie auf Aufnahme, lesen Sie vom Teleprompter ab, und das Studio nimmt eine Spur im Browser auf. Nehmen Sie jedes Kapitel einzeln neu auf, ohne den Rest anzutasten – die Kapitelmarken machen den Austausch sauber.

**KI-Voiceover erzeugen.** Wenn Sie mikrofonscheu sind oder einen gleichbleibenden Sprecher möchten, wählen Sie ein Kapitel aus und erzeugen Sie aus dem Skript Text-to-Speech. Das ist dieselbe TTS-Engine wie beim Video-Voiceover; sie arbeitet auf Ihrem Skripttext, sodass Änderungen synchron bleiben.

Die meisten Creators mischen beides: KI-Voiceover für Intros, Outros und werbeartige Segmente, die eigene Stimme für die Teile, die Authentizität brauchen.

## Schritt 4: Bearbeiten, zweite Spur hinzufügen und exportieren

Schneiden Sie Pausen und Versprecher direkt auf der Wellenform heraus. Fügen Sie eine zweite Spur für Intro-Musik oder einen Klangteppich unter Ihrer Sprache hinzu und stellen Sie den Pegel so ein, dass sie hinter Ihrer Stimme liegt. Das Studio rendert den Mix im Browser mit derselben ffmpeg.wasm-Pipeline wie beim Video-Export – ohne Server-Roundtrip und ohne Upload Ihres Rohaudios.

Wenn Sie zufrieden sind, exportieren Sie als MP3. Veröffentlichen Sie sie als Audio-Lebenslauf in Ihrem Profil, hängen Sie sie an einen Creator-Beitrag an oder laden Sie sie für einen externen Podcast-Host herunter. Der gesamte Ablauf – vom Skript bis zur veröffentlichten Episode – findet in einem Tab statt.

## Häufig gestellte Fragen

### Muss ich Software herunterladen, um einen Podcast aufzunehmen?

Nein. Das Studio nimmt auf, bearbeitet und exportiert vollständig im Browser. Die Aufnahme nutzt das Mikrofon Ihres Geräts über den Browser, und der finale Mix wird clientseitig mit ffmpeg.wasm gerendert, sodass Ihr Rohaudio für das Rendern einer Episode nie hochgeladen werden muss.

### Kann ich einen vorhandenen Videoentwurf in einen Podcast umwandeln?

Ja. Da alle Studio-Dokumente ein gemeinsames zugrunde liegendes Modell mit einer mediaKind-Achse teilen, können Sie ein Videodokument auf die Art Podcast umstellen. Skript und Kapitelstruktur bleiben erhalten; die visuellen Ebenen werden aus dem reinen Audio-Export einfach ausgeschlossen.

### Ist KI-Voiceover verpflichtend?

Nein – es ist optional. Sie können vollständig mit Ihrer eigenen Stimme aufnehmen, jedes Kapitel per KI-Voiceover erzeugen oder beides mischen. Der Teleprompter funktioniert in jedem Fall, damit Sie bei der Aufnahme beim Skript bleiben.

---

**Probieren Sie es aus:** [Studio](/creation-canvas) auf Builderforce.
