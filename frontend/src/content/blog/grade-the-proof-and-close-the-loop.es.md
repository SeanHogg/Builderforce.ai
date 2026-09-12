Pregúntale a un equipo qué entregó el último trimestre y te dará una lista. Pregúntale qué aprendió y te contará una historia, de memoria, según quién esté en la sala. La lista está escrita en algún sitio. El aprendizaje casi nunca.

Esa asimetría no es pereza. Es lo que pasa cuando una herramienta registra entregables y nada registra respuestas. Cualquier sistema de gestión de proyectos que exista puede decirte que algo se entregó. Muy pocos pueden decirte si funcionó, y casi ninguno puede decirte qué número acordaste de antemano que lo decidiría.

## Una prueba sin condición de parada es un lanzamiento con pasos de más

[De la idea a lo real](/blog/idea-to-real-the-operating-methodology) tiene tres actos —Leer, Demostrar, Crear— y el del medio es donde está la opinión. Leer una idea es barato. Construirla no. Elegir qué prueba merece la pena ejecutar es la decisión más trascendental del primer mes de cualquier proyecto, y existen [ocho formas de hacerla real](/blog/eight-ways-to-make-an-idea-real) precisamente para que esa elección sea una elección y no un valor por defecto.

```bf-figure
{
  "kind": "bars",
  "title": "Las ocho pruebas, según lo que cuesta ejecutarlas",
  "max": 5,
  "rows": [
    { "label": "Vídeo de demostración", "value": 1, "note": "una tarde", "hue": "prove" },
    { "label": "Prototipo navegable", "value": 2, "note": "días", "hue": "prove" },
    { "label": "Smoke test", "value": 2, "note": "días · publica una dirección", "hue": "prove" },
    { "label": "Mago de Oz", "value": 2, "note": "días · una persona detrás de la cortina", "hue": "prove" },
    { "label": "Línea telefónica", "value": 3, "note": "una semana · un número real al que la gente llama", "hue": "build" },
    { "label": "Prueba de concepto", "value": 3, "note": "una semana", "hue": "build" },
    { "label": "Piloto", "value": 4, "note": "semanas · usuarios reales, riesgos reales", "hue": "build" },
    { "label": "Sistema en producción", "value": 5, "note": "semanas de ingeniería real", "hue": "build" }
  ],
  "caption": "Todas las opciones se ofrecen siempre: esto es un consejo sobre qué ejecutar PRIMERO, no un filtro. Ocultar una la convertiría en un veredicto en lugar de en una recomendación."
}
```

Cada una de esas ocho lleva unos criterios de éxito que fijas *antes* de construir: 25 registros de 500 visitantes, una tasa de aciertos del 90 % en 20 pruebas, cuatro de cada cinco usuarios del piloto completando la tarea sin ayuda. Ese número es la condición de parada: el resultado que detendría el proyecto.

```bf-figure
{
  "kind": "flow",
  "title": "Dónde se fija el número y dónde se evalúa",
  "steps": [
    { "label": "Demostrar", "note": "Elige la prueba. Escribe los criterios: el número que te haría parar. No cuesta nada, no construye nada.", "hue": "prove", "tag": "fija la condición" },
    { "label": "Crear", "note": "Ejecuta la prueba. Un smoke test, una prueba de Mago de Oz, una línea telefónica, un piloto: lo que de verdad necesitaran los criterios.", "hue": "build", "tag": "gasta" },
    { "label": "Medir", "note": "Evalúala. Cumplida, no cumplida o abandonada, con el número que lo decidió y la fecha en que diste el veredicto.", "hue": "measure", "tag": "cierra el bucle" }
  ],
  "caption": "La condición y la evaluación están a propósito en extremos opuestos del bucle. Un criterio escrito después del resultado no es un criterio, es un pie de foto."
}
```

Hasta hace poco, Builderforce hacía bien los dos primeros y simplemente se olvidaba del tercero. Una realización registraba lo que se había construido —los archivos, los tickets, la URL en producción— y nada más. Las consolas que ejecutaban la prueba conocían la respuesta: la consola de demanda del smoke test contaba los registros y el banco de pruebas de la prueba de concepto juzgaba cada intento. Ambas calculaban un veredicto, lo mostraban en pantalla y lo tiraban a la basura al recargar.

