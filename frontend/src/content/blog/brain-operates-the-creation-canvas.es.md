Un asistente que solo puede describir el espacio de trabajo deja al usuario todos los cambios importantes. Un asistente con acceso sin restricciones al estado crea el problema contrario: nadie sabe qué cambió ni si cruzó algún límite.

Brain usa un tercer modelo. En Creation Canvas es un **operador acotado** con herramientas explícitas, contratos específicos por objeto y un búfer de propuestas revisable.

![Vista de producto de Brain operando sobre un marco seleccionado, con controles de alcance Canvas, Selección y Marco, y un panel de revisión que lista los cambios propuestos de objetos, campos, disposición, conexiones y acciones nativas antes de Aplicar](/blog/brain-canvas-operator-workspace.svg)

## El alcance es parte de la petición

El compositor puede dirigirse al lienzo completo, a la selección actual o a un marco. Brain recibe solo los objetos y las relaciones del alcance resuelto. Cada objeto aporta una vista de contexto segura en cuanto a contenido: su tipo, título, evidencia estructurada compatible, estado actual, acciones declaradas, campos modificables, disposición y metadatos de relaciones.

Eso hace que "evalúa esto" y "evalúa todo el plan de lanzamiento" sean peticiones materialmente distintas. El alcance es un estado visible, no una suposición extraída de la redacción de la conversación.

## Brain trabaja con herramientas explícitas del lienzo

Brain puede leer una instantánea; añadir, actualizar, eliminar, organizar, ocultar o bloquear un objeto; conectar objetos; actualizar o eliminar una conexión; e invocar las acciones que declara un tipo de objeto. Lee el registro antes de crear, de modo que un Gráfico, un Agente, una Hoja de ruta, un Sitio web y un Evermind exponen cada uno campos y acciones distintos.

Los campos de mutación desconocidos se rechazan. Las claves sensibles, como secretos, tokens, contraseñas, credenciales, valores de autorización, claves de API y cookies, se filtran tanto de las cargas de mutación como del contexto de la IA. Los límites de cadenas, arreglos, objetos y anidamiento mantienen el contexto acotado.

![Brain lee una instantánea acotada y el registro de objetos, pasa los campos creados por listas de permitidos y filtros de datos sensibles, y luego coloca los cambios de objetos, disposición, conexiones y acciones en un conjunto de propuestas seleccionable antes de que los cambios aprobados lleguen al estado del lienzo](/blog/brain-review-before-mutation.svg)

## La mutación es una propuesta, no un efecto secundario

Cuando Brain quiere crear una Evaluación, reorganizar una presentación, conectar un Dataset a un Gráfico o invocar una acción de un Workflow, registra un cambio propuesto. La interfaz puede mostrar el conjunto como operaciones concretas: añadir este objeto, actualizar estos campos, conectar estos ID, organizar este artefacto, invocar esta acción.

El usuario elige qué aplicar. Una respuesta con varios objetos sigue siendo, por tanto, inspeccionable con la misma granularidad que el propio lienzo.

Las acciones operativas reciben un límite adicional. La guía de inspección y edición puede devolverse de inmediato. Las ejecuciones, entregas, publicaciones, entrenamientos, integraciones y otras acciones de consecuencia se proponen para revisión. En una sesión local anónima, las acciones que requieren recursos duraderos abren la puerta de acceso a la cuenta sin modificar el lienzo.

## La capacidad nativa se queda con el objeto

Brain no simula cada función dentro de una respuesta de chat. Invoca las capacidades que declara el objeto seleccionado. Un Dataset puede perfilar o visualizar. Un Proyecto puede expandirse o compararse. Una Maqueta puede entregarse. Un Evermind puede entrenar, evaluar o publicar. Un Stand-up puede iniciarse.

Esto mantiene un único contrato entre el uso manual y el uso con IA. El botón del inspector y la acción de Brain se dirigen a la misma capacidad del objeto, a los mismos permisos y al mismo artefacto resultante.

## El resultado es una agencia legible

El objetivo no es la máxima autonomía. Es la **agencia legible**: Brain entiende el trabajo como objetos estructurados, puede operar sobre esos objetos y deja una superficie de revisión exacta entre la intención y el cambio.

Eso es lo que hace que el lienzo sea más que un chat con tarjetas alrededor. Brain puede participar en el trabajo sin volverlo opaco.

[Abrir Creation Canvas →](/create/new)
