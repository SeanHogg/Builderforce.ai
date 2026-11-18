/**
 * The training panel's warm-start base: an Evermind `.safetensors` checkpoint and the
 * tokenizer it was trained with. The panel holds the parsed values and the chosen file
 * names (the in-browser trainer and the Python-training import both use the values).
 */
import { useTranslations } from 'next-intl';
import type { HuggingFaceTokenizerSpec } from '@seanhogg/builderforce-memory-engine';

export interface WarmStartNames {
  base: string;
  tokenizer: string;
}

interface WarmStartBaseFieldsProps {
  hasBase: boolean;
  hasTokenizer: boolean;
  names: WarmStartNames;
  onNames: (update: (names: WarmStartNames) => WarmStartNames) => void;
  onBase: (checkpoint: ArrayBuffer | undefined) => void;
  onTokenizer: (spec: HuggingFaceTokenizerSpec | undefined) => void;
  onTokenizerError: () => void;
}

export function WarmStartBaseFields({ hasBase, hasTokenizer, names, onNames, onBase, onTokenizer, onTokenizerError }: WarmStartBaseFieldsProps) {
  const t = useTranslations('aiTraining');
  const setBaseName = (base: string) => onNames((current) => ({ ...current, base }));
  const setTokenizerName = (tokenizer: string) => onNames((current) => ({ ...current, tokenizer }));
  return (
    <details className="mt-2 rounded border border-gray-700 bg-gray-900 p-2">
      <summary className="cursor-pointer text-xs text-gray-300">{t('warmStartSummary')}</summary>
      <div className="mt-2 space-y-2 text-xs text-gray-400">
        <label className="block">{t('baseSafetensorsLabel')}
          <input type="file" accept=".safetensors,application/octet-stream" className="mt-1 block w-full text-xs" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) { onBase(undefined); setBaseName(''); return; }
            void file.arrayBuffer().then((bytes) => { onBase(bytes); setBaseName(file.name); });
          }} />
        </label>
        <label className="block">{t('matchingTokenizerLabel')}
          <input type="file" accept=".json,application/json" className="mt-1 block w-full text-xs" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) { onTokenizer(undefined); setTokenizerName(''); return; }
            void file.text().then((text) => { onTokenizer(JSON.parse(text) as HuggingFaceTokenizerSpec); setTokenizerName(file.name); }).catch(onTokenizerError);
          }} />
        </label>
        <div>{names.base || t('noBaseSelected')} · {names.tokenizer || t('noTokenizerSelected')}</div>
        {hasBase !== hasTokenizer ? <div className="text-amber-400">{t('selectBothFiles')}</div> : null}
      </div>
    </details>
  );
}
