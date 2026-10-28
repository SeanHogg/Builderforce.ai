/**
 * The Knowledge view's copy: the web's own `knowledgeGraph` catalog for the panel's
 * locale (`virtual:rovr-knowledge-catalogs`, served by `build.mjs`), through THE ONE
 * catalog → labels mapper the web uses (`@builderforce/knowledge-browser`). Never a
 * second translation of it.
 */

import catalogs from 'virtual:rovr-knowledge-catalogs';
import { catalogReader, knowledgeGraphLabels } from '@builderforce/knowledge-browser';
import type { KnowledgeGraphLabels } from '@builderforce/knowledge-graph-view';
import { uiCatalogLocale } from '../../i18n/t';

export function rovrKnowledgeLabels(locale: keyof typeof catalogs = uiCatalogLocale()): KnowledgeGraphLabels {
  return knowledgeGraphLabels(catalogReader(catalogs[locale]));
}
