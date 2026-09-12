Dibuja una sola vez el flujo de baja de un empleado. Revocar las cuentas, pagar la última nómina, recuperar el portátil, avisar al equipo. Seis pasos, conectados, construidos y ejecutándose con una programación. Bien.

Ahora dibuja el flujo de ascenso. Aprueba la subida de sueldo, actualiza el contrato, avisa a nóminas… y, en algún punto intermedio, da de baja al contratista cuyo puesto cubre ese ascenso.

Otra vez esos seis pasos.

Desde que el lienzo es el flujo de trabajo, la respuesta honesta era esa: volver a dibujarlos. Y la copia que corregías nunca era la que se ejecutaba. Alguien arregla el paso de nómina en el lienzo de bajas, y otros cuatro lienzos siguen haciéndolo a la antigua, en silencio, puntualmente, durante meses.

## Un lienzo ahora es un paso

`Run a canvas` es un tipo de paso como cualquier otro. Colócalo, elige un lienzo, y el flujo que dibujaste en otro sitio pasa a ser una sola tarjeta en este tablero.

```bf-figure
{
  "kind": "flow",
  "title": "Ascenso, con la baja dentro",
  "steps": [
    { "label": "Aprobar la subida", "note": "El punto de aprobación que de verdad decide una persona", "hue": "idea" },
    { "label": "Actualizar el contrato", "note": "Documentos, firmas, el expediente", "hue": "make" },
    { "label": "Ejecutar un lienzo · Baja", "note": "Seis pasos que viven en su propio tablero, con su propio autor y su propio historial", "hue": "run", "tag": "aquí, un solo paso" },
    { "label": "Avisar a nóminas", "note": "Lleva consigo lo que devolvió el lienzo anidado", "hue": "measure" }
  ],
  "caption": "El lienzo anidado no es una copia ni un enlace a un documento. Es el flujo, ejecutado, en mitad de este."
}
```

El paso es un valor, no un nuevo tipo de objeto: la misma regla que hace que un sector nuevo sea un valor de `discipline` y no un vocabulario nuevo. Eso significa que se dibuja, se conecta, se agrupa, se construye y se ejecuta exactamente igual que el switch que tiene al lado.

## Lo que acepta se lee en el tablero, no se declara

El diseño tentador es una tarjeta de contrato en el lienzo hijo: una lista de parámetros y una lista de valores devueltos contra las que se enlaza el padre. Es explícito, es estable, y falla la primera tarde en que alguien añade un paso, porque a partir de ahí hay dos descripciones de lo que necesita el lienzo y la que se ejecuta no es la que nadie está leyendo.

Así que no hay tarjeta de contrato. La interfaz se deriva del flujo que realmente está dibujado:

```bf-figure
{
  "kind": "compare",
  "title": "De dónde sale una interfaz",
  "columns": [
    { "title": "Un contrato declarado", "hue": "muted", "items": ["El autor escribe la lista de parámetros", "El autor escribe la lista de valores devueltos", "Alguien añade un paso", "La lista y el flujo dejan de coincidir", "Gana el flujo, en silencio"] },
    { "title": "Derivada del tablero", "hue": "make", "items": ["Un paso al que nada alimenta es por donde entran los datos", "Lo que ese paso declara necesitar ES un parámetro", "Una variable que nada aguas abajo lee ES un valor devuelto", "Añade un paso y la interfaz se ajusta sola", "No hay nada que mantener sincronizado"] }
  ],
  "caption": "La misma regla que el tablero ya sigue para decidir qué cuenta como sección ejecutable: pregúntale al dibujo, nunca a una marca que alguien tiene que acordarse de actualizar."
}
```

Elige un lienzo en el paso y te dice al momento qué recibe ese lienzo y qué devuelve, sin que tengas que abrirlo.

## Congelado o en vivo

Reutilizar plantea una pregunta que no tiene una única respuesta correcta, así que el paso te la hace a ti.

