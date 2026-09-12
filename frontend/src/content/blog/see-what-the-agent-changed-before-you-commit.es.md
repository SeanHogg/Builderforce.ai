Pides un arreglo. El agente trabaja, narra, termina y dice: *el cambio en el archivo se ha hecho en local; tendrás que hacer commit y push manualmente.*

¿Y ahora qué?

El cambio es real. Está en tu disco ahora mismo. Y hasta esta versión, nada en BuilderForce lo decía. El chat mostraba un turno terminado. El carril de tickets de encima mostraba una tarea en curso. Todas las secciones de la barra lateral —Sesiones, Chats, Proyecto y tareas, Bandeja de entrada— seguían como si nada hubiera tocado el sistema de archivos. El único rastro de la edición era una frase en una transcripción de la que tenías que fiarte, y el único camino hasta el código era fijarte por tu cuenta en la vista Control de código fuente de VS Code y relacionarla de memoria con la conversación.

Resulta extraño en una herramienta cuya premisa entera es que los agentes hacen un trabajo que puedes inspeccionar.

## Qué hay ahora

Dos superficies, leyendo una misma respuesta.

```bf-figure
{
  "kind": "screen",
  "frame": "El editor tras un turno del agente que tocó código",
  "ratio": 1.62,
  "regions": [
    { "label": "Cambios", "note": "Una nueva sección en la barra lateral. Contador, una fila por archivo; al hacer clic se abre el diff.", "x": 3, "y": 22, "w": 32, "h": 30, "hue": "make" },
    { "label": "Sesiones · Proyecto · Bandeja de entrada", "note": "Sin cambios", "x": 3, "y": 54, "w": 32, "h": 34, "hue": "muted" },
    { "label": "Barra de actividad", "note": "El contador de la sección sube hasta aquí: visible con el panel cerrado", "x": 0, "y": 8, "w": 3, "h": 84, "hue": "accent" },
    { "label": "Barra de cambios pendientes", "note": "3 cambios sin commit · Revisar", "x": 38, "y": 14, "w": 58, "h": 9, "hue": "make" },
    { "label": "Carril de tickets", "note": "Los tickets en los que trabaja este chat", "x": 38, "y": 25, "w": 58, "h": 12, "hue": "idea" },
    { "label": "La conversación", "x": 38, "y": 39, "w": 58, "h": 49, "hue": "idea" }
  ],
  "caption": "La barra está encima del carril de tickets porque es ahí donde ya estás mirando cuando termina un turno. La sección de la barra lateral es para cuando no lo estás."
}
```

**Una sección Cambios en la barra lateral de BuilderForce.** Una fila por archivo modificado, con lo que le ha pasado y el repositorio en el que está. Haz clic en una fila y se abre el propio visor de diffs del editor; no una representación de un diff, sino el de verdad, con toda su navegación y la posibilidad de editar el lado derecho. La sección lleva un contador numérico, y VS Code traslada los contadores de las vistas al icono de la barra de actividad, así que el trabajo pendiente es visible incluso con el panel contraído.

**Una barra de cambios pendientes en el chat**, justo encima del carril de tickets. Indica el recuento, se despliega en la lista de archivos y abre los mismos diffs mediante el mismo comando. Cuando el árbol está limpio no muestra nada en absoluto: ni un estado vacío, ni un espaciador. Una señal que está siempre en pantalla no es una señal.

Ambas se alimentan de la misma lectura, y eso importa más de lo que parece.

## Contar es la parte difícil

«¿Cuántos archivos hay pendientes?» parece una pregunta con una respuesta obvia, y tiene al menos cuatro respuestas equivocadas.

```bf-figure
{
  "kind": "compare",
  "title": "Lo que falla en un recuento ingenuo",
  "columns": [
    { "title": "La implementación obvia", "hue": "bad", "items": ["Preparados + no preparados, sumados", "Un archivo que preparaste y luego editaste cuenta dos veces", "Un renombrado muestra el archivo que ya no tienes", "Un conflicto sin resolver parece una edición preparada", "Los archivos sin seguimiento son invisibles o lo son todo"] },
    { "title": "Lo que tiene que significar el número", "hue": "make", "items": ["Una fila por ARCHIVO, tenga git registrado lo que tenga contra él", "Preparado y luego editado es un solo cambio pendiente, marcado como preparado", "Un renombrado es su destino: el archivo que existe", "Un conflicto dice conflicto, porque el remedio es distinto", "Lo que no tiene seguimiento se lista, y nunca se llama preparado"] }
  ],
  "caption": "Cada uno de estos casos es una prueba de la suite. Existen porque un recuento que no puedes cuadrar con la vista Control de código fuente que tienes al lado es peor que ningún recuento."
}
```

El mapeo vive en un único módulo sin dependencias del host, con dieciocho pruebas sobre exactamente esos casos, incluido `AD`, en el que preparaste una adición y luego borraste el archivo, y la edición pendiente es el borrado y no la adición. Todo lo que hay por encima lee ese único módulo: la barra lateral, la barra del chat y los datos del repositorio que se le comunican al propio agente al inicio de un turno. Esto último llevaba tiempo fallando en silencio en el código antiguo —sumaba las listas de preparados y no preparados—, así que al modelo se le podía decir «2 archivos sin commit» mientras una interfaz mostraba tres. Ahora hay un solo número.

