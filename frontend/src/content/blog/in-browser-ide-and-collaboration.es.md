Configurar un entorno de desarrollo es una de esas tareas que lleva entre 20 minutos y varios días y que enseña muy poco. Clonar el repositorio, instalar la versión correcta de Node, configurar las variables de entorno, pelearse con las dependencias nativas y descubrir que el README lleva tres años desactualizado.

El IDE en el navegador de Builderforce elimina todo eso. Abre un navegador, abre un proyecto y ya estás trabajando en un entorno de desarrollo real —con sistema de archivos, gestor de paquetes, servidor de desarrollo, terminal y un compañero de programación con IA— sin instalar nada.

![Maqueta de un IDE de tres paneles en el navegador con un explorador de archivos, el editor de código Monaco y un panel derecho que alterna entre Vista previa, Terminal y Chat de IA](/blog/in-browser-ide.svg)

---

## Cómo funciona: BuilderForce WebContainers

El IDE funciona sobre **BuilderForce WebContainers**, nuestro propio runtime de desarrollo en el navegador, de código abierto con licencia MIT ([código en GitHub](https://github.com/SeanHogg/builderforce-webcontainers) · [qué es](/open-source/builderforce-webcontainers)). Aporta al IDE:

- **Un servidor de desarrollo en la pestaña.** Cada archivo se compila al pedirse con esbuild-wasm y se sirve como módulo ES nativo, como hace el servidor de desarrollo de Vite, así que el arranque es inmediato y una edición recompila un solo archivo. Los proyectos Vite (React, Vue, Svelte), Create React App y los sitios estáticos tienen vista previa.
- **Paquetes sin esperas.** Las importaciones se resuelven en esm.sh, fijadas a las versiones de tu `package.json` y sin duplicados, así que la vista previa nunca espera a una instalación.
- **Node cuando lo necesitas.** El terminal ejecuta programas Node, `npm install` desde el registro real de npm y una shell interactiva, con un Web Worker por proceso, de modo que un bucle ocupado nunca congela el editor. Un servidor que escucha en un puerto se previsualiza como cualquier otra página.
- **Comprobar y publicar en el navegador.** La comprobación de tipos y el build de producción se ejecutan sobre los propios archivos, sin instalación y sin servidor.
- **Aislado de tu cuenta.** Las vistas previas y los procesos se sirven desde `preview.builderforce.ai`, un origen separado, así que el código que ejecutas tú o un agente nunca comparte tu sesión de Builderforce.
- **Sin configuración especial del navegador.** Necesita un contexto seguro y un service worker. Ninguna cabecera de aislamiento entre orígenes, así que los embeds y los scripts de terceros siguen funcionando.

Lo que no hace, dicho claramente: los complementos nativos y los scripts de instalación de paquetes no pueden ejecutarse en un navegador, y los servidores de desarrollo de Next.js, Nuxt, SvelteKit, Remix y Astro necesitan binarios nativos. El runtime reconoce esos proyectos y te explica por qué, en lugar de mostrar una vista previa rota. Los WebSockets y las respuestas en streaming desde un servidor en el navegador aún no están soportados.

No es una simulación ni una VM remota. El código se ejecuta en tu navegador. El servidor de desarrollo se ejecuta en tu navegador. Tus archivos se guardan en Builderforce, así que un proyecto se abre donde lo dejaste.

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

Explora, crea, renombra y elimina archivos. El árbol de archivos refleja en vivo el sistema de archivos del runtime: los cambios que haces en el editor aparecen al instante, y los que hacen los agentes (a través de BuilderForce Agents) aparecen a medida que se escriben.

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
| **Vista previa** | Iframe en vivo servido por el servidor de desarrollo del navegador; cada vista previa abierta se recarga cuando cambia un archivo |
| **Terminal** | Una shell `jsh` en el runtime: `npm`, `npx`, `node`, pipes y los comandos de archivos habituales |
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

No hay un «propietario»: todos los colaboradores tienen el mismo acceso al sistema de archivos, al terminal y al editor. Los archivos del proyecto son los mismos para todos los participantes.

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
2. Elige una plantilla (Web: Vite + React; Web + Móvil: una sola base de código React Native for Web sobre Vite)
3. Abre el proyecto en el IDE: el runtime arranca en la pestaña y se inicia el servidor de desarrollo
4. El panel de vista previa muestra tu aplicación en ejecución

La vista previa no necesita paso de instalación: los paquetes se cargan desde esm.sh en las versiones que pide tu `package.json`. Ejecuta `npm install` en el terminal cuando un programa Node necesite un `node_modules` real. Los archivos se guardan en R2, así que las siguientes aperturas restauran el proyecto exactamente donde lo dejaste.

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
- Lee [BuilderForce WebContainers es código abierto](/blog/builderforce-webcontainers-open-source) para ver lo que el runtime que hay bajo el IDE puede hacer por sí solo
- Invita a un compañero a colaborar: comparte la URL de la sesión desde la cabecera del IDE
- Lee [BuilderForce Agents e integración de agentes](/blog/agents-and-agent-integration) para entender cómo BuilderForce Agents amplía lo que construyes en el IDE
- Explora [Entrenamiento con WebGPU y LoRA](/blog/webgpu-lora-explained) si quieres ajustar modelos a tu código base directamente en el navegador
