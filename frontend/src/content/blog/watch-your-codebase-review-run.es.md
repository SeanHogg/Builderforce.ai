Haces clic en Review en una carpeta. Aparece un spinner. En algún lugar se están leyendo, resumiendo y juzgando archivos, y no tienes forma de saber si va por el archivo 12 de 40 o se quedó atascado en el 3. Si falla, te enteras al final, y el único remedio es empezar de nuevo.

Y el mapa tenía una segunda debilidad. Se dibujaba a partir de la copia del servidor, así que en cuanto cerrabas sesión, llegabas a un límite de uso o perdías la conexión, el mapa que acababas de construir se quedaba en blanco.

Ese es el hueco: **una revisión era un spinner en el que no se podía ver nada, y el mapa desaparecía sin el servidor.**

## El mapa es tuyo y funciona sin conexión

El mapa de conocimiento ahora se dibuja desde la copia que está en tu propio equipo, tengas o no vinculado el espacio de trabajo. El servidor es una réplica, mantenida al día por una cola en segundo plano que sobrevive a un cierre de sesión, a un límite de uso o a una caída, y simplemente continúa donde se quedó. Una carpeta que el servidor tiene pero tu equipo no se dibuja igualmente, en solo lectura, para que veas que existe sin fingir que la tienes.

```bf-figure
{
  "kind": "flow",
  "title": "De dónde viene ahora el mapa",
  "steps": [
    { "label": "Tu equipo", "note": "El mapa se lee de la copia local, vinculado o no. Cierra sesión, quédate sin conexión, llega a un límite: se abre igual.", "hue": "make" },
    { "label": "Cola en segundo plano", "note": "Los cambios esperan en una cola que sobrevive a una caída y reintenta por sí sola.", "hue": "run" },
    { "label": "La réplica del servidor", "note": "Se pone al día cuando puede. Una carpeta que solo tiene el servidor se dibuja en solo lectura.", "hue": "measure", "tag": "una copia, no la fuente" }
  ],
  "caption": "La dirección de la verdad cambió: primero se lee la copia local y el servidor la sigue."
}
```

## Cada revisión es una ejecución que puedes abrir

Review y Re-review ahora abren un panel de ejecución llamado Run details. Responde las preguntas que el spinner nunca pudo responder.

```bf-figure
{
  "kind": "screen",
  "frame": "Run details de la revisión de una carpeta",
  "ratio": 1.62,
  "regions": [
    { "label": "Línea de tiempo de fases", "note": "Planificar, extraer, juzgar, terminar: dónde está la ejecución ahora mismo", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "run" },
    { "label": "Carriles de trabajadores", "note": "En qué archivos trabaja cada hilo en este momento", "x": 4, "y": 24, "w": 44, "h": 40, "hue": "make" },
    { "label": "Pasos", "note": "La lista ordenada, lo hecho y lo que falta", "x": 52, "y": 24, "w": 44, "h": 40, "hue": "idea" },
    { "label": "Fallos · Retry", "note": "Qué salió mal, con un Retry al lado", "x": 4, "y": 68, "w": 44, "h": 26, "hue": "measure" },
    { "label": "Historial de ejecuciones", "note": "Las últimas 20 ejecuciones de esta carpeta; una caída aparece como «interrumpida»", "x": 52, "y": 68, "w": 44, "h": 26, "hue": "accent" }
  ],
  "caption": "Un solo panel para toda la ejecución: dónde está, quién hace qué, qué falló y qué pasó las últimas veinte veces."
}
```

**Retry no es un atajo para saltarse las reglas.** Marca los archivos fallidos como pendientes y los envía por el flujo normal de planificar, estimar y confirmar. Ves lo que costará el reintento antes de gastar nada, igual que la primera vez.

**El historial dice la verdad sobre las caídas.** Cada carpeta conserva sus últimas 20 ejecuciones. Una ejecución cortada por una caída aparece como «interrumpida» en lugar de faltar en silencio, así sabes que no terminó y puedes retomarla.

## Más rápido, sin machacar a tu proveedor

La lectura de los archivos ahora se reparte entre varios hilos de trabajo en tu equipo, hasta ocho y nunca más que tus núcleos menos uno, para que el editor siga respondiendo. El juicio se hace con cuatro archivos a la vez. Todas esas llamadas comparten un único limitador: como máximo seis llamadas al modelo en curso, y el límite se reduce a la mitad cuando un proveedor pide ir más despacio. Así, el paralelismo nunca multiplica la carga sobre el proveedor; solo aprovecha el margen que permite el límite.

Los resultados son idénticos a los de una ejecución en serie. Los mismos archivos se juzgan igual, solo que antes.

## Dónde encaja en el método

Esto es **Run**, con un pie en **Measure**. Una revisión es la base de código haciendo su trabajo, y una ejecución que puedes observar es una ejecución en la que puedes confiar y que puedes afinar. El historial y los fallos que conserva son las primeras mediciones de cómo va ese trabajo, y alimentan la siguiente idea sobre qué arreglar o volver a revisar.

```bf-figure
{
  "kind": "compare",
  "title": "Una revisión, antes y ahora",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Un spinner sin nada detrás", "El fallo se conoce solo al final", "Empezar de cero para recuperarse", "Mapa en blanco si el servidor no responde"] },
    { "title": "Ahora", "hue": "run", "items": ["Línea de tiempo de fases y carriles de trabajadores", "Fallos listados, cada uno con Retry", "Retry pasa por planificar, estimar, confirmar", "El mapa se abre desde tu equipo, vinculado o no"] }
  ],
  "caption": "La misma revisión, con el interior a la vista y un mapa que ya no depende de una conexión."
}
```

## Qué puedes hacer hoy

- **Abrir el mapa sin conexión**, con sesión iniciada o no, vinculado o no.
- **Observar una revisión** y ver en qué archivos trabaja cada trabajador.
- **Reintentar solo lo que falló**, después de ver la estimación.
- **Mirar atrás** las últimas 20 ejecuciones de cualquier carpeta.

---

**Lecturas relacionadas:** [Ejecuta la app que tu tablero acaba de construir](/blog/run-your-app-on-the-canvas) · [Tu Evermind privado en tu equipo](/blog/your-private-evermind-on-your-machine)
