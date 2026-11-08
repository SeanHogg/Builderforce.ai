## Warum Back-to-Back besser ist als asynchron

Asynchrone Video-Lebensläufe haben ihren Platz – damit screenen Sie an einem Abend 100 Kandidaten. Doch bei Kandidaten, die bereits auf Ihrer Shortlist stehen, verliert asynchrones Screening drei Dinge, die synchrones Screening behält:

1. **Rückfragen in Echtzeit.** Eine aufgezeichnete Antwort können Sie nicht bitten, sich zu erklären.
2. **Eindruck von Energie und Kulturpassung.** Asynchron werden genau die Momente herausgeschnitten, die Ihnen verraten, ob Sie mit jemandem wirklich zusammenarbeiten wollen.
3. **Tempo bis zur Entscheidung.** Rein asynchrone Schleifen kosten pro Runde 3–5 Tage; mit Back-to-Back-Blöcken treffen Sie die Entscheidung noch am selben Tag.

ZipRecruiters ZipIntro ist das klassische Produkt in diesem Bereich. Die Live Screening Sessions von Builderforce sind derselbe Workflow zu einem Bruchteil der Kosten – und sie fügen sich in die Ergebnisse des AI Recruiter Agent v2 aus dem vorherigen Artikel ein.

## Schritt 1: Zeitfenster festlegen

Senden Sie mit dem Zeitfenster einen `POST /api/recruiter/live-screen/sessions` ab:

```json
{
  "title": "Staff Backend Engineer first-rounds",
  "jobId": "<uuid>",
  "startTime": "2026-06-03T13:00:00Z",
  "endTime": "2026-06-03T15:00:00Z",
  "slotMinutes": 15,
  "meetingUrl": "https://meet.google.com/abc-defg-hij"
}
```

Die Session wird in `live_screening_sessions` mit dem Status `scheduled` gespeichert. Das Fenster dauert 2 Stunden; bei 15-Minuten-Slots ergibt das eine Kapazität von 8 Kandidaten. Sie können jede Slotlänge zwischen 3 und 60 Minuten wählen – die meisten Recruiter landen bei 8 Minuten für das Screening und 15 für tiefere Erstgespräche.

## Schritt 2: Kandidaten einplanen

Senden Sie Ihre Kandidatenliste per POST an `/sessions/:id/schedule`:

```json
{
  "candidates": [
    { "candidateId": "…", "candidateName": "Alice Chen", "candidateEmail": "alice@example.com" },
    { "candidateId": "…", "candidateName": "Bob Park", "candidateEmail": "bob@example.com" }
  ]
}
```

Die reine Funktion `buildBackToBackSchedule` teilt Ihr Fenster in aufeinanderfolgende Slots auf und ordnet ihnen die ersten N Kandidaten zu. Die Antwort nennt Ihnen die Kapazität, wie viele eingeplant wurden und welche (falls welche) überzählig waren – nützlich, wenn Sie mehr Kandidaten auf die Shortlist gesetzt haben, als Ihr Fenster fasst.

Jede Einladung erhält einen 32 Byte langen, nicht erratbaren `invite_token`. Schicken Sie dem Kandidaten per E-Mail oder SMS den Link `https://Builderforce/live-screen/invite/{token}` – für die Antwort braucht er kein Builderforce-Konto.

## Schritt 3: Der Kandidat nimmt an (oder lehnt ab)

Wenn der Kandidat seine Einladungs-URL aufruft, sieht er die Uhrzeit seines Slots und den Titel der Session. Mit einem Klick kann er zu- oder absagen. Die öffentlichen Endpunkte – `GET /api/live-screen/invites/:token` und `POST /api/live-screen/invites/:token/respond` – erfordern keine Authentifizierung, sodass der Link aus jedem Posteingang funktioniert.

Die Meeting-URL wird **erst nach der Zusage des Kandidaten angezeigt**. Das verhindert das Weitergeben der URL und liefert Ihnen eine saubere Annahmequote: Wer abgelehnt hat, hat den Meeting-Link nie gesehen.

