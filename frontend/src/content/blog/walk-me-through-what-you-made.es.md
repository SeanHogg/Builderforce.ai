Pega un plan de negocio en un lienzo, dirígelo a cinco de tus agentes y ve a prepararte un café.

Cuatro minutos después hay veinticuatro objetos en el tablero. Un perfil de empresa. Seis competidores, cada uno con una estimación de ingresos investigada y una sede. Dos segmentos de clientes, dimensionados. Un plan de salida al mercado. Un modelo de precios. Un mapa con la geografía competitiva trazada.

Es el producto funcionando exactamente como se pretendía, y también es el momento en que la gente nos dice que se bloquea.

> Es impresionante. No sé qué hacer con ello.

No es una queja sobre la investigación. Es una queja sobre la llegada. Veinticuatro objetos son más de lo que nadie lee de una vez, y un tablero no te da ningún motivo para mirar primero una tarjeta concreta.

## Qué fallaba de verdad

Tres cosas, y solo una tenía que ver con la explicación.

```bf-figure
{
  "kind": "compare",
  "title": "Por qué un tablero generado parecía un muro",
  "columns": [
    { "title": "Lo que veías", "hue": "muted", "items": ["Una larga cinta de tarjetas que se salía por la parte inferior de la pantalla", "Dos tercios de un monitor ancho vacíos a su lado", "Seis tarjetas de agente apiladas en un mismo punto, que parecían una sola", "El mismo competidor investigado dos veces", "Ninguna indicación de cuál abrir"] },
    { "title": "Lo que estaba pasando", "hue": "make", "items": ["El colocador solo sabía crecer hacia abajo, nunca a lo ancho", "Nada medía el ancho real del tablero", "Los objetos añadidos en un mismo ciclo tomaban todos la misma coordenada", "Un turno cortado en su límite de salida volvía a crear lo que ya no podía ver", "Nada en el tablero sabía presentarse a sí mismo"] }
  ],
  "caption": "Los cuatro primeros son fallos de colocación y están corregidos. El quinto es el que necesitaba algo nuevo."
}
```

La mitad de colocación merece una frase, porque es la menos interesante y era la que más daño hacía. Los objetos nuevos se colocaban bajando desde un punto de partida hasta encontrar un espacio libre: un razonamiento sensato para una tarjeta, y erróneo para un lote. Diez objetos creados en un solo turno, sin coordenadas, cada uno colocado respecto a los nueve anteriores, producen una columna estrecha. En un monitor de 3440 píxeles eso es una cinta con la mayor parte de la pantalla sin usar, que es justo lo que nos reportaron.

Ahora los objetos llenan el ancho que tiene de verdad el tablero antes de crecer hacia abajo, y ese ancho es algo que el lienzo mide en lugar de suponer.

## El recorrido

El lienzo ya tenía una visita guiada. Recorría la *interfaz*: aquí está el dock de Brain, aquí la paleta, aquí Compartir. Es la visita adecuada para tu primer tablero y no dice absolutamente nada sobre tu trabajo.

Así que hay una segunda, y recorre los artefactos.

```bf-figure
{
  "kind": "flow",
  "title": "Cómo decide el recorrido qué enseñarte",
  "steps": [
    { "label": "Agrupar", "note": "Por tipo, no por tarjeta. Seis competidores son una sola respuesta —contra quién compites—, no seis pasos.", "hue": "read" },
    { "label": "Ordenar", "note": "Según las propias conexiones del tablero. Qué alimenta a qué ya está dibujado en el lienzo, así que el recorrido lo sigue, y recurre al orden de lectura cuando no hay nada conectado.", "hue": "read" },
    { "label": "Recorrer", "note": "El tablero vuela hasta cada grupo por turnos y dice qué es, con las propias palabras del objeto en lugar de un pie genérico.", "hue": "make", "tag": "en el tablero" }
  ],
  "caption": "Nada de esto es un guion escrito a mano. Un nuevo tipo de objeto se suma al recorrido el mismo día en que se puede crear, porque el recorrido se deriva del tablero en lugar de estar listado en algún sitio."
}
```

Agrupar es la decisión que hace que funcione. Una parada por objeto es el mismo muro con un botón Siguiente: veinticuatro pasos son peores que veinticuatro tarjetas, porque ahora no puedes echar un vistazo rápido. Veinticuatro objetos de nueve tipos son nueve cosas que vale la pena decir, y una de ellas es *estos seis se investigaron juntos; léelos como un conjunto, lo importante es la comparación.*

