La mayoría del software para construir cosas se organiza en torno a lo que el propio software tiene. Un menú de departamentos, una cuadrícula de funciones, una lista de integraciones. Responde a «¿qué puede hacer esto?», que es una pregunta legítima, pero nunca responde a la pregunta con la que la persona llegó de verdad: *¿qué hago primero?*

Builderforce, en cambio, se organiza en torno a un método. La navegación es el método. El lienzo es donde el método se ejecuta. El precio se deriva de qué parte del método cuesta dinero. Este artículo es ese método puesto por escrito.

## El arco: dónde estás

Hay cuatro etapas, y no son departamentos. Son posiciones en un recorrido, y cada destino del producto está exactamente en una de ellas.

```bf-figure
{
  "kind": "stack",
  "title": "El arco: una pregunta por etapa",
  "bands": [
    { "label": "Idea", "note": "¿Y si…? — el lienzo, el briefing, la lectura de lo que realmente dijiste.", "hue": "idea", "tag": "gratis" },
    { "label": "Crear", "note": "Constrúyelo. — pruebas, proyectos, la fuerza de trabajo que recoge los tickets.", "hue": "make" },
    { "label": "Operar", "note": "Llévalo como una empresa. — finanzas, ingresos, personas, soporte, gobernanza.", "hue": "run" },
    { "label": "Medir", "note": "¿Está funcionando? — donde se evalúa la condición de parada fijada dos etapas antes.", "hue": "measure", "tag": "cierra el bucle" }
  ],
  "caption": "Hay dos etapas más allá de estas cuatro: Mercado (vender, comprar, contratar, que te encuentren) y Expansión (hacer crecer el negocio a partir de ello). Son lo que hace una empresa cuando ya tiene algo que funciona, así que no forman parte de la decisión de empezar."
}
```

La propiedad importante de esta lista es que **detenerse a mitad de camino es un uso completo y exitoso del producto**. Quien publica tres landing pages y nunca llega a constituir una empresa no ha fracasado en el onboarding. Las etapas posteriores siguen visibles todo el tiempo —atenuadas, no ocultas—, porque nadie pide una capacidad que nunca ha visto.

## El bucle: qué haces

Dentro del paso de Idea a Crear hay algo mucho más pequeño, y es la parte que tiene una opinión.

```bf-figure
{
  "kind": "flow",
  "title": "Leer → Demostrar → Crear",
  "steps": [
    { "label": "Leer", "note": "Pega una idea, un briefing, un RFP, un concurso. Vuelve como una especificación: qué tiene que hacer, qué capacidades nombra, qué límites fijó el propio briefing.", "hue": "read", "tag": "no escribe nada" },
    { "label": "Demostrar", "note": "Ocho formas de hacerlo real, ordenadas frente a esa especificación, de la más barata a la más cara. Cada una lleva una condición de parada: el número que detendría el proyecto.", "hue": "prove", "tag": "no construye nada" },
    { "label": "Crear", "note": "Archivos en el lienzo, endpoints en marcha, tickets en el tablero, el sitio publicado y una dirección que puedes enviar a alguien.", "hue": "build", "tag": "gasta" }
  ],
  "caption": "Los dos primeros actos son gratis. No es un truco de precios: es todo el diseño. Los dos actos que deciden si merece la pena hacer el caro nunca deben ser el motivo por el que alguien se los salta."
}
```

Leer una idea es barato. Construirla no. **Elegir qué prueba merece la pena ejecutar es la decisión más trascendental del primer mes de cualquier proyecto**, y es la decisión para la que la mayoría de las herramientas ni siquiera tienen un sitio. Describes lo que quieres y se ponen a construirlo. La elección se toma por defecto, y el valor por defecto siempre es la opción más cara.

## Por qué existe el acto intermedio

Este es el fallo en torno al cual está diseñado el método, y no es el descuido. Es el entusiasmo.

