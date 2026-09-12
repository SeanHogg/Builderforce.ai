En la mayoría de las herramientas de IA, "chat" significa una persona escribiéndole a un modelo. Cada mensaje ejecuta el modelo; no hay forma de traer a un compañero a la conversación y simplemente hablar con él, ni de pasarle la conversación a un agente especialista que luego *actúe*. Builderforce.ai ha rehecho el chat como **colaboración multiparte**: algunos participantes son personas y otros son agentes, y tú eliges para quién es cada mensaje.

> En Builderforce.ai, los hilos de chat de equipo se comparten en todo tu proyecto: invita a personas por correo electrónico e invita a agentes de IA a la conversación, y luego dirige cada mensaje a un participante concreto. Un mensaje a una persona simplemente habla con ella; una mención `@agent` hace que ese agente responda como sí mismo y ejecute un ciclo de herramientas acotado y limitado por permisos, sin superar nunca tu propio acceso.

![Un hilo de chat compartido con una barra de participantes que muestra al propietario, a un compañero invitado por correo electrónico y a un @agent; el mensaje al compañero lo responde una persona, mientras que el mensaje al agente lo responde el agente creando y vinculando tareas](/blog/chat-shared-thread.svg)

## Chatbot frente a chat de equipo multiparte

| | Chat de IA típico | Chat de equipo de Builderforce |
| --- | --- | --- |
| **Participantes** | Una persona, un modelo | Muchas personas **y** muchos agentes |
| **Qué ejecuta un mensaje** | Cada mensaje ejecuta el modelo | Diriges cada mensaje a una persona o a un `@agent` |
| **Hablar con un compañero** | No es posible | Dirígelo a una persona: el ciclo del agente sigue inactivo |
| **El agente actúa** | Solo responde con texto | Ejecuta un ciclo de herramientas acotado (tareas, OKR, tablero) como sí mismo |
| **Acceso** | N/A | El agente usa **tu** rol y tu token, nunca más |
| **Visibilidad del hilo** | Privado para ti | Compartido con el proyecto (o bloqueado de forma explícita) |

## Los hilos son compartidos, no silos privados

Un chat de Builderforce es **global para su proyecto y su tenant**. Un compañero puede verlo, abrirlo y unirse para colaborar: queda registrado automáticamente como miembro la primera vez que participa, así que la audiencia del hilo es real y está viva. También puedes **bloquear** un hilo para que solo accedan su propietario y los miembros invitados expresamente, cuando una conversación debe quedar en privado. Los propietarios conservan el control de administración (renombrar, archivar, invitar, quitar, bloquear); todos los demás colaboran.

## Invita a personas por correo electrónico, aunque todavía no estén en el equipo

Añade a un compañero a un hilo con su correo electrónico. Si ya está en tu equipo, recibe una notificación en la app (con un webhook de correo opcional) y el hilo aparece en su lista. Si **todavía no** es miembro, la invitación crea un registro pendiente para que, cuando se registre, se le añada automáticamente y se le incorpore al chat en su primer acceso: una sola incorporación fluida, sin pasos extra. Una campana de notificaciones global en la barra superior muestra las invitaciones a chats y las menciones, y enlaza directamente con el hilo.

## Dirige cada mensaje al participante adecuado

La idea clave: un mensaje tiene un **destinatario**. En el editor de mensajes eliges "Para: <nombre>" (o simplemente empiezas con `@name`), y Builderforce enruta el turno en consecuencia:

- **A una persona**: el mensaje es *para esa persona*. Se guarda y se entrega, pero **no** ejecuta el modelo. No se despierta ningún agente; son solo personas hablando.
- **A un `@agent`**: ese agente **responde como sí mismo**. Ejecuta en el servidor un ciclo de herramientas acotado sobre una lista de permitidos seleccionada y no destructiva (leer el tablero, crear una tarea de seguimiento, actualizar un OKR, leer especificaciones y conocimiento), con **tu** rol y tu token, así que un agente nunca puede hacer nada que tú no pudieras hacer. Su respuesta se publica atribuida al agente, con su propio nombre y avatar.

![El editor de mensajes envía cada mensaje por uno de dos carriles: a una persona, donde se entrega de persona a persona y el ciclo del agente sigue inactivo; o a un @agent, donde ejecuta un ciclo de herramientas limitado por permisos que crea tareas, actualiza OKR y lee el tablero](/blog/collab-message-routing.svg)

Así, un hilo puede contener una mezcla auténtica: le haces una pregunta a un compañero y luego mencionas con `@mention` a un agente para que cree las tareas que acaban de acordar.

## Regido por tus permisos, no por los del agente

Cada acción que realiza en el chat un agente invitado se ejecuta con los permisos del usuario que la desencadenó. En la lista de permitidos del chat no hay eliminaciones ni acceso al plano de control. El resultado es una colaboración en la que puedes confiar: un agente en la conversación es lo bastante potente para ser útil y lo bastante acotado para ser seguro.

## La misma experiencia en la web y en VS Code

El chat multiparte se comparte entre superficies. Brain en la web y el webview de VS Code usan el mismo enrutamiento por destinatario, la misma lista de participantes y los mismos avatares, y el árbol nativo de Sesiones muestra los participantes de cada hilo como discos de avatar de colores para que veas de un vistazo quién está en cada conversación. Invita a una persona desde la web, menciona con `@mention` a un agente desde VS Code: es una sola conversación.

## Por qué importa

El trabajo real es una conversación entre varias personas y, cada vez más, varios agentes. Tratar el chat como una persona frente a un modelo no puede representar eso. Al hacer que los hilos sean compartidos, que los participantes sean explícitos y que `@agent` sea un actor real sujeto a tus permisos, Builderforce convierte el chat en un lugar donde colabora toda una fuerza de trabajo, no en una simple caja de prompts.

## Preguntas frecuentes

**¿Puedo hablar con un compañero en el chat sin provocar una respuesta de la IA?** Sí. Dirige el mensaje a una persona (elígela como destinataria o empieza con `@name`) y se entregará como un mensaje de persona a persona: el ciclo del agente sigue inactivo.

**¿Qué puede hacer realmente un `@agent` cuando lo menciono?** Ejecuta un ciclo de herramientas acotado sobre una lista de permitidos segura, de lectura y escritura limitada (leer el tablero, crear tareas, actualizar OKR, leer especificaciones y conocimiento), usando tu rol y tu token. No puede eliminar nada ni llegar al plano de control, y nunca puede superar tus propios permisos.

**¿Puedo invitar a alguien que todavía no está en mi equipo?** Sí. Invitar a un correo nuevo crea una invitación pendiente; cuando esa persona se registra, se la añade al equipo y se la incorpora al chat automáticamente en su primer acceso.

**¿Un chat es privado para mí?** Por defecto, los hilos se comparten con tu proyecto para que tus compañeros puedan unirse. Puedes bloquear un hilo para que solo tengan acceso el propietario y los miembros invitados expresamente.

**¿Funciona en VS Code?** Sí. El webview de VS Code comparte el mismo enrutamiento por destinatario, el mismo modelo de participantes y los mismos avatares que Brain en la web: es una sola conversación entre superficies.
