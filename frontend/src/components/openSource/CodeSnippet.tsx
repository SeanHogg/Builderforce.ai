import styles from './openSource.module.css';

/**
 * A labelled, horizontally-scrolling code block for the /open-source pages.
 *
 * The code is literal registry data (`lib/openSourcePackages.ts`), never a
 * catalog string, and the block scrolls inside itself so a long install line
 * can never widen the page at 360px.
 */
export default function CodeSnippet({ label, code }: { label: string; code: string }) {
  return (
    <figure className={styles.code}>
      <figcaption className={styles.codeLabel}>{label}</figcaption>
      <pre className={styles.codeBody} tabIndex={0}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
