Lo más caro del paso de diseño a código muchas veces no es la implementación. Es reconstruir el contexto: qué concepto se aprobó, qué componente lo implementa, qué diagnóstico importa y si la vista previa local refleja la rama actual.

Creation Canvas puede mantener esa cadena como artefactos conectados, en lugar de un rastro de enlaces repartidos entre herramientas.

![Vista de producto de una Session de diseño a depuración con artefactos Website y WYSIWYG móvil conectados a objetos Repository, Editor selection, Diagnostics, Terminal output, Local service y Browser preview](/blog/design-build-debug-workspace.svg)

## Los artefactos de diseño siguen siendo editables

Un objeto Website representa el concepto de un sitio de varias páginas con titular, cuerpo, llamada a la acción, color de acento, viewport y páginas. Un WYSIWYG Prototype ofrece un concepto interactivo para trabajo de producto más específico. Los objetos Mockup y Mockup Set respaldan conceptos de funciones revisables individualmente y su entrega.

Estos objetos se pueden revisar directamente o ser creados por Brain a través de sus campos mutables declarados. La vista previa sigue siendo una acción nativa del objeto, no una captura de pantalla pegada en la conversación.

## El contexto de desarrollo llega desde VS Code

La superficie nativa de BuilderForce en VS Code puede añadir a la misma Session respaldada por servidor un Repository, la selección actual del Editor, Diagnostics, Terminal output, un Local service, un Code workspace y un Browser preview.

Cada objeto lleva el contexto propio de su tipo: URL y rama del repositorio; código seleccionado, lenguaje, ruta y rango; elementos de diagnóstico y gravedad; contenido de la terminal y código de salida; o la URL y el puerto de un servicio local. Los artefactos de terminal se marcan explícitamente para revisión de secretos, y las claves de contexto sensibles quedan excluidas del adaptador seguro de objetos de Brain.

![Website, WYSIWYG Prototype y Mockup forman la capa de diseño; Repository, Selection y Code forman el contexto de implementación; Diagnostics y Terminal aportan la evidencia de los fallos; Local service alimenta Browser preview; el resultado aprobado puede convertirse en una Task de Project gobernada](/blog/design-to-debug-object-graph.svg)

## Conecta el fallo con lo que afecta

Las relaciones tipadas hacen útil un lienzo de depuración. Una Selection puede **referenciar** un Prototype. Diagnostics puede **referenciar** la Selection. Un Local service puede **controlar** un Browser preview. La vista previa puede **presentar** el Website actual. Un Mockup aprobado puede conectarse por **entrega** a una Task.

Brain puede entonces responder una pregunta acotada como «¿Esta implementación cumple el concepto móvil seleccionado y qué bloquea la vista previa?» usando los objetos relevantes, en lugar de todo el repositorio o una transcripción aplanada.

## Revisa antes de cambiar el espacio de trabajo

Si Brain propone un artefacto de código, actualiza un criterio de aceptación, reorganiza el marco o añade una relación, esos cambios aparecen como un conjunto de propuestas. Las acciones operativas nativas conservan sus propios permisos. Un lienzo local anónimo puede esbozar el panorama completo de la implementación, pero la entrega duradera y la asignación esperan a un espacio de trabajo respaldado por una cuenta.

## Un traspaso, todavía una sola sesión

Producto y diseño pueden contribuir desde el navegador. Ingeniería puede contribuir desde el editor. Ninguna de las dos superficies queda reducida a una vista incrustada de la otra. El grafo de objetos compartido se convierte en el contrato del traspaso:

**intención aprobada → contexto de implementación → evidencia de diagnóstico → servicio en ejecución → resultado en el navegador → entrega gobernada**

Cuando el artefacto, el código y el fallo viven juntos, «¿qué intentábamos construir?» deja de ser una tarea recurrente de depuración.

[Empieza una sesión de diseño a código →](/create/new)
