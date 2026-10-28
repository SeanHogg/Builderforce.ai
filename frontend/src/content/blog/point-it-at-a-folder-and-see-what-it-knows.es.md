Hace un año leías el código antes de hacer merge. Hoy un agente escribe cuarenta archivos en una tarde, y nadie lee los cuarenta. Con los documentos pasa lo mismo: especificaciones, contratos, notas de investigación y políticas que un agente redactó, revisó y volvió a redactar.

No puedes leerlo todo, y no te hace falta. Lo que necesitas es juzgar la **forma**. ¿Está organizado en capas como querías? ¿Está lo mismo escrito dos veces? ¿Dice un documento lo contrario que otro? ¿Los enlaces siguen llevando a alguna parte?

Hasta ahora, nada te lo mostraba. Ahora apuntas BuilderForce a una carpeta y te lo muestra.

## Pídele que mire

Desde VS Code, desde Rovr o en el canvas web, escribe `/review ./contracts`, o simplemente pide: «revisa la carpeta de facturación». En VS Code también puedes hacer clic derecho en una carpeta y elegir **Review with BuilderForce**.

Antes de que nada se ejecute ves lo que hará la revisión: cuántos archivos leerá, cuántos no han cambiado desde la última vez y, aproximadamente, cuántas llamadas al modelo y cuánto dinero costará la pasada de evaluación. Dices que sí, y el grafo se construye mientras miras.

```bf-figure
{
  "kind": "flow",
  "title": "De una carpeta a un grafo sobre el que puedes actuar",
  "steps": [
    { "label": "Apuntar", "note": "Cualquier carpeta: código, documentos o ambos. Escribe /review, pídelo con tus palabras o haz clic derecho en VS Code.", "hue": "read" },
    { "label": "Confirmar", "note": "Ve el número de archivos, lo que no ha cambiado y el coste aproximado antes de gastar nada.", "hue": "accent", "tag": "tú decides" },
    { "label": "Ver", "note": "Se abre un grafo 3D de la carpeta, con cada problema encontrado ya marcado.", "hue": "build" },
    { "label": "Arreglar", "note": "Cada hallazgo tiene Fix with agent. Un clic pasa la petición a tu compositor.", "hue": "good" }
  ],
  "caption": "Una segunda revisión solo vuelve a leer los archivos que cambiaron, así que mantener la imagen al día cuesta casi nada."
}
```

## Lo que ves

La carpeta se abre como un grafo 3D que puedes girar, ampliar y recorrer con el ratón o con el dedo. El código se sitúa en planos, uno por capa. Los documentos se agrupan por carpeta y sección. Cuanto más grande es un nodo, más depende de él el resto de la carpeta. Cada flecha va de lo que usa a lo que se usa, y las flechas que rompen tus reglas se iluminan.

```bf-figure
{
  "kind": "screen",
  "frame": "Una carpeta revisada, en VS Code",
  "ratio": 1.62,
  "regions": [
    { "label": "La carpeta en 3D", "note": "Capas como planos, áreas como grupos, tamaño como importancia", "x": 4, "y": 8, "w": 62, "h": 66, "hue": "build" },
    { "label": "Hallazgos", "note": "Capas rotas, duplicados, contradicciones, enlaces rotos", "x": 69, "y": 8, "w": 27, "h": 44, "hue": "bad" },
    { "label": "Fix with agent", "note": "En cada hallazgo", "x": 69, "y": 56, "w": 27, "h": 18, "hue": "good" },
    { "label": "Lentes", "note": "Estructura, capas, duplicados, afirmaciones, enlaces, comparar", "x": 4, "y": 80, "w": 62, "h": 14, "hue": "accent" },
    { "label": "Preguntar", "note": "Respondido desde la memoria", "x": 69, "y": 80, "w": 27, "h": 14, "hue": "read" }
  ],
  "caption": "Una sola vista en cada entorno. VS Code, Rovr y el canvas web dibujan el mismo grafo de la misma carpeta."
}
```

Cambia de lente para hacerle otra pregunta a la misma carpeta:

- **Capas.** Qué archivos se saltan la capa a la que pertenecen y cuáles forman un ciclo.
- **Duplicados.** Código copiado de un sitio a otro, y secciones o documentos enteros que dicen casi lo mismo.
- **Afirmaciones.** Dónde un documento contradice a otro y dónde coinciden.
- **Enlaces.** Cada referencia entre documentos, con los enlaces rotos señalados.
- **Sin uso.** Archivos, exportaciones y dependencias que ya nada utiliza.
- **Comparar.** Esta revisión frente a la anterior, para ver qué ha mejorado y qué ha empeorado.

Elige cualquier archivo y **trázalo**. En el código obtienes una secuencia de capas: qué capa llamó a cuál, y dónde una llamada se saltó una capa o volvió a subir. En los documentos ves cómo uno llega a otro a través de enlaces y citas. Cualquiera de las dos trazas se copia como un diagrama que puedes pegar en un pull request.