```bf-figure
{
  "kind": "screen",
  "frame": "Parada 3 de 8",
  "ratio": 1.62,
  "regions": [
    { "label": "6 objetos de competidores", "note": "El grupo en el foco, traído a la vista", "x": 4, "y": 10, "w": 58, "h": 56, "hue": "make" },
    { "label": "Qué es este grupo", "note": "Nombrado a partir de la línea que escribió el propio objeto, nunca un resumen inventado", "x": 66, "y": 16, "w": 30, "h": 34, "hue": "idea" },
    { "label": "El resto del tablero", "note": "Sigue visible, sigue siendo tuyo", "x": 4, "y": 70, "w": 58, "h": 18, "hue": "muted" },
    { "label": "Atrás · Siguiente · sal cuando quieras", "x": 66, "y": 54, "w": 30, "h": 8, "hue": "accent" }
  ],
  "caption": "El foco sigue ahora a una tarjeta hacia la que el lienzo todavía está volando. Antes medía una sola vez, en el primer fotograma, y se quedaba clavado donde había estado la tarjeta."
}
```

Se ofrece una vez por tablero, en tableros con suficiente contenido como para perderse: un lienzo con tres tarjetas no necesita guía, y ofrecerle una da a entender que el producto no confía en ti. Después vive en la barra de comandos, junto a los diagnósticos y el cuadro de resultados, porque responde a la misma pregunta que ellos: *qué tengo aquí en realidad.*

## Dos duplicados que nunca fueron tuyos

Ya puestos, el mismo informe de sesión mostraba el mismo competidor dos veces en el tablero, y un agente tres veces. Ninguno de los dos era un fallo de investigación.

**Un asiento es una identidad, no un evento.** Dirigirte dos veces al mismo compañero de equipo sentaba antes dos tarjetas con el mismo nombre. Ahora trae a la vista la que ya tienes.

**Un modelo al que cortan rehace su trabajo.** Cuando un turno alcanza su límite de salida a mitad de frase, el siguiente intento ya no tiene su propia transcripción con la que comprobar, así que vuelve a crear el perfil de empresa. El tablero sí puede verlo, así que ahora es el tablero quien responde: un objeto del mismo tipo con el mismo nombre te devuelve el id del que ya existe y la instrucción de actualizarlo. Las notas adhesivas quedan exentas, porque en un muro de notas perfectamente puede haber tres que digan Precios.

## Dónde encaja en el método

[Leer va antes que Demostrar, y Demostrar antes que Crear](/blog/read-prove-build-the-inner-loop): el sentido de ese orden es que leer es barato y construir no, así que la decisión de construir debería ser una decisión informada.

Esto encaja de lleno en **Leer**, y cierra un hueco que se había abierto ahí. Habíamos hecho que *generar* la evidencia fuera casi gratis: un prompt, cuatro minutos, un panorama competitivo investigado con fuentes. Lo que no habíamos hecho gratis era *asimilarla*. Un panorama sin leer no informa ninguna decisión, así que una etapa Leer que produce más de lo que una persona puede asimilar ha fallado sin hacer ruido en lo único para lo que existe, y falla de forma invisible, porque el tablero impresiona de todos modos.

```bf-figure
{
  "kind": "compare",
  "title": "La distancia entre lo generado y lo entendido",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Aparecen veinticuatro tarjetas", "Abres una al azar", "Intentas averiguar qué es el conjunto", "Se te escapan por completo los segmentos", "Preguntas a Brain qué ha creado"] },
    { "title": "Ahora", "hue": "read", "items": ["Aparecen veinticuatro tarjetas, repartidas a lo ancho de la pantalla", "Pulsas Enséñamelo", "Ocho paradas, en el orden que sugiere el propio tablero", "Sales en cualquier paso y te pones a trabajar"] }
  ],
  "caption": "Leer solo es barato si de verdad ocurre. Es la diferencia entre producir evidencia y leerla."
}
```

## Qué puedes hacer con esto hoy

- **Haz una gran pregunta y obtén una respuesta legible**: los objetos llegan repartidos a lo ancho de tu pantalla en lugar de apilados hacia abajo.
- **Pulsa Enséñamelo** cuando un tablero vuelva más lleno de lo que esperabas, y sal en la parada en la que ya hayas visto suficiente.
- **Vuelve a él más tarde** desde la barra de comandos, en cualquier tablero, tantas veces como quieras.
- **Deja de eliminar duplicados a mano**: el mismo competidor, empresa o compañero de equipo no aparece dos veces.

---

**Lecturas relacionadas:** [El Lienzo de Creación no es una ventana de chat](/blog/creation-canvas-beyond-chat) · [Brain maneja el Lienzo de Creación](/blog/brain-operates-the-creation-canvas) · [Ejecuta la app que acaba de crear tu tablero](/blog/run-your-app-on-the-canvas)

[Abre un lienzo](/create) y pregúntale algo lo bastante grande como para necesitar un recorrido.
