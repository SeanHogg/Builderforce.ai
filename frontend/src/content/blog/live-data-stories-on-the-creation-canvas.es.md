El análisis suele fracturarse justo en el momento en que se vuelve útil. Los datos viven en una hoja de cálculo, el gráfico en un notebook, la decisión en un documento y la versión para dirección en unas diapositivas. Cada copia debilita el vínculo con la evidencia.

Creation Canvas trata la historia completa de los datos como un conjunto conectado de objetos vivos.

![Vista de producto de un lienzo de Data Story en vivo con una tabla de Dataset de origen conectada a un Chart y un KPI, ensamblados en un Dashboard y un Report, y presentados mediante Slides con aristas visibles de datos, referencia y presentación](/blog/live-data-stories-workspace.svg)

## Empieza con evidencia, no con una captura de pantalla

Un objeto Dataset puede importar contenido CSV o TSV en campos estructurados acotados. El lienzo registra las columnas, el número de filas y una muestra segura para inspeccionar y para el contexto de Brain, en lugar de volcar una tabla ilimitada en cada solicitud de razonamiento.

Perfila el Dataset para entender su forma y su cobertura. Visualízalo para crear un Chart conectado al origen. Para el análisis manual, los objetos Table y Spreadsheet guardan filas, columnas y fórmulas estructuradas. Son artefactos distintos con fines distintos, no una «tarjeta de datos» genérica.

## Construye la capa de decisión

Los objetos Chart guardan el tipo de gráfico, las etiquetas, los valores y las fuentes. Los objetos KPI llevan valor, objetivo, unidad, tendencia y referencias a sus fuentes. Un Dashboard puede ensamblar material de KPI y gráficos en una vista operativa; las acciones de actualizar y profundizar siguen siendo nativas del objeto.

Los Reports y las Evaluations añaden interpretación. Un Report puede combinar Markdown, datos de gráficos y citas. Una Evaluation registra un veredicto, carencias, recomendaciones y fuentes. Brain puede trabajar sobre la evidencia y los objetos analíticos seleccionados sin confundir su posición visual con una dependencia de datos.

![Los objetos Dataset, Table y Spreadsheet forman la capa de evidencia; los objetos Chart y KPI forman la capa visual; Dashboard, Report y Evaluation forman la capa de decisión; Slides presenta la narrativa mientras las conexiones tipadas de datos, referencia y presentación preservan la procedencia](/blog/data-story-object-pipeline.svg)

## Las relaciones tienen significado

Una línea en el lienzo no es mera decoración. Usa una conexión de **datos** cuando un objeto aporta valores a otro, una conexión de **referencia** cuando una conclusión cita evidencia, y una conexión de **presentación** cuando un Dashboard o un Report respalda unas Slides.

Ese grafo semántico permite a Brain distinguir «este gráfico usa el dataset» de «esta diapositiva menciona el informe». También hace que la historia visual pueda ser revisada por alguien que no la construyó.

## Empieza desde un paquete completo

La plantilla **Data story** incluida coloca en el lienzo un Dataset de origen, un Chart de tendencia clave, un Dashboard de decisión y un objeto Slides de historia de datos para dirección, con relaciones iniciales útiles. Es un andamio, no un flujo sellado. Añade una Spreadsheet para los cálculos, KPIs para los objetivos, una Evaluation para las carencias o contexto de Project para el rendimiento de entrega.

## Mantén conectada la salida para dirección

Cuando la narrativa cambia, la evidencia debe seguir siendo inspeccionable. Un objeto Slides en el lienzo puede conservar sus fuentes en lugar de convertirse en la copia terminal de una presentación desconectada. Quien revise puede pasar de una afirmación al Report, al Dashboard, al Chart y, en última instancia, al Dataset que la respalda.

Esta es la diferencia entre decorar una conclusión con gráficos y construir una historia de datos digna de confianza:

**filas → perfil → evidencia visual → vista de decisión → interpretación escrita → presentación**

Cada etapa sigue siendo un objeto. Cada dependencia importante puede seguir siendo una arista tipada.

[Construye una historia de datos →](/create/new)
