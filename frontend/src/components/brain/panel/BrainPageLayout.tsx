import { useTranslations } from 'next-intl';
import { ThemeSelect } from '@/components/ThemeSelect';
import { PlanBadge } from '@/components/PlanBadge';
import { AiDisclosure } from '../AiDisclosure';
import { useBrainPanel } from './BrainPanelContext';
import { BrainPanelCaptureButton } from './BrainCaptureButton';
import { BrainChatList } from './BrainChatList';
import { BrainConversation } from './BrainConversation';

/** Full-page Brain Storm chrome: a permanent chat sidebar beside the conversation. */
export function BrainPageLayout() {
  const { startNewChat, filterProjectId, setFilterProjectId, projects, searchQuery, setSearchQuery } = useBrainPanel();
  const tBrain = useTranslations('brain');
  return (
    <div className="bs-shell" style={{ marginBottom: 0 }}>
      <div className="bs-sidebar">
        <div className="bs-sidebar-header">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--font-size-body)', color: 'var(--text-strong)' }}>{tBrain('brainStorm')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              {/* Which plan funds this chat, and what's left of the allowance —
                  stated up front rather than after a turn dies on the cap. */}
              <PlanBadge />
              <BrainPanelCaptureButton />
              <button type="button" onClick={() => { void startNewChat(); }} style={{ padding: '4px 10px', fontSize: 'var(--font-size-small)', fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
                {tBrain('newChat')}
              </button>
            </div>
          </div>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 'var(--font-size-small)', color: 'var(--muted)' }}>
            {tBrain('projectLabel')}
            <span style={{ display: 'block', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 2 }}>{tBrain('newChatsHint')}</span>
            <ThemeSelect
              ariaLabel={tBrain('filterByProjectAria')}
              value={filterProjectId ?? ''}
              onChange={setFilterProjectId}
              options={[
                { value: '', label: tBrain('allProjects') },
                { value: 'none', label: tBrain('noProject') },
                ...projects.map((p) => ({ value: String(p.id), label: p.name })),
              ]}
              style={{ marginTop: 4 }}
            />
          </label>
          <input type="search" placeholder={tBrain('searchChats')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', fontSize: 'var(--font-size-small)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} />
        </div>
        <div className="bs-chat-list"><BrainChatList /></div>
      </div>
      <div className="bs-main"><AiDisclosure variant="banner" /><BrainConversation /></div>
    </div>
  );
}