## Arréglalo desde donde lo encontraste

Cada hallazgo tiene **Fix with agent**. No abre un chat nuevo ni una herramienta aparte. Coloca una petición ya preparada en el compositor que ya usas: «Consolida el grupo de clones n.º 3», «Mueve la importación de la base de datos detrás de un puerto», «Concilia la sección 4.2 de a.md con la sección 2 de b.md», «Repara 3 enlaces rotos». La lees, la cambias si quieres y la envías. Si sabes algo de un archivo que el grafo debería recordar, **Add fact** lo fija a ese archivo para cada persona y cada agente del proyecto.

## Pregunta, y a menudo no hace falta ningún modelo

Una vez revisada, la carpeta queda en memoria. Las preguntas sobre ella se responden desde esa memoria en lugar de volver a leer cada archivo.

```bf-figure
{
  "kind": "compare",
  "title": "Preguntar sobre una carpeta",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Le haces una pregunta al agente", "Abre y lee archivo tras archivo", "Pagas por cada archivo que lee", "Preguntas otra vez mañana y vuelve a leerlos todos"] },
    { "title": "Ahora", "hue": "read", "items": ["Le haces una pregunta al agente", "La respuesta sale del grafo en memoria", "A menudo se resuelve sin ninguna llamada al modelo", "Preguntas otra vez mañana y es igual de rápido"] }
  ],
  "caption": "/dup, /graph, /review y preguntas como «¿dónde se gestiona la facturación?» se reconocen antes de llamar a ningún modelo. Si el grafo está seguro, responde; si no, el modelo empieza con los datos en vez de buscarlos."
}
```

Escribe `/dup` y se listan los duplicados. Escribe `/graph` y la vista se abre sobre los archivos que nombraste. Pregunta «¿qué dice el contrato de arrendamiento sobre la rescisión?» o «¿dónde se gestiona la facturación?» y la respuesta vuelve con los lugares de donde salió y lo que tienen al lado. Cuando el grafo puede responder solo, no se llama a ningún modelo y no se gasta nada. Cuando no puede, el modelo parte de los datos que encontró el grafo en lugar de gastar turnos buscándolos.

## Dónde encaja en el método

El grafo sirve a dos etapas del arco [Idea to Real](/blog/idea-to-real-the-operating-methodology), una para cada tipo de carpeta.

**Para los documentos, es Idea → Read.** [Read](/blog/read-prove-build-the-inner-loop) hace una sola pregunta: *¿qué dijiste en realidad?* Cuando «lo que dijiste» son treinta especificaciones y una carpeta de contratos, la respuesta honesta incluye los puntos en los que no coinciden. Hasta ahora la única forma de encontrarlos era leer cada archivo. Ahora las contradicciones, las casi copias y los enlaces muertos están en pantalla antes de que nadie decida qué construir, y Read sigue siendo el paso barato que debe ser.

**Para el código, es Make → Build.** Build es el paso que gasta: agentes, presupuesto de ejecución, despliegues. Su pregunta es *¿es real?*, y cuando los agentes escriben las líneas, la respuesta depende de la forma: ¿respeta sus capas?, ¿está hecho una sola vez?, ¿algo sigue usando esto? Revisar línea por línea deja de escalar cuando ya no escribes tú las líneas. Juzgar la forma sí escala, y una capa rota detectada el día que aparece cuesta mucho menos que la misma encontrada después de que otras tres funciones se hayan apoyado en ella.

## Lo que puedes hacer hoy

- **Revisar cualquier carpeta**, de código o de documentos, desde VS Code, Rovr o el canvas web, y ver lo que costará antes de empezar.
- **Ver dónde se rompen tus capas** y qué archivos forman un ciclo, en un grafo que puedes recorrer.
- **Encontrar código duplicado y documentos casi idénticos** antes de que se separen.
- **Detectar documentos que se contradicen** y enlaces que ya no llevan a ninguna parte.
- **Trazar cualquier archivo** a través de las capas o documentos que alcanza, y copiar la traza como diagrama.
- **Arreglar cualquier hallazgo con un agente** en un clic, desde el compositor que ya usas.
- **Preguntar sobre la carpeta** y obtener respuestas desde la memoria, a menudo sin pagar una llamada al modelo.
- **Ver cómo baja la deuda técnica** comparando esta revisión con la anterior.

---

**Lecturas relacionadas:** [Read, Prove, Build: el bucle interno](/blog/read-prove-build-the-inner-loop) · [Inferencia con la memoria primero: sáltate el LLM](/blog/memory-first-inference-skip-the-llm) · [Un índice local para todas tus herramientas de IA](/blog/one-local-index-for-every-ai-tool)

[Abre un canvas](/create) y escribe `/review` seguido de la carpeta que ya has dejado de leer.
