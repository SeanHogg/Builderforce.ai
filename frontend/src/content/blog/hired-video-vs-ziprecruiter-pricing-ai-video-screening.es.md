## Cifras principales

**ZipRecruiter (2026):** Standard ~299–399 $/mes por puesto de oferta. Premium ~419–519 $. Pro ~719–899 $. Presupuesto a medida según sector, ubicación y volumen de puestos.

**Builderforce Pro:** una tarifa mensual plana, con opción anual con descuento. Las cifras actuales y los límites de cada plan están en la [página de precios](/pricing).

La diferencia de precio es de ~30× en el nivel de entrada *por puesto*. La tarificación por puesto de ZipRecruiter es el supuesto del que todo depende: cuantos más roles contratas, más escala.

## Emparejamiento con IA: ZipRecruiter frente a Builderforce

**ZipRecruiter** usa un algoritmo de emparejamiento con IA que sindica tu oferta a más de 100 sitios asociados e invita a los mejores candidatos a postularse. Las «invitaciones emparejadas por IA» son su propuesta de valor principal.

**Builderforce** usa una superficie de emparejamiento con IA más un agente de búsqueda activa. El AI Recruiter Agent v2 (`/api/recruiter/agent/intake` + `/source`) no se limita a invitar a los candidatos a postularse: los busca en la base de datos de currículums, puntúa a cada uno frente al puesto y redacta mensajes de contacto personalizados.

La distinción: la IA de ZipRecruiter es *pasiva* (espera a que los candidatos emparejados acepten). La IA de Builderforce es *activa* (va a buscarlos). En puestos donde los mejores candidatos no están buscando empleo activamente, la búsqueda activa gana.

## Cribado por vídeo: ZipIntro frente a Live Screening Sessions

**ZipIntro (ZipRecruiter):** el reclutador elige una franja horaria, ZipRecruiter empareja candidatos y los invita a videollamadas cortas consecutivas en un solo bloque. La función estrella de ZipRecruiter para 2026.

**Live Screening Sessions (Builderforce):** el mismo flujo. El reclutador declara la franja y la duración de cada turno, envía candidatos mediante `/sessions/:id/schedule`, el candidato acepta o rechaza por un enlace público con token, y se entregan turnos consecutivos.

Diferencias clave:
- **Coste.** ZipIntro está incluido en ZipRecruiter Pro (~719 $/mes o más). Las Live Screening Sessions están incluidas en Builderforce Pro; el precio actual está en la [página de precios](/pricing).
- **Base de candidatos.** ZipIntro empareja automáticamente desde la base de candidatos de ZipRecruiter. El flujo de Builderforce espera por ahora que envíes los candidatos explícitamente con POST, normalmente desde una ejecución previa del AI Recruiter Agent. El emparejamiento automático desde el agente está en la hoja de ruta (Gap Register #1208).
- **Infraestructura de reuniones.** ZipIntro aloja la videollamada. Builderforce usa tu URL de reunión (Zoom / Meet / Whereby). Menor huella de infraestructura, más libertad de herramientas. WebRTC nativo es un elemento de la hoja de ruta (Gap Register #1210).

## Distribución: ¿importa el alcance?

El argumento de ZipRecruiter es la distribución: publicas una vez y sindicas a más de 100 sitios asociados. Es realmente valioso para puestos de uso general, pero el valor se concentra en los tres primeros portales (Indeed, Google for Jobs, Glassdoor); los más de 97 sitios de la larga cola aportan muy poco.

Builderforce distribuye a Google for Jobs y a su propia base activa de candidatos. Para puestos especializados (ingeniería, diseño, producto, ventas, dirección), la audiencia dirigida de Builderforce suele rendir más que el reparto difuso en 100 portales.

Regla de decisión: si tu puesto es genérico y de alto volumen, la distribución de ZipRecruiter merece el sobrecoste. Si tu puesto es especializado y sensible a la calidad, el flujo más profundo por puesto de Builderforce es mejor palanca.

## Cuándo elegir cada una

**Elige ZipRecruiter cuando:** contrates 1–3 puestos genéricos por trimestre y la distribución sea la propuesta de valor; quieras sindicación gestionada en más de 100 portales sin publicar manualmente en cada uno; el presupuesto no sea la restricción determinante.

**Elige Builderforce cuando:** contrates 5 o más puestos por trimestre (la tarificación por puesto de ZipRecruiter se vuelve punitiva); quieras búsqueda + puntuación + contacto + seguimiento impulsados por IA en un solo flujo; quieras una tarifa mensual plana en lugar de precios por puesto; ZipIntro te atraiga pero 719 $/mes específicamente por eso no.

**Usa ambas:** publica tu puesto más difícil de cubrir en ZipRecruiter Pro por la distribución, haz todos tus demás puestos en Builderforce y ejecuta todo tu cribado por vídeo en las Live Screening Sessions de Builderforce.

## Preguntas frecuentes

### ¿Es Live Screening de Builderforce tan llave en mano como ZipIntro?

El flujo del reclutador tiene la misma forma: declarar la franja, programar candidatos, flujo de aceptación, turnos consecutivos. La principal diferencia de madurez es el emparejamiento automático: ZipIntro rellena el bloque desde su base de candidatos; Builderforce espera hoy que envíes con POST los candidatos de una ejecución previa del AI Recruiter Agent, con el emparejamiento automático en la hoja de ruta.

### ¿Cuánto cobra ZipRecruiter por cribado por vídeo?

ZipIntro está incluido en ZipRecruiter Pro (~719–899 $/mes por puesto de oferta). Las Live Screening Sessions de Builderforce están incluidas en el plan Pro plano.

### ¿Puedo exportar mis candidatos de ZipRecruiter a Builderforce?

ZipRecruiter no expone una API completa de lista de candidatos, pero la extensión de Chrome de Builderforce puede extraer los perfiles de candidatos a los que tienes acceso en tu panel de ZipRecruiter y enviarlos a tu bolsa de talento.

---

**Pruébalo:** [Builderforce para reclutadores](/hires) en Builderforce.
