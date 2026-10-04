import { MediaGenerateForm } from './MediaGenerateForm';
import { MediaLibraryGrid } from './MediaLibraryGrid';
import { MediaReviewCard } from './MediaReviewCard';
import type { MediaStudio } from './useMediaStudio';
import styles from './MediaPanel.module.css';

/**
 * Studio's Media panel — the workspace rail's `media` tab. Three parts, top to
 * bottom: what the agent is waiting on you to decide, a form to generate
 * yourself, and the project's library. Composition only; each part owns its UI
 * and `useMediaStudio` owns the data.
 */
export function MediaPanel({ studio }: { studio: MediaStudio }) {
  const { library, review } = studio;
  return (
    <div className={styles.panel}>
      {review && <MediaReviewCard key={review.item.id} review={review} />}
      <MediaGenerateForm onGenerate={library.generate} />
      {library.error && <p className={styles.error} role="alert">{library.error}</p>}
      <MediaLibraryGrid items={library.items} loading={library.loading} onRemove={library.remove} />
    </div>
  );
}
