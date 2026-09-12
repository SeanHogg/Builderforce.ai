Pide un servicio de envío de SMS y aparecen cuatro tarjetas en el tablero: `backend/server.js`, `frontend/index.html`, una página renderizada y una nota de configuración. Todas conectadas, todas correctas, todas ahí quietas.

¿Y ahora qué?

Durante un tiempo, la respuesta honesta era: nada, al menos en esa pantalla. El tablero podía describir una aplicación con todo detalle y no tenía forma de ejecutarla. El único camino hacia una URL en vivo pasaba por un inspector de tarjetas, detrás de una acción de publicar, planteado como algo comercial: a tres clics de profundidad e invisible hasta que seleccionabas exactamente la tarjeta correcta. Un lienzo que sabe construir software pero no puede ejecutarlo es un cuaderno muy bueno.

## La superficie de app

Ahora hay una cuarta forma de leer un tablero, junto a la conversación, el grafo y el espacio 3D: **la app**.

```bf-figure
{
  "kind": "flow",
  "title": "Qué ocurre al cambiar a la superficie de app",
  "steps": [
    { "label": "Reunir", "note": "Cada tarjeta de código del tablero se convierte en un archivo. No solo la seleccionada: todas, con la estructura que describen.", "hue": "make" },
    { "label": "Ensamblar", "note": "Se localiza la página de entrada, y sus hojas de estilo y scripts hermanos se integran en ella para que la vista previa tenga contra qué resolverlos.", "hue": "make" },
    { "label": "Ejecutar", "note": "Un único documento funcional, enmarcado a un ancho de dispositivo real, con los errores de compilación y de ejecución volviendo al asistente que lo escribió.", "hue": "make", "tag": "en el tablero" }
  ],
  "caption": "La superficie lee toda la sesión, no una tarjeta. Una aplicación repartida en seis tarjetas es un solo artefacto, algo que nada en el tablero podía expresar hasta ahora."
}
```

Dos aspectos de esto fueron más difíciles de lo que parecen.

```bf-figure
{
  "kind": "screen",
  "frame": "Un tablero leído como app",
  "ratio": 1.62,
  "regions": [
    { "label": "La aplicación en ejecución", "note": "Todas las tarjetas de código del tablero, ensambladas y servidas como un solo documento", "x": 4, "y": 8, "w": 62, "h": 74, "hue": "make" },
    { "label": "Brain", "note": "Pide el cambio, ve el error", "x": 69, "y": 8, "w": 27, "h": 74, "hue": "idea" },
    { "label": "Selector de superficie", "x": 4, "y": 88, "w": 30, "h": 8, "hue": "accent" },
    { "label": "Ejecutar · anchos · compartir", "x": 38, "y": 88, "w": 58, "h": 8, "hue": "accent" }
  ],
  "caption": "Una sola barra de comandos para todo el lienzo, no una por entorno de ejecución. La superficie de app aporta Ejecutar y los tres anchos DENTRO de esa barra, en lugar de dibujar una segunda debajo."
}
```

**Una vista previa necesita un origen.** Un documento entregado a un marco no tiene dirección, así que `href="styles.css"` se resuelve contra nada y obtienes una página de aspecto correcto sin ninguno de sus estilos: el clásico "¿por qué la vista previa se ve rota si el código está bien?". La superficie integra los archivos hermanos precisamente por eso.

**Los anchos de dispositivo no son un max-width.** Escritorio, tableta y teléfono solían ser tres botones que no cambiaban nada visible, porque al marco se le pedía a la vez tener cierto ancho y llenar el espacio, y ganaba llenar. Peor aún: incluso donde sí se aplicaba un límite, limitar un documento le entrega el ancho *menor*, así que sus propias media queries se disparan para el marco y tu vista de "escritorio" muestra el diseño móvil colapsado. Los tres ajustes ahora maquetan el documento a 1280, 834 y 390 píxeles CSS reales y escalan el resultado dentro de la caja. Se diferencian como se diferencian tres máquinas reales, porque eso es lo que ahora son.

