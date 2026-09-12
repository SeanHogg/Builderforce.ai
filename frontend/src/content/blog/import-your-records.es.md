El informe para el consejo siempre ha sido honesto. La diapositiva de Personas se construye a partir de los eventos de plantilla; la de Inversión, a partir de las cifras trimestrales de I+D; la de Calidad, a partir de incidentes y tickets de soporte, y la de IA, a partir de la adopción de herramientas. Nada de eso se teclea en una plantilla: cada número es una consulta sobre una tabla.

Lo que plantea la pregunta obvia para los conjuntos de datos que ningún conector alimenta: **¿cómo llegan las filas a la tabla?**

Durante un tiempo, la respuesta honesta fue: de una en una, a través de un formulario de seguimiento. Una responsable de finanzas con tres trimestres de gasto en una hoja de cálculo tenía por delante cien envíos de formulario. La mayoría no lo hacía, las vistas seguían vacías, y una vista vacía se parece mucho a una función que no funciona.

Técnicamente, había una segunda vía. Existía un endpoint de importación, colgado de la API de Análisis, que solo usaban las herramientas de Brain. Y había una página `/import` —un asistente guiado y un cargador masivo— a la que nada enlazaba, que solo conocía un «registro» genérico con un nombre y una prioridad, y que terminaba cada envío esperando seiscientos milisegundos y mostrándote un número de referencia que se acababa de inventar. Un andamio disfrazado de funcionalidad.

## Qué es ahora la importación

Hay una única superficie de importación, y la página es una fachada real sobre ella.

```bf-figure
{
  "kind": "flow",
  "title": "Un archivo se convierte en filas que las vistas pueden leer",
  "steps": [
    { "label": "Elige un tipo", "note": "Eventos de plantilla, puestos vacantes, finanzas de I+D, incidentes, disponibilidad, adopción de IA: el registro del propio servidor, listado desde el servidor.", "hue": "measure" },
    { "label": "Asigna", "note": "Tus encabezados se emparejan por nombre con las columnas del tipo; si la suposición falla, la corrección está a un desplegable. Las columnas obligatorias llevan asterisco.", "hue": "measure" },
    { "label": "Comprueba", "note": "Cada celda se valida según el tipo de su columna, en tu idioma, y el servidor ejecuta el mismo archivo en modo de prueba y dice qué filas escribiría.", "hue": "measure" },
    { "label": "Envía", "note": "Las filas válidas se suben en lotes de quinientas. La barra avanza cuando el servidor confirma un lote, no con un temporizador.", "hue": "measure", "tag": "progreso real" }
  ],
  "caption": "Las columnas no se repiten en la página. Se leen del registro de la API, así que una columna añadida a un conjunto de datos llega al asignador, a la plantilla y al asistente sin un segundo registro."
}
```

Hay tres cosas que conviene decir claramente, porque cada una sustituye algo que antes se fingía.

**Las columnas vienen del servidor.** La página consulta `/api/import/kinds` y recibe todos los conjuntos de datos importables con sus columnas, sus tipos, si cada una es obligatoria y un valor de ejemplo realista. La plantilla CSV que descargas se genera a partir de esa lista, y el texto de ejemplo de cada campo del asistente es el ejemplo de esa columna. No hay ninguna copia del esquema en el cliente que pueda desviarse.

**La comprobación son dos comprobaciones.** Antes de escribir nada, el cliente valida cada celda asignada —un número que no es un número, una fecha que no es una fecha, una columna obligatoria vacía— y te indica la fila y la columna, en tu idioma. Después, las mismas filas van al servidor con `dryRun: true`, y el servidor responde con lo que *escribiría* y qué filas omitiría. La primera comprobación te dice qué celda; la segunda es la autoridad sobre lo que se va a guardar.

**El progreso es real.** Las filas se envían por lotes, y el contador muestra *enviadas de total* a medida que el servidor confirma cada uno. Si un lote falla a medias, la página lo dice, conserva lo que ya se escribió y muestra el total en lugar de fingir que no ha pasado nada.

