import { ControlButton } from '@xyflow/react';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';
import { useCanvas3DControls, type Canvas3DControls } from '../canvas3dControls';
import { CanvasRailToggle } from './CanvasRailToggle';
import { DepthIcon, DropToLayersIcon, LayerGuidesIcon, ResetViewIcon, ZoomInIcon, ZoomOutIcon } from './railIcons';

/**
 * The scene's own commands, in rail order. A command the scene does not publish
 * (`run` returns undefined) is simply not drawn — so a new 3D command is one row
 * here, not another branch in the rail.
 */
type ThreeDRailCommand =
  | {
    kind: 'toggle';
    id: string;
    /** `canvasCommands` catalog keys: the stable name, and the tooltip while on / off. */
    label: string;
    activeTitle: string;
    inactiveTitle: string;
    pressed: (controls: Canvas3DControls) => boolean;
    run: (controls: Canvas3DControls) => () => void;
    Icon: ComponentType;
  }
  | {
    kind: 'button';
    id: string;
    label: string;
    run: (controls: Canvas3DControls) => (() => void) | undefined;
    Icon: ComponentType;
  };

const THREE_D_RAIL_COMMANDS: readonly ThreeDRailCommand[] = [
  {
    kind: 'toggle',
    id: 'depth',
    label: 'threeD.depthGroup',
    activeTitle: 'threeD.depthGroupActive',
    inactiveTitle: 'threeD.depthGroupInactive',
    pressed: (c) => c.depthMode !== 'flow',
    run: (c) => c.toggleDepth,
    Icon: DepthIcon,
  },
  {
    kind: 'toggle',
    id: 'layers',
    label: 'threeD.layerGuides',
    activeTitle: 'threeD.layerGuidesActive',
    inactiveTitle: 'threeD.layerGuidesInactive',
    pressed: (c) => c.layersVisible,
    run: (c) => c.toggleLayers,
    Icon: LayerGuidesIcon,
  },
  { kind: 'button', id: 'dropToLayers', label: 'threeD.dropToLayers', run: (c) => c.dropToLayers, Icon: DropToLayersIcon },
  { kind: 'button', id: 'zoomIn', label: 'threeD.zoomIn', run: (c) => c.zoomIn, Icon: ZoomInIcon },
  { kind: 'button', id: 'zoomOut', label: 'threeD.zoomOut', run: (c) => c.zoomOut, Icon: ZoomOutIcon },
  { kind: 'button', id: 'reset', label: 'threeD.reset', run: (c) => c.resetView, Icon: ResetViewIcon },
];

/**
 * The scene's depth, layer, zoom and reset commands — the flat zoom, fit and lock
 * hand over to these while 3D is on. Nothing while the board is flat, or before the
 * scene has published its controls.
 */
export function ThreeDRailCommands({ threeDActive }: { threeDActive: boolean }) {
  const t = useTranslations('canvasCommands');
  // Published by the scene while it is on screen; null in the flat view.
  const threeD = useCanvas3DControls();
  if (!threeDActive || !threeD) return null;
  return <>
    {THREE_D_RAIL_COMMANDS.map((command) => {
      const { Icon } = command;
      if (command.kind === 'toggle') {
        return <CanvasRailToggle
          key={command.id}
          pressed={command.pressed(threeD)}
          onClick={command.run(threeD)}
          label={t(command.label)}
          activeTitle={t(command.activeTitle)}
          inactiveTitle={t(command.inactiveTitle)}
        >
          <Icon />
        </CanvasRailToggle>;
      }
      const run = command.run(threeD);
      return run ? <ControlButton key={command.id} onClick={run} aria-label={t(command.label)} title={t(command.label)}>
        <Icon />
      </ControlButton> : null;
    })}
  </>;
}
