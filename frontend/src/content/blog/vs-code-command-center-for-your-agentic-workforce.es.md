Los desarrolladores viven en su editor. Por eso, en lugar de pedirte que lo abandones, Builderforce.ai lleva la plataforma entera *dentro* de VS Code. La extensión ya no es solo un panel de chat: es un **centro de mando** para dirigir una fuerza de trabajo mixta de personas y agentes de IA, con colaboración, reuniones, estado en vivo y entrenamiento de modelos, todo en la barra lateral.

> La extensión de BuilderForce para VS Code ejecuta toda la plataforma en tu editor: chat de equipo multiparte, estado de sesiones en vivo, videorreuniones nativas, una consola de entrenamiento de Evermind, árboles de proyectos y tareas, y aprobaciones con intervención humana. Así diriges toda una fuerza de trabajo agéntica sin salir de VS Code.

![La barra lateral de BuilderForce en VS Code con sus superficies —chat de equipo en Sesiones, Proyecto y tareas con estado en vivo, Reuniones, Evermind, aprobaciones en la Bandeja de entrada y Análisis— junto a un panel del editor que enumera las garantías de gobernanza](/blog/vscode-command-center.svg)

Esto es lo que te ofrece cada superficie de la barra lateral.

| Superficie de la barra lateral | Qué hace |
| --- | --- |
| **Sesiones** | Chat de equipo multiparte: personas + `@agents`, mensajes dirigidos, avatares |
| **Proyecto y tareas** | Tu tablero y el trabajo asignado, con un indicador de estado en vivo en cada fila |
| **Reuniones** | Llamadas próximas y en curso: únete en el navegador o de forma nativa en un webview |
| **Evermind** | Inspecciona y entrena el modelo autoactualizable de tu proyecto |
| **Bandeja de entrada** | Aprobaciones y decisiones con intervención humana |
| **Análisis y Diagnósticos** | La foto operativa y análisis con un solo clic |

## Ve de un vistazo qué te necesita

Cuando ejecutas varios agentes a la vez, la pregunta más difícil es «¿cuál me necesita ahora mismo?». Una única señal del servidor la responde en todas las superficies. En VS Code, los árboles **Sesiones** y **Proyecto y tareas** superponen un icono de estado en vivo en cada fila:

- **En ejecución**: un indicador giratorio azul; el agente está trabajando activamente (y sigue haciéndolo aunque cambies de chat).
- **Necesita tu respuesta**: un marcador ámbar con un `❓`; la ejecución se detuvo en una pregunta y te está esperando.
- **Hecho**: una marca de verificación verde.

![Tres filas de estado en vivo —un indicador giratorio azul para «en ejecución», un signo de interrogación ámbar para «necesita tu respuesta» y una marca verde para «hecho»—: la única señal que acompaña a una sesión en todas las superficies](/blog/vscode-live-status.svg)

El estado acompaña a la sesión allí donde se muestre, así que gestionar varias ejecuciones simultáneas se entiende al instante.

## Chat de equipo multiparte en la barra lateral

El panel Sesiones es un auténtico chat de equipo, no una caja de prompts para uno solo. Los hilos se comparten en todo el proyecto, puedes invitar a personas y agentes de IA a una sala y diriges cada mensaje a un participante concreto: habla con un compañero o `@mention` a un agente para que responda y actúe sobre el tablero dentro de tus permisos. Los participantes aparecen como avatares de colores directamente en el árbol, así ves quién está en cada sala.

## Únete a reuniones de forma nativa

Un árbol de **Reuniones** muestra tus llamadas próximas y en curso. **Unirse en el navegador** abre la reunión web autenticada; **Unirse aquí** ejecuta la videollamada WebRTC en malla *de forma nativa en un webview de VS Code*. Las reuniones diarias, la planificación y las retrospectivas suceden sin que tengas que salir de tu código.

## Inspecciona y entrena Evermind

Cada proyecto tiene su propio **Evermind**: un modelo autoactualizable que aprende del trabajo de tu equipo. Ahora es una vista de primera clase en la barra lateral. Abre la consola de Evermind para ver lo que ha aprendido (versión, recuentos de aprendidos y en cola, hora del último aprendizaje), orientar su entrenamiento (partir de un modelo publicado, conectar o congelar el aprendizaje, elegir un modelo maestro), **enseñarle a partir de una transcripción** pegando un ejemplo y vaciar la cola de aprendizaje cuando quieras. Los managers tienen los controles; todos pueden inspeccionar. La misma consola se muestra en la web: un componente, dos anfitriones.

## Los árboles que mueven el trabajo

La extensión incluye también el resto de la plataforma:

- **Proyecto y tareas**: tu tablero y el trabajo asignado, con el mismo indicador de estado en vivo.
- **Bandeja de entrada**: aprobaciones y elementos que requieren una decisión.
- **Análisis** y **Diagnósticos**: la foto operativa y los análisis.
- **Ejecutar y revisar**: envía tareas a los agentes, revisa y valida su resultado y aprueba acciones con intervención humana allí donde programas.

## Gobernado, y tuyo

Las rutas de ejecución compatibles en VS Code usan las aprobaciones configuradas en la plataforma y los registros de ejecución disponibles. La disponibilidad de modelos y la facturación dependen del catálogo actual, las credenciales, el plan y el entorno de ejecución; la paridad entre la web y la extensión está documentada por capacidad.

## Por qué importa

El cambio de contexto es el impuesto que se paga por gestionar agentes. Cada vez que sales del editor para revisar una ejecución, responder una pregunta, unirte a una reunión diaria o ajustar un modelo, pierdes el hilo. El centro de mando de VS Code elimina ese impuesto: toda la fuerza de trabajo —sus chats, sus reuniones, su estado y su modelo de aprendizaje— queda a un panel de distancia de tu código.

## Preguntas frecuentes

**¿Puedo saber qué agente me necesita sin abrir cada uno?** Sí. Los árboles Sesiones y Proyecto y tareas superponen un estado en vivo en cada fila —indicador giratorio azul para «en ejecución», `❓` ámbar para «esperando tu respuesta», marca verde para «hecho»— a partir de una única señal del servidor.

**¿El chat de VS Code es solo entre un modelo y yo?** No. Es multiparte: los hilos se comparten en todo el proyecto, puedes invitar a personas y agentes, y diriges los mensajes a participantes concretos, incluidas menciones `@agent` que hacen que un agente responda y actúe dentro de tus permisos.

**¿Puedo unirme a videorreuniones dentro de VS Code?** Sí. El árbol de Reuniones te permite unirte en el navegador o ejecutar la llamada WebRTC de forma nativa en un webview de VS Code.

**¿Puedo entrenar el modelo de mi proyecto desde el editor?** Sí. La vista de Evermind en la barra lateral permite a los managers inspeccionar lo que ha aprendido el modelo, orientar el entrenamiento, enseñarle a partir de una transcripción pegada y vaciar la cola de aprendizaje: es la misma consola que aparece en la web.

**¿Las acciones de los agentes en VS Code se saltan la gobernanza?** Las rutas de ejecución compatibles aplican la política de plataforma que tengan configurada. Comprueba la matriz de capacidades para la acción que quieras ejecutar, porque la cobertura entre la web y la extensión no es universal.
