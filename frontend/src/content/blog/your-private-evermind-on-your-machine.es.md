Cada asistente que usas está aprendiendo algo sobre ti. Qué proyectos te importan, cómo nombras las cosas, qué pasos de una tarea mensual haces siempre a mano. Y casi todos guardan ese conocimiento en el servidor de otro, en un modelo que nunca será tuyo y que te olvida en cuanto cambias de herramienta.

Esa es la carencia: **lo que tu IA aprende sobre tu trabajo no te pertenece.**

Synapse se creó para cerrarla. Es la aplicación de escritorio de Builderforce, y es donde vive tu propio Evermind: los hechos, demostraciones y habilidades que tus herramientas van captando se guardan y se entrenan en tu equipo, en un modelo `.evermind` que es tuyo. Hasta ahora todavía dependía de la nube para tres cosas: el modelo que te respondía, las herramientas a las que podía llegar y que estuvieras en tu mesa cuando un agente necesitaba un sí. Las tres se quedan ahora contigo.

```bf-figure
{
  "kind": "flow",
  "title": "Lo que ahora vive en tu equipo",
  "steps": [
    { "label": "Tu Evermind", "note": "Hechos, demostraciones y habilidades, entrenados en un modelo que es tuyo. Empieza desde uno de los modelos de tu espacio de trabajo.", "hue": "idea" },
    { "label": "Modelos locales", "note": "Instalados y dimensionados para tu memoria; el Brain puede responder con uno, y Claude Code también.", "hue": "make" },
    { "label": "Conectores", "note": "GitHub, Slack, Playwright, tus archivos: servidores MCP que usa el Brain, ejecutándose aquí.", "hue": "make" },
    { "label": "Aprobaciones desde cualquier lugar", "note": "Un paso de un agente que necesita un sí llega a tu teléfono a través de tu propia cuenta.", "hue": "run", "tag": "opcional" }
  ],
  "caption": "Nada de esta lista sale del equipo a menos que tú lo elijas, incluidas las aprobaciones desde el teléfono."
}
```

## Un modelo que cabe en el equipo que tienes

Elegir un modelo local es un pequeño examen de aritmética: número de parámetros, formatos de cuantización, cuánta memoria queda libre con el navegador y el editor abiertos. La mayoría adivina, descarga once gigabytes y descubre que no cabe.

