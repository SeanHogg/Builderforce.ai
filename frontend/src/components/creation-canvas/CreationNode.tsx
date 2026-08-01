'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

export type CreationFlowNode = Node<CreationNodeData, 'creation'>;

const ICONS: Record<CreationNodeData['kind'], string> = {
  workflow: '⌘', website: '◎', dashboard: '▥', chat: '●', agent: '✦', staff: '●',
  evaluation: '✦', dataset: '▤', voice: '◖', note: '◇', project: '▦', roadmap: '↗',
  task: '✓', mockup: '▣', featureSummary: '★',
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
  const isWide = data.kind === 'workflow' || data.kind === 'website' || data.kind === 'dashboard' || data.kind === 'evaluation' || data.kind === 'roadmap' || data.kind === 'featureSummary';
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
        {data.kind === 'chat' && <><div className={styles.message}><b>You</b><p>{data.subtitle || 'What would you like to create?'}</p></div><div className={styles.aiMessage}><b>Brain</b><p>I added your starting objects to the canvas. Keep creating freely; connect an account only when you want to collaborate or deliver the work.</p></div></>}
        {data.kind === 'dataset' && <><p className={styles.fileMeta}>18,420 rows · 8 columns</p><div className={styles.miniTable}><b>User</b><b>Plan</b><b>Conversion</b><span>user_001</span><span>Pro</span><span>8.3%</span><span>user_002</span><span>Free</span><span>2.1%</span></div></>}
        {data.kind === 'voice' && <><div className={styles.waveform}>▂▅▃▆▂▇▅▃▆▂▅▇▃▆▂▅</div><small>00:18 / 00:45</small></>}
        {data.kind === 'note' && <p>{data.subtitle || 'Double-click to add a thought.'}</p>}
        {data.kind === 'project' && <><div className={styles.projectHealth}><div><small>Maturity</small><b>3.8 / 5</b></div><div><small>Velocity</small><b>42 pts</b></div><div><small>Health</small><b className={styles.healthy}>On track</b></div></div><p>{data.subtitle || 'Optional project context. Expand to see related work.'}</p></>}
        {data.kind === 'roadmap' && <div className={styles.roadmap}><div><b>Now</b><span>Validate narrative</span><span>Sales deck</span></div><div><b>Next</b><span>Executive review</span><span>Launch pilot</span></div><div><b>Later</b><span>Measure adoption</span><span>Scale channels</span></div></div>}
        {data.kind === 'task' && <><div className={styles.personRow}><span className={styles.liveDot} /><b>{data.status || 'Ready'}</b><span>{data.role || 'Campaign Strategist'}</span></div><p>{data.subtitle || 'Build the approved mockup and deliver it to the project.'}</p></>}
        {data.kind === 'mockup' && <><div className={styles.mockupGrid}><i /><i /><i /></div><p>{data.subtitle || 'High-fidelity interactive concept ready for review.'}</p><div className={styles.pills}><span>{data.status || 'Draft'}</span><span>Desktop + mobile</span></div></>}
        {data.kind === 'featureSummary' && <div className={styles.featureGrid}>{['Smart onboarding','Team analytics','Approval inbox','Voice commands','Custom dashboards','Agent handoffs','Mobile review','Audit history','Templates','Live collaboration'].map((feature, index) => <span key={feature}><b>{index + 1}</b>{feature}</span>)}</div>}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </article>
  );
}
