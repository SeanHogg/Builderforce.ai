Dos vocabularios, cada uno correcto, uno junto al otro sin nada en medio.

Contratación era dueña del embudo: publicación, cribado, entrevista, oferta. Personas era dueña de la relación laboral: empleado, ciclo de vida, incorporación, evaluaciones. Ambos encabezados describían la transición entre ellos con las mismas palabras: *«una oferta que se convierte en empleado»*. Ninguno la ejecutaba. El producto traía dos embudos que se detenían a un palmo de distancia, y el hueco lo llenaba una persona copiando campos de una pantalla a otra.

## El traspaso y sus tres negativas

```bf-figure
{
  "kind": "flow",
  "title": "Oferta → empleado, en un solo paso",
  "steps": [
    { "label": "Oferta firmada", "note": "El detonante. No un verbal aceptado, no una oferta en borrador: una firmada.", "hue": "reach" },
    { "label": "Pasar los datos", "note": "Puesto, ubicación y modalidad desde la publicación; habilidades y evidencias desde el candidato; fecha de inicio desde la oferta. Nada inventado.", "hue": "run" },
    { "label": "Empleado + ciclo de vida", "note": "El registro laboral y el plan de incorporación, creados juntos y unidos a la oferta de la que provienen.", "hue": "measure" }
  ],
  "caption": "El traspaso no pertenece a NINGUNO de los dos vocabularios. Ponerlo en el del reclutador dejaría que contratación redactara registros de RR. HH.; ponerlo en el de RR. HH. dejaría que RR. HH. leyera los campos del reclutador. Se declara una sola vez, entre ambos."
}
```

Se niega en tres casos, y cada negativa es del tipo útil:

- **La oferta no está firmada.** Un registro laboral que parte de una oferta sin firmar es el registro de algo que no ocurrió.
- **No hay ninguna persona asociada.** Un empleado sin candidato detrás es donde nace un registro de persona duplicado.
- **No hay fecha de inicio.** Un ciclo de vida sin fecha de anclaje no tiene fechas de vencimiento, así que cada tarea de incorporación queda en silencio sin fecha.

Lanza un error en lugar de crear un par a medio rellenar, porque media contratación es peor que ninguna: lo descubres tres semanas después, cuando nómina pregunta quién es esta persona.

Junto a esto, cada currículum puntuado queda ahora asociado a un candidato real. Puntuar un documento que no pertenece a nadie produce un número sobre el que no puedes actuar, y un montón de ellos produce una lista corta que nadie puede armar.

## Lee el sistema de RR. HH. que ya usas

El catálogo podía publicar una requisición hacia fuera y leer una ejecución de nómina de vuelta, pero no tenía forma alguna de leer a **tu propia** gente. Así que los empleados, las asignaciones de rol, la capacidad y cada cifra de plantilla que muestran las vistas de entrega se escribían a mano, y «quién trabaja realmente aquí» vivía en un sistema al que este producto no llegaba.

```bf-figure
{
  "kind": "stack",
  "title": "Siete maneras de responder «quién trabaja aquí»",
  "bands": [
    { "label": "Workday", "note": "Trabajadores, organización, asignaciones.", "hue": "run" },
    { "label": "BambooHR · HiBob · Personio", "note": "Las tres del mercado medio, cada una con su propia idea de un registro laboral.", "hue": "run" },
    { "label": "SAP SuccessFactors", "note": "Para los entornos donde el sistema de RR. HH. es anterior al producto que lo describe.", "hue": "run" },
    { "label": "Greenhouse", "note": "El lado ATS: candidatos y pipelines, leídos junto a las personas en las que se convierten.", "hue": "reach" },
    { "label": "Directorio SCIM 2.0", "note": "El lector genérico, para todo lo que no está en esta lista.", "hue": "muted" }
  ],
  "caption": "Cada acción de la categoría es una LECTURA, y una prueba rompe la compilación si eso deja de ser cierto."
}
```

Esa última línea es la decisión de diseño, no un detalle de implementación. Un sistema de RR. HH. es el sistema de registro del empleo de las personas. Una herramienta que puede escribir en él es una herramienta que puede equivocarse sin hacer ruido con el salario, el puesto o la fecha de baja de alguien, y el alcance de eso es la vida de una persona, no un panel. El solo lectura se impone, se prueba y se declara donde cualquiera que integre pueda verlo.

## Qué cambia en una cifra de plantilla

```bf-figure
{
  "kind": "compare",
  "title": "De dónde sale una cifra de capacidad",
  "columns": [
    { "title": "Escrita", "hue": "bad", "items": ["Correcta el día en que se introdujo", "Incorrecta tras la primera baja", "Nadie sabe cuándo se revisó por última vez", "Así que nadie confía en el plan construido sobre ella"] },
    { "title": "Leída", "hue": "good", "items": ["Viene del sistema que es dueño del dato", "Se mueve cuando se mueve la organización", "Lleva consigo su procedencia", "Un plan construido sobre ella se puede discutir"] }
  ],
  "caption": "La misma regla que la antigüedad en una factura, o un porcentaje en una tabla de capitalización: un número que se puede escribir es un número que acabará discrepando de la realidad."
}
```

Ambas mitades pertenecen a la misma etapa del arco: Market es *vender, comprar, contratar, ser encontrado*, y Run es lo que ocurre cuando la persona ya está realmente en nómina. El traspaso es la costura entre ambas, y ahora es algo que el producto ejecuta en lugar de algo que describe.

---

**Lecturas relacionadas:** [La oficina de apoyo del fundador](/blog/the-founder-back-office-money-ownership-and-paperwork) · [Cómo construir un organigrama que se mantenga exacto](/blog/how-to-build-an-org-chart-that-stays-accurate) · [Scorecards estructurados y revisión ciega](/blog/structured-scorecards-and-blind-review-to-reduce-hiring-bias)

Consulta el [catálogo de integraciones](/integrations), o [abre un lienzo](/create) y pon el embudo junto al trabajo que está dotando de personal.
