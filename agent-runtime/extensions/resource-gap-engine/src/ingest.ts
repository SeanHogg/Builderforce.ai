/**
 * FR-1 — Data ingestion & normalization
 *
 * Parses employee & demand CSVs (common export shape) into typed records,
 * applying discipline, and reporting unmapped skills.
 *
 * CSV shape note: We accept permissive header aliases and attempt best-effort
 * parsing; strict schema enforcement belongs in higher-level validation.
 * Row-level issues produce IngestError entries rather than aborting.
 */

import type {
  Employee,
  EmployeeSkill,
  IngestError,
  IngestResult,
  ProjectDemand,
  ProjectDemandSkill,
  SeniorityBand,
  SkillProficiency,
  UnmappedSkill,
} from "./types.js";
import { isUnmappedSkill, resolveCanonicalSkillId } from "./configuration.js";
import type { SkillTaxonomyConfig } from "./configuration.js";

// ── Header utilities ─────────────────────────────────────────────────

type FieldMapping = Record<string, string[]>; // canonical → aliases (lowercased)

const EMPLOYEE_HEADERS: FieldMapping = {
  id: ["id", "employee_id", "emp_id", "uid", "employeeid"],
  name: ["name", "employee_name", "display_name", "fullname", "full_name"],
  currentrole: ["currentrole", "current_role", "role", "title", "job_title"],
  seniority: ["seniority", "seniority_band", "level", "band"],
  team: ["team", "team_name", "org_unit", "org", "department"],
  location: ["location", "geo", "region", "site", "country"],
  availabilitypct: [
    "availabilitypct",
    "availability_pct",
    "availability",
    "avail",
    "availability%",
    "percent",
  ],
  // skills can be multiple syntaxes: skills: "typescript:4, react:3", or json, or separate rows
  skills: ["skills", "skill", "skills_json", "skill_inventory", "skill_proficiency"],
  managercontact: ["managercontact", "manager_contact", "manager", "manager_email"],
  currentprojectenddate: [
    "currentprojectenddate",
    "current_project_end_date",
    "project_end",
    "assignment_end",
  ],
};

const DEMAND_HEADERS: FieldMapping = {
  projectid: ["projectid", "project_id", "project", "pid"],
  projectname: ["projectname", "project_name", "name"],
  team: ["team", "requesting_team", "team_name", "org_unit"],
  location: ["location", "geo", "site"],
  requiredseniority: ["requiredseniority", "required_seniority", "seniority", "band"],
  requiredskills: [
    "requiredskills",
    "required_skills",
    "skills",
    "demanded_skills",
    "skills_json",
  ],
  // supports paired FTE column: either embedded in skills json or separate fte column
  ftedemand: ["ftedemand", "fte_demand", "fte", "headcount_demand"],
  demandstartquarter: [
    "demandstartquarter",
    "start_quarter",
    "demand_start_q",
    "start_q",
    "demandstart",
    "start_date",
  ],
  demandendquarter: [
    "demandendquarter",
    "end_quarter",
    "demand_end_q",
    "end_q",
    "demandend",
    "end_date",
  ],
};

function normalizeHeaderKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findColumnIndex(
  headerRow: string[],
  canonicalField: string,
  mapping: FieldMapping,
): number {
  const aliases = (mapping[canonicalField] ?? [canonicalField]).map((a) =>
    normalizeHeaderKey(a),
  );
  for (let i = 0; i < headerRow.length; i++) {
    const norm = normalizeHeaderKey(headerRow[i]);
    if (aliases.includes(norm)) return i;
  }
  return -1;
}