```bf-figure
{
  "kind": "devices",
  "title": "Tres vistas, a tres anchos reales",
  "devices": [
    { "label": "Escritorio", "width": 1280, "hue": "make", "note": "El documento se maqueta a 1280 y se escala dentro del marco" },
    { "label": "Tableta", "width": 834, "hue": "run", "note": "Sus propias media queries se disparan para 834, no para el marco" },
    { "label": "Teléfono", "width": 390, "hue": "measure", "note": "El diseño móvil colapsado que de verdad publicas" }
  ],
  "caption": "Anchos dibujados a escala: la parte de la fila que ocupa cada marco es su ancho dividido entre la suma de todos. Un marco limitado le entrega al documento el ancho MENOR, y por eso la antigua vista de Escritorio mostraba el diseño móvil."
}
```

## El defecto de fondo

Mientras construíamos esto encontramos algo que merece decirse en voz alta, porque llevaba tiempo costándole a la gente sesiones enteras sin hacer ruido.

La superficie de app leía el código fuente de una tarjeta de código desde un campo. El asistente lo escribe en otro: el campo que usa su propia herramienta, y el primero que lee la vista previa de la tarjeta. Así que cada tarjeta de código escrita por el asistente se veía perfecta en el tablero y no aportaba **nada** a la app. Ni un error, ni un aviso, ni un estado vacío que se explicara: solo "Todavía no hay nada que ejecutar" bajo un tablero lleno de código.

Había otro justo al lado. Cada lectura y escritura de archivos del espacio de trabajo pedía al servidor una ruta vacía, por un detalle de enrutamiento que devuelve `undefined` para la parte de la URL que lleva el nombre del archivo. Un lienzo podía crear un proyecto y luego no escribir nunca una sola línea de código en él: cuatro llamadas a herramientas fallando seguidas y un turno que terminaba encogiéndose de hombros.

Los dos están corregidos. Los mencionamos porque un anuncio de producto que solo enumera capacidades nuevas es un documento de marketing; la superficie de app funciona hoy tanto gracias a estos dos arreglos como a la propia superficie.

## Dónde encaja en el método

Crear es el tercer acto, y el caro. [Leer y Demostrar](/blog/read-prove-build-the-inner-loop) van primero y no cuestan nada, precisamente para que la decisión de crear sea una decisión. Pero una vez que estás creando, el ciclo que va de *cambiar algo* a *verlo* es toda la experiencia, y cada salto fuera de ese ciclo —a una terminal, a un despliegue, a una URL de vista previa, a otra pestaña— es un punto por donde se escapa la atención.

```bf-figure
{
  "kind": "compare",
  "title": "La distancia entre editar y ver el resultado",
  "columns": [
    { "title": "El ciclo habitual", "hue": "muted", "items": ["Editar en el editor", "Guardar", "Esperar a la compilación", "Cambiar al navegador", "Recargar", "Descubrir que los estilos no se cargaron", "Adivinar por qué"] },
    { "title": "En el tablero", "hue": "make", "items": ["Pedir el cambio", "Ver cómo se actualizan las tarjetas", "Revisarlo al ancho que querías", "Los errores vuelven al asistente que los escribió"] }
  ],
  "caption": "Los errores de compilación y de ejecución ahora vuelven al agente, así que una compilación rota es algo que se arregla, no algo que se queda ahí aparentando estar terminado."
}
```

## Qué puedes hacer hoy

- **Describe una aplicación y ejecútala en el mismo minuto**: el backend, la página y los recursos se ensamblan en una sola cosa en la que puedes hacer clic.
- **Revísala a tres anchos reales** antes de que nadie la abra en un teléfono.
- **Conviértela en un proyecto** cuando deje de ser un boceto: un botón le da al tablero su propio entorno de ejecución, sus propios datos, su propia gente y su propia dirección web, y la dirección se elige desde el principio en lugar de descubrirse al publicar.
- **Empaquétala** como app web instalable, compilación para Android o compilación firmada para iOS: lo que va dentro del paquete es exactamente lo que previsualizaste.

Nada de eso exige salir del tablero, y ahí está la clave. El tablero no es un artefacto de planificación que precede al trabajo real. Es donde está el trabajo.

---

**Lecturas relacionadas:** [El Lienzo de Creación no es una ventana de chat](/blog/creation-canvas-beyond-chat) · [Crea antes de registrarte](/blog/create-before-you-sign-up) · [Diseña, construye y depura en un único espacio de trabajo espacial](/blog/design-build-debug-one-spatial-workspace)

[Abre un lienzo](/create) y pide algo que tenga backend.
