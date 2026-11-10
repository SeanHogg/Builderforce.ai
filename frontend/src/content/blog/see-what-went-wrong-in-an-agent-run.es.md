Le pides al agente del editor unas cuantas visualizaciones más. Trece minutos y medio después ha hecho trece cambios, el contador de tokens ha pasado de los tres millones y algo en el último archivo que tocó ya no compila. Lo detienes.

Luego intentas averiguar qué pasó, y no puedes. La ejecución no falló, así que no hay ningún error que leer. El modelo respondió en cada turno, así que nada agotó el tiempo. El informe de diagnóstico lo revisó todo y devolvió una sola palabra: **Inconcluso**.

Esa ejecución es real. Después reprodujimos a mano su traza registrada, y todos los problemas estaban ahí: 21 turnos de lectura antes del primer cambio, 13 turnos que hicieron cada uno exactamente una edición mientras reenviaban unos cien mil tokens de conversación, ni una sola comprobación de tipos ni prueba, y una edición que cerró un objeto una llave antes de tiempo. Todo había quedado registrado, y nada lo había señalado.

## El panel Agent runs

El Visualizer de VS Code tiene ahora un panel **Agent runs**. Muestra tus ejecuciones recientes del agente del editor para el proyecto que estás viendo. Elige una, y lee la ejecución registrada y te dice qué salió mal en ella.

```bf-figure
{
  "kind": "screen",
  "frame": "Visualizer · Agent runs",
  "ratio": 1.62,
  "regions": [
    { "label": "Ejecuciones recientes", "note": "Cada una con sus modelos, su número de turnos y sus hallazgos por gravedad", "x": 3, "y": 6, "w": 24, "h": 88, "hue": "idea" },
    { "label": "Franja de turnos", "note": "Una barra por turno: lectura, escritura, forzado o fallido. La altura son los tokens de prompt", "x": 30, "y": 6, "w": 67, "h": 22, "hue": "run" },
    { "label": "Hallazgos", "note": "Qué salió mal, lo peor primero, cada uno con su turno, su herramienta y su archivo", "x": 30, "y": 32, "w": 42, "h": 62, "hue": "measure" },
    { "label": "Archivos tocados", "note": "Escritos o comprobados, a un clic del mapa de conocimiento", "x": 75, "y": 32, "w": 22, "h": 62, "hue": "make" }
  ],
  "caption": "La ejecución que antes decía Inconcluso: un largo tramo plano de turnos de lectura, luego una fila de finos turnos de una sola escritura, cada uno alto por los tokens de prompt, y ninguna comprobación en toda la franja."
}
```

No resume con un modelo. Cada hallazgo sale de una comprobación fija sobre los turnos registrados, así que la misma ejecución da siempre los mismos hallazgos, y cada uno te muestra de dónde viene.

- **Análisis que nunca terminaba:** muchos turnos de solo lectura antes del primer cambio, y si el presupuesto del plan tuvo que forzar el traspaso.
- **Preparado, pero sin actuar:** el agente dijo que estaba listo y siguió leyendo.
- **Una escritura por turno:** una serie de turnos que hicieron un único cambio cada uno, con los tokens de prompt que costaron entre todos.
- **Prompt inflado:** cuánto prompt envió la ejecución por cada token que devolvió escrito, y cuánto costó cada cambio.
- **Escrito, nunca comprobado:** archivos modificados sin ninguna llamada posterior a comprobación de tipos, pruebas, lint o diagnósticos.
- **Llaves desequilibradas:** una edición cuyo texto nuevo abría o cerraba más llaves, corchetes o paréntesis que el texto al que sustituía.
- **Rotación:** el mismo archivo reescrito una y otra vez.
- **Registrado y luego hecho en línea:** tickets creados durante la ejecución, nunca asignados a nadie, y después construidos por la propia sesión.
- **Turnos lentos y sobredimensionados:** turnos de más de un minuto y llamadas a herramientas con kilobytes de argumentos repetidos.
- **Detenido sin verificar:** la ejecución terminó con tu Stop y con cambios sin comprobar todavía pendientes.

En la ejecución anterior, el panel señala 13 hallazgos. Nada vuelve como Inconcluso.

