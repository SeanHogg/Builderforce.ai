Jedes KI-Werkzeug, das Sie nutzen, beginnt das Gespräch bei null.

Sie erklären das Projekt noch einmal. Sie wiederholen die Entscheidung von letzter Woche, die Konvention, auf die Sie sich geeinigt haben, den Grund, warum Sie die naheliegende Lösung verworfen haben. Das Werkzeug antwortet gut – und vergisst es. Morgen erklären Sie es wieder: einem anderen Werkzeug, in einem anderen Fenster, mit denselben Worten.

Und wenn die Antwort lautet „das muss erledigt werden“, hilft der Chat nicht mehr weiter. Die Arbeit liegt woanders: auf einem Board, in einem Ticket, bei einem Agenten, den Sie in einem anderen Tab eingestellt haben.

Das ist die Lücke: **Das, womit Sie sprechen, kennt Sie nicht – und es kann die Arbeit nicht an die übergeben, die sie erledigen könnten.**

## Fragen Sie das Gehirn, das Sie kennt

Synapse meldet sich jetzt so bei Builderforce an wie die VS-Code-Erweiterung: Sie bestätigen einen Code im Browser, und der Schlüssel bleibt im Anmeldeinformationsspeicher Ihres Systems. Die Chats Ihres Arbeitsbereichs kommen mit: dieselben Unterhaltungen wie im Web und in Ihrem Editor.

```bf-figure
{
  "kind": "flow",
  "title": "Von einer Frage zu erledigter Arbeit",
  "steps": [
    { "label": "Fragen", "note": "Schreiben Sie dem Brain aus Synapse, in jedem Chat Ihres Arbeitsbereichs.", "hue": "idea" },
    { "label": "Erinnern", "note": "Bevor es antwortet, erinnert sich Ihr privates Evermind daran, was Ihre eigenen Werkzeuge über die Frage gelernt haben – auf Ihrem Rechner.", "hue": "make", "tag": "privat" },
    { "label": "Zuweisen", "note": "Wenn es Arbeit ist, fügen Sie dem Chat einen Agenten hinzu und sprechen ihn mit @ an.", "hue": "run" },
    { "label": "Vom Agenten erledigt", "note": "Der Agent antwortet mit seinen eigenen Werkzeugen, in Ihrem Namen – nie über das hinaus, was Sie selbst dürften.", "hue": "run" }
  ],
  "caption": "Das Brain beantwortet, was es mit Ihrem vorhandenen Wissen kann; Agenten erledigen, was Werkzeuge braucht."
}
```

Die Antwort des Brain stützt sich auf Ihr eigenes Gedächtnis. Die Fakten, die sich Ihre Coding-Agenten gemerkt haben, die Abläufe, die Sie Synapse beigebracht haben, die Konventionen, bei denen Sie sie korrigiert haben – sie werden für diese eine Frage auf Ihrem Rechner abgerufen, und nur die wenigen, die zählen, gehen mit.

## Übergeben Sie die Arbeit an einen Agenten