Synapse hace las cuentas. Gestiona Ollama por ti y lee cuánta memoria tiene el equipo. Para cada modelo de su catálogo calcula qué cuantización deja sitio para todo lo demás —precisión completa donde cabe, ocho bits donde no, cuatro bits para los más grandes— y marca un modelo como la mejor opción general para este equipo. Instalar es un clic, con barra de progreso; quitarlo, otro.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Modelos locales",
  "ratio": 1.4,
  "regions": [
    { "label": "El Brain responde con", "note": "Builderforce por defecto, o cualquier modelo instalado", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "idea" },
    { "label": "Modelos para este equipo", "note": "Cada tamaño con la cuantización que cabe; uno marcado como Recomendado", "x": 4, "y": 24, "w": 92, "h": 44, "hue": "make" },
    { "label": "Úsalos desde otras herramientas", "note": "Formatos de OpenAI y Anthropic en un puerto local, con clave", "x": 4, "y": 72, "w": 92, "h": 22, "hue": "run" }
  ],
  "caption": "Si un modelo es demasiado grande para este equipo, lo dice antes de la descarga, no después."
}
```

A partir de ahí, los modelos son tuyos en todas partes. Activa **Úsalos desde otras herramientas** y Synapse los sirve en tu equipo en los dos formatos que hablan las herramientas de IA: el de OpenAI y el de Anthropic, que es el que usa Claude Code. Dos variables de entorno y Claude Code funciona con un modelo que nunca sale de la habitación. Solo entran los programas del propio equipo que tienen la clave, y las páginas web se rechazan directamente.

## Herramientas para el Brain, sin entregar las llaves

El Brain de Synapse ya usaba las herramientas de la plataforma: tickets, tableros, especificaciones. Ahora también usa **conectores**: servidores MCP que se ejecutan en tu equipo. Elige GitHub, Slack, Brave Search, Playwright, Context7 o una carpeta de archivos del catálogo e instálalo con un clic, o añade cualquier servidor MCP por su línea de comandos.

Los tokens van al almacén de credenciales de tu sistema, nunca a un archivo de configuración. Una herramienta que solo lee se ejecuta al momento; una que cambia algo —abrir una incidencia, publicar un mensaje, escribir un archivo— aparece en el chat con Aprobar y Rechazar, igual que las de la propia plataforma.

```bf-figure
{
  "kind": "compare",
  "title": "Dónde se ejecuta la herramienta",
  "columns": [
    { "title": "Un asistente alojado", "hue": "muted", "items": ["Tus tokens guardados en sus servidores", "Las herramientas solo llegan a lo que alcanza la nube", "Tus archivos locales quedan fuera de su alcance"] },
    { "title": "Conectores de Synapse", "hue": "make", "items": ["Tokens en el almacén de credenciales de tu sistema", "Los servidores se ejecutan en tu equipo, junto a tus archivos", "Todo lo que cambia algo pregunta primero"] }
  ],
  "caption": "Los mismos servidores MCP, en el lugar donde ya está tu trabajo."
}
```

## Di que sí desde el teléfono

Los agentes a los que enseñas una vez —grabas una tarea en cualquier aplicación de escritorio y dejas que Synapse la repita— se detienen en los pasos importantes y esperan tu aprobación. Eso antes significaba esperarte en la mesa. Activa **Aprobar pasos desde el teléfono** y la solicitud llega también a tu cuenta de Builderforce, donde la cola de aprobaciones la muestra en cualquier teléfono. Gana la primera respuesta, venga del lado que venga; al otro lado se le avisa.

Está construido para que no entre nada que no deba. Synapse nunca abre un puerto a internet: la solicitud sube a través de tu propia cuenta con la sesión iniciada, y Synapse consulta la respuesta. Solo tú puedes verla o responderla: ni un compañero, ni un responsable, ni una regla de aprobación automática, ni otra herramienta de IA. Y la descripción del paso sale de tu equipo solo mientras ese interruptor está activado.

## Un modelo desde el que empezar

Tu Evermind aprende de lo que viven tus herramientas, pero necesita un modelo en el que aprender, y casi nadie tiene un archivo `.evermind` a mano. Synapse ahora te ofrece uno: elige cualquier modelo de Evermind que ya tenga tu espacio de trabajo y pulsa **Usar como mi modelo**. Se descarga en tu equipo, con su tokenizador, y desde entonces aprende allí: el espacio de trabajo nunca ve lo que aprende a menos que lo publiques.

## Su lugar en el método

Builderforce lleva cada idea por un mismo arco —[Idea, Hacer, Operar, Medir](/blog/read-prove-build-the-inner-loop)— y cada acto dentro de él por el bucle de Leer, Probar, Construir.

Esta versión va de **Operar**. Operar es donde el trabajo sigue ocurriendo mientras no lo miras, y es donde una configuración privada solía romperse: el agente se paraba en su primera compuerta porque no estabas en tu mesa, el modelo detrás de la respuesta era de otro, y las herramientas que podía usar eran las que alcanzaba la nube. Las aprobaciones en el teléfono mantienen la ejecución en marcha. Los modelos locales y los conectores la hacen funcionar donde ya están tu trabajo y tus datos.

También alimenta la **Lectura** de la próxima vez. Lo que una ejecución enseña a tu Evermind se queda en un modelo que es tuyo, así que la próxima vez que tú o cualquiera de tus herramientas leáis tu trabajo, lo leeréis con todo lo que has hecho antes.

## Lo que puedes hacer hoy

- **Instalar un modelo local con un clic** que quepa en tu equipo, y dejar que el Brain responda con él.
- **Apuntar Claude Code a tu propio equipo** con las dos líneas que te muestra Synapse.
- **Dar al Brain GitHub, Slack o tus archivos** como herramientas, con cada cambio esperando tu Aprobar.
- **Aprobar el paso de un agente desde el teléfono** en lugar de volver a la mesa.
- **Empezar tu Evermind privado** a partir de un modelo que ya tiene tu espacio de trabajo.

[Descarga Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) para Windows, macOS o Linux.

---

**Lecturas relacionadas:** [Un cerebro privado en tu escritorio que pasa el trabajo a tus agentes](/blog/a-private-brain-on-your-desktop-that-hands-work-to-agents) · [Enséñalo una vez y lo repetirá](/blog/teach-it-once-and-it-does-it-again) · [Un índice local para todas las herramientas de IA de tu equipo](/blog/one-local-index-for-every-ai-tool)
