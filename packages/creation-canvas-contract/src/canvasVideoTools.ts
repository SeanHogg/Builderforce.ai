/**
 * The canvas's two routes to MOVING pictures — named once, here, so the tool
 * descriptions, the guest-gated registry in `canvasTools.ts` and the refusal
 * below cannot drift apart (the `canvas_*` half of the prompt-tool-name contract).
 *
 *  • {@link CANVAS_VIDEO_TOOL} — one clip from one prompt, landed as a `video`
 *    object the timeline editor opens.
 *  • {@link CANVAS_SCENE_TOOL} — a story planned into shots, every shot rendered,
 *    and the shots cut together into a movie: a `scene` object (the shot list,
 *    re-renderable shot by shot) plus the `video` object holding the cut.
 *
 * Both are GUEST-GATED, not absent, for the reason that set exists: a model with no
 * video tool tells the user "I can't make videos", which is false about this canvas.
 */

export const CANVAS_VIDEO_TOOL = 'canvas_add_video';
export const CANVAS_SCENE_TOOL = 'canvas_create_scene';

/** Returned to the MODEL when a video tool is called on a canvas with no account. */
export const CANVAS_VIDEO_ACCOUNT_GATE = `${CANVAS_VIDEO_TOOL} and ${CANVAS_SCENE_TOOL} need a free Builderforce account: video is generated on the server, not in this browser. The account prompt is now open and the canvas is unchanged. Do BOTH of these in your reply: say in ONE sentence that the video needs a free account, and then build what this canvas CAN hold right now — the shot list, the script, the storyboard as authored objects — with canvas_add_object. Do NOT say that you are unable to make videos or that this is a technical limitation of the product: the only reason is the account, and it is one click away.`;
