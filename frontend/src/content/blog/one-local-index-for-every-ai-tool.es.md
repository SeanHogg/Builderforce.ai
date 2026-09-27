Observa a un agente empezar una tarea en un repositorio grande y cuenta las llamadas antes de su primera edición.

Hace grep de una palabra de tu petición. La palabra no está en el código: tú describiste el comportamiento, y el código lo llama de otra forma. Lista un directorio. Lee un archivo de 2.000 líneas para encontrar una función, luego la vecina equivocada, luego vuelve a leer el primer archivo porque la ventana que necesitaba se ha salido del contexto. Diez, veinte, treinta llamadas solo para orientarse, todas pagadas, antes de que cambie nada.

Después cambias a otra herramienta y lo hace todo otra vez, porque nada de lo que aprendió se guardó en ningún sitio que otra herramienta pudiera leer.

Esa es la brecha: **cada herramienta de IA que usas empieza desde cero, y cada una empieza desde cero por separado.**

## Synapse

Synapse es una pequeña aplicación que vive en la bandeja del sistema y mantiene un índice por repositorio: en tu equipo y actualizado hasta tu último guardado.

```bf-figure
{
  "kind": "flow",
  "title": "Qué contiene el índice y quién lo lee",
  "steps": [
    { "label": "Definiciones", "note": "Cada función, clase y tipo, cortados por sus límites reales: la unidad que un agente realmente quiere leer.", "hue": "idea" },
    { "label": "Un mapa", "note": "Archivos ordenados según cuánto depende de ellos el resto del código, cada uno con sus firmas más usadas.", "hue": "idea" },
    { "label": "Búsqueda por significado", "note": "Palabras clave que entienden identificadores («membership» encuentra resolveMembership) más embeddings locales, fusionados en un único ranking.", "hue": "make" },
    { "label": "Todas las herramientas", "note": "El agente de VS Code, Claude Code, Cursor y cualquier cliente MCP leen el mismo índice.", "hue": "run", "tag": "un índice" }
  ],
  "caption": "El vigilante de archivos reindexa lo que guardas, así que el índice describe el código tal como es ahora, no como era en el último escaneo."
}
```

En cuanto la aplicación está en marcha, cambian tres cosas.

**El agente empieza orientado.** El contexto de cada turno incluye el mapa del repositorio, así que el agente sabe qué módulos importan antes de abrir ninguno. Y obtiene `semantic_search`: pregunta «¿cómo llegan los reembolsos al libro mayor?» y la respuesta es la función que lo hace —su ruta, su rango de líneas, su cuerpo— en una sola llamada.

**Todas las herramientas lo comparten.** El mismo índice responde al agente de Builderforce en VS Code y, con una sola entrada MCP, a Claude Code y a Cursor. Lo que configuras una vez sirve para todas.

**La memoria obsoleta se detecta.** Esta es la parte que no esperábamos que importara tanto.

## Una memoria que sabe cuándo se equivoca

Evermind recuerda lo que las ejecuciones anteriores aprendieron sobre tu proyecto: convenciones, causas raíz, dónde vive cada cosa. Esa memoria es lo que evita que la décima ejecución vuelva a deducir lo que la primera ya resolvió.

También puede fallar de la peor manera posible. Un recuerdo que dice «los permisos pasan por `resolveMembership()`» era cierto el día que se escribió. Tres semanas después esa función ya no existe —renombrada, fusionada, eliminada— y el recuerdo sigue siendo seguro, concreto y ahora falso. Un agente que confía en él busca código que no existe o, peor aún, lo vuelve a crear.

```bf-figure
{
  "kind": "compare",
  "title": "El mismo recuerdo recuperado, antes y después",
  "columns": [
    { "title": "Sin el índice", "hue": "muted", "items": ["«Usa resolveMembership() para los permisos»", "El agente lo busca", "No encuentra nada, o una copia antigua", "Escribe una nueva junto al código real"] },
    { "title": "Con Synapse", "hue": "make", "items": ["«Usa resolveMembership() para los permisos»", "POSIBLEMENTE OBSOLETO: resolveMembership ya no existe", "El agente revisa primero el código actual", "Actualiza el recuerdo en lugar de obedecerlo"] }
  ],
  "caption": "Cada recuerdo y cada dato del proyecto recuperados se contrastan con el índice en vivo. Solo se comprueban nombres que son inequívocamente código —rutas e identificadores—, así que la prosa normal nunca se marca."
}
```

