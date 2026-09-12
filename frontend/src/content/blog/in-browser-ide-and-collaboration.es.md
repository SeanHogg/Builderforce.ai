Configurar un entorno de desarrollo es una de esas tareas que lleva entre 20 minutos y varios días y que enseña muy poco. Clonar el repositorio, instalar la versión correcta de Node, configurar las variables de entorno, pelearse con las dependencias nativas y descubrir que el README lleva tres años desactualizado.

El IDE en el navegador de Builderforce elimina todo eso. Abre un navegador, abre un proyecto y ya tienes en marcha un entorno real de Node.js —con sistema de archivos, gestor de paquetes, servidor de desarrollo, terminal y un compañero de programación con IA— sin instalar nada.

![Maqueta de un IDE de tres paneles en el navegador con un explorador de archivos, el editor de código Monaco y un panel derecho que alterna entre Vista previa, Terminal y Chat de IA](/blog/in-browser-ide.svg)

---

## Cómo funciona: WebContainers

El IDE funciona con **WebContainers**, un runtime de Node.js basado en WebAssembly que se ejecuta íntegramente dentro de la pestaña del navegador. WebContainers ofrece:

- Un sistema de archivos real compatible con POSIX (en memoria, con persistencia en R2)
- Un runtime completo de Node.js con soporte para módulos nativos
- La posibilidad de ejecutar `npm install`, `npm run dev` y `npm test` exactamente igual que en local
- Una capa de red localhost accesible desde el navegador: el puerto 3000 de tu servidor de desarrollo se abre directamente en el panel de vista previa

No es una simulación ni una VM remota. El código se ejecuta en tu navegador. El servidor de desarrollo se ejecuta en tu navegador. La ejecución en sí no depende de ningún cómputo del lado del servidor.

---

## Abrir el IDE

Ve a [/ide](/ide) y selecciona un proyecto, o abre el IDE directamente desde la página de detalle de un proyecto.

El IDE tiene una distribución en tres paneles:

```
┌─────────────┬──────────────────────────────┬──────────────┐
│ File        │                              │              │
│ Explorer    │  Code Editor (Monaco)        │  Preview /   │
│             │                              │  Terminal /  │
│  src/       │  // Your code here           │  AI Chat     │
│  ├ app/     │                              │              │
│  ├ api/     │                              │              │
│  └ tests/   │                              │              │
└─────────────┴──────────────────────────────┴──────────────┘
```

### Panel izquierdo: explorador de archivos

Explora, crea, renombra y elimina archivos. El árbol de archivos refleja en vivo el sistema de archivos de WebContainers: los cambios que haces en el editor aparecen al instante, y los que hacen los agentes (a través de BuilderForce Agents) aparecen a medida que se escriben.

### Panel central: editor Monaco

El editor Monaco completo, el mismo motor que impulsa VS Code. Incluye:

- Resaltado de sintaxis para todos los lenguajes principales
- Servidor de lenguaje de TypeScript (comprobación de tipos, autocompletado, ir a la definición)
- Marcadores de errores y advertencias en línea
- Pestañas para varios archivos con indicadores de cambios sin guardar
- Buscar y reemplazar en todo el proyecto

### Panel derecho: según el contexto

El panel derecho alterna entre tres vistas mediante el selector de la parte superior:

| Vista | Contenido |
|---|---|
| **Vista previa** | Iframe en vivo conectado al localhost del WebContainer; se actualiza automáticamente cuando tu servidor de desarrollo hace hot reload |
| **Terminal** | Terminal completo conectado a la shell del WebContainer: ejecuta cualquier comando |
| **Chat de IA** | El compañero de programación con IA (ver más abajo) |

---

## El compañero de programación con IA

El panel de Chat de IA es una interfaz conversacional que conoce a fondo el contexto de tu proyecto actual:

- **Archivos abiertos**: la IA sabe lo que estás mirando
- **Árbol de archivos**: entiende la estructura del proyecto
- **Salida del terminal**: puede ver los errores de tu servidor de desarrollo o de tu ejecutor de pruebas
- **Historial de git**: tiene acceso a los commits recientes

Pregúntale cualquier cosa en el contexto de tu trabajo:

> «Este componente se vuelve a renderizar demasiado. ¿Puedes averiguar por qué y sugerir una solución?»

> «Escribe un test para la utilidad `parseDate` que cubra los casos límite.»

> «La API devuelve un 500. El error está arriba, en el terminal: ¿qué está fallando?»

La IA puede editar tus archivos directamente (con tu aprobación), ejecutar comandos en el terminal y explicarte lo que hace sobre la marcha.

---

## Colaboración en tiempo real

Invita a un compañero a tu sesión del IDE y ambos trabajarán en el mismo entorno al mismo tiempo.

La colaboración funciona con **Yjs** —una biblioteca de sincronización en tiempo real basada en CRDT— sobre un relay WebSocket de Durable Objects de Builderforce:

- **Presencia de cursores**: ves dónde está el cursor de cada colaborador
- **Ediciones en vivo**: los cambios aparecen en tiempo real y sin conflictos
- **Chat**: un canal de chat lateral dentro de la sesión del IDE
- **Terminal compartido**: los comandos que ejecuta un usuario son visibles para todos

