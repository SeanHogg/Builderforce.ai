Cada herramienta de IA que usas empieza la conversación desde cero.

Vuelves a explicar el proyecto. Repites la decisión que tomaste la semana pasada, la convención que acordaste, el motivo por el que descartaste la solución obvia. La herramienta responde bien, y lo olvida. Mañana lo vuelves a explicar: a otra herramienta, en otra ventana, con las mismas palabras.

Y cuando la respuesta es «esto hay que hacerlo», el chat deja de servir. El trabajo vive en otra parte: un tablero, un ticket, un agente que contrataste en otra pestaña.

Esa es la carencia: **aquello con lo que hablas no te conoce, y no puede pasar el trabajo a quienes podrían hacerlo.**

## Pregunta al cerebro que te conoce

Synapse ahora inicia sesión en Builderforce igual que la extensión de VS Code: apruebas un código en tu navegador y la clave queda en el almacén de credenciales de tu sistema. Con ella llegan los chats de tu espacio de trabajo: las mismas conversaciones que ves en la web y en tu editor.

```bf-figure
{
  "kind": "flow",
  "title": "De una pregunta a un trabajo hecho",
  "steps": [
    { "label": "Preguntar", "note": "Escribe al Brain desde Synapse, en cualquiera de los chats de tu espacio de trabajo.", "hue": "idea" },
    { "label": "Recordar", "note": "Antes de responder, tu Evermind privado recuerda lo que tus propias herramientas aprendieron sobre la pregunta, en tu equipo.", "hue": "make", "tag": "privado" },
    { "label": "Asignar", "note": "Si es trabajo, añade un agente al chat y dirígete a él con @.", "hue": "run" },
    { "label": "Hecho por el agente", "note": "El agente responde con sus propias herramientas, en tu nombre, y nunca más allá de lo que podrías hacer tú.", "hue": "run" }
  ],
  "caption": "El Brain responde lo que puede con lo que ya sabes; los agentes hacen lo que necesita herramientas."
}
```

La respuesta del Brain se apoya en tu propia memoria. Los datos que recordaron tus agentes de código, los procedimientos que enseñaste a Synapse, las convenciones en las que los corregiste: se recuerdan en tu equipo para esta pregunta, y solo los pocos que importan viajan con ella.

## Pasa el trabajo a un agente

Cada chat tiene sus agentes: los que tu espacio de trabajo contrató, compró o registró. Asigna uno desde el chat y dirígete a él: elígelo en *Para*, o empieza el mensaje con `@` y su nombre.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse — Chat",
  "ratio": 1.6,
  "regions": [
    { "label": "Tus chats", "note": "Las mismas conversaciones que en la web y en VS Code", "x": 3, "y": 8, "w": 24, "h": 86, "hue": "muted" },
    { "label": "Agentes de este chat", "note": "Asígnalos desde el grupo de tu espacio de trabajo; quítalos con un clic", "x": 30, "y": 8, "w": 67, "h": 12, "hue": "accent" },
    { "label": "La conversación", "note": "De quién es cada respuesta —tú, el Brain o el agente— y para quién era cada mensaje", "x": 30, "y": 24, "w": 67, "h": 52, "hue": "run" },
    { "label": "Para: Brain o @agente", "note": "Intro envía; el agente al que te diriges responde con sus propias herramientas", "x": 30, "y": 80, "w": 67, "h": 14, "hue": "make" }
  ],
  "caption": "Un mensaje al Brain se responde en tu escritorio con tu memoria privada; un mensaje a un agente lo responde ese agente."
}
```

El agente se ejecuta en la plataforma con sus propias herramientas, en tu nombre y dentro de tus permisos: el mismo agente al que llegarías desde la web, ahora a una `@` de la conversación en la que ya estás.

## Míralo aprender

Synapse dibuja tu Evermind como un cerebro y lo mantiene en la barra lateral, donde puedes verlo.

```bf-figure
{
  "kind": "compare",
  "title": "Dos hemisferios, a partir de tus propios datos",
  "columns": [
    { "title": "Izquierdo: lo que sabe", "hue": "make", "items": ["Neocorteza: procedimientos que tu modelo privado aprendió en sus pesos", "Memoria semántica: datos que recordó cada herramienta de IA de este equipo", "Tálamo: lo que tus herramientas preguntan ahora mismo al índice de código"] },
    { "title": "Derecho: lo que hace", "hue": "run", "items": ["Hipocampo: demostraciones que grabaste", "Ganglios basales: habilidades que compiló y cómo fueron sus ejecuciones", "Amígdala: pasos irreversibles en los que se detuvo a preguntarte", "Hipotálamo: rutinas que lo ponen en marcha por sí solas"] }
  ],
  "caption": "Cada número sale de tu almacén. Una región brilla mientras aprende; el conocimiento nuevo aparece latiendo."
}
```

Abre Evermind y el cerebro ocupa la página: lo que el modelo ha aprendido y lo que está en cola, la pérdida de entrenamiento de cada adaptación, treinta días de demostraciones, habilidades, ejecuciones y aprendizaje, y una lista de lo último que ha asimilado. Haz clic en una región para ver solo lo que llegó allí.

## Su lugar en el método

El trabajo en Builderforce sigue un arco —**Idea → Hacer → Operar → Medir**— y cada acto recorre el mismo bucle interno: [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop).

El chat es donde empieza la **Idea**, y antes empezaba en frío. Ahora la primera **Lectura** es tu propia memoria: antes de responder, el Brain lee lo que tú y tus herramientas ya establecisteis, así que la idea empieza donde lo dejaste y no desde cero.

**Operar** es donde están los agentes, y dirigirte a uno desde el chat es el paso de hablar a hacer, sin salir de la conversación.

**Medir** es el cerebro. Lo que enseñaste, lo que se ejecutó, lo que aprendió el modelo y cómo cambió su pérdida se dibujan a partir del almacén, no se describen: una prueba que puedes ver de que esa capacidad privada está creciendo de verdad.

## Lo que puedes hacer hoy

- **Iniciar sesión en Builderforce desde Synapse** y trabajar en los mismos chats que en la web y en VS Code.
- **Preguntar al Brain** y obtener respuestas basadas en lo que tu Evermind privado aprendió en tu equipo.
- **Asignar agentes a un chat y dirigirte a ellos con @**: hacen el trabajo con sus propias herramientas, en tu nombre.
- **Ver aprender a tu Evermind** en la barra lateral, y ver el panorama completo —regiones, pérdida de entrenamiento, treinta días de actividad— en la página de Evermind.

[Descarga Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true), abre **Chat** e inicia sesión con tu navegador.

---

**Sigue leyendo:** [Enséñalo una vez y lo repetirá](/blog/teach-it-once-and-it-does-it-again) · [Un índice local para todas las herramientas de IA de tu equipo](/blog/one-local-index-for-every-ai-tool)