function parseCsv(text: string): string[][] {
  // RFC-ish minimal CSV parser: handles quoted fields, CRLF, basic escapes.
  const rows: string[][] = [];
  const curRow: string[] = [];
  let cur = "";
  let inQuote = false;
  let i = 0;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < s.length) {
    const c = s[i];
    if (inQuote) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuote = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    // not in quote
    if (c === '"') {
      inQuote = true;
      i++;
      continue;
    }
    if (c === ",") {
      curRow.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (c === "\n") {
      curRow.push(cur);
      cur = "";
      if (curRow.length > 1 || curRow[0] !== "" || rows.length === 0) {
        // Avoid final trailing newline creating empty row; but keep header empty check elsewhere.
        rows.push([...curRow]);
      } else {
        // empty line
        rows.push([...curRow]);
      }
      curRow.length = 0;
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  // last row may not end with newline
  if (cur !== "" || curRow.length > 0) {
    curRow.push(cur);
    rows.push([...curRow]);
  }
  // Trim trailing fully-empty row(s)
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }
  return rows;
}

// ── Skill token parsers ──────────────────────────────────────────────

function parseProficiencyToken(v: string): SkillProficiency | null {
  const n = Number(v.trim());
  if ([1, 2, 3, 4, 5].includes(n)) return n as SkillProficiency;
  return null;
}

function parseEmployeeSkills(raw: string): EmployeeSkill[] {
  raw = (raw ?? "").trim();
  if (!raw) return [];
  // Try JSON first
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const skills: EmployeeSkill[] = [];
      for (const e of arr as any[]) {
        if (!e || typeof e !== "object") continue;
        const sid = String((e.skillId ?? e.skill_id ?? e.skill ?? "") as string).trim();
        if (!sid) continue;
        const prof =
          (parseProficiencyToken(String(e.proficiency ?? e.level ?? e.minProficiency ?? "")) ??
            3) as SkillProficiency;
        skills.push({ skillId: sid, proficiency: prof, lastAssessedAt: e.lastAssessedAt });
      }
      return skills;
    } catch {
      // fall through to token parser
    }
  }
  // Token format: "typescript:4, react:3, python" (missing proficiency → 3)
  const tokens = raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const result: EmployeeSkill[] = [];
  for (const token of tokens) {
    const parts = token.split(":").map((p) => p.trim());
    if (parts.length >= 2) {
      const sid = parts[0];
      const prof = parseProficiencyToken(parts[1]);
      result.push({ skillId: sid, proficiency: prof ?? (3 as SkillProficiency) });
    } else if (parts.length === 1 && parts[0]) {
      result.push({ skillId: parts[0], proficiency: 3 as SkillProficiency });
    }
  }
  return result;
}

function parseRequiredSkills(raw: string, fallbackFte: number): ProjectDemandSkill[] {
  raw = (raw ?? "").trim();
  if (!raw) return [];
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const out: ProjectDemandSkill[] = [];
      for (const e of arr as any[]) {
        if (!e || typeof e !== "object") continue;
        const sid = String((e.skillId ?? e.skill_id ?? e.skill ?? "") as string).trim();
        if (!sid) continue;
        const minProf =
          (parseProficiencyToken(
            String(e.minProficiency ?? e.proficiency ?? e.level ?? ""),
          ) ?? 3) as SkillProficiency;
        const fte = Number(e.fteDemand ?? e.fte ?? fallbackFte);
        out.push({
          skillId: sid,
          minProficiency: minProf,
          fteDemand: Number.isFinite(fte) && fte > 0 ? fte : fallbackFte,
        });
      }
      return out;
    } catch {
      // fall through
    }
  }
  const tokens = raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const result: ProjectDemandSkill[] = [];
  for (const token of tokens) {
    // Formats: "typescript:4:1.5" or "typescript:4" or "typescript"
    const parts = token.split(":").map((p) => p.trim());
    const sid = parts[0];
    if (!sid) continue;
    let minProf = 3 as SkillProficiency;
    let fte = fallbackFte;
    if (parts.length >= 2) minProf = parseProficiencyToken(parts[1]) ?? minProf;
    if (parts.length >= 3) {
      const pfte = Number(parts[2]);
      if (Number.isFinite(pfte) && pfte > 0) fte = pfte;
    }
    result.push({ skillId: sid, minProficiency: minProf, fteDemand: fte });
  }
  return result;
}

function parseSeniority(raw: string): SeniorityBand {
  const v = normalizeHeaderKey(raw ?? "");
  if (["junior", "jr", "entry", "assoc"].includes(v)) return "junior";
  if (["mid", "middle", "intermediate"].includes(v)) return "mid";
  if (["senior", "sr"].includes(v)) return "senior";
  if (["staff", "lead", "principal"].includes(v)) {
    if (v === "principal") return "principal";
    return "staff";
  }
  return "mid";
}