No hay un «propietario»: todos los colaboradores tienen el mismo acceso al sistema de archivos, al terminal y al editor. El estado subyacente del WebContainer es coherente para todos los participantes.

Las sesiones de colaboración pueden incluir tanto personas como agentes. Si un agente de BuilderForce Agents está trabajando en el mismo proyecto, sus ediciones llegan como cambios en vivo al editor: ves al agente escribir código en la misma ventana en la que lo estás revisando.

---

## Conexión con BuilderForce Agents

El IDE y BuilderForce Agents son dos formas de interactuar con el mismo proyecto. El IDE es la interfaz nativa del navegador; BuilderForce Agents es el runtime agéntico autoalojado. Ambos comparten:

- **El mismo sistema de archivos**: BuilderForce Agents sincroniza su espacio de trabajo con Builderforce y el IDE lee de ese estado sincronizado
- **El mismo tablero de tareas**: las tareas que creas en el panel de tareas del IDE son las mismas que ejecuta BuilderForce Agents
- **El mismo historial de chat**: los mensajes que envías en el chat del IDE se retransmiten a la sesión activa de BuilderForce Agents, y sus respuestas aparecen en el chat del IDE en tiempo real

Esto significa que el IDE no es solo un editor de código: es una **ventana al trabajo del agente**. Mientras BuilderForce Agents ejecuta un flujo de trabajo en tu servidor, puedes ver cómo cambian los archivos en el IDE, seguir el razonamiento del agente en el panel de chat e intervenir si algo no pinta bien, todo sin salir del navegador.

---

## Configurar un proyecto desde el IDE

Para empezar un proyecto nuevo desde cero:

1. Crea un proyecto en [/projects](/projects) → **Nuevo proyecto**
2. Elige una plantilla (Next.js, Vite + React, Node + Express o en blanco)
3. Abre el proyecto en el IDE: WebContainers se inicializa, se instalan las dependencias y arranca el servidor de desarrollo
4. El panel de vista previa muestra tu aplicación en ejecución

Las plantillas ejecutan `npm install` automáticamente la primera vez que se inicializa el contenedor. En las siguientes aperturas se restaura desde R2 el último estado del sistema de archivos, así que tu sesión continúa exactamente donde la dejaste.

---

## Integración con el control de código fuente

El IDE incluye soporte de git integrado para los proyectos que tienen configurada una integración de control de código fuente:

- **Barra de estado**: muestra la rama actual y los cambios sin confirmar
- **Panel de commits**: prepara, confirma y haz push sin salir del IDE
- **Creación de PR**: abre un pull request directamente desde el IDE cuando tu trabajo esté listo
- **Cambio de rama**: cambia de rama, crea ramas de funcionalidad y fusiona

Los cambios confirmados en el IDE activan la sincronización de directorios de BuilderForce Agents: el espacio de trabajo local del agentHost se actualiza para coincidir con ellos, lo que mantiene sincronizados el IDE y el estado del agente local.

---

## Cuándo usar el IDE y cuándo BuilderForce Agents

| Usa el IDE para | Usa BuilderForce Agents para |
|---|---|
| Explorar y editar archivos directamente | Ejecutar flujos de trabajo autónomos largos |
| Programar en pareja con la IA sobre un problema concreto | Ejecutar tareas por lotes en todo un proyecto |
| Revisar y aprobar los diffs generados por agentes | Procesar las tareas despachadas desde el portal |
| Colaborar en tiempo real con tus compañeros | Trabajar de forma desatendida durante la noche |
| Ejecutar comandos rápidos en el terminal | Mantener servicios persistentes en segundo plano |

Ambos están pensados para usarse juntos: empieza una funcionalidad en el IDE con ayuda de la IA, pasa la implementación a un flujo de trabajo de BuilderForce Agents y revisa los resultados en el IDE cuando el agente termine.

---

## Buenas prácticas

**Mantén abierto el panel de vista previa mientras trabajas en el frontend.** La respuesta instantánea de la vista previa con hot reload es una de las mayores mejoras de flujo de trabajo del IDE en el navegador: no la sacrifiques por quedarte solo con el terminal.

**Usa el terminal para comandos puntuales y el agente para las tareas repetitivas.** Si estás ejecutando `npm test` más de tres veces para depurar el mismo problema, describe el fallo en el chat de IA y deja que se encargue del ciclo de iteración.

**Haz commits frecuentes en el IDE.** Los commits pequeños y frecuentes te dan a ti y a BuilderForce Agents un historial limpio sobre el que razonar. Los cambios grandes sin confirmar confunden a los agentes que leen el historial de git para obtener contexto.

**Asigna el proyecto del IDE a una instancia de BuilderForce Agents.** El IDE es más potente cuando tiene un agentHost conectado: el chat de IA del panel derecho puede despachar trabajo al runtime completo del agente, no solo al modelo del navegador.

---

## Próximos pasos

- Abre un proyecto en el [IDE](/ide) y explora la distribución en tres paneles
- Invita a un compañero a colaborar: comparte la URL de la sesión desde la cabecera del IDE
- Lee [BuilderForce Agents e integración de agentes](/blog/agents-and-agent-integration) para entender cómo BuilderForce Agents amplía lo que construyes en el IDE
- Explora [Entrenamiento con WebGPU y LoRA](/blog/webgpu-lora-explained) si quieres ajustar modelos a tu código base directamente en el navegador