```bf-figure
{
  "kind": "compare",
  "title": "Las mismas seis semanas, gastadas de dos maneras",
  "columns": [
    {
      "title": "Sin el acto intermedio",
      "hue": "bad",
      "items": [
        "Describes la idea a una herramienta que construye cosas.",
        "Seis semanas de ingeniería real, toda ella competente.",
        "Lanzamiento. A mirar el tráfico.",
        "Descubres que nunca se hizo la pregunta de la demanda.",
        "El trabajo era bueno. La pregunta era la equivocada."
      ]
    },
    {
      "title": "Con él",
      "hue": "good",
      "items": [
        "Describes la idea. Se lee y se convierte en una especificación.",
        "Una tarde: una landing page, una lista de espera, un umbral fijado de antemano.",
        "Dos semanas. El número llega por debajo del umbral.",
        "Paras, o cambias la idea, tras haber gastado una tarde.",
        "Te quedan seis semanas para la versión que la gente sí quería."
      ]
    }
  ],
  "caption": "El fallo caro no es construir despacio lo equivocado. Es construir lo que parece correcto antes de averiguar si alguien lo quería."
}
```

Por eso el recomendador de Builderforce es deliberadamente conservador. Da al **coste** un peso del cuarenta por ciento de la puntuación y nunca empieza por el sistema completo, ni siquiera ante un briefing que nombra cinco integraciones y claramente quiere uno. Un recomendador que estuviera de acuerdo con lo que ibas a hacer de todos modos no sería un consejo. Sería un espejo carísimo.

Aun así, todas las opciones se ofrecen siempre. Ordenar es una orientación sobre qué ejecutar *primero*; ocultar una opción convertiría una recomendación en un veredicto, y quien ya ha hecho su smoke test debería poder ir directo al piloto sin tener que discutir con una herramienta.

## La condición de parada es lo que lo convierte en un bucle

Una prueba sin ninguna condición que pueda fallar es un lanzamiento con pasos de más.

Por eso cada formulario de prueba incluye `successCriteria`, que se fija **antes de construir**, no después de conocer el resultado. Un smoke test sin un número que detendría el proyecto no es una prueba, es una landing page. Un piloto sin criterios de salida nunca termina; simplemente se convierte en el producto, ampliación a ampliación, hasta que alguien se da cuenta de que lleva un año en piloto.

Ese número es lo que se evalúa en Medir. Y eso es lo que convierte el arco en un bucle y no en una línea: la respuesta vuelve a Idea, y la siguiente pasada parte de algo que ahora sabes en lugar de algo que esperabas.

## Cómo se ve esto en el producto

Nada de lo anterior es el diagrama de una intención. Cada pieza es una superficie real:

- **Leer** es `POST /api/challenges` y el botón Leer del lienzo. No escribe nada en tu espacio de trabajo ni crea tickets. Puedes leer el mismo briefing cuatro veces mientras lo editas sin gastar nada.
- **Demostrar** es un registro de ocho objetivos, cada uno declarado como datos más una función de construcción. Añadir un noveno es una entrada en el registro, no una rama nueva en un constructor, y esa es la razón estructural por la que el catálogo puede crecer sin que el consejo empeore.
- **Crear** materializa lo que devuelva el objetivo elegido: archivos en el lienzo, endpoints en marcha, tickets sembrados, un sitio publicado, una dirección. A partir de ahí, los tickets de construcción se ofrecen al control del carril autónomo, de modo que los agentes los recogen en un tablero con equipo y los rechazan limpiamente en uno vacío.
- **Medir** es donde llegan la consola de demanda, la tasa de aciertos y el informe del piloto, cada uno juzgado frente al umbral que se dejó por escrito primero.

## Los límites, con honestidad

Tres cosas que este método no hace, dichas claramente porque un método que dice no tener límites es un eslogan.

No te dice si tu idea es buena. Te dice la forma más barata de averiguarlo, que es un servicio distinto y más útil.

No elimina la necesidad de criterio sobre *qué pregunta importa*. Las ocho pruebas responden a ocho preguntas distintas —«¿me lo puedes enseñar?», «¿alguien quiere esto?», «¿funciona la parte difícil?»— y elegir la pregunta equivocada de forma barata sigue siendo elegir la pregunta equivocada.

Y no hace innecesaria la prueba cara. A veces la respuesta es, de verdad, el sistema completo en una dirección real con un runbook de guardia. Lo único que afirma el método es que deberías llegar ahí habiendo recibido ya un sí de algo que costó una tarde.

---

*[Abre un lienzo](/create/new) y describe lo que intentas crear: no necesitas cuenta, el tablero es real y local hasta que decidas lo contrario. Con la sesión iniciada, `/realize` lee la idea y ordena las ocho pruebas frente a ella.*
