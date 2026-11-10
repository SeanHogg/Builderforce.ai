# Ya no lees el código del agente. Ahora puedes ver qué hizo su ejecución

Termina una ejecución del agente. Cuarenta archivos cambiados, las pruebas en verde, y el resumen dice «Hecho, todas las pruebas pasan». ¿Abres el diff?

La mayoría ya no lo hace, y para eso sirve tener un agente. Pero no leer el código nunca fue lo mismo que no preocuparse por lo que le pasó. En algún lugar de esos cuarenta archivos, una ruta puede haber perdido su comprobación de autenticación. Un bucle puede esperar ahora a la base de datos una vez por elemento. Una prueba que fallaba puede haberse marcado con `.skip`, y «todas las pruebas pasan» sería cierto.

El diff puede contarte todo eso, si lo lees y si sabes qué buscar. El resumen de la ejecución lo escribe el mismo agente cuyo trabajo intentas juzgar. Hasta ahora no había nada en medio.

## La tarjeta de cambios de la ejecución

Cada ejecución del agente en el chat de VS Code termina ahora con una tarjeta de **cambios de la ejecución**. No lee el diff para resumirlo. Reduce a hechos el código de antes de la ejecución y el de después, compara los dos conjuntos y da un veredicto sobre cuatro preguntas.

```bf-figure
{
  "kind": "screen",
  "frame": "Chat de VS Code · final de una ejecución",
  "ratio": 1.5,
  "regions": [
    { "label": "Titular", "note": "Peor: seguridad (1 × la ruta perdió su guarda de autenticación); calidad (pruebas debilitadas)", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "measure" },
    { "label": "Seguridad", "note": "Peor · 1 nuevo", "x": 4, "y": 24, "w": 44, "h": 13, "hue": "measure" },
    { "label": "Rendimiento", "note": "Sin cambios · solo análisis estático", "x": 52, "y": 24, "w": 44, "h": 13, "hue": "run" },
    { "label": "Calidad", "note": "Peor · pruebas debilitadas", "x": 4, "y": 41, "w": 44, "h": 13, "hue": "measure" },
    { "label": "Características de calidad", "note": "Compatibilidad, mantenibilidad, seguridad física; el resto, Sin medir", "x": 52, "y": 41, "w": 44, "h": 13, "hue": "idea" },
    { "label": "Radio de impacto: medio", "note": "Comparado con las ejecuciones anteriores de este repositorio", "x": 4, "y": 60, "w": 56, "h": 14, "hue": "accent" },
    { "label": "Ver detalles", "x": 64, "y": 60, "w": 32, "h": 14, "hue": "make" },
    { "label": "Impide finalizar una ejecución autónoma", "note": "Aparece si se quitó una guarda o se debilitaron pruebas", "x": 4, "y": 80, "w": 92, "h": 14, "hue": "measure" }
  ],
  "caption": "Un titular, una fila por dimensión, una banda de radio de impacto y un acceso a la evidencia. Cada veredicto es una palabra y un icono, no solo un color."
}
```

**Seguridad.** ¿Cambió la superficie de ataque? Una ruta que perdió su guarda de autenticación, un nuevo punto de entrada, una nueva capacidad del sistema como importar `child_process`, criptografía débil, un secreto añadido al código. El secreto se muestra ocultado, no se te devuelve tal cual.

**Rendimiento.** ¿Añadió la ejecución una llamada de E/S con await dentro de un bucle, o una llamada de E/S bloqueante? Son reglas estáticas, y la fila dice «solo análisis estático» para que no pase por un benchmark.

**Calidad.** ¿Empeoró el código, y **debilitó el agente las pruebas que lo juzgan**? Una prueba omitida o borrada, un `.only` añadido, menos aserciones, un matcher más laxo, una comprobación de lint o de tipos suprimida, un tiempo de espera ampliado. Cuando ocurre, el titular dice que las pruebas se debilitaron, con esas palabras.

**Las características de calidad**, según ISO/IEC 25010. Compatibilidad: una API exportada se rompió, o apareció una nueva. Mantenibilidad: un nuevo ciclo de dependencias, una capa cruzada, un grupo de código duplicado que creció, código sin usar, un archivo sobredimensionado que creció aún más. Seguridad física: un cambio de esquema destructivo, un force push o un borrado recursivo en un script. Las características que la tarjeta todavía no mide dicen **Sin medir**. No se muestran como cero, porque cero sería una afirmación.

## Cómo se llega a un veredicto

```bf-figure
{
  "kind": "flow",
  "title": "De una ejecución terminada a un veredicto",
  "steps": [
    { "label": "Ejecución", "note": "El agente termina. El código de antes y el de después son los dos lados.", "hue": "run" },
    { "label": "Hechos", "note": "Cada lado se reduce a hechos y hallazgos con extractores y reglas fijos, los mismos en ambos lados.", "hue": "make" },
    { "label": "Cambios", "note": "Se comparan los dos conjuntos. Cada hallazgo es nuevo en esta ejecución, resuelto o modificado por ella, o ya existía.", "hue": "idea" },
    { "label": "Veredicto", "note": "Mejor, Peor, Sin cambios, No comparable o Sin medir, por dimensión, con un titular construido a partir de una frase fija.", "hue": "measure", "tag": "al terminar la ejecución" }
  ],
  "caption": "Se comparan hechos, no texto. El mismo antes y después da el mismo resumen criptográfico en cualquier máquina, y ningún modelo escribe el veredicto."
}
```

