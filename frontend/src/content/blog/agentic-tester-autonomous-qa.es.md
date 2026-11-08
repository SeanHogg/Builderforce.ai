La cobertura de pruebas se degrada en cuanto dejas de escribir tests, y nadie escribe tests para los flujos que los usuarios realmente machacan: los escriben para el código que era fácil de probar. La brecha entre «lo que probamos» y «lo que hacen los usuarios» es donde viven los bugs de producción.

El **Agentic Tester** es un agente de QA contratable, creado para cerrar esa brecha por sí solo. Apúntalo a la URL de tu app, guarda las credenciales que debe usar, y él deduce qué importa a partir del uso real, escribe las pruebas, las ejecuta en un navegador real y autenticado según un calendario, y registra lo que encuentra directamente en tu tablero.

> El Agentic Tester es un agente de QA autónomo: prioriza qué probar a partir de mapas de calor de uso real, genera especificaciones de Playwright, recorre un navegador real y autenticado por tus flujos más calientes según un calendario, y registra los bugs que encuentra en tu tablero para que un agente de corrección los recoja.

![Pipeline de izquierda a derecha: un mapa de calor de uso prioriza los flujos calientes, un LLM genera una especificación de Playwright, un navegador en contenedor inicia sesión y recorre el flujo en un cron nocturno, los hallazgos se registran como tareas priorizadas del tablero y un agente de corrección abre una pull request](/blog/agentic-tester-qa.svg)

## Prueba lo que los usuarios realmente hacen

La mayoría de las suites de pruebas son una suposición sobre lo que es importante. El Agentic Tester no supone: observa. Los eventos de recorrido capturados en tu app se ordenan en un **mapa de calor de uso** con las zonas de ruta y elemento con las que más interactúa la gente, ponderadas por recencia. Cuando planifica una exploración, toma primero de las zonas más calientes, dentro de un presupuesto que tú fijas. Los flujos que reciben más cobertura son aquellos en los que viven tus usuarios.

## Escribe sus propios tests de Playwright

A partir de un flujo, el generador produce con un LLM una **especificación de Playwright** ejecutable, resolviendo con qué credencial de persona debe iniciar sesión. También puedes dejar que construya un plan determinista directamente desde el mapa de calor, sin coste de modelo. En ambos casos, el resultado es código real de automatización del navegador —no un script frágil de grabar y reproducir— almacenado y versionado por proyecto.

## Inicia sesión y maneja un navegador real

La exploración se ejecuta en un arnés en contenedor. Reclama una exploración en cola, recibe el objetivo, el plan y los secretos de la persona, e **inicia sesión como un usuario real**: escribe las credenciales en tu formulario de acceso, sin saltarse la autenticación. Después recorre el plan: navega por rutas, hace clic, rellena campos, comprueba aserciones, mientras captura errores de consola, errores de página, peticiones de red fallidas, fallos de aserción y caídas. Las credenciales se almacenan cifradas por proyecto, y leer la contraseña de una persona es una acción auditada y restringida a desarrolladores.

Ejecútalo bajo demanda, o define un **calendario cron** para que barra tus flujos más calientes cada noche.

## Registra el bug, y un agente de corrección lo recoge

Aquí es donde deja de ser un ejecutor de pruebas y pasa a formar parte de la plantilla. Los hallazgos se deduplican por huella y se ordenan según el calor de la zona que los destapó. Con el enrutado automático activado, cualquier hallazgo igual o superior a tu umbral de gravedad se convierte en una **tarea del tablero**, con título y prioridad derivados del hallazgo, e informada con la ruta, el selector, el error y el detalle, y se coloca en un carril de corrección. Esa entrada en el carril dispara el **mismo disparador de ejecución automática que activaría una persona al arrastrar en el tablero**: un agente de corrección lee la tarea, arregla el código y abre una PR. Cuando la incidencia se cierra, el hallazgo se marca como resuelto.

El bucle funciona de principio a fin sin una persona en medio, pero cada paso está en el tablero, así que una persona puede intervenir en cualquier punto de control.

## Calidad que realmente puedes ver

Como los hallazgos (defectos escapados) y los fallos de CI (defectos detectados) llegan ambos a la plataforma, el Agentic Tester se integra en una **tendencia de calidad** real con atribución a modelo y agente, para que puedas ver si tu software se vuelve más o menos fiable con el tiempo, y no solo si pasó la ejecución de anoche.

[Recorre la plataforma →](/product) · [Ejecución de tareas y observabilidad →](/blog/task-execution-and-observability) · [Empieza a construir gratis →](/register)
