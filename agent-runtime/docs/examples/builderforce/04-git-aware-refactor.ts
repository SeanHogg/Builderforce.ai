/**
 * Example 4: Git-Aware Refactoring
 *
 * This example demonstrates using git history awareness to guide refactoring:
 * - Analyze commit history
 * - Identify frequently changed files
 * - Track authorship and evolution
 * - Guide refactoring decisions based on change patterns
 */

async function main() {
  console.log("🤖 Git-Aware Refactoring Example\n");

  console.log("Git History Awareness Features:\n");

  console.log("1. Commit History Analysis");
  console.log("   - Track file evolution over time");
  console.log("   - Identify change hotspots");
  console.log("   - Understand architectural evolution");

  console.log("\n2. Authorship Tracking (git blame)");
  console.log("   - Identify code ownership");
  console.log("   - Track expertise areas");
  console.log("   - Coordinate with right developers");

  console.log("\n3. Change Pattern Detection");
  console.log("   - Files frequently changed together");
  console.log("   - Common refactoring targets");
  console.log("   - Technical debt indicators");

  console.log("\n4. Smart Refactoring Guidance");
  console.log("   - Prioritize high-churn areas");
  console.log("   - Identify coupling issues");
  console.log("   - Suggest module boundaries");

  console.log("\n✓ Example Analysis Output:");
  console.log(`
Repository Analysis:
  Total commits: 1,247
  Unique authors: 8
  Date range: 2024-01-15 to 2026-02-19
  
Hot Spots (most changed files):
  1. src/agents/pi-tools.ts - 47 commits
  2. src/builderforce/orchestrator.ts - 31 commits
  3. src/transport/runtime.ts - 28 commits
  
Refactoring Recommendations:
  ⚠ High churn detected in pi-tools.ts
    → Consider breaking into smaller modules
    → 5 different authors modified this file
    → 47 commits in 90 days suggests instability
    
  ✓ Stable modules:
    - src/builderforce/types.ts (3 commits, well-defined)
    - src/security/types.ts (5 commits, stable interface)
    
Coupling Analysis:
  Files often changed together:
    - pi-tools.ts ↔ pi-embedded-runner.ts (23 co-commits)
    → Suggests strong coupling, consider refactoring
    
Architecture Evolution:
  Phase 1: Local-only execution (commits 1-500)
  Phase 2: Distributed runtime added (commits 501-900)
  Current: Multi-agent orchestration (commits 901+)
  `);

  console.log("\n✓ Git Integration Enables:");
  console.log("  - Data-driven refactoring decisions");
  console.log("  - Identification of problem areas");
  console.log("  - Understanding of codebase evolution");
  console.log("  - Coordination with development team");
  console.log("  - Preservation of domain knowledge");
}

main().catch(console.error);
