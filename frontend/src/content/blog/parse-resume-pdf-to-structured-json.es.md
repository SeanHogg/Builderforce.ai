## El problema del análisis de currículums

Los currículums no están estructurados por naturaleza. No existe un estándar universal para el diseño, el nombre de las secciones, el formato de las fechas ni la organización del contenido. Un currículum puede poner la formación primero o al final, usar «Experiencia laboral», «Trayectoria profesional» o «Historial de carrera», y dar formato a las fechas como «2020–2023», «Ene 2020 - Dic 2023» o «1/2020 a 12/2023».

Para cualquier sistema que necesite procesar currículums a escala —plataformas ATS, bolsas de empleo, analítica de RR. HH., CRM de selección— estos datos no estructurados deben convertirse a un formato coherente y legible por máquinas. Eso es el análisis de currículums.

Los analizadores tradicionales basados en regex fallan en el 20–30 % de los currículums por las variaciones de diseño. Los analizadores modernos con IA, como la herramienta PDF to JSON de Builderforce, logran una precisión de extracción superior al 95 % porque entienden el contexto, no solo buscan patrones.

## El esquema de salida

La herramienta PDF to JSON de Builderforce produce un objeto JSON limpio con estos campos de primer nivel:

```json
{
  "basics": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string",
    "website": "string",
    "summary": "string"
  },
  "work": [
    {
      "company": "string",
      "position": "string",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM | Present",
      "highlights": ["string"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "graduationDate": "YYYY"
    }
  ],
  "skills": ["string"],
  "certifications": ["string"]
}
```

Este esquema es compatible con el estándar JSON Resume, lo que facilita la integración con herramientas y pipelines existentes.

## Cómo usar el analizador

**Interactivo (navegador):**
1. Abre la herramienta PDF to JSON en Builderforce/tools/pdf-to-json.
2. Suelta un archivo PDF o pega el texto del currículum.
3. Haz clic en Parse: la IA extrae los datos estructurados y muestra el JSON.
4. Copia el JSON o descárgalo como archivo .json.

El analizador gestiona diseños de varias columnas, tablas, formatos creativos y encabezados de sección no estándar. Funciona con PDF generados desde Word, Google Docs, LaTeX, Canva y herramientas de diseño.

## Errores comunes al analizar

**PDF solo de imagen.** Algunos PDF son imágenes escaneadas, no texto. Requieren OCR antes de analizarse. El analizador de Builderforce incluye OCR para documentos escaneados, pero la precisión baja hasta el ~85 % con escaneos de baja calidad.

**Currículums multilingües.** El analizador funciona mejor con currículums en inglés. La compatibilidad con otros idiomas está mejorando, pero puede pasar por alto matices en el formato de fechas y el nombre de las secciones.

**Currículums con mucho diseño.** Los currículums con infografías, líneas de tiempo, barras de habilidades y diseños circulares pierden algunos matices de formato durante la extracción. Los datos se siguen capturando, pero los elementos puramente visuales (como una barra de habilidad de «85 % de dominio de Python») pueden no traducirse a la salida JSON.

**Puestos fusionados.** Si alguien indica dos cargos en la misma empresa en una sola línea («Senior Engineer → Staff Engineer, 2020–2024»), el analizador puede crear una entrada en lugar de dos. Revisa estos casos por muestreo.

## Preguntas frecuentes

### ¿Qué formatos de archivo acepta el analizador?

La herramienta PDF to JSON acepta archivos PDF y DOCX, así como texto plano pegado. Los archivos PDF pueden estar basados en texto o escaneados (el OCR está incluido).

### ¿La salida es compatible con el formato JSON Resume?

Sí. El esquema de salida sigue el estándar JSON Resume (jsonresume.org) con pequeñas extensiones para certificaciones y habilidades. Puedes usar la salida directamente con cualquier herramienta o tema compatible con JSON Resume.

---

**Pruébalo:** [PDF to JSON](/tools/pdf-to-json) en Builderforce.
