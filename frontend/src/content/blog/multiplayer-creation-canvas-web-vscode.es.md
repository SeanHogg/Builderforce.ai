El trabajo multifuncional suele romperse en fragmentos con forma de herramienta. El contexto de producto vive en un ticket. La evidencia de clientes vive en un panel. El prototipo vive en una herramienta de diseño. El contexto de implementación vive en VS Code. Y la conversación sobre los cuatro vive en otro sitio.

Las Creation Sessions de Builderforce dan a esos artefactos un hogar espacial compartido sin obligar a cada colaborador a usar el mismo editor.

![Una Creation Session compartida de alta fidelidad que conecta un lienzo visual en el navegador y un editor de código nativo mediante un prototipo, objetos compartidos, comentarios, cursores, presencia y contexto de implementación](/blog/multiplayer-canvas-hero.webp)

## Una sesión de servidor, dos superficies nativas

En la web, Creation Canvas es el espacio de trabajo visual por defecto para chat, flujos de trabajo, sitios web, datos, modelos, personas, agentes y proyectos opcionales. En la extensión de BuilderForce para VS Code, la misma sesión se abre en una pestaña completa del editor: no en un iframe ni en una barra lateral estrecha.

Ambas superficies usan el mismo grafo de sesión, las mismas identidades de objeto, permisos, contrato de comandos con revisiones, presencia y comentarios. La línea de tiempo completa de actividad y los inspectores especializados siguen disponibles en el navegador. Un usuario web y un usuario del editor son colaboradores de una misma sesión, no usuarios de copias sincronizadas.

La superficie nativa de VS Code puede añadir contexto de desarrollo sin salir del editor:

- archivos o selecciones actuales;
- contexto del repositorio y de la rama;
- diagnósticos y Problems;
- salida de terminal pegada con una advertencia sobre secretos;
- servicios locales y vistas previas en el navegador;
- cualquier tipo de objeto compartido del Canvas desde la paleta nativa.

Un product manager puede conectar evidencia de clientes y una maqueta en la web mientras un desarrollador conecta el diagnóstico fallido, la selección de código relevante y la vista previa local desde VS Code.

![El Creation Canvas web aporta evidencia de clientes, prototipos, lentes de proyecto, actividad e inspectores, mientras la pestaña nativa de VS Code aporta archivos, contexto del repositorio, diagnósticos, salida de terminal, servicios locales y vistas previas; ambos usan un grafo de sesión con identidades de objeto, permisos, presencia, comentarios, actividad y comandos con revisiones compartidos](/blog/multiplayer-canvas-shared-session.svg)

## Colaboración sin peleas por el viewport

Cada miembro tiene su propio viewport personal. Mover o ampliar tu lienzo no mueve el de nadie más. En el navegador, la presencia muestra cursores, selecciones, el estado de escritura y la superficie de cliente que se está usando. El panel de VS Code informa de su selección actual a través del mismo contrato de presencia duradero.

Cuando alguien está presentando, los colaboradores pueden seguir deliberadamente el viewport de esa persona. Salir del modo de seguimiento devuelve el control a cada individuo. Así los recorridos guiados son útiles sin convertir la colaboración normal en compartir pantalla con control remoto.

Los comentarios se adjuntan a objetos. Las menciones y la actividad identifican quién pidió a Brain que actuara, quién revisó una propuesta y qué recurso canónico cambió. Los roles distinguen el acceso de Viewer, Commenter, Editor, Runner y Owner. Los permisos de los recursos subyacentes siguen aplicándose: una invitación a una sesión no es un atajo hacia un proyecto, dataset, agente o repositorio al que el miembro no puede acceder.

## Un traspaso práctico de diseño a código

Imagina a un equipo revisando un nuevo flujo de onboarding:

1. Producto añade un objeto Project y expande las lentes de feedback de clientes y de entrega.
2. Diseño coloca un Prototype WYSIWYG y su variante móvil junto a la evidencia.
3. Brain evalúa el prototipo frente a las funcionalidades solicitadas y crea un conjunto de cambios revisable.
4. El equipo aprueba un Mockup y lo entrega a una Task del proyecto asignada a un Agent de implementación.
5. Un desarrollador abre la misma Session en VS Code y añade el repositorio, la selección de componente, los diagnósticos y la vista previa local relevantes.
6. El Agent se ejecuta según la política de aprobación del proyecto. El estado de la build y su salida reaparecen en la Session.

Nadie tiene que reconstruir por qué existe la tarea. La evidencia, la decisión, el artefacto, el contexto de implementación y el historial de ejecución permanecen conectados.

## Exploración segura con ramas y checkpoints

Los checkpoints con nombre preservan estados de revisión significativos. Una rama de sesión permite un experimento más independiente, por ejemplo, una arquitectura de la información distinta o un pipeline de modelos distinto. Cuando la rama regresa, Builderforce presenta una revisión de fusión explícita objeto por objeto. Quien revisa puede usar la versión de la rama o conservar la versión del padre para cada objeto coincidente.

Los dibujos a mano alzada, las notas y los Frames reutilizables dan soporte al trabajo espacial desordenado que rodea a los artefactos formales. Los paquetes del Marketplace ofrecen puntos de partida más estructurados para campañas, descubrimiento de producto, historias de datos, stand-ups, construcción de modelos y revisiones ejecutivas.

## El traspaso se convierte en una imagen operativa compartida

«Traspaso» implica que un equipo termina y otro empieza. Una Creation Session multijugador admite un modelo mejor: los colaboradores añaden el contexto propio de su trabajo mientras el lienzo compartido preserva las relaciones y Brain ayuda a razonar sobre ellas.

El navegador sigue siendo el lugar más accesible para reunir contexto de negocio. VS Code sigue siendo el lugar adecuado para la implementación detallada. Builderforce los conecta sin reducir a ninguno de los dos a una transcripción.

[Inicia una Creation Session compartida →](/create/new)
