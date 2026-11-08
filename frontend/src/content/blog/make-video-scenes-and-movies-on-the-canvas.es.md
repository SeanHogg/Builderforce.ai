El lienzo ya podía hacer las partes estáticas de un lanzamiento: la página, el texto, las imágenes, la presentación. No podía hacer lo que la gente de verdad mira.

Pedías «un anuncio de 30 segundos para la panadería» y obtenías un storyboard: una tabla ordenada de planos, cada uno con la descripción de un clip que no existía. Convertirlo en vídeo significaba irte con la tabla, buscar una herramienta de vídeo, generar los planos uno por uno, descargarlos y montarlos en otro sitio. Muchas ideas morían ahí, y la mayoría se quedaban en storyboards.

Ahora el storyboard se renderiza.

## Un clip, una escena, una película

La unidad más pequeña es un **clip**. Describe un plano, como *vapor saliendo de una hogaza sobre una rejilla de enfriado, travelling lento hacia delante, luz de mañana*, y unos minutos después hay un clip de vídeo real en el tablero, en horizontal, vertical o cuadrado.

La unidad mayor es una **escena**. Describe una historia y el lienzo la planifica como lo haría un director: quién sale, qué ocurre y cómo la ve la cámara, dividido en planos. Después cada plano se renderiza como su propio clip, uno junto a otro.

```bf-figure
{
  "kind": "flow",
  "title": "De una frase a un montaje",
  "steps": [
    { "label": "Planificar", "note": "La historia se convierte en una lista de planos: acción, cámara y duración de cada uno, con los personajes coherentes en todos ellos.", "hue": "idea" },
    { "label": "Renderizar", "note": "Cada plano se renderiza como un clip de vídeo real, varios a la vez. Un plano que falla explica por qué, y el resto continúa.", "hue": "make" },
    { "label": "Montar", "note": "Los planos renderizados se ordenan en una línea de tiempo de vídeo, listos para música, narración y subtítulos.", "hue": "make", "tag": "en el tablero" },
    { "label": "Exportar", "note": "Descarga la película desde tu navegador o, en Pro y Teams, renderízala en nuestros servidores y cierra la pestaña.", "hue": "run" }
  ],
  "caption": "Una sola petición te lleva de la idea al montaje. Brain hace cada paso a partir de una sola frase, y tú puedes intervenir en cualquiera de ellos."
}
```

La lista de planos se queda en el tablero como un objeto propio, lo cual importa la primera vez que algo no sale del todo bien. Si en el tercer plano el perro mira hacia el lado equivocado, reescribe ese plano y renderízalo de nuevo. Solo se regenera ese plano, y los demás conservan los clips que ya te gustaban.

```bf-figure
{
  "kind": "screen",
  "frame": "Una escena en el lienzo",
  "ratio": 1.62,
  "regions": [
    { "label": "La historia", "note": "Un prompt, un formato y una duración", "x": 4, "y": 8, "w": 34, "h": 40, "hue": "idea" },
    { "label": "Planificar · Renderizar · Hacer película", "x": 4, "y": 52, "w": 34, "h": 12, "hue": "accent" },
    { "label": "Lista de planos", "note": "El prompt, la duración y el clip de cada plano; reescribe uno y renderiza solo ese", "x": 42, "y": 8, "w": 54, "h": 74, "hue": "make" },
    { "label": "Nube o este dispositivo", "x": 4, "y": 88, "w": 34, "h": 8, "hue": "muted" }
  ],
  "caption": "El vídeo en la nube usa modelos alojados y tu cuota diaria de vídeo. El motor en el dispositivo también sigue funcionando, de forma gratuita y privada en tu navegador."
}
```

## El montaje es un vídeo corriente

Hacer una película no la encierra dentro de un generador. El montaje llega al tablero como un objeto de vídeo normal, en el mismo editor de línea de tiempo que usas para grabaciones de pantalla y metraje importado. Añade una base musical, graba una locución, escribe subtítulos, recorta un plano, reordena los capítulos. Luego expórtalo o publícalo directamente en YouTube desde la misma tarjeta.

La exportación se ejecuta en tu navegador en todos los planes. En Pro y Teams también puedes **renderizar en el servidor**. La película se renderiza en nuestras máquinas, así que puedes cerrar la pestaña, y el MP4 terminado te espera en la tarjeta cuando vuelvas.

## Vídeo en las apps que construye Studio

El mismo generador ahora funciona dentro de Studio. Pide «una landing con un vídeo en bucle como cabecera» y el agente crea el clip, lo guarda en tu espacio de trabajo y escribe su enlace permanente en la etiqueta `<video>`. Obtienes un bucle de fondo real, no un enlace a un vídeo de muestra que deja de funcionar cuando publicas.

```bf-figure
{
  "kind": "compare",
  "title": "Pedir vídeo, antes y ahora",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Una tabla storyboard de planos que no existen", "Un enlace a un vídeo de muestra en la cabecera que se rompe al publicar", "Cinco herramientas y una tarde para convertir un guion en un montaje"] },
    { "title": "Ahora", "hue": "make", "items": ["Clips reales para cada plano, renderizados en el tablero", "Un bucle de cabecera generado y guardado con la app", "De una frase a una película que puedes editar, exportar o publicar"] }
  ],
  "caption": "La diferencia no es una mejor descripción de un vídeo. Obtienes el vídeo."
}
```

## Dónde encaja en el método

El trabajo en Builderforce sigue un arco, **Idea → Make → Run → Measure**, y cada acto recorre el mismo bucle interno: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

El vídeo pertenece a **Make**, pero da sus frutos en **Prove**. Muchas ideas solo resultan creíbles cuando se mueven: un anuncio, un recorrido por el producto, los treinta segundos iniciales de una presentación, un teaser vertical para la semana de lanzamiento. Un storyboard pide a quienes tienes que convencer que se imaginen la película. Un primer montaje les permite reaccionar a ella. «¿Harías clic en esto?» es una pregunta que ahora puedes hacer con el vídeo real delante de alguien, el mismo día en que se te ocurrió la idea.

También mantiene honesto a **Build**. Cada plano es un objeto independiente que se puede volver a renderizar, y el montaje es una línea de tiempo corriente, así que iterar significa cambiar un plano o un recorte, no empezar de cero. Cuando el montaje está terminado pasa a **Run** como bucle de cabecera de una página, una subida a YouTube o un recurso de campaña, sin salir del tablero.

## Qué puedes hacer hoy

- **Crear un clip a partir de una frase**, en horizontal, vertical o cuadrado.
- **Convertir una historia en una película corta**: planificada en planos, con cada plano renderizado y montado en una línea de tiempo.
- **Arreglar un plano sin rehacer el resto**: reescríbelo y renderiza de nuevo solo ese plano.
- **Terminarlo como cualquier vídeo**: música, narración, subtítulos y recortes; luego exporta, renderiza en el servidor (Pro y Teams) o publica en YouTube.
- **Pedirle a Brain todo en una línea**, o pedirle a Studio un vídeo de cabecera en la app que está construyendo.

---

**Lecturas relacionadas:** [Studio crea las imágenes que tu app necesita](/blog/studio-makes-the-images-your-app-needs) · [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [El Creation Canvas no es una ventana de chat](/blog/creation-canvas-beyond-chat)

[Abre un lienzo](/create) y pide un anuncio de treinta segundos.
