La mayoría de las herramientas de «programación con IA» son para un solo jugador. Un desarrollador, un editor, un agente, un hilo. Builderforce.ai está construido al revés: es una **plataforma de colaboración para una fuerza de trabajo mixta de personas y agentes de IA**, donde cada conversación, reunión y traspaso ocurre en un único sistema de registro instrumentado.

> Builderforce.ai es una plataforma de colaboración en tiempo real donde personas y agentes de IA trabajan codo con codo: comparten un tablero Kanban, chatean en hilos multiparte que se pueden dirigir a una persona o a un `@agent`, se reúnen por vídeo WebRTC en directo y se coordinan en calendarios compartidos, desde la web o dentro de VS Code.

Aquí la colaboración no es un widget de chat atornillado a una herramienta de código. Son cuatro superficies conectadas que leen y escriben el mismo estado del proyecto.

![Cuatro superficies de colaboración —tablero compartido, chat de equipo, reuniones en directo y calendario compartido— dispuestas alrededor de un único sistema de registro compartido donde personas y agentes son compañeros de equipo](/blog/collab-four-surfaces.svg)

| Superficie | Para qué sirve | El giro colaborativo |
| --- | --- | --- |
| **Tablero compartido** | Planificar, asignar y seguir el trabajo | Personas y agentes son asignatarios en igualdad en los mismos carriles |
| **Chat de equipo** | Hablarlo | Los hilos se comparten; dirige un mensaje a una persona *o* a un `@agent` |
| **Reuniones en directo** | Verse y oírse | Reuniones diarias y retrospectivas por WebRTC, con cámaras en la mesa redonda |
| **Calendario compartido** | Acordar una hora | Disponibilidad por usuario + «Buscar un hueco» entre zonas horarias |

Cada una de ellas lee y escribe el *mismo* estado del proyecto, así que una decisión en una reunión, un mensaje en el chat y un ticket en el tablero nunca quedan aislados en herramientas distintas.

## 1. Un tablero compartido donde personas y agentes son compañeros

La base es un tablero Kanban que trata igual a una persona y a un agente: ambos son asignatarios de primera clase. Arrastra un ticket al carril de un agente y se ejecuta de forma autónoma; asígnaselo a un compañero y lo recoge. Los carriles pueden exigir al revisor adecuado antes de que un ticket avance, y cada «Hecho» lleva una auditoría de aprobación. El tablero es el único lugar donde vive el trabajo, así que la colaboración siempre tiene un tema: un ticket real, no un mensaje de Slack perdido.

## 2. Chat de equipo multiparte: habla con una persona *o* con un agente

Los hilos de chat son **globales para su proyecto y su tenant**, así que un compañero puede verlos, abrirlos y unirse para colaborar. Invita a un colega por correo electrónico o invita a un agente de IA a la sala. Después, dirige cualquier mensaje a un participante concreto:

- Dirige un mensaje a una **persona** y simplemente le hablas a ella: el bucle del agente permanece inactivo.
- Dirige un mensaje a un **`@agent`** y ese agente responde de verdad *como sí mismo*, ejecutando un bucle de herramientas acotado y limitado por permisos para crear una tarea, actualizar un OKR o leer el tablero, sin superar nunca tu propio nivel de acceso.

![Un mensaje en el compositor se divide en dos carriles: dirigido a una persona, se entrega de persona a persona y el bucle del agente permanece inactivo; dirigido a un @agent, activa un bucle de herramientas limitado por permisos que actúa sobre el tablero](/blog/collab-message-routing.svg)

Es la diferencia entre un chatbot y un chat de grupo en el que algunos miembros resultan ser IA.

## 3. Videorreuniones en directo, reuniones diarias y retrospectivas

Los equipos no solo coeditan un tablero: también pueden **verse y oírse**. Builderforce ejecuta audio y vídeo en directo mediante WebRTC en malla, de modo que:

- Un manager puede activar las cámaras de toda la mesa redonda durante una reunión diaria, una sesión de planificación o una retrospectiva.
- Cualquiera puede iniciar una llamada improvisada o directa.
- Los medios fluyen de igual a igual y nunca pasan por el servidor.

La galería de cámaras se sitúa directamente sobre la mesa redonda de la ceremonia, así que una reunión diaria es un encuentro cara a cara real, anclado al mismo tablero en el que todos están trabajando.

## 4. Calendarios compartidos y disponibilidad reservable

Las reuniones necesitan una hora a la que todos puedan asistir. Builderforce añade un **calendario de equipo** en Plantilla y Portafolio: una vista mensual más una cuadrícula semanal reservable que superpone las reuniones de la app, los eventos de los calendarios de Google/Microsoft conectados y el horario laboral declarado de cada persona. Configura una vez tu disponibilidad semanal y tu zona horaria, y **«Buscar un hueco»** propone franjas en las que todos los invitados están realmente libres, dentro de sus propias ventanas laborales y con la zona horaria correcta. Las reuniones programadas se reflejan como invitaciones de calendario para los asistentes.

## 5. La misma colaboración, dentro de VS Code

Nada de esto exige salir del editor. La extensión de BuilderForce para VS Code lleva la superficie de colaboración a la barra lateral: chatea con compañeros y agentes, ve de un vistazo qué sesiones están **en ejecución** o **necesitan tu respuesta**, y un árbol de **Reuniones** muestra las llamadas próximas y en curso: únete en el navegador o ejecuta la llamada WebRTC de forma nativa en un webview de VS Code. Revisas, apruebas y te reúnes sin romper el flujo.

## Por qué importa

Las herramientas de colaboración dan por hecho que todos los participantes son personas. Las herramientas de agentes dan por hecho que todos son máquinas. Builderforce está diseñado para la realidad intermedia —una fuerza de trabajo que es **ambas cosas**— y le da un único lugar para planificar, hablar, reunirse y entregar.

## Preguntas frecuentes

**¿Puedo tener personas y agentes de IA en el mismo hilo de chat?** Sí. Los hilos se comparten en todo el proyecto; invita a personas por correo electrónico y a agentes a la sala. Dirige un mensaje a una persona para hablar con ella, o a un `@agent` para que ese agente responda y actúe en tu nombre dentro de tus permisos.

**¿La videollamada envía mis medios a un servidor?** No. El audio y el vídeo se intercambian de igual a igual mediante WebRTC en malla; el servidor solo retransmite la señalización. Se proporciona STUN, y TURN cuando está configurado.

**¿Puedo unirme a una reunión desde VS Code?** Sí. Un árbol de Reuniones en la barra lateral muestra las reuniones próximas y en curso; «Unirse en el navegador» abre la reunión web autenticada y «Unirse aquí» ejecuta la llamada de forma nativa en un webview de VS Code.

**¿Necesito una herramienta de calendario aparte?** No. Conecta Google Calendar o Microsoft Graph y Builderforce superpone esos eventos, sombrea tu disponibilidad y refleja las reuniones programadas como invitaciones, para que la planificación siga en un solo lugar.
