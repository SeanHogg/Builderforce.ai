```bf-figure
{
  "kind": "launch",
  "title": "Studio mit einer 3D-Welt öffnen",
  "links": [
    {
      "label": "3D-Welt-Lebenslauf starten",
      "hue": "build",
      "href": "/create/new?prompt=Create+a+3D+World+r%C3%A9sum%C3%A9+scene%3A+a+small+explorable+room+with+a+desk%2C+three+project+pedestals+a+visitor+can+walk+up+to%2C+and+a+nameplate+with+my+headline.",
      "note": "Szenenbasierte Engine – Three.js, React Three Fiber, Rapier-Physik."
    },
    {
      "label": "Studio",
      "hue": "muted",
      "href": "/creation-canvas",
      "note": "Der Editor selbst: Viewport, Objektpalette und Inspektor."
    }
  ],
  "caption": "Eine 3D-Welt ist `mediaKind: \"game\"` auf der Engine `world-3d` und keine der älteren, Sprite-basierten Minispiel-Vorlagen."
}
```

## Der spielbare Lebenslauf

Das kühnste Format, das die Builderforce Creation Canvas unterstützt, ist eine 3D-Welt – eine erkundbare Szene, durch die ein Recruiter laufen kann. Für eine Stelle in der Buchhaltung ist das übertrieben, für Spieleentwickler, 3D-Künstlerinnen, Technical Artists oder XR-Entwickler, die beweisen müssen, dass sie interaktives 3D ausliefern können, ist es genau richtig.

Unter der Haube ist das 3D-Welt-Studio ein Dokument mit `mediaKind: "game"` und dem Unterscheidungsmerkmal `engine: "world-3d"`, aufgebaut auf Three.js und React Three Fiber mit einer Rapier-Physikschicht. Sie platzieren Objekte, verdrahten Interaktionen, und das Ergebnis läuft in jedem modernen Browser – ohne Unity- oder Unreal-Installation, ohne Plugin.

## Schritt 1: Ein 3D-Welt-Dokument anlegen

Öffnen Sie das [Studio](/creation-canvas), legen Sie ein neues Dokument an und wählen Sie den Spieltyp **3D-Welt**. Der Editor lädt einen 3D-Viewport, eine Objektpalette und einen Inspektor. (Die älteren 2D-Spielvorlagen gibt es weiterhin – sie tragen jetzt das Label „Minispiel“ –, aber eine 3D-Welt ist die vollwertige szenenbasierte Engine.)

Beginnen Sie mit einer einfachen Bodenfläche und einem Spawn-Punkt. Widerstehen Sie dem Drang, ein ganzes Level zu bauen. Ziel ist ein kurzer, geführter Spaziergang, der Ihre Geschichte erzählt, kein Open-World-Spiel.

## Schritt 2: Objekte platzieren und Physik hinzufügen

Ziehen Sie Objekte aus der Palette in die Szene: Plattformen, Requisiten, Textpanels und Trigger-Zonen. Jedes Objekt hat eine Transformation (Position, Rotation, Skalierung), die Sie im Inspektor festlegen. Fügen Sie Objekten, die kollidieren oder fallen sollen, einen Rapier-Physikkörper hinzu – die Engine übernimmt die Simulation, sodass eine fallen gelassene Requisite auf dem Boden landet, ohne dass Sie eine Physikschleife schreiben.

Nutzen Sie Textpanels als erzählerisches Rückgrat: ein Panel am Eingang mit Ihrem Namen und Ihrer Headline, Panels entlang des Wegs mit Beschreibungen der einzelnen Projekte, ein Panel am Ende mit dem, was Sie suchen. Die Spielerin liest den Lebenslauf, indem sie sich durch ihn bewegt.

## Schritt 3: Interaktionen verdrahten

Trigger-Zonen machen aus der Szene ein Erlebnis statt eines Dioramas. Hängen Sie eine Interaktion an eine Zone, sodass das Betreten ein Projektpanel einblendet, einen Sound abspielt oder die Kamera weiterbewegt. Halten Sie Interaktionen auffindbar – ein Recruiter, der Ihre Welt zum ersten Mal erkundet, sollte keine versteckte Mechanik erraten müssen, um Ihre Arbeit zu sehen.

Ein bewährtes Muster: ein linearer Pfad mit optionalen Nebenräumen. Der Hauptpfad erzählt Ihre Kerngeschichte in 60–90 Sekunden Laufzeit; die Nebenräume enthalten vertiefende Panels für Recruiter, die mehr wollen.

## Schritt 4: Veröffentlichen und den Link teilen

Eine 3D-Welt wird als spielbares, per Link teilbares Erlebnis veröffentlicht, das im Browser läuft. Da das Studio für seine Laufzeit cross-origin-isoliert läuft, wird die Szene mit selbst gehosteten Assets geladen und ohne Download abgespielt.

Teilen Sie den Link in Ihrer Bewerbung, auf Ihrem Profil oder in einem Creator-Beitrag. Bei Rollen für interaktives 3D ist eine spielbare Welt das Portfolio-Stück – sie beweist auf direkteste Weise, dass Sie genau das ausliefern können, wonach die Stelle verlangt.

## Häufig gestellte Fragen

### Muss ich programmieren können, um eine 3D-Welt zu bauen?

Nein. Sie platzieren Objekte, legen Transformationen im Inspektor fest und verdrahten Interaktionen über Trigger-Zonen – alles visuell. Programmierkenntnisse erlauben es, weiterzugehen, aber der Kernaufbau ist ein Workflow aus Ziehen, Platzieren und Konfigurieren.

### Was ist der Unterschied zwischen einer 3D-Welt und einem Minispiel?

Eine 3D-Welt ist eine vollwertige szenenbasierte Engine – `mediaKind: "game"` mit der Engine `world-3d` – auf Basis von Three.js, React Three Fiber und Rapier-Physik. Die 2D-Spielvorlagen tragen jetzt das Label „Minispiel“ und sind einfachere, Sprite-basierte Erlebnisse. Für eine Lebenslauf-Szene, die ein Recruiter in 3D erkundet, nutzen Sie die 3D-Welt.

### Muss ein Recruiter etwas installieren, um sie zu sehen?

Nein. Die Welt läuft in jedem modernen Browser über WebGL. Sie teilen einen Link, er klickt und erkundet. Keine Game-Engine, kein Plugin, kein Download.

---

**Probieren Sie es aus:** [Studio](/creation-canvas) auf Builderforce.
