Cuando un equipo está formado por humanos y agentes de IA en el mismo tablero, "quién hizo qué" deja de ser obvio. Un ticket marcado como Hecho no te dice nada sobre si los roles correctos lo tocaron: si un revisor realmente revisó, si un especialista en seguridad llegó a ver el ticket de seguridad, o si el agente que entregó el código era siquiera un programador. En un tablero agéntico rápido, esa ambigüedad es por donde la calidad se escapa en silencio.

Builderforce.ai convierte la participación en algo de primera clase y demostrable.

## El rol correcto hace el trabajo

La causa raíz de buena parte de la mala salida de los agentes es la asignación equivocada: un agente Product Manager al que se le da un ticket de código, un generalista al que se le da una tarea que necesitaba a un especialista. Por eso la asignación ahora es **consciente del rol**. Cada agente (y cada humano) tiene una capacidad de rol de primera clase, y una etapa productora resuelve el rol que requiere el trabajo —a partir del tipo de acción del ticket— y despacha a alguien realmente capaz de hacerlo. Un responsable sin capacidad para el rol no puede ser el ejecutor de respaldo en una etapa productora. El modo de fallo exacto en el que se envía a un manager a escribir código simplemente no puede ocurrir.

## Un manifiesto de participación por ticket

Cada ticket deriva un **manifiesto de participación** de los requisitos de calle (swimlane) de su tablero: los roles que necesita, cada uno resuelto a un humano o agente capaz, cada uno con un estado: pendiente, asignado, en curso, completado, cambios solicitados, exento o sin dotar. Es el reparto del ticket, y puedes ver de un vistazo qué papeles están cubiertos y cuáles no.

Un control de **Evaluación de recursos** permite a un manager añadir un rol que la plantilla no anticipó —un diseñador, un revisor de seguridad— y, si ese rol no se puede dotar, aparece como una **brecha de recursos** bloqueante en lugar de una omisión silenciosa.

## Un Informe de Responsabilidad inmutable

El registro en sí es de solo anexado. `ticket_role_signoffs` captura, por rol: **Quién** dio el visto bueno, **Cuándo**, su **Veredicto**, sus **Comentarios** y su **Contribución** real. Nada se edita ni se sobrescribe: cambiar de opinión es una nueva entrada, no una reescritura. El visto bueno está protegido por **permisos de denegación por defecto**: solo un miembro realmente capaz de un rol puede dar el visto bueno como ese rol, y cada visto bueno escribe en el registro de actividad unificado.

El resultado es el **Informe de Responsabilidad**: una vista por rol de Quién/Cuándo/Veredicto/Comentarios/Contribución en el ticket, más sus brechas: roles sin dotar, roles sin firmar, contribuciones ausentes, exenciones. Es la respuesta a "¿esto se hizo realmente bien?" respaldada por evidencia, no por sensaciones.

## Por qué importa

Los marcos de gobernanza —SOC 2, ISO 27001 y el resto— hacen siempre la misma pregunta: ¿puedes *demostrar* que las personas correctas hicieron las cosas correctas? En un tablero donde los agentes se mueven rápido, la respuesta honesta solía ser "más o menos". La responsabilidad restringida por rol la convierte en "sí, aquí está el registro inmutable", y como el mismo manifiesto que lo demuestra también *impulsa* la asignación, obtienes la pista de auditoría gratis como subproducto de hacer bien el trabajo desde el principio.

La calidad se controla en el tablero, no se espera a posteriori.

[Recorre la plataforma →](/product) · [Lee sobre el Kanban de la plantilla agéntica →](/blog/transitioning-to-an-agentic-workforce) · [Empieza a construir gratis →](/register)
