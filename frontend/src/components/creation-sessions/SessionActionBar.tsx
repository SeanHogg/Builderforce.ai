'use client';

import { Button, Icon } from '@/components/ui';
import { useSessionManagement, type SessionManagementPorts } from './useSessionManagement';
import styles from './SessionActionBar.module.css';

export type { ManagedSession, SessionMenuAction, SessionManagementPorts } from './useSessionManagement';

/**
 * Every action a session has, ON the session.
 *
 * This replaced a `⋯` trigger that opened a menu. The actions were all there
 * and none of them were findable: nothing on a card said a menu existed, so
 * rename, move, merge and archive read as features the library did not have.
 * The bar sizes itself to the space it is given — the labels appear beside the
 * icons once the row is wide enough (the list view), and step back to icons
 * with accessible names inside a card column.
 */
export function SessionActionBar(props: SessionManagementPorts) {
  const { actions, editor } = useSessionManagement(props);
  return (
    <div className={styles.bar} role="group" aria-label={props.session.title} onClick={(event) => event.stopPropagation()}>
      {actions.map((action) => (
        <Button
          key={action.id}
          type="button"
          variant="ghost"
          size="sm"
          disabled={action.disabled}
          title={action.label}
          aria-label={action.label}
          className={`${styles.action}${action.danger ? ` ${styles.danger}` : ''}`}
          onClick={() => void action.run()}
        >
          <Icon name={action.icon} size={16} />
          <span className={styles.label}>{action.label}</span>
        </Button>
      ))}
      {editor}
    </div>
  );
}
