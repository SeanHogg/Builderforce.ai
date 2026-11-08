```bf-figure
{
  "kind": "launch",
  "title": "Abre Studio en un 3D World",
  "links": [
    {
      "label": "Empieza un currículum 3D World",
      "hue": "build",
      "href": "/create/new?prompt=Create+a+3D+World+r%C3%A9sum%C3%A9+scene%3A+a+small+explorable+room+with+a+desk%2C+three+project+pedestals+a+visitor+can+walk+up+to%2C+and+a+nameplate+with+my+headline.",
      "note": "Motor basado en escenas: Three.js, React Three Fiber, física Rapier."
    },
    {
      "label": "Studio",
      "hue": "muted",
      "href": "/creation-canvas",
      "note": "El propio editor: viewport, paleta de objetos e inspector."
    }
  ],
  "caption": "Un 3D World es `mediaKind: \"game\"` sobre el motor `world-3d`, no una de las plantillas de minijuegos antiguas basadas en sprites."
}
```

## El currículum jugable

El formato más audaz que admite el Creation Canvas de Builderforce es un 3D World: una escena explorable por la que un reclutador puede caminar. Es excesivo para un puesto de contabilidad y exactamente lo adecuado para un desarrollador de juegos, un artista 3D, un artista técnico o un ingeniero de XR que necesita demostrar que sabe entregar 3D interactivo.

Por dentro, el estudio 3D World es un documento `mediaKind: "game"` con un discriminador `engine: "world-3d"`, construido sobre Three.js y React Three Fiber con una capa de física Rapier. Colocas objetos, conectas interacciones y el resultado se ejecuta en cualquier navegador moderno: sin instalar Unity ni Unreal, sin plugins.

## Paso 1: Crea un documento 3D World

Abre [Studio](/creation-canvas), crea un documento nuevo y elige el tipo de juego **3D World**. El editor carga un viewport 3D, una paleta de objetos y un inspector. (Las plantillas de juego 2D más antiguas siguen existiendo —ahora llevan la insignia «Mini-game»—, pero un 3D World es el motor completo basado en escenas.)

Empieza con un plano de suelo sencillo y un punto de aparición. Resiste la tentación de construir un nivel entero. El objetivo es un recorrido corto y guiado que cuente tu historia, no un juego de mundo abierto.

## Paso 2: Coloca objetos y añade física

Arrastra objetos de la paleta a la escena: plataformas, accesorios, paneles de texto y zonas de activación. Cada objeto tiene una transformación (posición, rotación, escala) que estableces en el inspector. Añade un cuerpo de física Rapier a los objetos que deban colisionar o caer: el motor se encarga de la simulación para que un accesorio que se suelta aterrice en el suelo sin que escribas un bucle de física.

Usa los paneles de texto como columna vertebral narrativa: un panel en la entrada con tu nombre y titular, paneles a lo largo del camino que describan cada proyecto, un panel al final con lo que buscas. El jugador lee el currículum moviéndose a través de él.

## Paso 3: Conecta las interacciones

Las zonas de activación convierten la escena de un diorama en una experiencia. Asocia una interacción a una zona para que, al entrar en ella, se revele un panel de proyecto, suene un sonido o avance la cámara. Haz que las interacciones sean fáciles de descubrir: un reclutador que explora tu mundo por primera vez no debería tener que adivinar una mecánica oculta para ver tu trabajo.

Un buen patrón: un camino lineal con salas laterales opcionales. El camino principal cuenta tu historia central en 60–90 segundos de paseo; las salas laterales contienen paneles de profundización para los reclutadores que quieren más.

## Paso 4: Publica y comparte el enlace

Un 3D World se publica como una experiencia jugable y compartible por enlace que se ejecuta en el navegador. Como Studio se ejecuta aislado por origen cruzado para su runtime, la escena carga con sus recursos alojados por nosotros y se reproduce sin descargas.

Comparte el enlace en tu candidatura, en tu perfil o en una publicación de Creator. Para puestos de 3D interactivo, un mundo jugable es la pieza de portafolio: demuestra, de la manera más directa posible, que puedes entregar exactamente lo que el puesto pide.

## Preguntas frecuentes

### ¿Necesito saber programar para construir un 3D World?

No. Colocas objetos, estableces transformaciones en el inspector y conectas interacciones mediante zonas de activación, todo visualmente. Saber programar te permite llegar más lejos, pero la construcción básica es un flujo de arrastrar, colocar y configurar.

### ¿Qué diferencia hay entre un 3D World y un Mini-game?

Un 3D World es un motor completo basado en escenas —`mediaKind: "game"` con el motor `world-3d`— construido sobre Three.js, React Three Fiber y física Rapier. Las plantillas de juego 2D llevan ahora la insignia «Mini-game» y son experiencias más simples basadas en sprites. Para una escena de currículum que un reclutador explora en 3D, usa el 3D World.

### ¿Necesita el reclutador instalar algo para verlo?

No. El mundo se ejecuta en cualquier navegador moderno mediante WebGL. Tú compartes un enlace; ellos hacen clic y exploran. Sin motor de juego, sin plugin, sin descargas.

---

**Pruébalo:** [Studio](/creation-canvas) en Builderforce.
