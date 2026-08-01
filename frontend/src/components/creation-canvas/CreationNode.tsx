'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

export type CreationFlowNode = Node<CreationNodeData, 'creation'>;

const ICONS: Record<CreationNodeData['kind'], string> = {
  workflow: '⌘', website: '◎', dashboard: '▥', chat: '●', agent: '✦', staff: '●',
  evaluation: '✦', dataset: '▤', voice: '◖', note: '◇',
};

function WorkflowBody({ status }: { status?: string }) {
  const steps = ['Audience', 'Create campaign', 'Approve', 'Publish'];
  return (
    <div className={styles.workflowSteps}>
      {steps.map((step, index) => (
        <div className={styles.workflowStep} key={step}>
          <span className={index === 0 ? styles.doneDot : index === 1 ? styles.liveDot : styles.idleDot} />
          <strong>{step}</strong>
          <small>{status === 'Running' && index === 1 ? 'Running…' : index === 0 ? 'Defined' : index === 1 ? 'In progress' : 'Pending'}</small>
        </div>
      ))}
    </div>
  );
}

function WebsiteBody() {
  return (
    <div className={styles.websitePreview}>
      <div className={styles.siteNav}><strong>AutumnGlow</strong><span>Products&nbsp;&nbsp; Collections&nbsp;&nbsp; About</span><button>Shop now</button></div>
      <div className={styles.siteHero}>
        <div><h3>Fall in love<br />with every look</h3><p>New arrivals for the season ahead.</p><button>Shop the collection</button></div>
        <div className={styles.heroArt}>AG</div>
      </div>
      <div className={styles.siteBenefits}><span>Free shipping</span><span>Easy returns</span><span>Secure checkout</span></div>
    </div>
  );
}

function DashboardBody() {
  return (
    <>
      <div className={styles.kpis}><div><small>Reach</small><strong>212K</strong><em>↑ 18.4%</em></div><div><small>CTR</small><strong>3.6%</strong><em>↑ 0.6pp</em></div><div><small>Conversion</small><strong>2.1%</strong><em>↑ 0.3pp</em></div></div>
      <div className={styles.charts}>
        <div><small>Funnel</small><div className={styles.funnel}><i /><i /><i /><i /></div></div>
        <div><small>Channel mix</small><div className={styles.donut} /></div>
      </div>
    </>
  );
}

function EvaluationBody() {
  return (
    <div className={styles.evaluationBody}>
      <div className={styles.verdict}>Promising,<br />with 3 gaps</div>
      <div><b>✓ Message match is strong</b><p>Campaign messaging aligns with the landing page.</p></div>
      <div><b>△ Mobile CTA appears too late</b><p>Move the primary action above the fold.</p></div>
      <div><b>◷ Approval timing risks launch</b><p>Publishing may miss the planned window.</p></div>
      <button>Apply recommendations</button>
    </div>
  );
}

export function CreationNode({ data, selected }: NodeProps<CreationFlowNode>) {
  const isWide = data.kind === 'workflow' || data.kind === 'website' || data.kind === 'dashboard' || data.kind === 'evaluation';
  return (
    <article className={`${styles.node} ${styles[`node_${data.kind}`]} ${selected ? styles.selected : ''} ${isWide ? styles.wideNode : ''}`}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <header className={styles.nodeHeader}>
        <span className={styles.nodeIcon}>{ICONS[data.kind]}</span>
        <strong>{data.title}</strong>
        {data.status && <span className={styles.status}>{data.status}</span>}
        <button className={styles.moreButton} aria-label={`More options for ${data.title}`}>•••</button>
      </header>
      <div className={styles.nodeBody}>
        {data.kind === 'workflow' && <WorkflowBody status={data.status} />}
        {data.kind === 'website' && <WebsiteBody />}
        {data.kind === 'dashboard' && <DashboardBody />}
        {data.kind === 'evaluation' && <EvaluationBody />}
        {data.kind === 'agent' && <><div className={styles.personRow}><span className={styles.presence} /><b>{data.status || 'Online'}</b><span>{data.model || 'gpt-4o'}</span></div><p>{data.subtitle}</p><div className={styles.pills}><span>Audience Analyzer</span><span>Copy Optimizer</span><span>Autonomy: Medium</span></div></>}
        {data.kind === 'staff' && <><div className={styles.personRow}><span className={styles.avatar} style={{ background: data.accent }}>{data.title.slice(0, 1)}</span><b>{data.role}</b><span className={styles.presence} /></div><small>Current focus</small><p>{data.focus}</p></>}
        {data.kind === 'chat' && <><div className={styles.message}><b>You</b><p>Will this workflow be effective with the landing page?</p></div><div className={styles.aiMessage}><b>Brain</b><p>Select or connect both objects and I’ll evaluate message match, timing, and conversion risk.</p></div></>}
        {data.kind === 'dataset' && <><p className={styles.fileMeta}>18,420 rows · 8 columns</p><div className={styles.miniTable}><b>User</b><b>Plan</b><b>Conversion</b><span>user_001</span><span>Pro</span><span>8.3%</span><span>user_002</span><span>Free</span><span>2.1%</span></div></>}
        {data.kind === 'voice' && <><div className={styles.waveform}>▂▅▃▆▂▇▅▃▆▂▅▇▃▆▂▅</div><small>00:18 / 00:45</small></>}
        {data.kind === 'note' && <p>{data.subtitle || 'Double-click to add a thought.'}</p>}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </article>
  );
}
