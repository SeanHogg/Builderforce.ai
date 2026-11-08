Toda búsqueda empieza con el mismo acto: poner el puesto delante de la gente. En el lienzo, ese era el único acto que una oferta de empleo no podía hacer.

Podías redactar la requisición con Brain, darle un registro real en el espacio de trabajo, clasificar una pila de CV frente a ella y contar las candidaturas recibidas. La tarjeta incluso tenía un campo para saber dónde estaba publicada: `distribution`, una fila por portal, con un estado, una fecha y un enlace. Nada escribía en él. El espacio de trabajo ya incluía conectores de portales de empleo para Greenhouse, Lever, Ashby, Indeed, LinkedIn Jobs y un feed de sitio de carreras, cada uno capaz de crear una oferta, y nada los llamaba para una requisición real. Así que "publicar este puesto" terminaba en un documento, y el volumen de candidatos era cero porque nadie sabía que el empleo existía.

## Distribuir, desde la tarjeta

Una tarjeta de oferta de empleo ahora tiene un control **Distribuir**. Lista los portales que tu espacio de trabajo ha conectado, marcas los que quieres y pulsas el botón.

```bf-figure
{
  "kind": "flow",
  "title": "Qué hace una pulsación de Distribuir",
  "steps": [
    { "label": "Elegir portales", "note": "Solo los portales que has conectado, y solo aquellos en los que la oferta no está ya activa.", "hue": "run" },
    { "label": "Publicar", "note": "Cada portal recibe la misma oferta: el título, la descripción y los requisitos del registro, más la ubicación y la seniority de tu tarjeta.", "hue": "run" },
    { "label": "Leer la respuesta", "note": "Se lee la respuesta del portal para obtener su propio id de la oferta y su enlace público cuando lo da.", "hue": "run" },
    { "label": "Registrarlo", "note": "Una fila por portal en el espacio de trabajo: Activa con el id del portal, o Fallida con el motivo del portal.", "hue": "measure", "tag": "la tarjeta lee esto" }
  ],
  "caption": "Cada llamada pasa por el mismo runtime de conectores que cualquier otra integración: tus credenciales por espacio de trabajo, comprobadas, registradas y auditadas."
}
```

También puedes simplemente pedirlo. Dile a Brain que publique el puesto y leerá dónde está ya activa la oferta y qué portales están conectados, te preguntará cuáles usar y solo entonces publicará. Publicar pone el nombre de tu empresa en un portal público, así que pasa por la misma regla de aprobación que el envío de una campaña.

```bf-figure
{
  "kind": "screen",
  "frame": "Una tarjeta de oferta de empleo",
  "ratio": 1.3,
  "regions": [
    { "label": "La requisición", "note": "Puesto, nivel, ubicación, requisitos imprescindibles, número de candidatos", "x": 4, "y": 6, "w": 92, "h": 34, "hue": "idea" },
    { "label": "Publicada en", "note": "Lever: Activa, desde el 9 oct, Ver oferta · Indeed: Fallida, No autorizado", "x": 4, "y": 44, "w": 92, "h": 22, "hue": "run" },
    { "label": "Publicar en", "note": "Greenhouse · Ashby · Feed de carreras", "x": 4, "y": 70, "w": 60, "h": 14, "hue": "accent" },
    { "label": "Distribuir a 2 portales", "x": 4, "y": 87, "w": 44, "h": 8, "hue": "accent" }
  ],
  "caption": "La lista de dónde está activa se lee del espacio de trabajo cada vez que se abre la tarjeta, no se guarda en la tarjeta."
}
```

## "Activa" significa que el portal lo dijo

Lo difícil no era llamar a seis API. Era decidir qué cuenta como publicado.

Un HTTP 200 no es una publicación. Ashby responde a cada petición con 200 y mete un rechazo dentro del cuerpo. Las API GraphQL como la de Indeed hacen lo mismo. El endpoint de ofertas de LinkedIn es una llamada por lotes cuyos fallos por oferta van dentro de una respuesta exitosa. Un sistema que se fiara del código de estado le diría a un reclutador que un puesto estaba activo en tres portales cuando lo estaba en uno, y los candidatos que fueran a buscarlo no encontrarían nada.

Por eso un portal se muestra como **Activa** solo cuando su respuesta traía su propio id de la oferta. Cualquier otra cosa se muestra como **Fallida**, con el motivo que dio el portal. La regla también la impone la base de datos: no se puede escribir una fila confirmada sin el id del portal.