Jeder Chat hat seine Agenten: die, die Ihr Arbeitsbereich eingestellt, gekauft oder registriert hat. Weisen Sie einen im Chat zu und sprechen Sie ihn an – wählen Sie ihn unter *An* oder beginnen Sie die Nachricht mit `@` und seinem Namen.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Chat",
  "ratio": 1.6,
  "regions": [
    { "label": "Ihre Chats", "note": "Dieselben Unterhaltungen wie in der Web-App und in VS Code", "x": 3, "y": 8, "w": 24, "h": 86, "hue": "muted" },
    { "label": "Agenten in diesem Chat", "note": "Aus dem Pool Ihres Arbeitsbereichs zuweisen; mit einem Klick entfernen", "x": 30, "y": 8, "w": 67, "h": 12, "hue": "accent" },
    { "label": "Die Unterhaltung", "note": "Von wem jede Antwort kam – Ihnen, dem Brain oder dem Agenten – und an wen jede Nachricht ging", "x": 30, "y": 24, "w": 67, "h": 52, "hue": "run" },
    { "label": "An: Brain oder @Agent", "note": "Enter sendet; der angesprochene Agent antwortet mit seinen eigenen Werkzeugen", "x": 30, "y": 80, "w": 67, "h": 14, "hue": "make" }
  ],
  "caption": "Eine Nachricht an das Brain wird auf Ihrem Desktop mit Ihrem privaten Gedächtnis beantwortet; eine Nachricht an einen Agenten beantwortet dieser Agent."
}
```

Der Agent läuft auf der Plattform mit seinen eigenen Werkzeugen, in Ihrem Namen und innerhalb Ihrer Berechtigungen – derselbe Agent, den Sie im Web erreichen würden, jetzt nur ein `@` von der Unterhaltung entfernt, in der Sie ohnehin sind.

## Sehen Sie ihm beim Lernen zu

Synapse zeichnet Ihr Evermind als Gehirn und behält es in der Seitenleiste, wo Sie es sehen können.

```bf-figure
{
  "kind": "compare",
  "title": "Zwei Hemisphären, aus Ihren eigenen Daten",
  "columns": [
    { "title": "Links – was es weiß", "hue": "make", "items": ["Neokortex: Abläufe, die Ihr privates Modell in seine Gewichte gelernt hat", "Semantisches Gedächtnis: Fakten, die sich jedes KI-Werkzeug auf diesem Rechner gemerkt hat", "Thalamus: was Ihre Werkzeuge gerade den Code-Index fragen"] },
    { "title": "Rechts – was es tut", "hue": "run", "items": ["Hippocampus: Vorführungen, die Sie aufgezeichnet haben", "Basalganglien: Fähigkeiten, die es kompiliert hat, und wie ihre Ausführungen liefen", "Amygdala: unumkehrbare Schritte, bei denen es angehalten und Sie gefragt hat", "Hypothalamus: Routinen, die es von selbst starten"] }
  ],
  "caption": "Jede Zahl stammt aus Ihrem Speicher. Eine Region leuchtet, während sie lernt; neues Wissen pulsiert herein."
}
```

Öffnen Sie Evermind, und das Gehirn füllt die Seite: was das Modell gelernt hat und was noch wartet, der Trainingsverlust jeder Anpassung, dreißig Tage an Vorführungen, Fähigkeiten, Ausführungen und Gelerntem, und eine Liste dessen, was es zuletzt aufgenommen hat – klicken Sie auf eine Region, um nur zu sehen, was dort gelandet ist.

## Wo es in der Methode steht

Arbeit auf Builderforce folgt einem Bogen – **Idee → Machen → Betreiben → Messen** – und jeder Akt läuft durch dieselbe innere Schleife: [Lesen, Beweisen, Bauen](/blog/read-prove-build-the-inner-loop).

Im Chat beginnt die **Idee**, und bisher begann sie kalt. Jetzt ist das erste **Lesen** Ihr eigenes Gedächtnis: Bevor das Brain antwortet, liest es, was Sie und Ihre Werkzeuge bereits festgehalten haben – die Idee beginnt dort, wo Sie aufgehört haben, nicht bei null.

Beim **Betreiben** sind die Agenten, und einen aus dem Chat anzusprechen ist die Übergabe vom Reden zum Tun, ohne die Unterhaltung zu verlassen.

**Messen** ist das Gehirn. Was Sie beigebracht haben, was lief, was das Modell gelernt hat und wie sich sein Verlust bewegt hat, wird aus dem Speicher gezeichnet, nicht beschrieben – ein sichtbarer Beweis dafür, dass die private Fähigkeit wirklich wächst.

## Was Sie heute tun können

- **Sich aus Synapse bei Builderforce anmelden** und in denselben Chats arbeiten wie in der Web-App und in VS Code.
- **Das Brain fragen** und Antworten bekommen, die auf dem beruhen, was Ihr privates Evermind auf Ihrem Rechner gelernt hat.
- **Agenten einem Chat zuweisen und sie mit @ ansprechen** – sie erledigen die Arbeit mit ihren eigenen Werkzeugen, in Ihrem Namen.
- **Ihrem Evermind beim Lernen zusehen** in der Seitenleiste, und das Gesamtbild – Regionen, Trainingsverlust, dreißig Tage Aktivität – auf der Evermind-Seite sehen.

[Laden Sie Synapse herunter](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true), öffnen Sie **Chat** und melden Sie sich mit Ihrem Browser an.

---

**Weiterlesen:** [Einmal beibringen, dann erledigt es das immer wieder](/blog/teach-it-once-and-it-does-it-again) · [Ein lokaler Index für jedes KI-Werkzeug auf Ihrem Rechner](/blog/one-local-index-for-every-ai-tool)
