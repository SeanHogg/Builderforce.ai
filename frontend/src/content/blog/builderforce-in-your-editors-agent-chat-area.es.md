# BuilderForce ya está en el área de chat de agentes de VS Code, junto a tu código

VS Code ya tiene un sitio para los agentes de programación. La barra lateral secundaria, a la derecha, reúne Chat, Claude Code y Codex, cada uno en su propia pestaña. Escribes ahí, y el código que el agente cambia sigue abierto en el editor, al lado.

BuilderForce no estaba en esa fila. Su chat se abría como una **pestaña del editor**, así que ocupaba el espacio que necesitaba tu código. Para ver cómo un agente cambiaba un archivo tenías que dividir el editor a mano o ir y venir entre la conversación y el código.

Ahora BuilderForce tiene su propia pestaña en esa fila.

```bf-figure
{
  "kind": "screen",
  "frame": "VS Code con BuilderForce en el área de chat de agentes",
  "ratio": 1.78,
  "regions": [
    { "label": "Barra lateral", "note": "Sesiones, Trabajo, Bandeja de entrada, Estado", "x": 2, "y": 6, "w": 18, "h": 88, "hue": "muted" },
    { "label": "Tu código", "note": "El archivo que el agente está cambiando, a todo el ancho", "x": 22, "y": 6, "w": 46, "h": 88, "hue": "make" },
    { "label": "Chat · Claude Code · Codex · BuilderForce", "x": 70, "y": 6, "w": 28, "h": 8, "hue": "accent" },
    { "label": "BuilderForce", "note": "La misma conversación, ejecuciones y aprobaciones que en cualquier otro sitio", "x": 70, "y": 16, "w": 28, "h": 78, "hue": "idea" }
  ],
  "caption": "El editor se queda con el código y el área de chat de agentes, con la conversación. No hay que renunciar a nada."
}
```

## Un chat, en un solo lugar

No es un segundo chat. La pestaña muestra la misma conversación que verías en la web: la misma transcripción, las mismas aprobaciones de herramientas, la misma elección de modelo y el mismo ámbito de proyecto. Una ejecución sigue en marcha aunque la pestaña esté oculta, porque el agente se ejecuta en la extensión, no en la pestaña.

Ahora todas las formas de abrir un chat llegan a esa pestaña: el comando **Abrir chat**, una sesión pulsada en la lista de Sesiones, *Trabajar en esta tarea* desde el tablero y un prompt enviado desde Project 360. «Abre mi chat» siempre lleva al mismo sitio.

```bf-figure
{
  "kind": "flow",
  "title": "Cualquier entrada, un único destino",
  "steps": [
    { "label": "Pedir", "note": "Abrir chat, una sesión de la barra lateral, una tarea, un prompt de Project 360", "hue": "idea" },
    { "label": "Llegar", "note": "La pestaña de BuilderForce en el área de chat de agentes se abre en esa conversación", "hue": "make", "tag": "junto a tu código" },
    { "label": "Observar", "note": "Las ediciones aparecen en el editor de al lado; las aprobaciones y el indicador de Cambios siguen a la vista", "hue": "run" }
  ],
  "caption": "Los tableros siguen abriéndose en el editor, porque un lienzo necesita el ancho. Si prefieres una pestaña del editor por conversación, el ajuste de pestañas por sesión te la sigue dando."
}
```

En las versiones de VS Code anteriores a la 1.106, que no tienen área de chat de agentes, la misma pestaña aparece en la barra lateral de BuilderForce.

## Dónde encaja en el método

Construir es el tercer acto, después de [Leer y Probar](/blog/read-prove-build-the-inner-loop), y es donde más importa el ciclo corto entre *pedir un cambio* y *ver el cambio*. Cada salto fuera de ese ciclo cuesta atención: un cambio de pestaña, una división montada a mano, una conversación que tapa el archivo que está editando.

```bf-figure
{
  "kind": "compare",
  "title": "Ver cómo un agente cambia tu código",
  "columns": [
    { "title": "Chat como pestaña del editor", "hue": "muted", "items": ["El chat ocupa el espacio del editor", "Dividir el editor a mano o ir y venir", "El archivo que cambia queda a un clic", "Cada punto de entrada podía abrir su propia pestaña"] },
    { "title": "Chat en el área de chat de agentes", "hue": "make", "items": ["Código a todo el ancho en el editor", "La conversación siempre al lado", "Aprobaciones y cambios a la vista mientras lees el diff", "Todos los puntos de entrada llegan a la misma pestaña"] }
  ],
  "caption": "El mismo chat, las mismas ejecuciones. Lo que cambia es dónde está."
}
```

Hacer, Ejecutar y Medir ocurren en la plataforma. Cuando el trabajo es código en tu propia máquina, Hacer ocurre en tu editor, y ahora el agente que lo hace está en el área de chat de agentes del editor, junto a tu código.

## Pruébalo

Actualiza la extensión de BuilderForce, recarga VS Code y abre el área de chat de agentes. BuilderForce tiene su propia pestaña junto a Chat, Claude Code y Codex. O ejecuta **BuilderForce: Abrir chat** y se abrirá ahí.

---

**Lecturas relacionadas:** [Leer, Probar, Construir: el ciclo interno](/blog/read-prove-build-the-inner-loop) · [Sin cuenta, sin GPU, sin red](/blog/no-account-no-gpu-you-choose-where-it-runs)