Así que la plataforma podía decir *ejecutaste un smoke test*. Nunca podía decir *falló y construiste la cosa de todos modos*.

## Qué es un veredicto

Ahora una prueba registra tres cosas, y su forma importa más que el hecho de que existan.

- **El veredicto**: `met`, `missed` o `abandoned`. Tres valores, no dos. Una prueba que nadie terminó es un hecho distinto de una prueba que falló, y mezclarlas maquilla el historial: los equipos abandonan muchos más experimentos de los que suspenden, y solo uno de esos dos casos es evidencia sobre la idea.
- **La métrica que lo decidió**: leída directamente de la consola que la midió, nunca vuelta a teclear. Un número que una persona escribe a posteriori es un número que coincide con lo que ahora cree.
- **La fecha en que se decidió**: guardada aparte de la última vez que se tocó el registro, para que reconstruir la prueba el mes que viene no cambie en silencio cuándo tomaste la decisión.

Registrarlo es un solo botón, y solo aparece cuando la consola llega a un estado que permite decidir: el recuento supera el umbral o se han juzgado todos los intentos. Un botón de «registrar veredicto» disponible en cualquier momento es una invitación a evaluar una prueba que no ha terminado.

## Por qué este es el número con el que nos medimos

Toda plataforma tiene una métrica estrella. La mayoría miden actividad: proyectos creados, agentes ejecutados, tokens gastados. Esas cifras suben cuando se usa el producto, tanto si el usuario ha sacado algo de él como si no.

La nuestra es la proporción de ideas que llegan a una **prueba evaluada**: una construcción cuya condición de parada se midió de verdad, no solo un entregable que se produjo.

```bf-figure
{
  "kind": "compare",
  "title": "Dos formas de informar del mismo trimestre",
  "columns": [
    { "title": "Lo que cuenta la mayoría de las herramientas", "hue": "muted", "items": ["Proyectos creados", "Cosas desplegadas", "Tickets cerrados", "Horas de trabajo de agentes", "Todo lo cual sube cuando no se aprende nada"] },
    { "title": "Lo que cuenta el método", "hue": "measure", "items": ["Pruebas ejecutadas frente a criterios declarados", "Veredictos registrados con su número", "Ideas descartadas pronto, con evidencias", "Ideas que continúan, con evidencias", "Todo lo cual puede bajar cuando el producto se usa mal"] }
  ],
  "caption": "Una métrica que no puede bajar cuando las cosas van mal no es una métrica, es un marcador."
}
```

Es un número deliberadamente incómodo. Baja cuando la gente construye sin demostrar, que es exactamente cuando queremos verlo bajar.

## El bucle, en la práctica

Esto es lo que cambia en un lunes cualquiera.

Pegas un briefing. Vuelve como una especificación: qué tiene que hacer la cosa, qué capacidades nombra, qué límites fijó el propio briefing. Se ordenan ocho pruebas frente a ella, de la más barata a la más cara, y la recomendación explica *por qué* esta responde a la pregunta que el briefing plantea de verdad. Eliges una, escribes el número que te haría parar y la construyes. Se publica en una dirección que puedes enviar a alguien.

Dos semanas después, la consola dice 9 registros de 512 visitantes frente a un umbral de 25. Pulsas registrar. El veredicto es `missed`, la métrica se guarda a su lado y la fecha es la de hoy.

Y ahora viene lo útil: esa respuesta vuelve a Idea. No como la sensación de que «lo de la landing page no acabó de funcionar», sino como una fila que puedes poner en un tablero junto a la siguiente versión de la idea y junto a las otras cuatro cosas que probaste ese trimestre.

Una prueba sin ninguna condición que pueda fallar es un lanzamiento con pasos de más. Una prueba con una condición que nadie evalúa es un lanzamiento con papeleo de más. El tercer acto es lo que hace que los dos primeros merezcan la pena.

---

**Lecturas relacionadas:** [De la idea a lo real: la metodología operativa](/blog/idea-to-real-the-operating-methodology) · [Ocho formas de hacer real una idea](/blog/eight-ways-to-make-an-idea-real) · [Leer, Demostrar, Crear: el bucle interno](/blog/read-prove-build-the-inner-loop)

Empieza donde empieza el método: [abre un lienzo](/create) y pega esa idea sobre la que llevas tiempo discutiendo.
