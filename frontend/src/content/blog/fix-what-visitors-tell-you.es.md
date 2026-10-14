Ver una visita le dice qué salió mal. No le dice qué cambiar, cuánto vale el cambio ni si el cambio que publicó sirvió de algo.

Ahí es donde se detienen la mayoría de los datos de un sitio. Un mapa de calor con una mancha roja sobre el titular. Un embudo que cae en el paso dos. Cuarenta grabaciones de gente que abandona el mismo formulario. Todo cierto, y nada de ello una decisión. Alguien todavía tiene que convertirlo en un cambio, adivinar si importa, escribir el encargo, conseguir que se construya y luego — casi nunca — comprobar si el número se movió.

Insights ahora hace ese trabajo con usted. Su inicio ya no es un panel. Es una lista corta de correcciones.

## Las correcciones, ordenadas

Cada corrección parte de algo que los visitantes hicieron de verdad en su sitio: una parte de los visitantes haciendo clics de rabia sobre un elemento, un error que aparece en la mayoría de las visitas que caen en un paso, un titular que la gente pulsa como si fuera un enlace, el botón principal por debajo de donde la mayoría deja de desplazarse, móviles que convierten muy por debajo del escritorio, una versión que fue peor que la anterior. Esos hallazgos salen de reglas sobre sus propias grabaciones, no de la opinión de un modelo. La IA solo pone en palabras un hallazgo citado y redacta el cambio; una frase que no puede atar a la evidencia se descarta.

