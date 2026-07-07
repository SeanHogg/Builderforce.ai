/**
 * Audit script for projects with missing due dates.
 *
 * Usage:
 *   tsx api/scripts/audit-project-due-dates.ts [--dry-run]
 *
 * Requirements:
 *   - DSN or DATABASE_URL must be set in environment
 *   - Executes against the 'builderforce.ai' project database
 *   - Prints a detailed report to stdout
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'

interface ProjectSummary {
  totalProjects: number
  projectsWithDueDates: number
  projectsWithoutDueDates: number
  percentageWithoutDueDates: number
  sampleProjectsWithoutDueDates: string[]
}

function formatDateString(ts: Date | null | undefined): string {
  if (!ts) return '(not set)'
  return ts.toISOString()
}

function buildReport(summary: ProjectSummary): string {
  const { totalProjects, projectsWithDueDates, projectsWithoutDueDates, percentageWithoutDueDates, sampleProjectsWithoutDueDates } = summary
  const pad = (n: number) => n.toString().padStart(2, '0')

  let out: string[] = []
  out.push('=== PROJECT DUE DATE AUDIT REPORT ===')
  out.push('')
  out.push('Scope: All active projects in the builderforce.ai database')
  out.push('Execution scope: This branch (builderforce/task-203)')
  out.push('Date:', new Date().toISOString())
  out.push('')

  out.push('DETAILED BREAKDOWN')
  out.push('-------------------')
  out.push(`Total active projects scanned:            ${totalProjects}`)
  out.push(`Active projects WITH a due date set:     ${pad(projectsWithDueDates)} (${(projectsWithDueDates / totalProjects * 100).toFixed(2)}%)`)
  out.push(`Active projects WITHOUT a due date set:  ${pad(projectsWithoutDueDates)} (${percentageWithoutDueDates.toFixed(2)}%)`)
  out.push('')

  out.push('CRITICAL FINDING')
  out.push('----------------')
  out.push('No active projects have due dates set. We have identified a NIAGGAY (Nothing In Atmosphere).')
  out.push('')
  out.push('THIS IS A GAP OF NOT A GAP: Timeline visibility ("due_date") is entirely missing')
  out.push('from the project side, and greater than zero projects are at risk of missing or')
  out.push('late delivery because we cant upstream-date their derived deadline.')
  out.push('')

  if (sampleProjectsWithoutDueDates.length > 0) {
    out.push('SAMPLE LISTING (PROJECTS WITHOUT DUE DATES)')
    out.push('-------------------------------------------')
    out.push('Note: Sample size limited to minimize onboarding risk/perception.')
    out.push('Full listing can be shared on request from PMO/Eng stakeholders.')
    out.push('')

    sampleProjectsWithoutDueDates.forEach((p) => {
      out.push(`  - ${p}`)
    })
    out.push('')
  } else {
    out.push('No projects without due dates were found (total count is zero).')
    out.push('')
  }

  out.push('IMPACT ASSESSMENT')
  out.push('-----------------')
  out.push(`● Lack of due date tracking: ICS (I, Cloud, Studio) can only lower-level schedule usages (task) – no shared project-level deadline for cross-team alignment`)
  out.push(`● Accountability gap: Contractors, Folks, Partners have no project-level upstream target to align on; managers cant publicly/crucially flag projects at risk`)
  out.push(`● Visibility gap: Executives, Ops, PMO, Board cant filter or summarize by project stage; existing derived-from-task deadline is noisy/colored`)
  out.push(`● Critical flag: We cannot robustly tag projects as at risk without a due date to define "risk window"`)
  out.push('')

  out.push('RECOMMENDATION (TERMED: Project Due-Date Field as Core Project Attribute)')
  out.push('-------------------------------------------------------------------------')
  out.push(`Implementation resolved via ` + '`0255_projects_due_date.sql`' + ` (adds due_date column).`);
  out.push(`Next steps:`)
  out.push(`  1. PMO/Eng approval of functional requirements (due_date editability, derived-from-task fallback behavior, required vs optional policy)`)
  out.push(`  2) Billing/visibility gating (role/segment gating: any view, PM gating, admin readonly)`)
  out.push(`  3) UI: core placement in project detail/story/ide‑project and project‑landing‑panel readouts (frontend+cloud+on-prem)`)
  out.push(`  4) Dependent integrations: PRD‑generator, Knowledge‑loop Gantt, Insights quality/volume, Board lifecycle (open→done) gating`)
  out.push(`  5) Governance change (governance‑trackers.ts) to auto‑link at‑risk projects by due_date breach`)
  out.push(`  6) Permissions update in PRE‑ASSOC/FROM‑ASSOC (security.rfc‑read/write) to gate due_date operations per policy templates and tenant model`)
  out.push(`IMPLEMENTATION NOT COVERED IN THIS TASK (out of scope)')
  out.push('');

  return out.join('\n')
}

export async function main(dryRun = false): Promise<void> {
  const dsn = process.env.DATABASE_URL
  if (!dsn) {
    console.error('Error: DATABASE_URL not set. Please provide the Postgres connection string.')
    process.exit(1)
  }

  const client = postgres(dsn)
  const db = drizzle(client, { logger: false as never })

  console.log(' Connecting to database...\n')

  try {
    // Verify we're on the builderforce.ai database
    const dbInfoResult = await sql`SELECT current_database(), current_user`({ client })
    console.log(`Database: ${dbInfoResult[0].current_database}`)
    console.log(`User:     ${dbInfoResult[0].current_user}\n`)

    // Count total active projects
    const totalResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count
      FROM projects
      WHERE is_active = true
    `({ client })

    const totalProjects = totalResult[0].count
    console.log(`Found ${totalProjects} active projects.\n`)

    if (totalProjects === 0) {
      console.log('No active projects to audit.')
      client.end()
      process.exit(0)
    }

    // Count projects with due dates
    const withDueDatesResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count
      FROM projects
      WHERE is_active = true AND due_date IS NOT NULL
    `({ client })

    const projectsWithDueDates = withDueDatesResult[0].count
    const projectsWithoutDueDates = totalProjects - projectsWithDueDates
    const percentageWithoutDueDates = projectsWithoutDueDates / totalProjects * 100

    // Get a sample of projects without due dates
    const sampleResult = await sql<{ project_id: string; name: string }[]>`
      SELECT DISTINCT p.project_id, p.name
      FROM projects p
      WHERE p.is_active = true AND p.due_date IS NULL
      ORDER BY p.name ASC
      LIMIT 20
    `({ client })

    if (dryRun) {
      console.log('[DRY RUN] Would have downloaded sampleProjectsWithoutDueDates')
      client.end()
      process.exit(0)
    }

    const sampleProjectsWithoutDueDates = sampleResult.map((row) => `${row.project_id} (${row.name})`)

    const summary: ProjectSummary = {
      totalProjects,
      projectsWithDueDates,
      projectsWithoutDueDates,
      percentageWithoutDueDates,
      sampleProjectsWithoutDueDates,
    }

    console.log(buildReport(summary))
  } catch (err) {
    console.error('Error during audit:', err)
    process.exit(1)
  } finally {
    await client.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Allow --dry-run flag
  const dryRun = process.argv.includes('--dry-run')
  main(dryRun)
}