In Ihrem Dashboard sehen Sie, wie die Einladungsliste von `pending` zu `accepted` / `declined` wechselt, während die Kandidaten antworten. Die meisten Einladungen werden innerhalb von 24 Stunden beantwortet; die wenigen übrigen können Sie vor Beginn des Fensters erneut anstupsen oder ersetzen.

## Ablauf am Tag selbst

**T-30 Minuten.** Öffnen Sie die Detailansicht der Session. Prüfen Sie, ob die Zahl der angenommenen Einladungen Ihren Erwartungen entspricht. Schreiben Sie Kandidaten ohne Antwort ein letztes Mal an.

**T-0.** Öffnen Sie die Meeting-URL. Kandidat 1 steigt für 15 Minuten ein. Sie stellen 2–3 Fragen und machen sich Notizen im Dashboard. Bei T+15 verlässt Kandidat 1 den Raum und Kandidat 2 tritt bei – derselbe Raum, dieselbe URL, Back-to-Back.

**T+Session.** Nachdem der letzte Kandidat gegangen ist, setzen Sie den Status der Session auf `completed`. Markieren Sie optional jede Einladung, bei der niemand erschienen ist, als `no_show`. Befördern Sie die stärksten 2–3 über die normale Pipeline in Ihre nächste Runde.

Ein 2-Stunden-Block erlaubt es Ihnen, 8 Kandidaten à 15 Minuten zu interviewen. Das waren früher zwei Wochen „lass uns einen Termin finden“. Jetzt ist es ein Dienstagnachmittag.

## ROI im Vergleich zur Terminabstimmung per Telefon-Pingpong

**Der Telefon-Pingpong-Workflow:** 8 Kandidaten × (3 E-Mails + 1 Terminverschiebung + 30-Minuten-Gespräch + 5 Minuten Nachbereitung) = ca. 4,5 Stunden Recruiter-Zeit + 14 Kalendertage von „interessiert“ bis „Entscheidung“.

**Der Live-Screen-Workflow:** 8 Kandidaten × (1 Einladung + 15-Minuten-Slot) = ca. 2,5 Stunden Recruiter-Zeit + 3 Kalendertage.

Eingesparte Zeit pro 8 Kandidaten: **2 Stunden Recruiter-Arbeit + 11 Tage Durchlaufzeit**. Die Durchlaufzeit zählt mehr als die Recruiter-Stunden – der Kandidat mit drei laufenden Angeboten sagt dem Unternehmen zu, das am schnellsten ist. Live-Screen-Blöcke machen Durchlaufzeit zu Ihrem Wettbewerbsvorteil.

## Häufig gestellte Fragen

### Brauchen Kandidaten ein Builderforce-Konto, um eine Einladung anzunehmen?

Nein. Der Zusage-/Absage-Ablauf ist vollständig Token-basiert – die Einladungs-URL enthält einen 32 Byte langen, nicht erratbaren Token, und die öffentlichen Endpunkte erfordern keine Authentifizierung. Der Kandidat kann mit einem Klick von jedem Gerät und aus jedem Posteingang antworten.

### Stellt Builderforce den Videoraum bereit?

Nicht in diesem Release. Sie stellen die Meeting-URL (Zoom, Meet, Whereby) bereit, und Builderforce übernimmt Matching, Terminplanung, Einladungen, Zusage-Ablauf und Erinnerungen. Ein nativer WebRTC-Raum steht auf der Roadmap (Gap Register #1210), doch externe Räume funktionieren heute gut und erlauben es Ihnen, Ihre vorhandenen Tools weiterzuverwenden.

### Kann ich Kandidaten aus einem früheren Agent-Lauf automatisch zuordnen?

Das automatische Zuordnen aus einem gespeicherten Agent-Lauf in eine Session steht auf der Roadmap (Gap Register #1208). Heute senden Sie die Kandidatenliste explizit per POST. Das gängigste Muster: den AI Recruiter Agent laufen lassen (Top 8 nach Score), diese IDs in den Body von `/schedule` kopieren, absenden. Zwei Minuten von Anfang bis Ende.

---

**Probieren Sie es aus:** [Live Screening Sessions](/hires) auf Builderforce.
