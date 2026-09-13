import { render, screen } from '@testing-library/react';
import { Position, ReactFlowProvider, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { CanvasNodeFace } from './CanvasNodeFace';
import { CanvasNodeHandle } from './CanvasNodeHandle';

/**
 * An object drawn off the board by the board's own component.
 *
 * The 3D space used to draw its own summary of every object, which is how a
 * website read "Draft" there while the board showed its page. What is proved here
 * is that the face IS the registered node component, handed the node's data, and
 * that its connection points draw without a React Flow node around them.
 */
type Card = Node<{ title: string }, 'card'>;

function CardNode({ id, data, selected }: NodeProps<Card>) {
  return <article data-testid={`card-${id}`} data-selected={selected}>
    <CanvasNodeHandle type="target" position={Position.Left} className="in" />
    {data.title}
    <CanvasNodeHandle type="source" position={Position.Right} />
  </article>;
}

const nodeTypes: NodeTypes = { card: CardNode };

describe('CanvasNodeFace', () => {
  it('draws a node with the component the board registers for its type', () => {
    render(<ReactFlowProvider>
      <CanvasNodeFace node={{ id: 'site', type: 'card', position: { x: 0, y: 0 }, data: { title: 'Make Better Decisions' } } satisfies Card} nodeTypes={nodeTypes} />
    </ReactFlowProvider>);

    const card = screen.getByTestId('card-site');
    expect(card).toHaveTextContent('Make Better Decisions');
    // A face is looked at, not worked on: the host draws its own selection.
    expect(card).toHaveAttribute('data-selected', 'false');
    // The handles keep their picture — same classes as the board — with no node to connect.
    expect(card.querySelector('.react-flow__handle.react-flow__handle-left.in')).not.toBeNull();
    expect(card.querySelector('.react-flow__handle.react-flow__handle-right')).not.toBeNull();
  });

  it('draws nothing for a type the board has no component for', () => {
    const { container } = render(<ReactFlowProvider>
      <CanvasNodeFace node={{ id: 'x', type: 'unknown', position: { x: 0, y: 0 }, data: {} }} nodeTypes={nodeTypes} />
    </ReactFlowProvider>);
    expect(container).toBeEmptyDOMElement();
  });
});