```bf-figure
{
  "kind": "compare",
  "title": "Qué puede significar la respuesta de un portal",
  "columns": [
    { "title": "Registrada como Activa", "hue": "run", "items": ["El portal respondió con su id de la oferta", "Se muestra su enlace público cuando lo devolvió", "Volver a pulsar Distribuir la omite, así que el empleo nunca se publica dos veces"] },
    { "title": "Registrada como Fallida", "hue": "muted", "items": ["El portal rechazó la petición", "Respondió 200 pero informó de un error en su interior", "Respondió 200 sin id de la oferta", "Faltaba una credencial o un campo obligatorio"] }
  ],
  "caption": "Un portal fallido se puede reintentar. Uno activo se deja en paz, porque una segunda creación en la mayoría de los portales es una segunda oferta."
}
```

Esa decisión es también la razón por la que todos los portales los gestiona el mismo código. Cada conector ya indica, como datos, dónde va cada entrada en la petición. Ahora también indica dónde vuelven el id de la oferta y el enlace en la respuesta: `data.id` y `data.urls.show` para Lever, `results.id` para Ashby, el id del primer elemento para LinkedIn, con una cabecera como alternativa. Añadir un portal es una nueva entrada en el catálogo, no una nueva rama en el publicador, y un portal que no puede decirnos su id nunca se ofrece como destino.

## Candidatos, por portal

Las candidaturas de una oferta ya se desglosaban por origen. Ahora cada portal en el que salió la oferta aparece en ese desglose con su propio nombre y su recuento real. Eso incluye el cero, porque "Indeed: 0 tras dos semanas" es exactamente el número que te dice que un portal no funciona. Omitirlo se leería como "nunca se publicó ahí". Las filas de portal de la tarjeta llevan el mismo recuento.

La coincidencia es exacta. Una candidatura registrada como procedente de un portal lleva la clave de ese portal, y el propio id de la oferta viaja a cada portal para que este pueda devolverlo por su nombre. Un origen de texto libre como "LinkedIn" escrito en una candidatura se deja tal cual en lugar de adivinar que corresponde al portal LinkedIn Jobs, porque un candidato mal atribuido da la respuesta equivocada a la única pregunta para la que existe este desglose.

## Dónde encaja en el método

Ejecutar. Idea y Crear produjeron la requisición: el puesto, el listón, el registro que hay detrás. Ejecutar es donde empieza a trabajar en el mundo, y una búsqueda de personal solo empieza a funcionar cuando los candidatos pueden verla.

```bf-figure
{
  "kind": "flow",
  "title": "Una requisición a lo largo del método",
  "steps": [
    { "label": "Idea", "note": "Redacta el puesto con Brain en el lienzo", "hue": "idea" },
    { "label": "Crear", "note": "Dale un registro real; clasifica CV frente a él", "hue": "make" },
    { "label": "Ejecutar", "note": "Distribúyela a los portales y mira dónde está activa", "hue": "run", "tag": "nuevo" },
    { "label": "Medir", "note": "Candidatos por portal; qué portales están en silencio", "hue": "measure" },
    { "label": "Alcanzar", "note": "El feed de carreras la pone en todos los agregadores sin una API de socio", "hue": "reach" }
  ],
  "caption": "La tarjeta sigue siendo un asa sobre el registro en cada paso: los recuentos, los portales y los enlaces se leen del espacio de trabajo, nunca se teclean."
}
```

## Lo que puedes hacer hoy

- **Publicar un puesto en varios portales a la vez** desde la tarjeta de oferta de empleo, o pidiéndoselo a Brain.
- **Ver dónde está realmente activa**, con un enlace al anuncio de cada portal cuando el portal lo da.
- **Reintentar un portal que falló** tras corregir el motivo que dio, sin publicar dos veces en ningún sitio donde ya funcionó.
- **Comparar portales por candidatos**, incluidos los que todavía no han producido a nadie.
- **Llegar a la cola larga** con el feed del sitio de carreras, que leen todos los agregadores sin una API de socio.

---

**Lecturas relacionadas:** [Delega la búsqueda, no la decisión](/blog/delegate-the-search-not-the-decision) · [Ejecuta la aplicación que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas)

[Abre un lienzo](/create), añade una oferta de empleo y conecta un portal de empleo en Integraciones.
