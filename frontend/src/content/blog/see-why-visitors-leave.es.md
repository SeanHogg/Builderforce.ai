Un panel puede decirle que la gente se fue. No puede decirle por qué. Tasa de rebote, tiempo en página, un embudo que cae entre el paso dos y el tres — eso son recuentos. Callan sobre el encabezado que parecía un enlace, el botón que no disparó, el formulario que se comió el primer intento, el momento en que alguien hizo clic con rabia y cerró la pestaña.

Ese silencio es caro. Los equipos discuten de memoria sobre una visita que nadie vio. Envían un arreglo para lo equivocado. Califican una prueba con un número que nunca preguntó si la muestra se alcanzó de verdad, o si quienes no convirtieron vieron una página rota.

La repetición de sesión cierra ese hueco. Usted ve la visita como la vio el visitante.

## La visita, en la página que vieron

Insights ahora tiene una lectura de Visitors que reproduce la sesión: la página, el cursor, el clic que no fue a ningún lado. Una visita lleva la etiqueta de la versión en la que corrió. Clics de rabia, clics muertos, errores y la conversión (o el fallo) están en la línea de tiempo para que pueda saltar a ellos, no buscarlos.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — Visitors",
  "ratio": 1.5,
  "regions": [
    { "label": "Grabaciones", "note": "Una visita, etiquetada con la versión en la que corrió", "x": 4, "y": 6, "w": 36, "h": 88, "hue": "measure" },
    { "label": "La página que vieron", "note": "La repetición reproduce la Sala, el formulario, el clic que no fue a ningún lado", "x": 42, "y": 6, "w": 54, "h": 58, "hue": "accent" },
    { "label": "Momentos", "note": "Clic de rabia · clic muerto · error · conversión", "x": 42, "y": 68, "w": 54, "h": 26, "hue": "run" }
  ],
  "caption": "La grabación es la visita. Los recuentos están al lado para que encuentre el momento y luego lo vea."
}
```

Las entradas siguen enmascaradas. Las claves de API siguen bloqueadas. Una visita con sesión en builderforce.ai y la anónima que la precedió son la misma grabación.

## De una grabación al siguiente cambio

Ver no es el punto. El punto es lo que hace con el momento.

```bf-figure
{
  "kind": "flow",
  "title": "De un sitio en vivo al siguiente ticket",
  "steps": [
    { "label": "Ejecutar", "note": "La app alojada o el snippet en su propio origen graba la visita.", "hue": "run" },
    { "label": "Grabar", "note": "Los fragmentos llegan en segundos. La frustración, los errores y las conversiones se marcan mientras ocurren.", "hue": "measure" },
    { "label": "Ver", "note": "Abra la grabación. Salte al clic de rabia. Vea la página que realmente vieron.", "hue": "measure", "tag": "la visita" },
    { "label": "Ticket", "note": "Un momento se vuelve una tarea, con la grabación unida, para que el arreglo sea para ese clic.", "hue": "idea" },
    { "label": "Hacer", "note": "La siguiente versión lleva el cambio. Los mapas de calor y las grabaciones de esa versión le dicen si funcionó.", "hue": "make" }
  ],
  "caption": "El bucle es el producto. Una grabación que no se vuelve ticket es un vídeo que vio una vez."
}
```

## Una versión contra la siguiente

Un mapa de calor sin versión es un promedio de cada página que haya enviado. Así es como un encabezado roto de la semana pasada se esconde dentro de un mapa de clics que parece sano.

```bf-figure
{
  "kind": "compare",
  "title": "La misma página, dos versiones",
  "columns": [
    { "title": "Esta versión", "hue": "muted", "items": ["Rabia en el encabezado que parece un enlace", "Clics muertos en un botón que nunca disparó", "Desplazamiento que nunca llegó al formulario"] },
    { "title": "La siguiente versión", "hue": "measure", "items": ["El encabezado es un encabezado", "El botón envía", "El formulario está a la vista — y la gente lo usa"] }
  ],
  "caption": "Compare mapas de calor por versión, no por URL. La URL no cambió. La página sí."
}
```

## Dónde encaja en el método

**Medir** es donde se califica la condición de corte de una prueba. La repetición es lo que la califica: una muestra que se alcanzó de verdad, un evento de éxito que los visitantes dispararon de verdad, y grabaciones de los visitantes que no convirtieron.

Esa evidencia vuelve a **Idea** — leer de nuevo con lo aprendido — y sigue a **Hacer**: un ticket desde el momento, cuyo efecto mide en la siguiente versión.

[Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop) es el bucle interno. [Calificar la prueba](/blog/grade-the-proof-and-close-the-loop) es donde se anota el número. La repetición es cómo ese número deja de ser un panel y empieza a ser una visita que puede ver.

```bf-figure
{
  "kind": "flow",
  "title": "El bucle, calificado por la visita",
  "steps": [
    { "label": "Probar", "note": "Una condición de corte, un tamaño de muestra, un evento de éxito. Barato a propósito.", "hue": "idea" },
    { "label": "Construir", "note": "Lo más pequeño que se puede alcanzar.", "hue": "make" },
    { "label": "Ejecutar", "note": "Un origen en vivo, un token de versión, un snippet o una app alojada.", "hue": "run" },
    { "label": "Medir", "note": "La repetición califica la prueba: muestra alcanzada, evento disparado, grabaciones de quienes no convirtieron.", "hue": "measure", "tag": "calificado por la repetición" },
    { "label": "Idea", "note": "Leer de nuevo con lo que mostraron las visitas. El siguiente Hacer empieza en un momento, no en una conjetura.", "hue": "idea" }
  ],
  "caption": "Idea → Hacer → Ejecutar → Medir es el arco. La repetición es la nota en Medir, no un producto aparte al lado."
}
```

Instale Insights, ponga un snippet en su sitio, o active la grabación en una app alojada. La primera visita llega en segundos. El método mismo es [el menú](/blog/idea-make-run-measure-menu-as-methodology).

---

**Lecturas relacionadas:** [Calificar la prueba](/blog/grade-the-proof-and-close-the-loop) · [Leer, Probar, Construir](/blog/read-prove-build-the-inner-loop) · [Idea, Hacer, Ejecutar, Medir](/blog/idea-make-run-measure-menu-as-methodology)

[Abrir un lienzo](/create) y ver la siguiente visita.
