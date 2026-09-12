Pídele a un agente que cambie cómo caducan las sesiones y observa lo que hace de verdad. Lista un directorio. Lee un archivo que resulta ser el equivocado. Busca `expiry`, obtiene cuarenta resultados, lee cuatro, vuelve a buscar `ttl` y da con lo que buscaba al sexto intento. Entonces —veinte turnos después, con la respuesta por fin en la mano— empieza con el cambio que le pediste.

Cada uno de esos callejones sin salida sigue en su contexto. El archivo equivocado está ahí entero. También la búsqueda de cuarenta resultados. Cuando el agente llega a la parte que requiere criterio, esa parte compite por espacio con un listado de directorio que leyó por error.

No es un problema de razonamiento. Es un problema de orden.

## Qué es un subagente

Un subagente es un segundo agente que hace la búsqueda **en su propio contexto** y devuelve una sola respuesta.

```bf-figure
{
  "kind": "flow",
  "title": "Una delegación, de principio a fin",
  "steps": [
    { "label": "Encargo", "note": "El padre escribe una instrucción completa: el hijo no ve nada de la conversación del padre, así que el encargo tiene que sostenerse por sí solo.", "hue": "idea" },
    { "label": "Búsqueda", "note": "El hijo lee, hace grep y razona sobre su propia transcripción, con un presupuesto pequeño y estricto. Sus callejones sin salida son suyos.", "hue": "make" },
    { "label": "Respuesta", "note": "Vuelve un solo párrafo: rutas exactas, nombres exactos y un 'no encontrado' explícito cuando ese es el resultado honesto.", "hue": "prove" }
  ],
  "caption": "El padre paga un párrafo en lugar de veinte turnos. En qué se gastaron esos turnos nunca llega a entrar en su contexto."
}
```

El aislamiento es justo la clave. Un hijo que compartiera la conversación del padre sería solo una forma más cara de dar otro turno.

```bf-figure
{
  "kind": "compare",
  "title": "La misma tarea, con veinte turnos de diferencia",
  "columns": [
    { "title": "Buscar sobre la marcha", "hue": "muted", "items": ["Listar el directorio", "Leer el archivo equivocado, entero", "Buscar: cuarenta resultados", "Leer cuatro de ellos", "Volver a buscar", "Encontrarlo al sexto intento", "Empezar a pensar, con todo eso todavía en la ventana"] },
    { "title": "Delegar la búsqueda", "hue": "make", "items": ["Preguntar: ¿dónde está la caducidad de las sesiones?", "Leer un párrafo", "Empezar a pensar"] }
  ],
  "caption": "El mismo trabajo hecho. La diferencia es qué agente carga con él después."
}
```

## Solo lectura por defecto, y escritura cuando tú lo dices

Una delegación es de solo lectura por defecto, porque una delegación sin especificar casi siempre es una investigación. El hijo puede leer, buscar y razonar, y un hijo de solo lectura no puede costarte nada más que tiempo.

Es un valor por defecto, no un techo. Un agente que ha encontrado los catorce archivos que necesitan el mismo cambio mecánico puede pedir un hijo que lo haga, y entonces cada escritura que intente ese hijo te pide permiso **a ti** primero, por su nombre, con el mismo aviso que usan las escrituras de tu propio agente. Auto cubre las escrituras de un subagente exactamente igual que las del padre. Un control de gobernanza que bloquea una herramienta la bloquea también para el hijo, y uno que exige aprobación la sigue exigiendo aunque Auto esté activado, porque una preferencia no puede anular una política compilada. Si lo rechazas, la negativa le llega al hijo como algo que sortear, no como un callejón sin salida.

Eso es lo que ha cambiado más recientemente. Hasta este lanzamiento, un subagente en tu editor solo podía leer: el aviso de aprobación lo lanza el chat al que pertenece la ejecución, y un agente anidado no tenía forma de llegar a él, así que lo honesto era ejecutar a los hijos en solo lectura y decirlo. Ahora el aviso es accesible desde dentro de una delegación, así que el hijo hace la pregunta en lugar de que se le niegue la oportunidad de hacerla.

Un hijo sigue sin poder crear otro hijo. No es un contador de profundidad que alguien tenga que acordarse de decrementar: la capacidad de delegar simplemente no está entre lo que recibe un hijo, así que no tiene nada con lo que hacer recursión.

```bf-figure
{
  "kind": "compare",
  "title": "Qué puede tocar una delegación",
  "columns": [
    { "title": "El hijo puede", "hue": "prove", "items": ["Leer y listar archivos", "Buscar en el árbol", "Recuperar la memoria del proyecto", "Buscar en la web", "Escribir, con tu aprobación, archivo por archivo", "Responder, una vez, en prosa"] },
    { "title": "El hijo no puede", "hue": "bad", "items": ["Escribir nada que no hayas aprobado", "Saltarse un control de gobernanza", "Pausar la ejecución para consultar a una persona", "Proponer una habilidad", "Crear otro subagente"] }
  ],
  "caption": "El actor responsable sigue siendo el padre. Conserva todas las decisiones y tú conservas todas las aprobaciones: simplemente deja de pagar por la búsqueda."
}
```

## Dónde encaja en el método

[Leer va antes que Demostrar, y Demostrar antes que Crear](/blog/read-prove-build-the-inner-loop), y Leer es la etapa que esto cambia.

Leer es el acto barato del método, hasta que la base de código es grande. Entonces deja de serlo: la ventana del agente se llena de lo que leyó por el camino hacia lo que necesitaba, y cuando llega a Crear está razonando entre los escombros de su propia búsqueda. Los equipos lo perciben como un agente que era agudo en un repositorio pequeño y vago en uno real. No es menos capaz ahí. Está más lleno.

Delegar hace que Leer vuelva a costar lo que vale. La búsqueda ocurre en un lugar que el padre no tiene que cargar, y el padre llega a Demostrar con espacio para pensar, que es la única etapa en la que pensar fue siempre lo importante.

## Qué puedes hacer hoy

- **Pídele a un agente que encuentre algo sin gastar su contexto en encontrarlo.** "¿Dónde está el middleware de autenticación?", "¿se usa este patrón en algún otro sitio?", "¿qué exporta realmente este archivo de seiscientas líneas?": un encargo, un párrafo.
- **Tenlo allí donde se ejecute el agente.** El editor, una ejecución en la nube, un contenedor de larga duración y un job de GitHub Actions delegan de la misma manera —la misma herramienta, el mismo encargo, el mismo presupuesto—, así que un hábito aprendido en uno sirve en todos los demás. Las dos superficies de larga duración son donde más rinde: tienen la shell y el checkout, que es justo donde más cuesta cargar con una búsqueda en línea.
- **Envía una edición mecánica, no solo una pregunta.** "Renombra este símbolo en todos los sitios donde aparezca" ahora es una delegación, no un informe sobre el que luego tienes que actuar tú. Apruebas cada archivo a medida que ocurre.
- **Mira lo que costó.** Cada delegación aparece en la línea de tiempo de la ejecución con su etiqueta, sus turnos y si se quedó sin ellos: un hijo al que se le cortó lo dice, en lugar de hacer pasar su última palabra por una conclusión.