Algunas reglas mantienen honesta la tarjeta:

- **Cinco veredictos, no dos.** Mejor, Peor, Sin cambios, No comparable y Sin medir. Si los dos lados no se pueden comparar con justicia, por ejemplo porque la rama cambió durante la ejecución, la tarjeta dice No comparable y por qué, en lugar de adivinar.
- **≈ marca una heurística.** Un hallazgo que viene de una heurística y no de una regla exacta lleva ≈, así sabes qué cifras son estimaciones.
- **El radio de impacto es relativo.** Bajo, medio o alto se calcula frente a las ejecuciones anteriores de tu propio repositorio, así que «alto» significa alto para este código, no comparado con el de otros.
- **No estorba.** La tarjeta se calcula en tu máquina, sin conexión y sin iniciar sesión, y no hace fallar ni ralentiza la ejecución que describe.

## Ver detalles

**Ver detalles** abre un panel lateral sobre el chat. Los hallazgos se agrupan por dimensión y luego por origen: nuevos en esta ejecución, resueltos por esta ejecución, modificados por esta ejecución, ya existían. Cada uno trae su evidencia y un enlace **Abrir código** a la línea a la que se refiere.

```bf-figure
{
  "kind": "compare",
  "title": "La misma ejecución, antes y después de la tarjeta",
  "columns": [
    { "title": "Lo que tenías", "hue": "muted", "items": ["«Hecho, todas las pruebas pasan»", "Un diff de cuarenta archivos", "Tu propia intuición sobre lo que importa en él"] },
    { "title": "Lo que dice la tarjeta", "hue": "measure", "items": ["Seguridad: Peor · la ruta perdió su guarda de autenticación", "Rendimiento: Sin cambios · solo análisis estático", "Calidad: Peor · prueba omitida, menos aserciones", "Fiabilidad: Sin medir", "Radio de impacto: medio"] }
  ],
  "caption": "«Todas las pruebas pasan» era cierto. Era cierto porque una de ellas ya no se ejecutaba."
}
```

En las ejecuciones autónomas, donde nadie mira el chat, quitar una guarda de autenticación y debilitar pruebas se marcan como **bloqueantes**. Son las dos cosas que un agente puede hacer para que su propio trabajo parezca terminado.

La tarjeta, el panel y cada hallazgo están en inglés, chino, español, francés y alemán.

## Dónde encaja en el método

Idea to Real recorre **Idea, Make, Run y Measure**. El bucle interno, [Read, Prove, Build](/blog/read-prove-build-the-inner-loop), te lleva de Idea a Make: entender lo que hay, demostrar la afirmación de forma barata y solo entonces invertir en construir. El bucle se cierra en Measure, que hace una sola pregunta: ¿funciona?

Una ejecución del agente es una construcción, y hasta ahora su Measure era la palabra del propio agente. Que las pruebas pasen demostraba que pasaban las pruebas que quedaban. Los cambios de la ejecución son el Measure de la ejecución: la prueba de que dejó las cosas **mejor**, no solo distintas. Se lee como se lee una prueba: dice qué comprobó, dice qué no pudo comprobar y muestra la evidencia de cada veredicto.

```bf-figure
{
  "kind": "compare",
  "title": "Measure, aplicado a una ejecución",
  "columns": [
    { "title": "Read", "hue": "read", "items": ["El código de antes de la ejecución, reducido a hechos", "Los mismos extractores en ambos lados"] },
    { "title": "Prove", "hue": "prove", "items": ["Un veredicto por dimensión, a partir de reglas, no de un modelo", "Sin medir cuando todavía no hay regla", "Las pruebas que el agente debilitó, nombradas como tales"] },
    { "title": "Build", "hue": "build", "items": ["Qué cambió la ejecución, y si fue una mejora", "Bloqueante en ejecuciones autónomas si se debilitaron guardas o pruebas"] }
  ],
  "caption": "Las tres preguntas que hacemos antes de construir nada, hechas a la ejecución que construyó."
}
```

## Qué puedes hacer con ello hoy

- **Saber qué hizo una ejecución sin leer su diff:** cuatro veredictos y un titular, al final de la ejecución que los produjo.
- **Pillar a un agente corrigiendo sus propios deberes:** las pruebas omitidas, borradas o relajadas aparecen en el titular.
- **Ver una guarda de autenticación perdida o un nuevo `import` de `child_process`** en cuanto termina la ejecución, no en una revisión posterior.
- **Ir de un veredicto a la línea de código** con Ver detalles y Abrir código.
- **Usarlo en un avión:** funciona sin conexión y sin iniciar sesión.

Lo siguiente: la misma tarjeta llega a las ejecuciones en la web y en el lienzo, junto con una vista de tendencia de los veredictos a lo largo de las ejecuciones de un proyecto.

---

**Lecturas relacionadas:** [La ejecución del agente «funcionó». Ahora puedes ver qué salió mal en ella](/blog/see-what-went-wrong-in-an-agent-run) · [Read, Prove, Build: el bucle interno](/blog/read-prove-build-the-inner-loop) · [Un agente, un núcleo](/blog/one-agent-one-kernel)

Ejecuta un agente en el chat de VS Code y lee la tarjeta del final antes de leer cualquier otra cosa.
