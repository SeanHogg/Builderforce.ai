«Hacerlo real» no es una sola cosa. Son al menos ocho, difieren enormemente en fidelidad y en coste, y elegir mal entre ellas es el error más caro que se puede cometer en el primer mes de un proyecto.

La mayoría de las herramientas ofrecen exactamente una respuesta: construir el sistema. Es la prueba más cara que existe y, para la mayoría de las preguntas que de verdad se plantea un negocio, es la equivocada. «¿Me lo puedes enseñar?» no necesita un sistema en funcionamiento. «¿Alguien quiere esto?» se responde con una landing page y un número, y responderlo con un sistema construido es la manera de pasarse seis semanas en algo que nadie pidió.

Así que aquí van las ocho, lo que responde cada una y dónde se sitúa cada una en los dos ejes que importan.

## El mapa

```bf-figure
{
  "kind": "matrix",
  "title": "Fidelidad frente a esfuerzo",
  "xLabel": "Esfuerzo  ·  1 = una tarde,  5 = semanas",
  "yLabel": "Fidelidad  ·  1 = un boceto,  5 = la cosa en sí",
  "max": 5,
  "points": [
    { "label": "Vídeo demo", "x": 1, "y": 1, "hue": "read", "dx": 10, "dy": -12 },
    { "label": "Prototipo clicable", "x": 2, "y": 2, "hue": "read", "dx": -12, "dy": 20 },
    { "label": "Prueba de humo", "x": 2, "y": 2, "hue": "prove", "dx": 12, "dy": -12 },
    { "label": "Mago de Oz", "x": 2, "y": 3, "hue": "prove", "dx": 12, "dy": -10 },
    { "label": "Prueba de concepto", "x": 3, "y": 3, "hue": "prove", "dx": 12, "dy": 18 },
    { "label": "Línea telefónica", "x": 3, "y": 4, "hue": "build", "dx": 12, "dy": -12 },
    { "label": "Piloto", "x": 4, "y": 4, "hue": "build", "dx": 12, "dy": 20 },
    { "label": "Sistema en producción", "x": 5, "y": 5, "hue": "make", "dx": -12, "dy": -14 }
  ],
  "caption": "El prototipo clicable y la prueba de humo están de verdad en las mismas coordenadas —misma fidelidad, mismo esfuerzo— y sus etiquetas se separan para que ambas sigan siendo legibles. Cuestan lo mismo y responden a preguntas completamente distintas, que es justo la cuestión: el coste no te dice qué prueba ejecutar, solo en cuáles te puedes permitir equivocarte."
}
```

Lee la esquina inferior izquierda como una regla general, no como una clasificación. Nada de lo que hay ahí abajo es una prueba menor; es una respuesta más barata a una pregunta más acotada. Hacer un vídeo demo nunca es *un error*.

## Las ocho, y la pregunta para la que sirve de verdad cada una

**Vídeo demo** — *«¿Puedes enseñarme qué es esto?»* Un montaje cronometrado y un guion de narración, para que hoy mismo exista una demo grabable de noventa segundos. Fidelidad 1, esfuerzo 1. Es la respuesta cuando quien pregunta es una parte interesada, un inversor o un colega que necesita imaginarse la cosa. Construir un sistema para responder a eso es un error de categoría.

**Prototipo clicable** — *«¿Alguien puede completar esto sin ayuda?»* Un recorrido clicable e instrumentado del flujo, sin backend y sin datos. Fidelidad 2, esfuerzo 2. Un prototipo que necesita un despliegue no es un prototipo; todo su valor está en que funciona en cualquier portátil, delante de una persona real, esta misma tarde.

**Prueba de humo** — *«¿Alguien quiere esto de verdad?»* Una landing de puerta falsa, una lista de espera y una consola de demanda evaluada frente a un umbral fijado de antemano. Fidelidad 2, esfuerzo 2. El umbral es toda la prueba. Sin él, tienes una landing page y una sensación.

**Mago de Oz** — *«¿Vale la pena pagar por el resultado antes de poder automatizarlo?»* Un front end real con una persona detrás, con reloj de SLA, usando las mismas rutas que usará el sistema construido. Fidelidad 3, esfuerzo 2. Absurdamente infrautilizado, porque parece hacer trampa. No es hacer trampa; es separar «¿esto tiene valor?» de «¿podemos automatizarlo?», dos preguntas que fallan por motivos distintos.

**Prueba de concepto** — *«¿La parte difícil funciona de verdad, con suficiente fiabilidad?»* El paso más arriesgado aislado tras un banco de pruebas, con una tasa de acierto evaluada frente a un listón fijado de antemano. Fidelidad 3, esfuerzo 3. Fíjate en la forma: una *tasa de acierto*, no una demo. Una ejecución con éxito no demuestra nada sobre un paso que tiene que funcionar ocho de cada diez veces.

**Piloto** — *«¿Aguanta con personas reales, a un tamaño en el que podamos sobrevivir a estar equivocados?»* Una ejecución acotada con un grupo definido, un ciclo de feedback semanal y criterios de salida por escrito. Fidelidad 4, esfuerzo 4. Los criterios de salida son lo que impide que un piloto se convierta, sin que nadie lo decida, en producción.

