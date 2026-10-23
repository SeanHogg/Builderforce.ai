Alguien de tu equipo ya dejó por escrito cómo despliegan un cambio de esquema. Está en `.claude/skills/ship-a-schema-change/SKILL.md`, con un script al lado que ejecuta las comprobaciones, y Claude Code lo sigue cada vez.

Hasta hoy, ese conocimiento se quedaba en el borde de la herramienta para la que se escribió. Para llevarlo a BuilderForce pegabas las instrucciones en un cuadro de texto, perdías el script y esperabas que nadie editara una copia sin la otra. El procedimiento que funcionaba se convertía en dos procedimientos que se separaban.

Las skills ahora son un **estándar**, y BuilderForce lo habla. Una skill es una carpeta: un `SKILL.md` que dice qué es y cuándo usarla, más los scripts y referencias a los que apunta. Claude Code, Codex y una lista creciente de herramientas de agentes leen exactamente esa forma —el formato abierto [Agent Skills](https://agentskills.io)— y también la lee cada agente de BuilderForce, en cada superficie.

## Trae la carpeta, conserva la carpeta

```bf-figure
{
  "kind": "flow",
  "title": "El viaje de ida y vuelta de una skill",
  "steps": [
    { "label": "Importar", "note": "Elige la carpeta, un .zip de ella o un SKILL.md suelto. Se comprueba contra el estándar antes de enviar nada —nombre, descripción, cada ruta— y el veredicto que ves es el mismo al que llega el servidor.", "hue": "idea" },
    { "label": "Usar", "note": "Cada agente del espacio de trabajo ve una línea: su nombre y cuándo usarla. Cuando una tarea encaja, el agente carga las instrucciones; cuando las instrucciones piden un script, carga también ese script.", "hue": "make", "tag": "en todas partes" },
    { "label": "Sacarla", "note": "Descargar carpeta te da <name>.zip: el mismo SKILL.md y los mismos archivos, listos para .claude/skills o .agents/skills. O publícala, y quien la instale recibe exactamente lo que tú ejecutas.", "hue": "run" }
  ],
  "caption": "Nada se vuelve a escribir y nada se pierde al entrar ni al salir. La carpeta que importas es la carpeta que exportas."
}
```

Importar equivale a aprobar. Quien trae una skill es quien responde por ella, así que queda en vigor para todos los agentes desde su próxima ejecución: el mismo estado que produce la aprobación de un revisor, con el mismo registro de quién lo hizo. Una skill que propone un *agente* sigue esperando como borrador hasta que una persona la apruebe; [ese ciclo no cambia](/blog/the-run-that-teaches-the-next-one), y los borradores que produce ahora también son carpetas estándar.

También puedes escribir una en el navegador. **Nueva skill** pide un título, el nombre con el que los agentes la cargan, cuándo usarla y los pasos. Lo que guarda es un `SKILL.md` estándar, así que una skill nacida aquí se descarga y funciona en cualquier otro sitio.

## Una skill, en cada lugar donde trabajan tus agentes

La pregunta importante no era «¿podemos interpretar SKILL.md?», sino «¿llega la skill al agente que la necesita, dondequiera que se ejecute?». Una skill que funciona en las ejecuciones en la nube y no hace nada en el editor es una skill en la que nadie puede confiar.

```bf-figure
{
  "kind": "screen",
  "frame": "Adónde llegan ahora las skills de un espacio de trabajo",
  "ratio": 1.7,
  "regions": [
    { "label": "Ejecuciones en la nube y en contenedor", "note": "El catálogo en el prompt; la skill se carga cuando el ticket encaja", "x": 4, "y": 8, "w": 44, "h": 26, "hue": "make" },
    { "label": "Brain — web, VS Code, Rovr", "note": "El mismo catálogo, el mismo cargador, en mitad de la conversación", "x": 52, "y": 8, "w": 44, "h": 26, "hue": "idea" },
    { "label": "Lienzo de creación y Studio", "note": "El asistente del tablero sigue tu procedimiento mientras construye", "x": 4, "y": 40, "w": 44, "h": 26, "hue": "make" },
    { "label": "Agentes autoalojados", "note": "Las skills asignadas llegan al disco como carpetas reales; .claude/skills y .agents/skills se cargan tal cual", "x": 52, "y": 40, "w": 44, "h": 26, "hue": "run" },
    { "label": "Cualquier cliente MCP", "note": "Claude, Cursor y otros conectados a tu espacio reciben la misma herramienta", "x": 4, "y": 72, "w": 92, "h": 20, "hue": "accent" }
  ],
  "caption": "Un único cargador detrás de todos. Añade una skill una vez y cada superficie la ve en su siguiente turno; ninguna guarda una copia propia."
}
```

En un agente autoalojado, una skill asignada en el portal solía llegar como un *nombre*: «se te ha asignado ship-a-schema-change; si por casualidad hay un SKILL.md para ella en esta máquina, síguelo». Ahora se escribe en disco la carpeta misma, con sus scripts, y aparece en la lista de skills del agente como una creada en local. Una skill que escribiste tú con el mismo nombre siempre gana; la sincronización nunca sobrescribe una carpeta que no escribió ella.

## Cincuenta skills por el precio de cincuenta líneas

La mejor idea del estándar es que un agente no debería cargar con todos los procedimientos que podría necesitar. Ve un catálogo —una línea por skill— y carga las instrucciones de una skill solo cuando la tarea que tiene delante encaja. Una referencia incluida se carga solo cuando las instrucciones la señalan.

```bf-figure
{
  "kind": "compare",
  "title": "Lo que lleva una ejecución antes de empezar",
  "columns": [
    { "title": "Todas las skills pegadas", "hue": "muted", "items": ["Cada procedimiento aprobado, completo, en cada prompt", "Los largos, cortados a mitad de un paso", "Los scripts, en ningún sitio: solo la prosa sobre ellos", "Más skills, más coste, en cada turno"] },
    { "title": "El catálogo del estándar", "hue": "make", "items": ["Una línea por skill: su nombre y cuándo usarla", "Las instrucciones completas cuando —y solo cuando— la tarea encaja", "Scripts y referencias incluidos, bajo demanda", "Una biblioteca que crece sin hacer crecer cada prompt"] }
  ],
  "caption": "Las skills asignadas directamente a una ejecución, un proyecto o un agente se siguen dando completas: es un contrato más fuerte que una entrada de catálogo, y lo sigue siendo."
}
```

## Dónde encaja en el método

Las skills viven en el acto **Build** de [Read · Prove · Build](/blog/read-prove-build-the-inner-loop), el que gasta. Read y Prove son baratos a propósito, para que decidir construir sea una decisión de verdad. Una vez que construyes, lo más caro que puede hacer un agente es redescubrir cómo hace tu equipo algo que ya ha hecho cien veces: qué comprobación ejecutar, qué pista de migración necesita una columna, cómo sale una release.

Una skill es ese conocimiento, escrito una vez. Convertirla en una carpeta estándar es lo que le permite viajar con el trabajo en lugar de vivir en una sola herramienta: así, el procedimiento que tu ingeniera pulió en su editor es el que sigue la ejecución en la nube en el siguiente ticket, y el que sigue el asistente del tablero mientras construye. Build sigue siendo el acto caro; deja de ser el acto en el que se paga dos veces la misma lección.

## Lo que puedes hacer hoy

- **Importar** una carpeta de skill desde Claude Code, el `.agents/skills` de un repositorio o el .zip de un compañero, con scripts y referencias.
- **Escribir** una skill en el navegador y obtener un `SKILL.md` estándar.
- **Descargar** cualquier skill del espacio de trabajo, o cualquier skill publicada en el marketplace, como una carpeta lista para usar.
- **Publicar** una skill en el marketplace desde su carpeta, para que el anuncio y lo que reciben quienes la instalan nunca discrepen.
- **Usar** cada skill desde las ejecuciones en la nube, el Brain en la web, en VS Code y en Rovr, el lienzo de creación y el Studio, y desde agentes autoalojados, donde las skills asignadas ahora llegan al disco.

---

**Lecturas relacionadas:** [La ejecución que enseña a la siguiente](/blog/the-run-that-teaches-the-next-one) · [Enséñalo una vez y lo vuelve a hacer](/blog/teach-it-once-and-it-does-it-again) · [Skills, asignaciones y el marketplace](/blog/skills-assignment-and-the-marketplace)

[Abre las skills de tu espacio de trabajo](/skills) e importa la carpeta en la que tu equipo ya confía.