Con la aplicación de escritorio en marcha, cada recuerdo que recupera el agente se contrasta con el índice antes de que el agente lo vea. Una ruta o un símbolo que ya no existe se adjunta al recuerdo como advertencia. El agente verifica en lugar de obedecer, y un recuerdo desactualizado se corrige en vez de seguir dirigiendo el trabajo en silencio otro mes.

## Se queda en tu equipo

La indexación, la fragmentación y los embeddings se ejecutan en local. El modelo de embeddings se descarga una vez, el índice vive en tu perfil de usuario —nunca dentro del repositorio— y la aplicación no sube código a ningún sitio. El servicio local que ejecuta está protegido por una clave generada en cada arranque que solo tu cuenta de usuario puede leer, y rechaza de plano las peticiones que vienen de páginas web.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse",
  "ratio": 1.4,
  "regions": [
    { "label": "Espacios de trabajo indexados", "note": "Progreso de escaneo y embeddings por repositorio; reescanear o quitar", "x": 4, "y": 8, "w": 92, "h": 44, "hue": "idea" },
    { "label": "Conecta tus herramientas", "note": "VS Code es automático; un comando para Claude Code; un bloque JSON para Cursor", "x": 4, "y": 56, "w": 92, "h": 30, "hue": "run" },
    { "label": "Se queda en local", "x": 4, "y": 89, "w": 40, "h": 7, "hue": "accent" }
  ],
  "caption": "Abre una carpeta en VS Code con la extensión de Builderforce y se registra sola; no hay nada que configurar."
}
```

Esto importa más allá de la comodidad. Muchos equipos no pueden enviar código fuente a un índice alojado: trabajo regulado, código de clientes bajo NDA, entornos aislados. Un índice local marca la diferencia entre que esos equipos tengan agentes que conocen su código o se queden sin ellos.

## Dónde encaja en el método

Todo el trabajo en Builderforce sigue el mismo bucle interno: [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop). Leer y Probar son gratuitos a propósito: sirven para decidir si merece la pena el paso caro, Construir.

Synapse es una función de **Leer**, y leer era donde los agentes eran más débiles. Un agente que no sabe leer bien el código no se salta la lectura; lee mal, a precio de construcción: cada llamada de orientación se factura como un paso de construcción y cada relectura quema el contexto que necesitaba el cambio real. Hacer que Leer sea barato y preciso es lo que vuelve honesto el resto del bucle: Probar trabaja sobre el código real y Construir empieza en el archivo correcto.

La comprobación de memoria obsoleta cierra una brecha más silenciosa en el mismo paso. Leer incluye leer lo que ya sabes, y un recuerdo solo es conocimiento mientras sigue siendo cierto.

## Lo que puedes hacer hoy

- **Poner a un agente a trabajar en una zona desconocida** y dejar que encuentre la función describiendo lo que hace, en lugar de adivinar su nombre.
- **Usar Claude Code y Cursor sobre el mismo índice** que el agente de Builderforce: añádelo una vez desde el panel Conectar de la aplicación.
- **Confiar más en la memoria recuperada**, porque el recuerdo que se ha quedado obsoleto lo dice.
- **Trabajar con código que no puede salir de la empresa** y aun así dar al agente pleno conocimiento de él.

[Descarga Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) para Windows, macOS o Linux y abre una carpeta en VS Code con la extensión de Builderforce.

---

**Lecturas relacionadas:** [Leer, Probar, Construir: el bucle interno](/blog/read-prove-build-the-inner-loop) · [El centro de mando de VS Code para tu plantilla agéntica](/blog/vs-code-command-center-for-your-agentic-workforce) · [Publica desde el editor](/blog/ship-from-the-editor-commit-branch-pull-request)