// Compact quarter parsing: "2026-Q2", "2026Q2", "Q2 2026", "2026/2", "2026-04-01", etc → "YYYY-Qn"
// Anything unrecognized is passed through (engine will normalize leniently).
function normalizeQuarterInput(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return s;
  // 2026-Q2 / 2026Q2 / 2026 Q2
  const m1 = s.match(/(19|20)\d{2}\s*[-/. ]*\s*Q?\s*([1-4])/i);
  if (m1) {
    const year = m1[0].match(/(19|20)\d{2}/)?.[0] ?? "";
    const q = m1[2];
    return `${year}-Q${q}`;
  }
  // Q2 2026
  const m2 = s.match(/Q\s*([1-4])\s*[-/. ]*\s*((19|20)\d{2})/i);
  if (m2) return `${m2[2]}-Q${m2[1]}`;
  // ISO date → quarter
  const dt = Date.parse(s);
  if (!Number.isNaN(dt)) {
    const d = new Date(dt);
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${d.getFullYear()}-Q${q}`;
  }
  return s;
}

function parsePct(raw: string): number {
  const s = (raw ?? "").trim().replace("%", "");
  if (!s) return 100;
  const n = Number(s);
  if (!Number.isFinite(n)) return 100;
  if (n < 0) return 0;
  if (n > 100 && n <= 1) return n * 100; // fractional? rare
  if (n >= 0 && n <= 1) return n * 100; // 0.8 → 80
  if (n > 100) return 100;
  return n;
}

// ── Unmapped skill aggregation ───────────────────────────────────────

function collectUnmapped(
  skills: { skillId: string }[],
  taxonomy: SkillTaxonomyConfig,
): UnmappedSkill[] {
  const counts = new Map<string, { count: number; exampleContext?: string }>();
  for (const entry of skills) {
    const rawId = entry.skillId;
    if (isUnmappedSkill(taxonomy, rawId)) {
      const cur = counts.get(rawId) ?? { count: 0 };
      cur.count += 1;
      counts.set(rawId, cur);
    }
  }
  const out: UnmappedSkill[] = [];
  for (const [skillId, v] of counts) {
    out.push({ skillId, occurrenceCount: v.count, exampleContext: v.exampleContext });
  }
  return out;
}

// ── Public parsers ───────────────────────────────────────────────────

export function parseEmployeesCsv(
  csvText: string,
  taxonomy: SkillTaxonomyConfig,
): IngestResult<Employee> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return {
      records: [],
      errors: [{ rowIndex: 0, message: "empty CSV" }],
      unmappedSkills: [],
      summary: { total: 0, accepted: 0, errorCount: 1, unmappedCount: 0 },
    };
  }
  const headers = rows[0] ?? [];

  const idx = {
    id: findColumnIndex(headers, "id", EMPLOYEE_HEADERS),
    name: findColumnIndex(headers, "name", EMPLOYEE_HEADERS),
    currentRole: findColumnIndex(headers, "currentrole", EMPLOYEE_HEADERS),
    seniority: findColumnIndex(headers, "seniority", EMPLOYEE_HEADERS),
    team: findColumnIndex(headers, "team", EMPLOYEE_HEADERS),
    location: findColumnIndex(headers, "location", EMPLOYEE_HEADERS),
    availabilityPct: findColumnIndex(headers, "availabilitypct", EMPLOYEE_HEADERS),
    skills: findColumnIndex(headers, "skills", EMPLOYEE_HEADERS),
    managerContact: findColumnIndex(headers, "managercontact", EMPLOYEE_HEADERS),
    currentProjectEndDate: findColumnIndex(
      headers,
      "currentprojectenddate",
      EMPLOYEE_HEADERS,
    ),
  };

  const records: Employee[] = [];
  const errors: IngestError[] = [];
  const allSkillInputs: { skillId: string }[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c.trim())) continue;

    const get = (j: number): string => (j >= 0 && j < row.length ? row[j] : "");
    const id = get(idx.id).trim();
    const currentRole = get(idx.currentRole).trim() || get(idx.team).trim() || "IC";

    if (!id) {
      errors.push({ rowIndex: r + 1, message: "missing employee id", field: "id" });
      continue;
    }

    const name = get(idx.name).trim() || undefined;
    const seniorityRaw = get(idx.seniority);
    const team = get(idx.team).trim() || "unknown";
    const location = get(idx.location).trim() || "remote";
    const skillsRaw = get(idx.skills).trim();
    let skills = parseEmployeeSkills(skillsRaw);
    allSkillInputs.push(...skills.map((s) => ({ skillId: s.skillId })));

    // Apply canonical mapping for stored record. Keep original identity for flagging — resolved id replaces skillId.
    skills = skills.map((s) => ({
      ...s,
      skillId: resolveCanonicalSkillId(taxonomy, s.skillId),
    }));

    // Validate proficiency range
    for (const s of skills) {
      if (![1, 2, 3, 4, 5].includes(s.proficiency)) {
        (s as any).proficiency = 3 as SkillProficiency;
      }
    }

    const availabilityPct = parsePct(get(idx.availabilityPct));

    const rec: Employee = {
      id,
      name,
      currentRole,
      seniority: parseSeniority(seniorityRaw),
      team,
      location,
      availabilityPct,
      skills,
      managerContact: get(idx.managerContact).trim() || undefined,
      currentProjectEndDate: get(idx.currentProjectEndDate).trim() || undefined,
    };
    records.push(rec);
  }

  const unmappedSkills = collectUnmapped(allSkillInputs, taxonomy);

  return {
    records,
    errors,
    unmappedSkills,
    summary: {
      total: rows.length - 1,
      accepted: records.length,
      errorCount: errors.length,
      unmappedCount: unmappedSkills.reduce((sum, u) => sum + u.occurrenceCount, 0),
    },
  };
}

export function parseDemandsCsv(
  csvText: string,
  taxonomy: SkillTaxonomyConfig,
): IngestResult<ProjectDemand> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return {
      records: [],
      errors: [{ rowIndex: 0, message: "empty CSV" }],
      unmappedSkills: [],
      summary: { total: 0, accepted: 0, errorCount: 1, unmappedCount: 0 },
    };
  }
  const headers = rows[0] ?? [];

  const idx = {
    projectId: findColumnIndex(headers, "projectid", DEMAND_HEADERS),
    projectName: findColumnIndex(headers, "projectname", DEMAND_HEADERS),
    team: findColumnIndex(headers, "team", DEMAND_HEADERS),
    location: findColumnIndex(headers, "location", DEMAND_HEADERS),
    requiredSeniority: findColumnIndex(headers, "requiredseniority", DEMAND_HEADERS),
    requiredSkills: findColumnIndex(headers, "requiredskills", DEMAND_HEADERS),
    fteDemand: findColumnIndex(headers, "ftedemand", DEMAND_HEADERS),
    demandStartQuarter: findColumnIndex(headers, "demandstartquarter", DEMAND_HEADERS),
    demandEndQuarter: findColumnIndex(headers, "demandendquarter", DEMAND_HEADERS),
  };

  const records: ProjectDemand[] = [];
  const errors: IngestError[] = [];
  const allSkillInputs: { skillId: string }[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c.trim())) continue;

    const get = (j: number): string => (j >= 0 && j < row.length ? row[j] : "");
    const projectId = get(idx.projectId).trim();
    if (!projectId) {
      errors.push({ rowIndex: r + 1, message: "missing project id", field: "projectId" });
      continue;
    }

    const fteRaw = get(idx.fteDemand).trim();
    let fteFallback = 1;
    if (fteRaw) {
      const n = Number(fteRaw);
      if (Number.isFinite(n) && n > 0) fteFallback = n;
    }

    const requiredSkillsRaw = get(idx.requiredSkills).trim() || get(idx.team).trim();
    let requiredSkills = parseRequiredSkills(requiredSkillsRaw, fteFallback);
    if (requiredSkills.length === 0 && fteRaw) {
      // Skill list missing but FTE present — allow single-skill fallback when team present as placeholder? No, leave empty and flag.
    }

    allSkillInputs.push(...requiredSkills.map((s) => ({ skillId: s.skillId })));

    requiredSkills = requiredSkills.map((s) => ({
      ...s,
      skillId: resolveCanonicalSkillId(taxonomy, s.skillId),
    }));

    const rec: ProjectDemand = {
      projectId,
      projectName: get(idx.projectName).trim() || undefined,
      team: get(idx.team).trim() || undefined,
      location: get(idx.location).trim() || undefined,
      requiredSeniority: get(idx.requiredSeniority).trim()
        ? parseSeniority(get(idx.requiredSeniority))
        : undefined,
      requiredSkills,
      demandStartQuarter: normalizeQuarterInput(get(idx.demandStartQuarter)) || "2026-Q1",
      demandEndQuarter:
        normalizeQuarterInput(get(idx.demandEndQuarter)) ||
        normalizeQuarterInput(get(idx.demandStartQuarter)) ||
        "2026-Q1",
    };
    records.push(rec);
  }

  const unmappedSkills = collectUnmapped(allSkillInputs, taxonomy);

  return {
    records,
    errors,
    unmappedSkills,
    summary: {
      total: rows.length - 1,
      accepted: records.length,
      errorCount: errors.length,
      unmappedCount: unmappedSkills.reduce((sum, u) => sum + u.occurrenceCount, 0),
    },
  };
}