```bf-figure
{
  "kind": "compare",
  "title": "Dos formas de depender del lienzo de otra persona",
  "columns": [
    { "title": "Instantánea: la opción por defecto", "hue": "make", "items": ["Los pasos del hijo se copian en este flujo al construirlo", "Una definición, una ejecución, una línea de tiempo", "Los cambios allí no alteran nada aquí hasta que vuelvas a construir", "Lo que entregaste es lo que se ejecuta"] },
    { "title": "En vivo: opcional", "hue": "run", "items": ["Este flujo guarda una referencia a la compilación propia del hijo", "El hijo se vuelve a leer cada vez que se ejecuta este flujo", "Arregla el lienzo de bajas una vez y todos los que lo llaman lo recogen", "El hijo tiene que haberse construido allí al menos una vez"] }
  ],
  "caption": "Una subrutina compartida pide En vivo. Un flujo que tiene que seguir comportándose como cuando se aprobó pide Instantánea. Las dos opciones son un desplegable en el paso."
}
```

Ninguno de los dos enlaces puede fallar en silencio. Un lienzo que no se puede leer, uno sin pasos, uno con un paso que todavía necesita un prompt, un lienzo que se alcanza a sí mismo y una composición anidada más allá de cinco niveles son, todos, **rechazos**: la construcción se detiene y el mensaje nombra el lienzo. Es deliberado, y es la misma regla que el compilador siempre ha aplicado a un paso sin ninguna llamada: un flujo que se ejecuta, informa de éxito y no hace lo que debe es peor que uno que ni siquiera se construye.

## Dónde encaja en el método

La composición pertenece a **Crear**, el tercer acto y el caro, pero lo que de verdad cambia es lo que ocurre después: en Operar y en Medir.

[Leer y Demostrar](/blog/read-prove-build-the-inner-loop) van primero para que la decisión de crear sea una decisión. La composición consiste en que lo que ya decidiste crear merezca la pena conservarlo. Un proceso dibujado una vez y reutilizado es un proceso que puedes *mejorar* una sola vez: la corrección de la nómina cae en un único sitio, y todo lo que depende de ella es correcto en la siguiente ejecución, porque quienes lo llaman guardan una referencia, no una copia.

```bf-figure
{
  "kind": "stack",
  "title": "Lo que gana cada acto con un lienzo reutilizable",
  "bands": [
    { "label": "Crear", "note": "Dibuja la parte compartida una sola vez. El flujo de ascenso dice \"luego, dar de baja\" igual que dice \"luego, enviar la carta\".", "hue": "make" },
    { "label": "Operar", "note": "Los pasos anidados aparecen en la propia línea de tiempo del padre, bajo el nombre del lienzo hijo: una ejecución que vigilar, un punto de aprobación, un único lugar donde mirar.", "hue": "run", "tag": "en vivo o congelado" },
    { "label": "Medir", "note": "Corrige el paso compartido en su propio lienzo y todos los flujos que lo llaman quedan bien en la siguiente ejecución. Una corrección, no siete.", "hue": "measure" }
  ],
  "caption": "El arco no gana ninguna etapa. Lo que gana es que el mismo trabajo deja de redibujarse en cada etapa que lo necesita."
}
```

## Qué puedes hacer hoy

- **Convierte cualquier lienzo en un paso reutilizable**: sin exportar, sin plantilla, sin copia. Es el propio lienzo, ejecutándose.
- **Mira qué recibe antes de conectarlo**: parámetros y valores devueltos, derivados del tablero hijo y mostrados en el paso.
- **Elige si queda congelado o en vivo**: una compilación sobre la que puedes razonar, o una subrutina compartida que heredan todos los que la llaman.
- **Compón hasta cinco niveles**, con las autorreferencias y las cadenas demasiado profundas rechazadas por su nombre, en lugar de descubrirlas como una ejecución colgada.

Incorporaciones, bajas, aprobación de compras, comunicación de incidentes, renovación de contratos: toda organización tiene ocho procesos así, y cada uno aparece dentro de una docena de flujos más grandes. Siempre fueron el mismo flujo. Ahora son el mismo objeto.

---

**Lecturas relacionadas:** [El lienzo es el flujo de trabajo](/blog/creation-canvas-beyond-chat) · [Ejecuta la app que acaba de construir tu tablero](/blog/run-your-app-on-the-canvas) · [Puntos de aprobación y supervisión humana](/blog/approval-gates-and-human-oversight)

[Abre un lienzo](/create), dibuja el flujo que todo el mundo sigue redibujando y colócalo en el siguiente.