```bf-figure
{
  "kind": "compare",
  "title": "La misma ejecución, leída de dos maneras",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["13 min 38 s, 3,06 M tokens de prompt", "Detenida a mano", "Informe: Inconcluso", "Abre la traza y cuenta los turnos tú mismo"] },
    { "title": "En el panel Agent runs", "hue": "measure", "items": ["21 turnos de lectura antes de la primera escritura; el presupuesto del plan forzó el traspaso", "13 turnos de una sola escritura y el prompt que reenviaron", "Todos los archivos escritos, ninguno comprobado", "labels.ts: una llave cerrada antes de tiempo, en el turno y la edición que la causaron", "Detenida con cambios sin verificar", "13 hallazgos en total, cada uno con su evidencia"] }
  ],
  "caption": "No se registró nada nuevo. Cada hallazgo ya estaba en la traza; el panel es lo que la lee."
}
```

## El agente también lo detecta en el mismo turno

Un panel que explica una mala ejecución a posteriori es útil. Es mejor si la ejecución no se tuerce. Por eso el agente del editor recibe ahora dos señales en cada edición:

```bf-figure
{
  "kind": "flow",
  "title": "Lo que devuelve ahora una edición",
  "steps": [
    { "label": "Edición", "note": "El agente cambia un archivo.", "hue": "make" },
    { "label": "Diagnósticos", "note": "Los errores del servidor de lenguaje para ese archivo vuelven en el propio resultado de la edición, junto a cualquier otra nota de ese resultado.", "hue": "run" },
    { "label": "Equilibrio", "note": "Si el cambio abrió o cerró más paréntesis o llaves de los que sustituyó, el resultado lo dice, aunque no haya ningún comprobador configurado.", "hue": "run" },
    { "label": "Siguiente turno", "note": "El agente arregla el archivo que acaba de romper en lugar de seguir construyendo encima.", "hue": "measure", "tag": "misma ejecución" }
  ],
  "caption": "La llave que rompió labels.ts se informaría ahora en la edición que la rompió, en lugar de que una persona la encontrara al final de la ejecución."
}
```

## Qué puedes hacer con ello hoy

- **Abre cualquier ejecución reciente del agente del editor** y ve, en segundos, en qué se fueron su tiempo y sus tokens.
- **Señala el turno, la herramienta y el archivo** detrás de cada problema en lugar de describirlo de memoria.
- **Ve qué archivos cambió una ejecución sin comprobarlos nunca**, y salta desde cualquiera de ellos al mapa de conocimiento.
- **Deja que el agente detecte sus propias ediciones rotas**: los errores del servidor de lenguaje y un aviso de llaves vuelven en la propia edición.

## Dónde encaja en el método

Idea to Real recorre Idea, Make, Run y Measure, y el bucle interno es [Read, Prove, Build](/blog/read-prove-build-the-inner-loop): entender lo que hay, demostrar la afirmación de forma barata y solo entonces invertir en construir. Eso le pedimos al trabajo, y el agente que hace el trabajo debería cumplir el mismo estándar.

Una ejecución de agente es una construcción, y hasta ahora no tenía Measure. Podías ver que había terminado o que la habías detenido, pero no si leyó demasiado tiempo, si escribió sin comprobar o si rompió algo por el camino. El panel Agent runs es el Measure del agente, y las comprobaciones que ejecuta son pruebas sobre la ejecución registrada. Un hallazgo dice qué pasó, en qué turno y en qué archivo. Los diagnósticos en el momento de la edición y el aviso de llaves llevan parte de esa prueba al interior de la ejecución, al paso que de otro modo habría fallado en silencio.

```bf-figure
{
  "kind": "compare",
  "title": "Measure, aplicado al agente",
  "columns": [
    { "title": "Read", "hue": "idea", "items": ["Cuántos turnos se dedicaron a leer", "Si se sostuvo la preparación que afirmó tener"] },
    { "title": "Prove", "hue": "measure", "items": ["Cada archivo escrito tiene una comprobación después, o un hallazgo", "Cada edición mantiene equilibradas sus llaves, o lo dice en el acto"] },
    { "title": "Build", "hue": "make", "items": ["Cuánto costó cada cambio en tokens de prompt", "Si los tickets registrados se traspasaron o se hicieron en línea"] }
  ],
  "caption": "Las mismas tres preguntas que hacemos antes de construir cualquier cosa, planteadas a la ejecución que hizo la construcción."
}
```

---

**Lecturas relacionadas:** [Read, Prove, Build: el bucle interno](/blog/read-prove-build-the-inner-loop) · [Un agente, un núcleo](/blog/one-agent-one-kernel) · [Empaqueta el conocimiento que tu revisión demostró](/blog/portable-knowledge-packs)

Abre el Visualizer en VS Code, abre **Agent runs** y elige la última ejecución que no salió como esperabas.
