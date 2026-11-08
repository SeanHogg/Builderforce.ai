Un lienzo en blanco es liberador una vez. Un proceso de equipo repetible necesita una estructura que se pueda reutilizar sin congelar cada proyecto en el mismo documento.

Creation Canvas separa cuatro tipos de reutilización: paquetes iniciales, marcos reutilizables, puntos de control con nombre y ramas.

![Vista de producto del menú de plantillas de Canvas con seis paquetes incluidos, un espacio de trabajo enmarcado, historial de puntos de control con nombre, indicador de rama y controles de revisión de fusión objeto por objeto](/blog/canvas-reuse-versioning-workspace.svg)

## Los paquetes crean sistemas de objetos funcionales

Builderforce incluye seis paquetes iniciales a través del catálogo de plantillas de Canvas:

- **Campaign studio** — Workflow, Website, Dashboard y un Agent de campaña.
- **Product discovery** — Dataset, Feature Summary, Mockup Set y Evaluation.
- **Data story** — Dataset, Chart, Dashboard y Slides.
- **Impromptu stand-up** — Stand-up, Staff Member, Agent y una Task de seguimiento.
- **Evermind model lab** — Dataset, Evermind, Evaluation y un Agent de modelo publicado.
- **Executive review** — Project, Dashboard, Roadmap y Slides.

El paquete coloca tipos de objeto reales y registrados, junto con relaciones iniciales. La política del tenant sigue gobernando cada recurso en vivo que añadas después; instalar un paquete no concede acceso a un Project, un modelo, un Agent ni una integración.

## Los marcos conservan una disposición útil

Un Frame (marco) es un objeto de colaboración de primera clase con un propósito, un color y un borde. Los equipos pueden agrupar un área de revisión, un taller, un pipeline de modelos o una secuencia de presentación sin dar a entender que todos los objetos cercanos se ejecutan juntos.

Los ajustes preestablecidos de marco personalizados se pueden guardar de forma privada en el dispositivo y volver a insertar desde el menú de plantillas. Es útil para rituales recurrentes y convenciones de diseño que no justifican una plantilla de espacio de trabajo completa.

![Los paquetes iniciales colocan objetos registrados y relaciones tipadas; los Frames reutilizables conservan disposiciones locales; los Checkpoints con nombre guardan estados significativos del servidor; las Branches permiten experimentos independientes; la revisión de fusión elige la versión de la rama o del padre para cada objeto coincidente](/blog/canvas-reuse-layers.svg)

## Los puntos de control ponen nombre a los estados importantes

El historial automático responde a «¿qué cambió?». Un punto de control con nombre responde a «¿qué estado acordó el equipo que importaba?». En una Session respaldada por servidor, los editores pueden poner nombre a un punto de control antes de una revisión ejecutiva, un experimento, una decisión de entrega o un cambio en el entrenamiento de un modelo.

Los puntos de control aparecen en el historial de la sesión junto a las instantáneas de revisión. No sustituyen a la experimentación con ramas; son un hito duradero en la línea de trabajo actual.

## Las ramas aíslan los experimentos

Una rama crea una Session independiente derivada de la principal. Úsala para una arquitectura de información distinta, una dirección de campaña, un plan de modelo o un criterio de priorización diferente. Los colaboradores pueden trabajar sin que el lienzo principal pase por cada estado intermedio.

Cuando una rama vuelve, Builderforce prepara una revisión de fusión explícita. Para cada objeto que existe en ambas versiones, quien revisa elige la versión de la rama o mantiene la del padre. Los objetos nuevos se pueden aceptar sin reemplazar trabajo no relacionado del padre.

Este modelo objeto por objeto se ajusta mejor a la unidad real de creación que «reemplazar todo el tablero».

## La exportación mantiene la sesión portable

La exportación de Canvas ofrece otra vía de recuperación y portabilidad. Juntas, las capas forman una progresión práctica:

**paquete para un sistema inicial → marco para una disposición reutilizable → punto de control para un estado acordado → rama para un experimento → fusión para una decisión explícita → exportación para la portabilidad**

La reutilización se vuelve más precisa porque cada mecanismo responde a una pregunta distinta.

[Empieza desde un paquete de Creation Canvas →](/create/new)
