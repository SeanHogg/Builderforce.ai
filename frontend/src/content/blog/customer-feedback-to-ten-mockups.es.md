A los equipos de producto rara vez les falta feedback. Les falta un camino fiable desde miles de comentarios hasta un puñado de decisiones, y desde esas decisiones hasta algo que los clientes puedan evaluar de verdad.

Creation Canvas convierte ese camino en una sola sesión visible.

![Miles de señales de feedback de clientes atraviesan un motor de síntesis cristalino y se abren en diez conceptos de producto interactivos de alta fidelidad, con los hilos de evidencia visibles desde cada fuente hasta cada mockup](/blog/feedback-to-mockups-hero.webp)

## 1. Trae la evidencia

Inicia una sesión con un prompt como este:

> Visualiza el feedback de nuestros clientes, identifica las diez funciones más solicitadas y crea un concepto interactivo para cada una.

Añade un objeto Dataset e importa feedback en CSV o TSV. También puedes colocar en el lienzo feedback respaldado por proyectos, informes, dashboards, documentos o fuentes MCP conectadas. El acceso a fuentes sensibles sigue los permisos del recurso subyacente; añadir un objeto no copia esos controles de un lado a otro.

Pide a Brain que perfile temas, segmentos, frecuencia y actualidad. Un objeto Chart o Dashboard puede mostrar qué peticiones dominan en conjunto y cuáles importan de forma desproporcionada para un segmento de clientes de alto valor.

## 2. Sintetiza, no te limites a contar

El número bruto de menciones es útil, pero no es una hoja de ruta. Dos clientes pueden describir la misma necesidad con palabras distintas, y una petición estratégicamente importante puede pesar más que cincuenta preferencias cosméticas.

Brain crea un objeto Feature Summary que agrupa el feedback relacionado semánticamente y conserva citas de la evidencia original. Un buen resumen registra:

- el problema del cliente;
- evidencia representativa de las fuentes;
- frecuencia y segmentos afectados;
- el resultado esperado;
- restricciones y dependencias conocidas;
- confianza y frescura de la evidencia.

Como el resumen es un objeto, los colaboradores pueden comentarlo, conectarle métricas del proyecto o pedir otro criterio de priorización sin perder la primera interpretación.

## 3. Convierte las diez funciones en mockups

Conecta el Feature Summary a un Mockup Set y pide a Brain que expanda cada elemento. Cada función se convierte en un objeto Mockup revisable individualmente, en lugar de un collage estático.

Usa un objeto WYSIWYG Prototype cuando un concepto necesite más fidelidad. Edita titulares, llamadas a la acción, color, viewport responsive, navegación o enlaces de datos directamente en el inspector. Añade dibujos y notas alrededor de un concepto durante la crítica. Agrupa variantes relacionadas en un Frame reutilizable.

En este punto el lienzo se convierte en una sala de decisión visual: la evidencia a la izquierda, las oportunidades sintetizadas en el centro y los conceptos interactivos a la derecha.

![El paquete Product Discovery conserva la procedencia desde CSV, informes, dashboards y fuentes MCP, a través de un Feature Summary con citas, hasta diez Mockups revisables individualmente; luego evalúa el impacto en el cliente, el solapamiento y el riesgo de entrega antes de crear una Task aprobada y una ejecución de Agent](/blog/feedback-mockup-provenance.svg)

## 4. Evalúa los conceptos frente a la realidad

Añade el objeto Project correspondiente y expande su vista de feedback de clientes, métricas o entrega. Brain ya puede comparar un mockup con las funciones actuales, el trabajo abierto, la salud del producto y las restricciones de entrega.

Haz preguntas como:

- «¿Qué concepto resuelve el mayor problema verificado de los clientes?»
- «¿Qué funciones se solapan con trabajo ya planificado?»
- «¿Qué dependencias hacen arriesgados estos tres conceptos este trimestre?»
- «Crea un relato de ventas y una hoja de ruta ejecutiva a partir del conjunto aprobado.»

Brain añade objetos persistentes Evaluation, Roadmap y Slides con fuentes inspeccionables. Los cambios recomendados que afectan a varios objetos siguen siendo propuestas hasta que alguien con rol de revisión los selecciona y aplica.

## 5. Entrega el trabajo aprobado

Los proyectos son opcionales durante la exploración, pero valiosos en el momento de la entrega. Desde un Mockup aprobado, elige **Add to project and assign**. Builderforce crea o enlaza una Task, adjunta el artefacto, asigna a una persona o a un Agent de IA y aplica la política de aprobación del proyecto.

La ejecución de la tarea sigue visible desde la sesión. Quien revisa puede ver si el trabajo está listo, en ejecución, pendiente de aprobación, bloqueado o entregado, sin abandonar la evidencia y las decisiones que lo originaron.

Esta es la diferencia clave entre generar diez imágenes y desarrollar diez conceptos de producto. Cada concepto tiene procedencia. Cada aprobación tiene un rastro de auditoría. Cada artefacto entregado tiene una vía hacia trabajo con responsables.

## Usa un paquete Product Discovery reutilizable

La biblioteca de plantillas de Creation Canvas incluye un paquete Product Discovery con objetos Dataset, Feature Summary, Mockup Set y Evaluation ya dispuestos y conectados. Los equipos también pueden guardar Frames personalizados para sus propios rituales de revisión.

Empieza con el paquete o con un lienzo en blanco. En ambos casos, el flujo es el mismo:

**evidencia → síntesis → conceptos visuales → evaluación → aprobación → entrega**

[Convierte el feedback en una sesión visual →](/create/new)
