Todo equipo tiene una lista corta de cosas sin las que un cambio no está terminado. El README menciona el nuevo flag. DONE.md registra lo que se entregó. El linter está en verde. Nadie sube a main con una prueba fallando.

Podrías decírselo al agente cada vez, pero se te olvidaría. Tu compañero ni sabría que hay que decirlo. Y una instrucción escrita en un chat termina con ese chat, así que la siguiente sesión empieza de cero.

Esa lista pertenece al repositorio, no a quien casualmente esté escribiendo. Así que ahora vive ahí.

## Workspace hooks

Añade un archivo a tu repositorio, `.builderforce/hooks.json`:

```json
{
  "hooks": [
    { "on": "stop", "prompt": "Update README.md and DONE.md with the work completed in this session." },
    { "on": "stop", "command": "npm run lint" },
    { "on": "preTool", "tool": "git_push", "command": "npm test" },
    { "on": "postTool", "tool": "write_file|edit_file", "command": "npx prettier --check ." }
  ]
}
```

Cada ejecución del agente en ese espacio de trabajo ahora lo sigue, ya empiece en el panel de BuilderForce o en el chat integrado de VS Code.

```bf-figure
{
  "kind": "flow",
  "title": "Dónde se dispara cada hook en una ejecución",
  "steps": [
    { "label": "preTool", "note": "Antes de una llamada a una herramienta que coincida. Un comando que falla rechaza la llamada, y el agente ve por qué.", "hue": "make" },
    { "label": "postTool", "note": "Tras una llamada exitosa. La salida de una comprobación fallida vuelve al agente junto con el resultado.", "hue": "make" },
    { "label": "stop", "note": "La ejecución está a punto de terminar. Un prompt se entrega una vez. Una comprobación fallida retiene la ejecución hasta que pase.", "hue": "run", "tag": "antes de entregar" },
    { "label": "runEnd", "note": "Después de que la ejecución ha terminado. Un comando para notificaciones, informes y limpieza.", "hue": "measure" }
  ],
  "caption": "Los hooks stop se ejecutan antes de que el agente haga commit y push, así que lo que pidan, como documentación, una línea de changelog o una corrección de lint, se entrega en el mismo commit."
}
```

Un **prompt** es una instrucción, en palabras llanas, que el agente cumple con sus propias herramientas. Un **command** es una comprobación que se ejecuta en la raíz del espacio de trabajo, y su salida decide qué ocurre después. Por defecto, los hooks stop se disparan solo en ejecuciones que cambiaron código, de modo que una pregunta sobre la base de código no envía al agente a reescribir tu README. Establece `"when": "always"` si quieres uno en cada ejecución.

La guía permanente que no está atada a un momento va en `.builderforce/rules.md`, por ejemplo "usa pnpm", "cada migración lleva un rollback" o "escribe las pruebas en Vitest". Se lee en las instrucciones de cada ejecución, por debajo de las puertas de gobernanza de tu organización y por encima de todo lo demás.

```bf-figure
{
  "kind": "screen",
  "frame": "Un repositorio con directivas de equipo",
  "ratio": 1.62,
  "regions": [
    { "label": ".builderforce/hooks.json", "note": "Se comprueba mientras escribes contra su esquema", "x": 4, "y": 8, "w": 44, "h": 40, "hue": "make" },
    { "label": ".builderforce/rules.md", "note": "Instrucciones permanentes para cada tarea", "x": 4, "y": 52, "w": 44, "h": 36, "hue": "idea" },
    { "label": "Chat del agente", "note": "Antes de terminar, este espacio de trabajo te pide: actualizar README.md y DONE.md…", "x": 52, "y": 8, "w": 44, "h": 80, "hue": "run" }
  ],
  "caption": "Ambos archivos son texto plano en tu repositorio: se revisan en pull requests, se versionan con el código y son idénticos para todos los que lo clonan."
}
```

## Compartido, y aun así seguro

Los archivos viven en `.builderforce/`, así que se hacen commit. Eso también significa que un archivo de hooks llega con cada clon, y un comando en él se ejecuta en tu máquina. Por eso los comandos no se ejecutan hasta que los apruebas, una vez por máquina. VS Code te muestra la lista exacta. Si alguien cambia un comando o añade uno, se te vuelve a preguntar. Editar un prompt o las reglas no requiere aprobación, porque son texto que el agente lee, como cualquier otro archivo del repositorio. En un espacio de trabajo en el que VS Code no confía, no se ejecuta nada.

## Dónde encaja en el método

Los hooks pertenecen a **Build**, el tercer acto y el costoso. [Read y Prove](/blog/read-prove-build-the-inner-loop) no cuestan nada porque aún no ha cambiado ningún código. Una vez que el código cambia, la definición de terminado de un equipo es lo que evita que una ejecución deje un desorden a la siguiente persona. En una sesión de editor local, el agente es el único revisor que tendrá el cambio antes de entregarse, así que los estándares del equipo tienen que ser parte de la propia ejecución, no un recordatorio que depende de que alguien se acuerde.

```bf-figure
{
  "kind": "compare",
  "title": "Terminar un cambio",
  "columns": [
    { "title": "Sin hooks", "hue": "muted", "items": ["El agente entrega el código", "Alguien nota que el README está desactualizado", "Otra persona nota que el lint está en rojo", "Un commit de seguimiento corrige ambos", "La ejecución del siguiente compañero lo repite"] },
    { "title": "Con workspace hooks", "hue": "make", "items": ["El agente cambia el código", "Actualiza la documentación que se le pidió", "El lint debe pasar antes de que pueda terminar", "Un solo commit entrega todo", "Lo mismo para todo el equipo"] }
  ],
  "caption": "La definición de terminado de un equipo pasa de ser un hábito a ser parte de la ejecución."
}
```

## Qué puedes hacer con esto hoy

- **Mantén la documentación al día sin pedirlo**: un prompt stop hace que "actualizar README y DONE" sea parte de cada cambio.
- **Convierte una comprobación en un requisito**: un comando stop retiene la ejecución hasta que pase tu linter o la comprobación de tipos, dentro de un número limitado de intentos.
- **Controla las acciones arriesgadas**: un comando preTool puede rechazar `git_push` hasta que `npm test` pase.
- **Corrige sobre la marcha**: una comprobación postTool fallida envía la queja del formateador directamente de vuelta al agente.
- **Compártelo todo mediante git**: haz commit de `.builderforce/` y el agente de cada compañero sigue las mismas directivas.

Ejecuta **BuilderForce: Edit Workspace Hooks** en VS Code para crear un archivo inicial.

---

**Lecturas relacionadas:** [Puertas de aprobación y supervisión humana](/blog/approval-gates-and-human-oversight) · [BuilderForce vs Claude Code](/blog/builderforce-vs-claude-code) · [Orquestación multiagente](/blog/multi-agent-orchestration)