```bf-figure
{
  "kind": "screen",
  "frame": "Importación masiva, en el paso de comprobación",
  "ratio": 1.5,
  "regions": [
    { "label": "Tipo", "note": "Un conjunto de datos, elegido del registro", "x": 4, "y": 6, "w": 92, "h": 10, "hue": "measure" },
    { "label": "Filas en el archivo · válidas · con errores · el servidor escribirá", "note": "Cuatro recuentos, dos fuentes", "x": 4, "y": 20, "w": 92, "h": 16, "hue": "accent" },
    { "label": "Fila 12 · effectiveOn · debe ser una fecha", "note": "La comprobación del cliente, por celda, traducida", "x": 4, "y": 40, "w": 60, "h": 34, "hue": "bad" },
    { "label": "Filas que el servidor omitiría", "note": "Las líneas de la propia prueba en seco", "x": 68, "y": 40, "w": 28, "h": 34, "hue": "muted" },
    { "label": "Atrás · Cancelar · Importar 188 filas", "x": 4, "y": 80, "w": 92, "h": 12, "hue": "accent" }
  ],
  "caption": "El botón Importar cuenta las filas que superaron la comprobación del cliente, y la prueba en seco del servidor se muestra al lado para que sepas en qué se convertirá ese recuento."
}
```

## La ruta guiada sigue existiendo

No todos los registros son un archivo. Un solo incidente, un puesto vacante, las cifras de herramientas de IA de este mes: el asistente los recoge de uno en uno, validando cada campo al salir de él y con un paso de revisión antes del envío. Lo que ha cambiado es el final: envía el registro por el mismo endpoint que usa la ruta masiva y te muestra la respuesta del servidor, escrito u omitido y por qué. El número de referencia inventado ha desaparecido, porque un recibo que te inventas no es un recibo.

## Dónde encaja en el método

Importar es una capacidad de **Medir**. El arco es Idea → Crear → Operar → Medir, y Medir es el acto que devuelve una respuesta evaluada a Idea: es donde se cierra el bucle. Una vista que lee de una tabla vacía no puede evaluar nada; solo puede aparentar que está a punto de hacerlo. Las vistas de Personas, I+D, Calidad e IA se diseñaron para ser honestas sobre lo que el espacio de trabajo está haciendo realmente, y lo único que se interponía entre ellas y la honestidad era el coste de meter en ellas un trimestre de datos.

```bf-figure
{
  "kind": "compare",
  "title": "El coste de una vista fiel",
  "columns": [
    { "title": "Antes", "hue": "muted", "items": ["Abrir el formulario de seguimiento", "Escribir una fila", "Enviar", "Repetir cien veces", "O dejar la vista vacía", "O pedir a Brain que llamara a un endpoint que la página no conocía"] },
    { "title": "Ahora", "hue": "measure", "items": ["Descargar la plantilla del tipo", "Rellenarla, o exportar desde donde ya estén los números", "Asignar, comprobar, enviar", "Ver cómo se redibuja la vista"] }
  ],
  "caption": "Importar vive como una pestaña de Análisis porque ahí es donde aparecen las filas importadas. Antes la página no tenía ninguna puerta; ahora la puerta está junto a la habitación."
}
```

## Qué puedes hacer con ello hoy

- **Carga un trimestre de finanzas de I+D, ingresos y asignación de FTE** a partir de tres archivos pequeños y consulta la vista de Inversión frente al plan.
- **Completa el histórico de eventos de plantilla y puestos vacantes** para que la cascada y la rotación de la diapositiva de Personas se basen en tu historia, no en el día en que te registraste.
- **Incorpora incidentes, tickets de soporte y muestras de disponibilidad** desde una exportación de la herramienta que los contenga, y deja que la vista de Calidad evalúe el trimestre.
- **Registra la adopción de herramientas de IA y el gasto del programa** mes a mes, y ve cómo la vista de IA calcula las horas ahorradas por dólar.
- **Pídeselo a Brain**: su herramienta `board_data.import` habla el mismo contrato, prueba en seco incluida.

Todas terminan igual: una vista que antes estaba vacía, mostrando un número real.

---

**Lecturas relacionadas:** [Evalúa la prueba y cierra el bucle](/blog/grade-the-proof-and-close-the-loop) · [La visión operativa de cada rol](/blog/every-role-operating-picture)

[Abre Importar](/import) y descarga una plantilla para ese conjunto de datos que llevas tiempo queriendo completar.