## Mantenerlo fiel entre eventos

Las herramientas de archivos de un agente escriben directamente en disco. No pasan por la API de documentos del editor, así que nada en VS Code se dispara cuando escriben. Una superficie que espera educadamente una notificación se quedará diciéndote que no hay nada pendiente mientras acaban de cambiar tres archivos por debajo.

```bf-figure
{
  "kind": "flow",
  "title": "Todo lo que puede mover el árbol de trabajo, y qué nos avisa",
  "steps": [
    { "label": "Editas y guardas", "note": "El propio evento de guardado del editor", "hue": "idea" },
    { "label": "Preparas, haces commit o cambias de rama", "note": "El evento de estado del repositorio de la extensión Git", "hue": "run" },
    { "label": "Un agente escribe un archivo", "note": "No se dispara nada, así que la propia herramienta que modifica ES la señal, emitida en el momento en que tiene éxito", "hue": "make", "tag": "el hueco" },
    { "label": "Una sola suscripción compartida", "note": "Da igual cuántos paneles de chat y barras laterales estén observando: un solo listener y una sola lectura en caché detrás de todos", "hue": "measure" }
  ],
  "caption": "El tercer paso es el que hizo necesaria esta funcionalidad y el que se le escapa a un diseño basado en notificaciones."
}
```

## Dónde encaja en el método

Esto es **Demostrar**, y conviene ser preciso sobre por qué.

[Leer, Demostrar, Crear](/blog/read-prove-build-the-inner-loop) es el bucle interno, y Demostrar es el acto barato que decide si Crear acertó. Un agente que edita tu código ha hecho una afirmación: *este cambio hace lo que pediste*. Una transcripción que lo diga no es una prueba. El diff es la prueba, y si el diff está a tres clics, en otra herramienta, en la práctica la mayoría de la gente acepta la afirmación en lugar de comprobarla, que es precisamente como un flujo de trabajo agéntico deja de ser revisable y se convierte en algo en lo que o confías a ciegas o abandonas.

Poner la prueba a un clic de la afirmación no es una comodidad. Es lo que mantiene el bucle cerrado.

También se sitúa en una costura concreta del arco [Idea → Crear → Operar → Medir](/blog/idea-make-run-measure-menu-as-methodology): la salida de **Crear**. El código existe; todavía no se ha hecho commit, ni se ha ejecutado, ni se ha medido nada. Ese traspaso era el único punto en el que la superficie del editor local no tenía ninguna representación: el tablero sigue un ticket, el carril de la nube hace commit de cada escritura y abre un pull request cuando termina la ejecución, y en local el trabajo simplemente se volvía invisible en el momento en que dejaba de ser conversación y pasaba a ser archivos. Ahora es visible.

## Qué puedes hacer con esto hoy

- **Sabe, sin preguntar, que un turno cambió código**: el recuento está en el chat y en el icono de la barra de actividad, y aparece en el momento en que la herramienta tiene éxito, no cuando da la casualidad de que algo se refresca.
- **Lee cada cambio como un diff real**, en el propio visor del editor, a un clic de la conversación que lo produjo.
- **Ve lo que ya está preparado**, para que el commit no te dé sorpresas.
- **Pásaselo a Brain cuando estés conforme**: la acción del título de la sección Cambios abre un chat preparado para revisar el diff, hacer commit en una rama, hacer push y abrir un pull request, confirmando antes contigo el nombre de la rama y el título.

Hay algo que esto deliberadamente **no** hizo en su momento: darle al agente un verbo propio para hacer commit o push. Lo que un agente local puede hacerle a tu árbol de trabajo y a tu remoto es una decisión de gobernanza —rama o `main`, si un push necesita un punto de aprobación, si «abrir un PR y pedir revisión» debería sustituir a «push» como final por defecto—, y lanzar los verbos antes que la decisión habría sido lanzar un agente capaz de hacer push a una rama protegida por iniciativa propia. El camino de revisión llegó primero a propósito.

**Desde entonces, esa decisión se ha tomado y los verbos ya están disponibles**: `git_commit` (en una rama de ticket, nombrando los archivos exactos que cambió), `git_push` (que rechaza la rama base salvo que apruebes ese acto concreto) y `open_pull_request`. Consulta [Publica desde el editor](/blog/ship-from-the-editor-commit-branch-pull-request) para ver cómo se resolvió la cuestión de gobernanza.

---

**Lecturas relacionadas:** [VS Code como centro de mando de tu fuerza de trabajo agéntica](/blog/vs-code-command-center-for-your-agentic-workforce) · [Leer, Demostrar, Crear: el bucle interno](/blog/read-prove-build-the-inner-loop) · [Puntos de aprobación y supervisión humana](/blog/approval-gates-and-human-oversight)

Instala la [extensión de BuilderForce para VS Code](https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai), pide un cambio a un agente y mira cómo aparece el recuento.
