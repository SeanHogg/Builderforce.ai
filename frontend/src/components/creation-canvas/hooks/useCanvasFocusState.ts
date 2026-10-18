import { useState } from 'react';

/**
 * Which object each focused panel or mode is ABOUT — one value each, because each is a
 * different question about a different object:
 *
 *  - `frameFocus`: the section being worked on alone, a canvas within a canvas. It replaced
 *    a modal that mounted a SECOND workflow canvas over the board; focusing a frame is the
 *    same board showing one section, so the palette, Brain, undo and presence all still work.
 *  - `trainingFocus`: the object whose model is being trained.
 *  - `gameShipFocus`: the game whose SHIP panel is open — distribution, not play (playing is
 *    the `play` surface; a build in a drawer is a build nobody can judge).
 *  - `publishFocus`: the object being listed for sale — `''` publishes the whole board.
 *  - `releaseFocus`: Build → Stage → Live for one card. Held apart from `publishFocus`: "what
 *    is this and what does it cost" is a form, "which version is on sale and is the next one
 *    fit to be" is a lifecycle. `''` means the whole board.
 */
export function useCanvasFocusState() {
  const [frameFocus, setFrameFocus] = useState<string | null>(null);
  const [trainingFocus, setTrainingFocus] = useState<{ nodeId: string; projectId: number | string; localOnly: boolean } | null>(null);
  const [gameShipFocus, setGameShipFocus] = useState<string | null>(null);
  const [publishFocus, setPublishFocus] = useState<string | null>(null);
  const [releaseFocus, setReleaseFocus] = useState<string | null>(null);
  const [talktrackOpen, setTalktrackOpen] = useState(false);
  return {
    frameFocus, setFrameFocus, trainingFocus, setTrainingFocus, gameShipFocus, setGameShipFocus,
    publishFocus, setPublishFocus, releaseFocus, setReleaseFocus, talktrackOpen, setTalktrackOpen,
  };
}