**Línea telefónica** — *«¿Pueden los clientes llegar a esto por teléfono, y puede esto llegar a ellos?»* Un número entrante que contesta y entiende, más un endpoint que realiza llamadas salientes. Fidelidad 4, esfuerzo 3. Más barata que el piloto que tiene al lado y con una fidelidad muy superior a lo que sugiere su coste, porque un número de teléfono que contesta es inequívocamente real para quien llama.

**Sistema en producción** — *«¿Está funcionando de verdad y sabemos operarlo?»* El sistema completo en una dirección real, con una consola de operaciones y un manual de guardia. Fidelidad 5, esfuerzo 5. Fíjate en la segunda mitad de esa pregunta. Un sistema que nadie sabe operar no está terminado; es un pasivo que, de momento, tiene buena disponibilidad.

## Lo que hace realmente la clasificación

```bf-figure
{
  "kind": "bars",
  "title": "Esfuerzo, ordenado: la recomendación de partida antes de leer ningún brief",
  "max": 5,
  "rows": [
    { "label": "Vídeo demo", "value": 1, "note": "una tarde", "hue": "read" },
    { "label": "Prototipo clicable", "value": 2, "note": "uno o dos días", "hue": "read" },
    { "label": "Prueba de humo", "value": 2, "note": "uno o dos días", "hue": "prove" },
    { "label": "Mago de Oz", "value": 2, "note": "uno o dos días", "hue": "prove" },
    { "label": "Prueba de concepto", "value": 3, "note": "unos días", "hue": "prove" },
    { "label": "Línea telefónica", "value": 3, "note": "unos días", "hue": "build" },
    { "label": "Piloto", "value": 4, "note": "semanas", "hue": "build" },
    { "label": "Sistema en producción", "value": 5, "note": "semanas de ingeniería de verdad", "hue": "make" }
  ],
  "caption": "El coste pesa por sí solo el cuarenta por ciento de la puntuación de la clasificación, antes de cualquier coincidencia de capacidades. Sin ese término, un brief que nombra cinco capacidades pondría siempre en cabeza la prueba que incluye más de ellas, que siempre es la más grande."
}
```

Cuando pegas un brief, la clasificación es el ajuste de capacidades **más** una preferencia permanente por lo barato frente a lo caro. Un brief que dice «voz» apunta de verdad a la línea telefónica, y el término de ajuste lo dirá. Pero un brief que nombra cinco cosas apunta a cinco pruebas, y sin el término de coste la recomendación se reduce a «constrúyelo todo», cada vez, disfrazado de análisis.

La clasificación sigue dos reglas más, y ambas existen porque la alternativa es peor:

- **Todas las opciones vuelven siempre, con sus motivos.** Una puntuación sin motivos no es un consejo, es un veredicto, y un fundador debería poder discutir un consejo.
- **Una opción sin lista de capacidades es universal, no irrelevante.** Puntuar «no coincide con nada» como cero enterraría el vídeo demo, que es la primera respuesta correcta para la mayoría de los briefs.

## Elegir bien

La pregunta práctica no es «qué prueba es la mejor». Es **qué pregunta estoy dispuesto a pagar por responder, y qué resultado me haría parar**.

```bf-figure
{
  "kind": "flow",
  "title": "Una decisión que puedes tomar en más o menos un minuto",
  "steps": [
    { "label": "Nombra la duda", "note": "No la funcionalidad: la duda. «Nadie lo quiere», «el modelo no es lo bastante preciso», «la gente no consigue completar el flujo», «no aguantará la carga real».", "hue": "read" },
    { "label": "Elige la prueba que la ataca", "note": "Demanda → prueba de humo. Comprensión → prototipo clicable. Riesgo técnico → prueba de concepto. Valor antes de automatizar → Mago de Oz.", "hue": "prove" },
    { "label": "Escribe primero el número", "note": "El umbral, la tasa de acierto, la tasa de finalización, los criterios de salida. Antes de construirlo, no después de tener el resultado.", "hue": "prove", "tag": "innegociable" },
    { "label": "Ejecútala y respeta el número", "note": "Un umbral que renegocias después de ver el resultado nunca fue un umbral.", "hue": "build" }
  ]
}
```

Ese último paso es donde de verdad falla la mayor parte de la validación. La prueba se ejecuta, el número sale bajo y el número se mueve. Escribirlo antes no vuelve honesto a nadie, pero sí hace visible la deshonestidad, y resulta que eso es la mayor parte del trabajo.

## Cuando la fidelidad no lo es todo

Una advertencia sobre el mapa. La fidelidad mide lo cerca que está la prueba de la cosa real, no lo *convincente* que resulta. Un vídeo demo de noventa segundos con fidelidad 1 llevará a un inversor más lejos que una prueba de concepto con fidelidad 3, porque la pregunta del inversor era «¿me lo puedes enseñar?» y la PoC respondió a una pregunta que nadie le había hecho.

Adapta la prueba a quien pregunta, no al eje.

---

*[Empieza con un lienzo](/create/new) y describe la idea: con la sesión iniciada, `/realize` la lee y clasifica las ocho frente a ella, y leer no construye nada, así que consultar la clasificación no te cuesta nada. O lee el método en el que encajan: [De la idea a lo real](/blog/idea-to-real-the-operating-methodology).*
