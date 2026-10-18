# Änderungen kommen an, während Sie zusehen – Hot Updates, echte Stylesheets und die Frameworks, die Sie schon nutzen

Jedes Mal, wenn die Vorschau neu lädt, verlieren Sie Ihre Stelle.

Sie waren im dritten Schritt eines Checkouts, ein Formular halb ausgefüllt, ein Dialog offen, und Sie haben eine Farbe geändert. Die Seite lud neu, das Formular war leer, und Sie klickten sich zurück, um zu sehen, ob die Farbe stimmt. Multiplizieren Sie das mit jeder kleinen Änderung eines Nachmittags, und der Großteil Ihrer Zeit geht dafür drauf, wieder dorthin zu kommen, wo Sie waren.

Hinter dieser Lücke steckte eine zweite. Viele echte Projekte kamen nie bis zur Vorschau. Ein `styles.scss`, ein `Button.module.css`, ein `import 'some-library/dist/styles.css'` oder eine Next.js-App – und die Vorschau scheiterte oder zeigte stillschweigend die Seite ohne ihre Styles.

Dieses Release schließt beide Lücken.

## Änderungen werden an Ort und Stelle übernommen

```bf-figure
{
  "kind": "compare",
  "title": "Eine Farbe ändern",
  "columns": [
    { "title": "Vorher", "hue": "muted", "items": ["Die ganze Seite lädt neu", "Das Formular, das Sie ausgefüllt haben, ist wieder leer", "Der Dialog schließt sich, die Scrollposition springt nach oben", "Sie klicken sich zurück, um die Änderung zu prüfen"] },
    { "title": "Jetzt", "hue": "run", "items": ["Nur das Stylesheet wird ausgetauscht", "Was Sie eingegeben haben, bleibt stehen", "Der Dialog bleibt offen, die Scrollposition bleibt", "Die neue Farbe ist einfach da"] }
  ],
  "caption": "Stylesheet-Änderungen werden an Ort und Stelle ausgetauscht. Änderungen an React-Komponenten rendern die Komponente neu und behalten ihren Zustand. Was sich nicht sicher aktualisieren lässt, lädt wie bisher neu."
}
```

- **Stylesheets werden ausgetauscht.** Ändern Sie eine `.css`-, `.scss`- oder `.less`-Datei, wird nur dieses Stylesheet in der laufenden Seite ersetzt. Nichts lädt neu.
- **React-Komponenten behalten ihren Zustand.** Bearbeiten Sie eine Komponente, wird sie mit dem neuen Code neu gerendert und behält ihren Zustand – mit Reacts eigenem Fast Refresh. Zähler behalten ihren Stand, Formulare ihre Werte.
- **Ein sicherer Rückfall.** Lässt sich eine Änderung nicht an Ort und Stelle anwenden (etwa eine Änderung an der Einstiegsdatei der App), lädt die Seite wie gewohnt neu, damit nichts halb aktualisiert zurückbleibt.

## Stylesheets so, wie echte Projekte sie schreiben

```bf-figure
{
  "kind": "flow",
  "title": "Von Ihrem Quellcode zur Seite",
  "steps": [
    { "label": "styles.scss", "note": "Variablen, Verschachtelung, @use und Partials oder Less mit seinen Mixins", "hue": "make" },
    { "label": "Im Browser kompiliert", "note": "Importe werden aus Ihrem Projekt, dann aus node_modules, dann über das Paket-CDN aufgelöst", "hue": "run", "tag": "neu" },
    { "label": "Button.module.css", "note": "Klassennamen pro Datei gekapselt, mit composes und :global", "hue": "run", "tag": "neu" },
    { "label": "Vorschau und veröffentlichte Seite", "note": "Dasselbe CSS in beiden", "hue": "measure" }
  ],
  "caption": "Vorschau und veröffentlichter Build nutzen dieselben Compiler – was Sie beim Bauen sehen, ist das, was ausgeliefert wird."
}
```

- **Sass, SCSS und Less werden kompiliert.** Dazu gehören `.scss`-, `.sass`- und `.less`-Dateien sowie `<style lang="scss">` in Vue- und Svelte-Komponenten. Partials, `@use`, `@import` und Importe aus npm-Paketen werden aufgelöst.
- **CSS Modules sind echt.** `import styles from './Button.module.css'` gibt jeder Klasse einen gekapselten Namen, sodass `.title` in einer Komponente nie mit `.title` in einer anderen kollidiert. `composes`, `:global` und Keyframes funktionieren wie erwartet.
- **Stylesheets aus Paketen werden geladen.** `import 'react-toastify/dist/ReactToastify.css'`, das Theme einer Komponentenbibliothek oder das CSS eines Schriftpakets werden jetzt in der Vorschau und auf der veröffentlichten Seite geladen, statt übersprungen zu werden.

## Next.js im Browser

Ein Next.js-Projekt startet jetzt seinen eigenen Entwicklungsserver, `next dev`, im Browser-Tab – so wie es eine Express- oder Vite-App bereits tat. Die Seite, die Sie öffnen, rendert Next selbst aus Ihrem `app/`-Verzeichnis, ohne dass etwas von uns dazwischensteht. SvelteKit-Projekte laufen genauso: `vite dev` startet das echte Vite, und SvelteKit rendert die Seite auf seinem eigenen Server.

Dafür hat die Runtime darunter die Teile von Node bekommen, auf die sich ein Framework wie Next stillschweigend verlässt. Prozesse können sich jetzt Nachrichten schicken (`child_process.fork` und `worker_threads`), dynamische Importe laden die eigenen Dateien des Projekts, und Nexts WebAssembly-Compiler lädt dort, wo der native nicht laufen kann. Die meisten dieser Änderungen helfen auch anderen Werkzeugen.

## Wo es in der Methode steht

Bauen ist der dritte Akt von [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Wie sich dieser Akt anfühlt, hängt an einer Sache: wie kurz der Weg von *etwas ändern* zu *sehen, was es bewirkt hat* ist.

Hot Updates nehmen das Neuladen aus diesem Weg, und dass Ihre Stelle erhalten bleibt, nimmt das Zurückklicken heraus. Echte Stylesheets und echte Frameworks lösen die andere Seite: Das Projekt, das Sie in der Vorschau erproben, ist das Projekt, das Sie ausliefern – keine vereinfachte Kopie, die nur so aussieht.

## Was Sie heute tun können

- **Styles ändern, ohne die Stelle zu verlieren:** Öffnen Sie einen Dialog, bearbeiten Sie sein CSS und sehen Sie zu, wie er sich ändert.
- **Stylesheets mitbringen, wie sie sind:** SCSS-Partials, Less, CSS Modules und das CSS Ihrer eigenen Pakete.
- **Eine React-Komponente mitten im Ablauf bearbeiten** und den Zustand behalten, mit dem Sie gerade testen.
- **Ein Next.js- oder SvelteKit-Projekt** auf einem Canvas öffnen und ausführen.

---

**Weiterlesen:** [Ihre App antwortet jetzt](/blog/your-app-talks-back) · [Führen Sie die App aus, die Ihr Board gerade gebaut hat](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers ist Open Source](/blog/builderforce-webcontainers-open-source)

[Öffnen Sie einen Canvas](/create) und ändern Sie etwas, während er läuft.
