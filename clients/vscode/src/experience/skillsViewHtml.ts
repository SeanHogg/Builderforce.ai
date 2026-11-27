import { SKILLS_CLIENT_CORE } from "./skillsClientCore";
import { SKILLS_CLIENT_SKILLS } from "./skillsClientSkills";
import { SKILLS_CLIENT_TEACH } from "./skillsClientTeach";
import { SKILLS_CSS } from "./skillsViewStyles";

/**
 * The Skills view's document: a self-contained page (no bundle, no remote origin) under a
 * nonce'd CSP that allows nothing but its own inline style and script. Pure, so the
 * shell's policy is testable without a webview.
 */
export function renderSkillsHtml(input: { nonce: string; title: string }): string {
  const { nonce, title } = input;
  const csp = ["default-src 'none'", `style-src 'nonce-${nonce}'`, `script-src 'nonce-${nonce}'`].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">${SKILLS_CSS}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">
${SKILLS_CLIENT_CORE}
${SKILLS_CLIENT_TEACH}
${SKILLS_CLIENT_SKILLS}
boot();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
