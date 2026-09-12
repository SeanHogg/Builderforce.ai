Un tablero Kanban te dice *qué* está pasando. Una conversación cara a cara te dice *por qué*, y rápido. Builderforce.ai reúne ahora ambas cosas en un solo lugar: reuniones de vídeo y audio en directo que se sitúan directamente sobre el tablero en el que ya trabaja tu equipo, personas y agentes.

> Builderforce.ai ofrece videorreuniones en directo mediante WebRTC en malla directamente sobre el tablero de tu proyecto: cámaras en las reuniones diarias y retrospectivas, llamadas improvisadas y directas, un calendario de equipo reservable con disponibilidad por usuario y sincronización con los calendarios de Google/Microsoft. Puedes unirte desde la web o dentro de VS Code, y los medios fluyen de igual a igual, nunca a través del servidor.

![Tres pares conectados en una malla WebRTC intercambian audio y vídeo directamente; el servidor solo retransmite la señalización y STUN, así que los medios nunca pasan por él](/blog/meetings-webrtc-mesh.svg)

## Tipos de reunión de un vistazo

| Tipo | Cuándo usarlo | Quién puede iniciarla |
| --- | --- | --- |
| **Reunión diaria / Planificación / Retrospectiva** | Ceremonias recurrentes, con cámaras en la mesa redonda | El manager activa las cámaras; cualquier miembro se une |
| **Improvisada** | Una sincronización rápida y no planificada | Cualquiera |
| **Directa** | Una llamada uno a uno | Cualquiera |
| **Programada** | Reservada con antelación y reflejada en los calendarios como invitación | El organizador |

## Cámaras en la mesa redonda

Builderforce ya ejecuta ceremonias —reuniones diarias, planificación, retrospectivas— como una mesa redonda estructurada anclada al proyecto. Ahora esas ceremonias pueden activar **cámaras y micrófonos**. Un manager puede iniciar el vídeo para todo el equipo, o cualquiera puede pulsar «Unirse con cámara» para añadirse a una galería en directo sobre la reunión diaria. Como la reunión vive en la ceremonia, todos miran el mismo tablero mientras hablan.

También tienes llamadas sencillas: inicia una reunión **improvisada** para una sincronización rápida o una llamada **directa** con un compañero. Hay una superficie `/meetings` dedicada, con un modal de programación, inicio inmediato y una lista de reuniones en vivo y próximas.

## De igual a igual por diseño

En Builderforce, los medios se intercambian **de cliente a cliente mediante WebRTC en malla**. Las transmisiones de cámara y micrófono, las ofertas y respuestas SDP y los candidatos ICE fluyen directamente entre navegadores; el servidor solo retransmite la señalización y sirve STUN (y TURN si lo configuras). Tu vídeo nunca llega a nuestra infraestructura. La negociación está libre de colisiones, así que dos personas que se conectan en el mismo instante no chocan.

## Un calendario que sabe cuándo están libres todos

Las reuniones solo sirven si son a una hora a la que la gente puede asistir. Builderforce añade un **calendario de equipo compartido** tanto en Plantilla como en el Portafolio del proyecto:

- Una **vista mensual** y una **cuadrícula semanal reservable** en un solo componente.
- Superpone las reuniones de la app *y* los eventos de tus calendarios de Google/Microsoft conectados.
- Sombrea tus horas de **disponibilidad** declaradas para que las franjas libres salten a la vista.
- Haz clic en una franja libre para reservar, o en una reunión para unirte.

Configura una vez tus **ventanas de horario laboral semanal y tu zona horaria**, y el solucionador **«Buscar un hueco»** propone franjas en las que *todos* los invitados están libres: sin reuniones en conflicto y dentro de las ventanas laborales de cada persona, calculadas con la zona horaria correcta. Se acabó el ir y venir de correos para encontrar un hueco.

![Una cuadrícula semanal entre zonas horarias con las ventanas de horario laboral y los bloques ocupados de tres personas, en la que el solucionador resalta la única franja en la que todos están libres](/blog/meetings-find-a-time.svg)

## Trae tu propio calendario

Conecta **Google Calendar** o **Microsoft Graph** por usuario con un único flujo OAuth. Las reuniones programadas en Builderforce se reflejan como eventos de calendario reales con invitaciones a los correos de los asistentes, y tus próximos eventos externos aparecen directamente en `/meetings`. Un solo lugar para verlo todo, sin duplicar entradas.

## Únete desde cualquier sitio, incluido tu editor

Las invitaciones son enlaces profundos que requieren inicio de sesión (`/meetings?join=<id>`) y el acceso está **limitado por autorización**: solo pueden unirse el organizador, los asistentes de la lista, los managers o los miembros del proyecto de la reunión; el acceso entre tenants está bloqueado. Y no hace falta estar en un navegador. La extensión de VS Code añade un árbol de **Reuniones** en la barra lateral con las llamadas próximas y en curso:

- **Unirse en el navegador** abre la reunión web autenticada.
- **Unirse aquí** ejecuta la llamada WebRTC de forma nativa en un webview de VS Code, para que nunca tengas que salir del editor por una reunión diaria.

## La clave

Las reuniones diarias, la planificación y las retrospectivas son donde un equipo se alinea. Al ejecutarlas como vídeo en directo *sobre el propio tablero* —con un calendario que respeta la disponibilidad real de cada persona y un botón para unirse dentro de VS Code—, Builderforce elimina la distancia entre la «herramienta de reuniones» y «el trabajo». La conversación y los tickets de los que trata por fin están en el mismo lugar.

## Preguntas frecuentes

**¿Builderforce usa un servicio de vídeo de terceros?** No. El vídeo y el audio funcionan mediante WebRTC en malla directamente entre los participantes. El servidor solo retransmite la señalización y proporciona STUN (más TURN opcional); tus medios van de igual a igual.

**¿Cómo funciona «Buscar un hueco»?** Cada usuario declara sus ventanas de horario laboral semanal y una zona horaria. El solucionador de disponibilidad propone franjas en las que ningún invitado tiene una reunión en conflicto y la hora cae dentro de sus ventanas, con el cálculo correcto entre zonas horarias.

**¿Puedo sincronizar mi calendario actual?** Sí: conecta Google Calendar o Microsoft Graph por usuario. Tus eventos externos se superponen al calendario del equipo y las reuniones programadas se reflejan de vuelta como invitaciones.

**¿Quién puede unirse a una reunión desde un enlace de invitación?** Solo las personas autorizadas: el organizador, los asistentes de la lista, los managers o los miembros del proyecto de la reunión (en una reunión de proyecto) o del tenant (en una reunión de todo el tenant). El enlace exige iniciar sesión y las uniones entre tenants están bloqueadas.

**¿Puedo unirme a una reunión sin abrir un navegador?** Sí. El árbol de Reuniones de VS Code te permite unirte en el navegador o ejecutar la llamada de forma nativa en un webview de VS Code.
