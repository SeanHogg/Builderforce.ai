/**
 * @file csvParser.ts
 * @module @builderforce/resource-gap-engine
 * @description Minimal CSV ingestion implementation.
 *
 * Supports FR-1.1 and FR-1.2 (CSV upload of employees and project demand).
 * This pass covers the parsing logic only; integrations to Workday/BambooHR
 * and REST API ingress are out of scope per PRD (see Out-of-Scope section).
 *
 * Parses "comma-separated values" strings. Handles quoted fields and escaped quotes.
 */

import type { RGEmployee, RGProjectRequirement, RGQuarter, RGTeam, RGSkillRequirement, SeniorityBand } from "./types.js";

/** Parsed result plus normalization metadata. */
export interface CSVParseResult<T> {
  readonly records: ReadonlyArray<T>;
  readonly unmappedFields: ReadonlyArray<string>;
}

/** Parse employees from CSV text. Expected header (case-insensitive, order-agnostic):
 *  employeeId, role, team, orgUnitId, skills, location, utilization, [managerContactId]
 *
 *  skills format: "TypeScript:4,Kubernetes:3" (skill:level pairs separated by semicolons or commas).
 */
export function parseEmployeesCsv(
  csvText: string,
  options: { skillDelimiter?: string; pairDelimiter?: string; skillNormalizer?: (raw: string) => string } = {}
): CSVParseResult<RGEmployee> {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    return { records: [], unmappedFields: [] };
  }
  const header = normalizeHeader(rows[0]);
  const col = (name: string): number => header.indexOf(name.toLowerCase());

  const employeeIdIdx = col("employeeid");
  const roleIdx = col("role");
  const teamIdx = col("team");
  const orgUnitIdIdx = col("orgunitid");
  const skillsIdx = col("skills");
  const locationIdx = col("location");
  const utilizationIdx = col("utilization");
  const managerIdx = col("managercontactid");

  const requiredIndices = [
    [employeeIdIdx, "employeeId"],
    [roleIdx, "role"],
    [teamIdx, "team"],
    [orgUnitIdIdx, "orgUnitId"],
    [skillsIdx, "skills"],
    [locationIdx, "location"],
    [utilizationIdx, "utilization"],
  ] as const;
  const missingHeaders = requiredIndices
    .filter(([idx]) => idx === -1)
    .map(([, name]) => name);
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required employee CSV columns: ${missingHeaders.join(", ")}`);
  }

  const records: RGEmployee[] = [];
  const unmappedFields = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0].trim() === "") continue; // skip blank rows

    const skillsRaw = row[skillsIdx!] || "";
    const skills = parseSkills(skillsRaw, options);

    const employeeId = row[employeeIdIdx!]?.trim();
    if (!employeeId) continue;

    const team: RGTeam = {
      name: row[teamIdx!]?.trim() || "",
      orgUnitId: row[orgUnitIdIdx!]?.trim() || "",
    };

    const utilizationNum = Number(row[utilizationIdx!] || NaN);
    const utilization = Number.isFinite(utilizationNum)
      ? Math.max(0, Math.min(1, utilizationNum > 1 ? utilizationNum / 100 : utilizationNum))
      : 0;

    records.push({
      employeeId,
      role: row[roleIdx!]?.trim() || "",
      team,
      skills,
      location: row[locationIdx!]?.trim() || "",
      utilization,
      managerContactId: managerIdx >= 0 ? row[managerIdx]?.trim() || undefined : undefined,
    });
  }

  return { records, unmappedFields: Array.from(unmappedFields) };
}

/** Parse project demand/requirements from CSV text. Expected header:
 *  projectId, requiredSkills, seniorityBand, demandFte, quarters, [includeUnitSpecific]
 *
 *  requiredSkills format: "Go:3,Kubernetes:4"
 *  quarters format: "2026-Q1,2026-Q2,2026-Q3"
 *  includeUnitSpecific: truthy defaults to true
 */
export function parseProjectsCsv(
  csvText: string,
  options: { skillDelimiter?: string; pairDelimiter?: string } = {}
): CSVParseResult<RGProjectRequirement> {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    return { records: [], unmappedFields: [] };
  }
  const header = normalizeHeader(rows[0]);
  const col = (name: string): number => header.indexOf(name.toLowerCase());

  const projectIdIdx = col("projectid");
  const skillsIdx = col("requiredskills");
  const seniorityIdx = col("seniorityband");
  const demandIdx = col("demandfte");
  const quartersIdx = col("quarters");
  const includeUnitIdx = col("includeunitspecific");

  const requiredIndices: Array<readonly [number, string]> = [
    [projectIdIdx, "projectId"],
    [skillsIdx, "requiredSkills"],
    [seniorityIdx, "seniorityBand"],
    [demandIdx, "demandFte"],
    [quartersIdx, "quarters"],
  ];
  const missingHeaders = requiredIndices
    .filter(([idx]) => idx === -1)
    .map(([, name]) => name);
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required project CSV columns: ${missingHeaders.join(", ")}`);
  }

  const records: RGProjectRequirement[] = [];
  const unmappedFields: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 1 && row[0].trim() === "") continue;

    const projectId = row[projectIdIdx!]?.trim();
    if (!projectId) continue;

    const requiredSkills = parseSkillRequirements(row[skillsIdx!], options);
    const demandFteNum = Number(row[demandIdx!] || NaN);
    const demandFte = Number.isFinite(demandFteNum) ? demandFteNum : 0;

    const quarters = parseQuarters(row[quartersIdx!] || "");
    const seniorityBand = normalizeSeniority(row[seniorityIdx!]?.trim() || "");

    const includeUnitSpecificRaw = row[includeUnitIdx]?.trim();
    const includeUnitSpecific = includeUnitIdx >= 0 && includeUnitSpecificRaw
      ? /^(true|yes|1|y)$/i.test(includeUnitSpecificRaw)
      : true;

    records.push({
      projectId,
      requiredSkills,
      seniorityBand,
      demandFte,
      quarters,
      includeUnitSpecific,
    });
  }

  return { records, unmappedFields };
}

