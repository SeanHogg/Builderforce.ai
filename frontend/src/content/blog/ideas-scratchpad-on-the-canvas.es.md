La mayoría de las ideas no mueren por ser malas. Mueren en una app de notas.

Tienes una en la ducha, durante un paseo, a mitad de una llamada sobre otra cosa. La anotas en algún sitio —una app de notas, el reverso de un recibo, un mensaje de Slack a ti mismo— y se queda ahí con otras cuarenta, ninguna más avanzada que el día en que se te ocurrió. Seis meses después no sabes decir cuáles probaste alguna vez con un cliente real y cuáles solo te *sonaron* bien.

El lienzo tenía el problema contrario. Podía contener un segmento de clientes investigado, una battlecard de competidor, una entrevista con un cliente y un experimento puntuado. No tenía dónde poner el pensamiento a medio formar del que nació todo lo demás.

## El bloc de Ideas

Ahora todo lienzo tiene una cuarta forma de leer el tablero, justo al lado de Tablero: **Ideas**.

```bf-figure
{
  "kind": "screen",
  "frame": "El bloc de Ideas en un lienzo",
  "ratio": 1.62,
  "regions": [
    { "label": "Capturar", "note": "Escribe el pensamiento y pulsa Capturar: la primera línea se convierte en su título y la nota completa se conserva", "x": 4, "y": 8, "w": 92, "h": 20, "hue": "idea" },
    { "label": "Etapas", "note": "Cuántas ideas hay en cada etapa; pulsa una para filtrar", "x": 4, "y": 32, "w": 26, "h": 60, "hue": "accent" },
    { "label": "Tus ideas", "note": "Las más nuevas primero, cada una con su etapa, su siguiente paso y su evidencia", "x": 33, "y": 32, "w": 63, "h": 60, "hue": "make" }
  ],
  "caption": "El bloc es una lectura del tablero, no un segundo lugar donde guardar cosas. Cada idea capturada es una tarjeta en el tablero, así que Brain la ve y puedes arrastrarla junto al trabajo en el que se convierte."
}
```

Anotar una idea lleva casi lo mismo que tenerla. Escribe una frase, o tres, y pulsa **Capturar**. La primera línea se convierte en el título de la idea y la nota completa se conserva exactamente como la escribiste. Lo a medio formar es el punto: un bloc que pide un enunciado del problema antes de aceptar una nota es un formulario, y la nota se pierde.

Después el bloc lleva el seguimiento por ti. Cada idea tiene una etapa, y las etapas son las que una idea atraviesa de verdad:

```bf-figure
{
  "kind": "flow",
  "title": "La vida de una idea",
  "steps": [
    { "label": "Capturada", "note": "Anotada. No se le pide nada más.", "hue": "idea" },
    { "label": "Explorando", "note": "Se está investigando: el problema, quién lo tiene, quién más lo está resolviendo.", "hue": "idea" },
    { "label": "Validando", "note": "Hay una entrevista con un cliente o un experimento en marcha.", "hue": "make" },
    { "label": "Validada", "note": "La evidencia dijo que sí.", "hue": "run", "tag": "ganada, no sentida" }
  ],
  "caption": "Otras tres etapas son salidas, y cada una significa algo distinto un mes después: En pausa es «ahora no», Descartada es «la evidencia dijo que no» y Promovida es «se convirtió en algo»: un proyecto, una empresa, una prueba."
}
```

## Dónde entran las entrevistas con clientes

Una idea vale lo que valgan las conversaciones que hay detrás, así que cada idea del bloc tiene un botón **Planificar una entrevista**. Púlsalo y ocurren tres cosas a la vez: aterriza en el tablero una tarjeta de entrevista con un cliente, titulada con el nombre de la idea; la idea registra que esa entrevista la pone a prueba; y una idea que solo estaba capturada o en exploración pasa a Validando.

Cuando la entrevista se redacta —las preguntas, los dolores que la persona planteó sin que se lo preguntaran, las citas textuales—, la idea la cuenta. Cada idea muestra su evidencia con palabras llanas: *probada con 2 entrevistas y 1 experimento*, o *sin probar: habla con alguien antes de construir*. Si una idea nombra una entrevista que no está en el tablero, lo dice en lugar de contarla.

Y en lo alto del bloc está el único número que merece una acción: cuántas de tus ideas abiertas nadie ha probado aún con un cliente.

```bf-figure
{
  "kind": "compare",
  "title": "Guardar ideas frente a hacerles seguimiento",
  "columns": [
    { "title": "Una app de notas", "hue": "muted", "items": ["Cuarenta ideas, todas en el mismo estado", "Sin registro de a quién preguntaste", "«Validada» significa que todavía suena bien", "Empezar el trabajo significa copiarla a otro sitio"] },
    { "title": "El bloc de Ideas", "hue": "idea", "items": ["Cada idea tiene una etapa", "Entrevistas y experimentos enlazados a la idea que ponen a prueba", "Validada significa que la evidencia dijo que sí", "La idea ya es una tarjeta en el tablero donde ocurre el trabajo"] }
  ],
  "caption": "La diferencia no es dónde se guardan las palabras. Es si «¿hemos hablado con alguien sobre esto?» tiene respuesta."
}
```

## Dónde encaja en el método

De la idea a lo real recorre **Idea → Crear → Ejecutar → Medir**, y el primer acto es el más barato a propósito: [Leer y Probar](/blog/read-prove-build-the-inner-loop) van antes de Construir para que decidir construir sea una decisión y no inercia.

El bloc es la puerta de entrada de ese primer acto. **Capturar** es el momento anterior a Leer: la idea tiene que existir en algún sitio antes de que nadie pueda investigarla. **Explorando** es Leer: Brain puede tomar cualquier idea del tablero e investigar el problema, el segmento y la competencia que la rodean. **Validando** es Probar: la entrevista con un cliente o el experimento que convierte una suposición en un hecho, y la más barata de las [ocho formas de hacer real una idea](/blog/eight-ways-to-make-an-idea-real). Solo una idea que haya pasado por ambas debería ser **Promovida** a algo que construyes.

Esa etapa lo necesitaba porque era el único lugar donde el método no tenía objeto. Todo lo posterior sí lo tenía: pruebas, proyectos, lanzamientos, métricas. La idea en sí vivía en la app que tuvieras abierta cuando se te ocurrió.

## Lo que puedes hacer hoy

- **Captura una idea en segundos** desde cualquier lienzo, en una frase, sin decidir todavía qué es.
- **Ve todas las ideas a la vez**, las más nuevas primero, filtradas por etapa con una pulsación.
- **Planifica con un clic la entrevista con un cliente que pone a prueba una idea**, enlazada en ambos sentidos.
- **Ve qué ideas están realmente probadas**, y cuántas ideas abiertas nadie ha hablado con un cliente.
- **Pide a Brain que investigue cualquier idea** del tablero, porque cada idea ya es una tarjeta que puede leer y completar.

---

**Lecturas relacionadas:** [Leer, Probar, Construir: el bucle interno](/blog/read-prove-build-the-inner-loop) · [Ocho formas de hacer real una idea](/blog/eight-ways-to-make-an-idea-real) · [Del feedback de clientes a diez maquetas](/blog/customer-feedback-to-ten-mockups)

[Abre un lienzo](/create), pulsa Ideas y escribe esa que llevas tiempo queriendo probar.