Cada corrección lleva un rango de impacto calculado con sus propios visitantes — las personas que se toparon con el problema frente a las que no. Cuando hay muy pocas visitas para decirlo, lo dice en lugar de inventar un número. La lista se ordena por impacto frente a esfuerzo, de modo que el cambio barato y probable queda por encima del caro y especulativo.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — Insights · Correcciones",
  "ratio": 1.5,
  "regions": [
    { "label": "Correcciones, ordenadas", "note": "Impacto frente a esfuerzo, la mayor primero", "x": 4, "y": 6, "w": 32, "h": 88, "hue": "measure" },
    { "label": "Antes", "note": "La página tal como es, numerada donde los visitantes tropiezan", "x": 39, "y": 6, "w": 28, "h": 56, "hue": "muted" },
    { "label": "Después", "note": "La misma página con el cambio renderizado", "x": 69, "y": 6, "w": 27, "h": 56, "hue": "make" },
    { "label": "Rango de impacto", "note": "De sus propios visitantes, o «muy pocas visitas para decirlo»", "x": 39, "y": 66, "w": 28, "h": 28, "hue": "accent" },
    { "label": "Corregir · Probar · Seguimiento · Ticket", "note": "Una acción, y luego un veredicto en la siguiente versión", "x": 69, "y": 66, "w": 27, "h": 28, "hue": "run" }
  ],
  "caption": "Las grabaciones, los mapas de calor y los embudos siguen ahí. Son la evidencia detrás de una corrección, a la que se llega desde ella, no el lugar donde se empieza."
}
```

## La página, como es y como sería

Además de lo que hicieron los visitantes, Insights revisa sus páginas clave en cada versión: páginas de entrada, pasos del embudo, páginas de prueba y sus rutas más visitadas. Cada una se captura a ancho de escritorio y de móvil y se revisa en lo básico de búsqueda, contenido, rendimiento y accesibilidad — una descripción que falta, más de un titular principal, una llamada a la acción vaga, ningún motivo para confiar en usted antes del pliegue, una imagen principal lenta, texto difícil de leer, zonas táctiles demasiado pequeñas. Sus datos de búsqueda se usan cuando los ha conectado, y nunca se inventan cuando no. La captura nunca rellena un formulario ni inicia sesión.

Un hallazgo que viene de mirar la captura de pantalla solo se muestra cuando apunta a un elemento real de la página y a un hecho medido sobre él, y se etiqueta como observado.

Luego se dibuja el cambio. No se describe — se renderiza, sobre su página, antes y después.

```bf-figure
{
  "kind": "compare",
  "title": "La misma página, antes y después del cambio",
  "columns": [
    { "title": "Como es", "hue": "muted", "items": ["① El titular parece un enlace, y la gente lo pulsa", "② El botón principal queda por debajo de donde la mayoría deja de desplazarse", "③ Ningún motivo para confiar en usted antes del pliegue", "④ Texto gris sobre fondo claro"] },
    { "title": "Como sería", "hue": "make", "items": ["① El titular es texto simple con una promesa clara", "② El botón sube, a la vista", "③ Una línea de prueba junto al botón", "④ Un contraste que cumple"] }
  ],
  "caption": "Los números de la izquierda corresponden a marcas sobre la página capturada. La derecha es esa página con el cambio aplicado, no una maqueta. Los cambios de búsqueda se muestran como el resultado que vería la gente."
}
```

## De un hallazgo a un veredicto

Una corrección que puede ver sigue siendo una corrección que nadie ha hecho. Por eso cada una trae una forma de hacerla — y ninguna llega a producción por sí sola.

- **Corregir.** En un sitio que aloja con nosotros, un agente de código hace el cambio y usted recibe una versión de vista previa. Una persona la publica.
- **Probar.** Ejecute el cambio como prueba A/B: los visitantes se reparten, cada uno ve siempre la misma versión, y la prueba se detiene según una regla que usted fija de antemano, no tras una tarde que pinta bien.
- **Seguimiento.** Cuando el problema le costó visitantes conocidos — alguien que dudó en los precios o abandonó el pago —, inscríbalos en una secuencia de seguimiento, con sus propias reglas comerciales.
- **Ticket.** Llévelo al tablero con la evidencia adjunta.
- **Dárselo a una IA.** Aplíquelo en el compositor del lienzo, o copie un prompt de mejora escrito para un agente de código o para el constructor de sitios que use.

```bf-figure
{
  "kind": "flow",
  "title": "Una corrección, de principio a fin",
  "steps": [
    { "label": "Hallazgo", "note": "Algo que hicieron los visitantes, o un hecho medido sobre la página. Citado, no adivinado.", "hue": "measure" },
    { "label": "Prescripción", "note": "El cambio, el motivo, un rango de impacto de sus propios visitantes y el cambio dibujado sobre la página.", "hue": "idea" },
    { "label": "Aplicar", "note": "Corregir, Probar, Seguimiento o Ticket — o aplicarlo en el compositor, dárselo a un agente de código o copiar el prompt.", "hue": "make", "tag": "decide una persona" },
    { "label": "Siguiente versión", "note": "Detectada sola. La página se vuelve a capturar y a puntuar.", "hue": "run" },
    { "label": "Veredicto", "note": "Funcionó, sin efecto o peor. Peor en una corrección publicada ofrece revertir.", "hue": "measure", "tag": "medido" }
  ],
  "caption": "El registro muestra cada versión con las correcciones que llevó y lo que hicieron. Una corrección sin veredicto sigue abierta."
}
```

El veredicto es la parte que la mayoría de herramientas deja fuera. Una corrección o un ticket se juzga por cómo se comportaron los visitantes en la ruta antes y después de la versión que la llevó. Una prueba se juzga por sus variantes. Un seguimiento se juzga por los inscritos frente a quienes encajaban y no se inscribieron. La respuesta es una de tres palabras — funcionó, sin efecto, peor —, y «peor» en un cambio que usted publicó viene con un camino de vuelta.

## Dónde encaja en el método

El método tiene un arco — **Idea → Hacer → Ejecutar → Medir → Alcance** — y un bucle interno de tres actos: **Leer, Probar, Construir**. [Vea por qué se van los visitantes](/blog/see-why-visitors-leave) puso las grabaciones en Medir, como la nota de una prueba. Las correcciones son la otra mitad: el puente de Medir de vuelta a Hacer.

- **Corregir es Hacer.** Es un Construir, acotado a un hallazgo citado, con una vista previa que publica una persona.
- **Probar es una prueba.** Una condición de corte, una muestra, una regla de parada — la misma forma que cualquier prueba de la [lista de la más barata primero](/blog/eight-ways-to-make-an-idea-real), ejecutada sobre la página que ya tiene.
- **El veredicto es Medir, otra vez.** La siguiente versión se califica por lo que hicieron los visitantes, no por si el cambio se publicó.
- **Un fallo es el siguiente Leer.** Cuando una prueba falla, el motivo que cita se convierte en un hallazgo propio, y usted vuelve a leer la idea con ese motivo en la mano.

```bf-figure
{
  "kind": "flow",
  "title": "De Medir de vuelta a Hacer, y otra vuelta",
  "steps": [
    { "label": "Medir", "note": "Las grabaciones, los mapas de calor y la revisión de página producen hallazgos citados.", "hue": "measure" },
    { "label": "Hacer", "note": "Corregir: un cambio, una versión de vista previa, una persona publica.", "hue": "make", "tag": "Construir" },
    { "label": "Probar", "note": "Probar: una prueba A/B con una regla de parada fijada antes de empezar.", "hue": "prove", "tag": "una prueba" },
    { "label": "Medir", "note": "La siguiente versión se detecta y se califica: funcionó, sin efecto, peor.", "hue": "measure", "tag": "veredicto" },
    { "label": "Leer", "note": "El motivo citado de una prueba fallida es lo siguiente contra lo que se lee la idea.", "hue": "read" }
  ],
  "caption": "Idea → Hacer → Ejecutar → Medir es el arco. Las correcciones son cómo Medir deja de ser un informe y empieza a ser el siguiente cambio."
}
```

[Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop) es el bucle interno. [Calificar la prueba](/blog/grade-the-proof-and-close-the-loop) es donde se anota el número. Esto es lo que hace con el número una vez anotado.

Instale Insights, ponga el snippet en su sitio o active la grabación para una app alojada, y las primeras correcciones llegan en cuanto hay visitas de las que leerlas.

---

**Lecturas relacionadas:** [Vea por qué se van los visitantes](/blog/see-why-visitors-leave) · [Calificar la prueba](/blog/grade-the-proof-and-close-the-loop) · [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop) · [Idea, Hacer, Ejecutar, Medir](/blog/idea-make-run-measure-menu-as-methodology)

[Abrir un lienzo](/create) y corregir lo primero que le dijeron sus visitantes.
