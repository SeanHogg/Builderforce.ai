#!/usr/bin/env node
/**
 * Catalog keys for the comparison matrix (`CompetitorMatrix`).
 *
 * The matrix renders `compare.categories` — data that was already translated in
 * all five catalogs and rendered by nothing. Only the table's own chrome is new,
 * so this adds three keys and nothing else. Same shape as the other
 * `i18n-patch-*.mjs` scripts: idempotent, writes all five catalogs, run once.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const messagesDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/i18n/messages');

const PATCH = {
  en: {
    matrixHeading: 'Capability by capability',
    matrixNote:
      'Each row is a capability and each column a tool. Cells describe support as we currently understand it. Vendor products and plans change often, so verify anything decision-critical against current vendor documentation and a hands-on trial.',
    matrixScrollHint: 'Scroll the table sideways to see every tool.',
  },
  zh: {
    matrixHeading: '逐项能力对比',
    matrixNote:
      '每一行代表一项能力，每一列代表一款工具。单元格描述的是我们目前所了解的支持情况。各厂商的产品与方案变动频繁，因此对决策至关重要的内容，请对照厂商的最新文档并通过实际试用加以核实。',
    matrixScrollHint: '左右滑动表格即可查看全部工具。',
  },
  es: {
    matrixHeading: 'Capacidad por capacidad',
    matrixNote:
      'Cada fila es una capacidad y cada columna una herramienta. Las celdas describen la compatibilidad según la entendemos actualmente. Los productos y planes de los proveedores cambian con frecuencia, así que verifica todo lo que sea decisivo con la documentación vigente del proveedor y con una prueba práctica.',
    matrixScrollHint: 'Desplaza la tabla horizontalmente para ver todas las herramientas.',
  },
  fr: {
    matrixHeading: 'Capacité par capacité',
    matrixNote:
      'Chaque ligne correspond à une capacité et chaque colonne à un outil. Les cellules décrivent la prise en charge telle que nous la comprenons aujourd’hui. Les produits et les forfaits des fournisseurs évoluent souvent : vérifiez tout élément déterminant pour votre décision dans la documentation à jour du fournisseur et lors d’un essai pratique.',
    matrixScrollHint: 'Faites défiler le tableau horizontalement pour voir tous les outils.',
  },
  de: {
    matrixHeading: 'Funktion für Funktion',
    matrixNote:
      'Jede Zeile steht für eine Funktion, jede Spalte für ein Werkzeug. Die Zellen beschreiben den Stand nach unserem derzeitigen Kenntnisstand. Produkte und Tarife der Anbieter ändern sich häufig – prüfen Sie alles Entscheidungsrelevante daher anhand der aktuellen Anbieterdokumentation und in einem praktischen Test.',
    matrixScrollHint: 'Scrollen Sie die Tabelle seitwärts, um alle Werkzeuge zu sehen.',
  },
};

for (const [locale, keys] of Object.entries(PATCH)) {
  const file = resolve(messagesDir, `${locale}.json`);
  const catalog = JSON.parse(readFileSync(file, 'utf8'));
  catalog.compare = { ...catalog.compare, ...keys };
  writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`${locale}: +${Object.keys(keys).length} compare.matrix* keys`);
}
