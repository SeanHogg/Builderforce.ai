La mayoría de las herramientas de programación con IA te esperan. Abres el editor, escribes un prompt, lees la sugerencia, la aceptas y repites. El agente es rápido, pero *tú* eres el bucle: cada paso espera a que una persona lo empuje.

Builderforce.ai lo invierte. **Asigna un agente de IA a un carril de Kanban y el tablero empieza a conducirse solo.** Los tickets se despachan automáticamente al agente asignado, el tablero avanza de carril en carril a medida que termina el trabajo, y la ejecución se detiene solo en las puertas de aprobación que decidas conservar. Gestionas *resultados* en un tablero en lugar de hacer de niñera de *prompts* en una ventana de chat.

> La Ejecución Autónoma de Carriles te permite asignar cualquier agente —en la nube o local— a un carril de Kanban. Los tickets se despachan automáticamente y el tablero avanza por sí solo a medida que los agentes terminan, deteniéndose solo en las puertas de aprobación que elijas.

![Ejecución autónoma de carriles: un ticket fluye por los carriles Backlog, Build, Review y Done, cada uno atendido por un agente asignado, con una puerta de aprobación que suspende la ejecución antes de la fusión en Done](/blog/autonomous-swimlanes.svg)

## Cómo funciona

Un carril en el tablero de tareas de Builderforce.ai es una columna de estado: `Backlog`, `In Progress`, `In Review`, `Done` o cualquier etapa de flujo de trabajo personalizada que definas. Normalmente una persona arrastra un ticket de un carril al siguiente. Con la ejecución autónoma, asocias un agente y un modelo a un carril, y ese carril se convierte en un **trabajador**:

1. **Un ticket llega al carril.** Puede llegar porque lo creaste ahí, porque un carril anterior terminó su trabajo o porque un flujo de trabajo lo enrutó.
2. **El agente del carril lo recoge.** La referencia del agente configurado y el modelo fijado viajan con el despacho: sin recurrir a un modelo por defecto débil.
3. **El agente hace el trabajo.** Clona el repositorio vinculado a través de un proxy git seguro en el servidor, hace el cambio, ejecuta la compilación y abre una pull request, sin interfaz y sin navegador abierto.
4. **El tablero avanza.** Cuando el agente termina, el ticket pasa automáticamente al siguiente carril. Si ese carril también tiene un agente, el relevo continúa.
5. **Se detiene en tus puertas.** Cualquier transición de carril puede exigir la aprobación de una persona. La ejecución se suspende, recibes una notificación por Slack o correo, y no ocurre nada de alto impacto hasta que apruebes.

El resultado es una cadena de entrega que puedes *observar* en lugar de *operar*. Un ticket puede fluir `Backlog → Build → Review → Done` con dos agentes especialistas distintos encargándose de Build y Review, y una única aprobación humana antes de la fusión.

## Agentes en la nube y agentes locales, en el mismo tablero

Los carriles autónomos funcionan con ambos tipos de agente de Builderforce.ai:

- **Los agentes en la nube** se ejecutan íntegramente en la nube: un entorno de ejecución duradero que sobrevive a los reinicios y avanza un paso cada vez, de modo que los trabajos largos no mueren al chocar con el muro del tiempo de espera de una petición.
- **Los agentes locales (On-Premise)** se ejecutan en tu propia máquina (uno o varios por host), manteniendo tu código y tus credenciales dentro de tu red.

Puedes combinarlos. Un agente en la nube puede clasificar y redactar un cambio mientras un agente local ejecuta las partes que deben permanecer en tu hardware. Al tablero no le importa dónde vive el trabajador; solo le importa que el carril tenga uno.

## Por qué importa: resultados, no prompts

El paso de un trabajo *guiado por prompts* a uno *guiado por el tablero* es el objetivo central de una plantilla de agentes:

| Herramientas guiadas por prompts | Builderforce.ai guiado por el tablero |
|---|---|
| Tú inicias cada paso | Los carriles inician el trabajo automáticamente |
| Un agente, una sugerencia a la vez | Muchos agentes, cada uno dueño de un carril |
| El progreso vive en un registro de chat | El progreso vive en un tablero compartido |
| La gobernanza se añade después (o falta) | Las puertas de aprobación forman parte del modelo de carriles |
| El contexto se reinicia en cada sesión | La memoria persistente del proyecto sobrevive a los reinicios |

Quien gestiona y mira el tablero ve exactamente qué está haciendo cada agente, qué está bloqueado a la espera de una aprobación y qué se ha entregado, igual que haría con un equipo de personas. Por eso describimos Builderforce.ai como una **nube totalmente agéntica con una persona en el bucle**: los agentes hacen el trabajo, tú mantienes el control en las puertas.

## La gobernanza está integrada, no añadida

La autonomía sin control es un riesgo. Cada transición autónoma de carril está sujeta a la misma capa de gobernanza que envuelve el resto de la plataforma:

- **Las puertas de aprobación** suspenden la ejecución hasta que una persona aprueba o rechaza: por tipo de acción, techo de coste o número de archivos modificados.
- **Las reglas de aprobación automática** dejan pasar las acciones de bajo riesgo para que las personas solo vean lo que importa.
- **Un rastro de auditoría completo** registra cada despacho, llamada a herramienta, token y decisión.
- **La escalada** hace caducar las aprobaciones fuera de plazo y avisa a las personas adecuadas.

Tú decides cuánta cuerda recibe cada carril. Una transición `Backlog → Build` puede ejecutarse de forma totalmente autónoma, mientras que `Review → Merge` siempre espera a una persona.

## Primeros pasos

1. Abre un proyecto y cambia a la pestaña **Tareas**: tu tablero Kanban en vivo.
2. Configura un carril: elige el agente (en la nube o local) y fija un modelo.
3. Decide qué transiciones de carril requieren aprobación.
4. Suelta un ticket en el carril y mira cómo el tablero empieza a moverse.

Nunca sales del tablero, y si prefieres quedarte en tu editor, la extensión de VS Code de BuilderForce muestra el mismo tablero de forma nativa, de modo que puedes aprobar acciones y ver avanzar los carriles sin salir de VS Code.

La Ejecución Autónoma de Carriles es la diferencia entre una IA que *te ayuda a programar* y una plantilla de IA que *entrega el ticket*. Pon un carril a trabajar y gestiona el resultado.

[Empieza a construir gratis →](/register) · [Recorre la plataforma →](/product) · [Mira cómo nos comparamos →](/compare)
