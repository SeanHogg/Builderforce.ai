"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/composerCommands/index.ts
var composerCommands_exports = {};
__export(composerCommands_exports, {
  HELP_COMMAND_ID: () => HELP_COMMAND_ID,
  createComposerCommandRegistry: () => createComposerCommandRegistry,
  describeComposerProblem: () => describeComposerProblem,
  parseComposerInput: () => parseComposerInput
});
module.exports = __toCommonJS(composerCommands_exports);

// src/composerCommands/parse.ts
var COMMAND = /^\/([a-z][a-z-]*)(?:\s|$)/;
function tokenize(rest) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}
function splitList(value) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}
function matchChoice(value, choices) {
  const wanted = value.toLowerCase();
  return choices.find((choice) => choice.value.toLowerCase() === wanted)?.value;
}
function checkChoices(name, values, choices, problems) {
  if (!choices) return values;
  return values.map((value) => {
    const canonical = matchChoice(value, choices);
    if (canonical === void 0) {
      problems.push({ code: "bad-choice", name, value, choices: choices.map((choice) => choice.value) });
      return value;
    }
    return canonical;
  });
}
function parseArguments(command, tokens) {
  const problems = [];
  const args = {};
  const positionals = [];
  const flagValues = /* @__PURE__ */ new Map();
  const flags = command.flags ?? [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--") || token.length === 2) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).toLowerCase();
    const flag = flags.find((candidate) => candidate.name === name);
    if (!flag) {
      problems.push({ code: "unknown-flag", name });
      continue;
    }
    let value;
    if (eq !== -1) value = token.slice(eq + 1);
    else if (index + 1 < tokens.length && !tokens[index + 1].startsWith("--")) value = tokens[++index];
    const values = value === void 0 ? [] : flag.multiple ? splitList(value) : [value];
    if (values.length === 0 || values.every((entry) => entry === "")) {
      problems.push({ code: "missing-value", name });
      continue;
    }
    const seen = flagValues.get(name);
    if (seen && !flag.multiple) {
      problems.push({ code: "duplicate-flag", name });
      continue;
    }
    flagValues.set(name, [...seen ?? [], ...checkChoices(name, values, flag.choices, problems)]);
  }
  let cursor = 0;
  for (const arg of command.args) {
    if (arg.multiple) {
      const values = positionals.slice(cursor).flatMap(splitList);
      cursor = positionals.length;
      if (values.length > 0) args[arg.name] = checkChoices(arg.name, values, arg.choices, problems);
      else if (arg.required) problems.push({ code: "missing-arg", name: arg.name });
      continue;
    }
    const value = positionals[cursor];
    if (value === void 0) {
      if (arg.required) problems.push({ code: "missing-arg", name: arg.name });
      continue;
    }
    cursor += 1;
    args[arg.name] = checkChoices(arg.name, [value], arg.choices, problems)[0];
  }
  for (const extra of positionals.slice(cursor)) problems.push({ code: "extra-arg", value: extra });
  for (const flag of flags) {
    const values = flagValues.get(flag.name);
    if (values) args[flag.name] = flag.multiple ? values : values[0];
    else if (flag.required) problems.push({ code: "missing-flag", name: flag.name });
  }
  return { args, problems };
}
function parseComposerInput(text, registry) {
  const trimmed = text.trim();
  if (trimmed.startsWith("//")) return { kind: "escaped", text: text.trimStart().slice(1) };
  const match = COMMAND.exec(trimmed);
  if (!match) return { kind: "message" };
  const name = match[1];
  const command = registry.get(name);
  if (!command) return { kind: "unknown", name };
  if (command.availability && !command.availability.ok) return { kind: "unavailable", id: command.id, reason: command.availability.reason };
  const { args, problems } = parseArguments(command, tokenize(trimmed.slice(match[0].length)));
  if (problems.length > 0) return { kind: "invalid", id: command.id, problems };
  return { kind: "command", id: command.id, args, raw: trimmed };
}
function describeComposerProblem(problem) {
  switch (problem.code) {
    case "missing-arg":
      return `Missing <${problem.name}>`;
    case "missing-flag":
      return `Missing --${problem.name}`;
    case "missing-value":
      return `--${problem.name} needs a value`;
    case "bad-choice":
      return `"${problem.value}" is not a valid ${problem.name} (one of: ${problem.choices.join(", ")})`;
    case "unknown-flag":
      return `Unknown option --${problem.name}`;
    case "duplicate-flag":
      return `--${problem.name} was given twice`;
    case "extra-arg":
      return `Unexpected "${problem.value}"`;
  }
}

// src/composerCommands/registry.ts
var HELP_COMMAND_ID = "help";
var COMMAND_ID = /^[a-z][a-z-]*$/;
function helpCommand(ids) {
  return {
    id: HELP_COMMAND_ID,
    syntax: "/help [command]",
    args: [{ name: "command", required: false, choices: ids.map((value) => ({ value })) }],
    example: ids[0] ? `/help ${ids[0]}` : "/help"
  };
}
function toHelpEntry(command, labels) {
  const flags = command.flags ?? [];
  return {
    id: command.id,
    syntax: command.syntax,
    description: labels.describe(command.id),
    args: command.args,
    flags,
    example: command.example,
    availability: command.availability ?? { ok: true },
    runnable: !command.args.some((arg) => arg.required) && !flags.some((flag) => flag.required),
    insertText: `/${command.id} `
  };
}
function createComposerCommandRegistry(entries, labels) {
  const seen = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    if (!COMMAND_ID.test(entry.id)) throw new Error(`Composer command id "${entry.id}" must match ${COMMAND_ID}`);
    if (entry.id === HELP_COMMAND_ID) throw new Error('Composer command "help" is built in');
    if (seen.has(entry.id)) throw new Error(`Composer command "${entry.id}" is registered twice`);
    seen.add(entry.id);
  }
  const commands = [helpCommand(entries.map((entry) => entry.id)), ...entries];
  const byId = new Map(commands.map((command) => [command.id, command]));
  const all = () => commands.map((command) => toHelpEntry(command, labels));
  const helpForUnknown = (name) => ({ entries: all(), unknown: name });
  return {
    list: () => commands,
    get: (id) => byId.get(id),
    help: (id) => {
      if (id === void 0) return { entries: all() };
      const command = byId.get(id.toLowerCase());
      return command ? { entries: [toHelpEntry(command, labels)] } : helpForUnknown(id);
    },
    helpForUnknown
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HELP_COMMAND_ID,
  createComposerCommandRegistry,
  describeComposerProblem,
  parseComposerInput
});
//# sourceMappingURL=composerCommands.cjs.map