function parseCsvRows(csvText: string): ReadonlyArray<ReadonlyArray<string>> {
  const lines = csvText.split(/\r?\n/);
  return lines
    .filter((line, idx) => idx === 0 || line.trim() !== "")
    .map(parseCsvLine);
}

function parseCsvLine(line: string): ReadonlyArray<string> {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i += 1;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      i += 1;
    } else {
      current += ch;
      i += 1;
    }
  }
  fields.push(current);
  return fields;
}

function normalizeHeader(headerRow: ReadonlyArray<string>): ReadonlyArray<string> {
  return headerRow.map((h) => h.trim().toLowerCase().replace(/\s+/g, ""));
}

function parseSkills(
  raw: string,
  options: { skillDelimiter?: string; pairDelimiter?: string; skillNormalizer?: (raw: string) => string } = {}
): ReadonlyArray<{ name: string; level: 1 | 2 | 3 | 4 | 5 }> {
  const pairDelim = options.pairDelimiter ?? ";";
  const skillDelim = options.skillDelimiter ?? ",";
  // Support either skill:level separated by semicolons or commas.
  // Tolerate mixed delimiters: use both; filter empties.
  const pairs = raw
    .split(new RegExp(`[${pairDelim}${skillDelim}]`))
    .map((s) => s.trim())
    .filter(Boolean);
  const result: Array<{ name: string; level: 1 | 2 | 3 | 4 | 5 }> = [];
  for (const pair of pairs) {
    if (!pair.includes(":")) continue;
    const [nameRaw, levelRaw] = pair.split(":").map((s) => s.trim());
    if (!nameRaw) continue;
    const levelNum = Number(levelRaw);
    if (!Number.isFinite(levelNum)) continue;
    const level = clampProficiency(levelNum);
    const name = options.skillNormalizer ? options.skillNormalizer(nameRaw) : nameRaw;
    if (!result.find((s) => s.name === name)) {
      result.push({ name, level });
    }
  }
  return result;
}

function parseSkillRequirements(raw: string, options: { skillDelimiter?: string; pairDelimiter?: string } = {}): ReadonlyArray<RGSkillRequirement> {
  const skills = parseSkills(raw, options);
  return skills.map((s) => ({ skillName: s.name, minProficiency: s.level }));
}

function parseQuarters(raw: string): ReadonlyArray<RGQuarter> {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => parseQuarter(label));
}

export function parseQuarter(label: string): RGQuarter {
  const match = label.match(/^(\d{4})-Q([1-4])$/i);
  if (!match) {
    throw new Error(`Invalid quarter label: ${label}`);
  }
  const year = Number(match[1]);
  const quarter = Number(match[2]) as 1 | 2 | 3 | 4;
  return { label: `${year}-Q${quarter}`, quarter, year };
}

export function quarterToDate(quarter: RGQuarter): Date {
  const month = (quarter.quarter - 1) * 3;
  return new Date(Date.UTC(quarter.year, month, 1));
}

function normalizeSeniority(raw: string): SeniorityBand {
  const map: Record<string, SeniorityBand> = {
    entry: "Entry",
    junior: "Entry",
    early: "Early Professional",
    mid: "Mid",
    medium: "Mid",
    senior: "Senior",
    sr: "Senior",
    lead: "Lead",
    staff: "Staff",
    principal: "Principal",
    distinguished: "Distinguished",
  };
  const key = raw.toLowerCase().replace(/\s+/g, "");
  return map[key] || (raw as SeniorityBand);
}

function clampProficiency(n: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.round(n))) as 1 | 2 | 3 | 4 | 5;
}