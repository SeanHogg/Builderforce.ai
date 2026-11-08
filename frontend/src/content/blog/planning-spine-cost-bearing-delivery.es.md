La estrategia vive en una presentación. La entrega vive en un tablero. El coste vive en una hoja de cálculo de finanzas. Tres herramientas, tres responsables y un ritual mensual en el que alguien las concilia a mano y todos discuten sobre qué número es el correcto.

La **Planning Spine** (columna vertebral de planificación) colapsa esas tres capas en una sola. Es una única jerarquía con fechas —**Portafolio → Iniciativa → Épica → Tarea**, con los **Objetivos y Resultados Clave** como capa de metas que se acopla a cualquier nivel— en la que cada nodo tiene una fecha de inicio, una fecha de fin y su propio coste acumulado. Planificas, entregas y contabilizas el mismo trabajo en el mismo lugar.

> La Planning Spine de Builderforce.ai es una única jerarquía con fechas y costes —portafolio, iniciativa, épica y tarea en un solo Gantt— donde el coste de cada hoja se acumula hacia todos sus ancestros y se divide en CAPEX y OPEX, de modo que finanzas y entrega leen de la misma fuente de verdad.

![Diagrama de la Planning Spine: una jerarquía anidada de portafolio a iniciativa, épica y tarea en un solo Gantt, donde el coste de cada tarea hoja se acumula hacia todos sus ancestros, cada nodo se clasifica como CAPEX u OPEX mediante un resolutor con orden de prioridad, con señales de anomalía cuando un hijo contradice a su padre y exportación a CSV para el cierre financiero](/blog/planning-spine.svg)

## El coste es una propiedad del trabajo, no un libro contable aparte

Como cada tarea en Builderforce.ai ya está instrumentada —el gasto en LLM se valora en el momento de escribirlo a partir del registro de uso, y el esfuerzo humano a partir de la tarifa de coste de cada miembro—, la Planning Spine no necesita un sistema financiero paralelo. El coste de las hojas simplemente **se acumula** hacia todos sus ancestros: el coste de una tarea fluye a su épica, el de la épica a su iniciativa, el de la iniciativa a su portafolio. Obtienes una cifra real a cualquier altura, sin necesidad de rellenar datos a posteriori.

Y cada dólar está clasificado. Cada nodo lleva un `cost_class` de **CAPEX** u **OPEX**, resuelto por orden de prioridad: gana una declaración explícita; si no, se hereda del padre; si no, un clasificador de agente propone una a partir de la categoría de inversión del trabajo (la innovación se capitaliza como CAPEX; el mantenimiento, el soporte y la deuda técnica se contabilizan como OPEX), con un valor por defecto conservador según GAAP como suelo. Cuando la clase declarada de un hijo contradice la de su padre, la spine lo marca como una **anomalía** para que un PM la concilie: las decisiones de capitalización reciben aprobación en lugar de heredarse en silencio.

## Un solo Gantt, todos los niveles

La Planning Spine se muestra como una única línea de tiempo anidada y plegable. Una barra de portafolio contiene sus iniciativas; una iniciativa contiene sus épicas; una épica contiene sus tareas, todo con fechas, todo sobre el mismo eje, con colores según la clase de coste y marcadores de anomalía donde la capitalización necesita revisión. Las **dependencias** a nivel de iniciativa (bloqueante → bloqueada, con comprobación de ciclos) alimentan una **ruta crítica** bajo demanda, de modo que la cadena incompleta más larga siempre está a la vista.

Cuando finanzas necesita las cifras fuera de la aplicación, toda la spine se exporta a CSV para cualquier rango de fechas: las mismas cifras que muestra el panel, listas para el cierre.

## Por qué importa

Una plantilla de IA cambia el comportamiento del coste de la noche a la mañana. Cuando los agentes construyen, el gasto deja de parecerse a la plantilla de personal y empieza a parecerse al consumo: a ráfagas, por tarea, atribuible. Un tablero que sigue el estado pero no el coste no puede responder la pregunta que todo CFO está a punto de hacer: *¿cuánto costó realmente esta iniciativa y cuánto de ello podemos capitalizar?*

La Planning Spine lo responde con datos en vivo. Ingeniería planifica sobre ella, la PMO consolida los portafolios sobre ella y finanzas cierra los libros desde ella: una jerarquía, un solo conjunto de números, sin paso de conciliación.

[Recorre la plataforma →](/product) · [Mira la visión operativa de cada rol →](/blog/every-role-operating-picture) · [Empieza a construir gratis →](/register)
