Abre un canvas y el tablero es el producto. Todo lo demás —el título, el selector de superficies, la lista de participantes, el estado de guardado, los siete botones— es andamiaje a su alrededor.

Durante mucho tiempo ese andamiaje se organizó en **bandas**: franjas de ancho completo apiladas a lo largo de la ventana, cada una trazando una línea dura, cada una quitándole altura a aquello a lo que la gente venía. La peor infractora era una barra de sesión de 54 píxeles que llevaba un título, un selector, siete botones, una lista de participantes y un botón de guardar repartidos por toda la ventana, con mucho espacio vacío entre controles que no tenían nada que ver entre sí.

```bf-figure
{
  "kind": "screen",
  "frame": "Antes — el tablero recibe lo que sobra",
  "ratio": 1.6,
  "regions": [
    { "label": "Barra de sesión", "note": "Título · selector · siete botones · participantes · guardar", "x": 2, "y": 3, "w": 96, "h": 11, "hue": "bad" },
    { "label": "Controles de superficie", "x": 2, "y": 16, "w": 96, "h": 9, "hue": "bad" },
    { "label": "El tablero", "x": 2, "y": 27, "w": 96, "h": 46, "hue": "muted" },
    { "label": "Barra de equipo — siempre activa", "x": 2, "y": 75, "w": 96, "h": 9, "hue": "bad" },
    { "label": "Dock en vivo · esquina legal", "x": 2, "y": 86, "w": 96, "h": 11, "hue": "bad" }
  ],
  "caption": "Cuatro bandas, medidas en cada canvas de cada página, incluido el dock en vivo, que reservaba una franja de la ventana para una llamada que casi nadie estaba a punto de iniciar."
}
```

```bf-figure
{
  "kind": "screen",
  "frame": "Después — el tablero llena la ventana, todo flota",
  "ratio": 1.6,
  "regions": [
    { "label": "El tablero", "note": "De borde a borde, corriendo detrás del chrome en lugar de empezar debajo de él", "x": 2, "y": 3, "w": 96, "h": 94, "hue": "make" },
    { "label": "Qué ES este canvas", "x": 5, "y": 7, "w": 30, "h": 10, "hue": "idea" },
    { "label": "Cómo se LEE", "x": 38, "y": 7, "w": 26, "h": 10, "hue": "accent" },
    { "label": "Cómo SALE el trabajo de él", "x": 67, "y": 7, "w": 28, "h": 10, "hue": "reach" },
    { "label": "Qué le HACES", "x": 20, "y": 84, "w": 60, "h": 10, "hue": "accent" }
  ],
  "caption": "En qué tarjeta cae un control es un DATO, no una decisión a criterio de un componente: una tabla declara las cuatro ranuras, y no se puede añadir un control a una sin que la prueba note que falta en la otra."
}
```

## La regla que hizo seguro el colapso

Un canvas llena la pantalla y su barra no cambia durante minutos, así que plegarla vale la pena. Lo que lo vuelve peligroso es la mitad de la barra que **informa** en lugar de actuar.

Si pliegas "quién está en esta sesión", "la conexión está activa" y "hay una ejecución en curso", quien opera trabaja a ciegas en un tablero que otras personas están editando.

```bf-figure
{
  "kind": "compare",
  "title": "Colapsar oculta controles, nunca el estado",
  "columns": [
    { "title": "Sobrevive al colapso — estado", "hue": "good", "items": ["El título — en qué canvas estás", "Estado de guardado — el HECHO de si está guardado", "La lista de participantes — quién está aquí", "Estado de la superficie — si esto está activo"] },
    { "title": "Se pliega — controles", "hue": "muted", "items": ["El selector de superficies", "El grupo de acciones", "Controles específicos de la superficie", "El BOTÓN de guardar — pulsarlo abre la puerta de la cuenta"] }
  ],
  "caption": "Guardar es el caso interesante: se lee como un estado y se comporta como un control, así que el botón se pliega y el estado junto a él se queda. Algo que puedes pulsar es un control por mucho que su etiqueta suene a un hecho."
}
```

Está escrito como una tabla en lugar de una condición porque "las acciones" no es la frontera: el selector de superficies es un control y el indicador de tiempo real no lo es, y están a dos elementos de distancia en la misma fila. Una regla que los revisores tienen que recordar es una regla que dura unas tres pull requests.

## Una barra por canvas, no una por runtime

Añadir una forma de *ejecutar* una app en el tablero produjo de inmediato lo que todo editor visual intenta evitar: dos barras de herramientas, misma altura, mismo estilo, en desacuerdo sobre cuál pulsar.

Ahora la superficie aporta sus controles **dentro de** la única barra. Una superficie añadida el año que viene obtiene un lugar en ella gratis, y una acción declara lo que *necesita* —objetos, un tablero— en lugar de enumerar las superficies a las que se aplica. La alternativa sería añadir cada superficie futura a cada lista a la que casualmente aplique, en un archivo que nadie abre por ese motivo.

## Y un teléfono no podía compartir un canvas en absoluto

Esta es la parte que vale la pena generalizar.

Una regla móvil general ocultaba todo botón sin etiqueta de la barra. La hoja de desbordamiento que sobrevivió no listaba ninguno. Así, un teléfono perdía en silencio deshacer, rehacer, diagnósticos, el cuadro de resultados **y todas las rutas al panel de invitaciones**: cinco acciones, ninguna declarada como ausente en ningún sitio. Salió de una sola línea de CSS basada en el nombre de una clase.

Ahora la ubicación es un dato: cada acción declara si un teléfono la muestra en la barra o en el desbordamiento, y ambos se renderizan a partir de esa única lista, de modo que barra y menú son complementarios. Una acción no puede acabar en ninguno de los dos, y una prueba lo afirma, incluido el presupuesto de dos acciones para la barra del teléfono, porque pasado ese número, lo que se queda sin espacio es el título, que es lo único que te dice en qué canvas estás.

---

**Lecturas relacionadas:** [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [El Creation Canvas no es una ventana de chat](/blog/creation-canvas-beyond-chat) · [Creation Canvas multijugador, web y VS Code](/blog/multiplayer-creation-canvas-web-vscode)

[Abre un canvas](/create): ahora es igual en un teléfono, algo que antes no ocurría.
