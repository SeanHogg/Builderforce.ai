/**
 * Quality Improvement Service (Kotlin)
 *
 * Automated bug triage and remediation suggestions for the Builderforce platform.
 */

package com.builderforce.quality

import BugIngestionService
import BugAnalysisService
import RecommendationEngine
import HumanApprovalGate
import QualityConfiguration
import QualityTriage
import Recommendation
import Hotspot
import DefectDensityScore

/**
 * Quality Improvement Service - Main entry point
 *
 * Provides bug count ingestion, analysis, and recommendation generation when defects exceed thresholds.
 */
object QualityTriageService {
    
    private var currentBugs: List<Bug> = emptyList()
    private var analysisService: BugAnalysisService? = null
    private var recommendationEngine: RecommendationEngine? = null
    private var approvalGate = HumanApprovalGate()
    private var qualityConfig: QualityConfiguration? = null

    /**
     * Initialize the quality triage service
     */
    fun initialize(config: QualityConfiguration) {
        qualityConfig = config
        
        // Create services
        val ingestionService = BugIngestionService(config)
        
        // Services will be created by the orchestrator
    }

    /**
     * Run complete quality improvement workflow
     */
    suspend fun analyze(projectId: String? = null, since: String? = null): QualityAnalysisResult {
        println("🔍 Starting Quality Improvement analysis...")
        println("  Project: ${projectId ?: "default"}")
        println("  Since: ${since ?: "last 7 days"}")
        println()

        // Step 1: Ingest bugs
        println("📥 Ingesting bugs from issue trackers...")
        val ingestionService = BugIngestionService(qualityConfig ?: QualityConfiguration.default())
        val bugs = ingestionService.ingestBugs(projectId, since)
        currentBugs = bugs

        println("✓ Ingested ${bugs.size} bugs")
        println()

        // Exit early if no bugs
        if (bugs.isEmpty()) {
            println("ℹ️  No bugs found - nothing to triage")
            return QualityAnalysisResult.Completed(
                totalBugs = 0,
                hotspots = emptyList(),
                recommendations = emptyList(),
                thresholdBreaches = emptyList()
            )
        }

        // Step 2: Analyze
        println("🔬 Analyzing bug data...")
        val analysis = analysisService ?: BugAnalysisService(bugs, qualityConfig ?: QualityConfiguration.default())
        val scores = analysis.computeDefectDensityScores()
        val hotspots = analysis.identifyHotspots(scores)
        val recurrences = analysis.detectRecurrencePatterns()

        println("✓ Identified ${hotspots.size} hotspots")
        println("✓ Detected ${recurrences.size} recurrence patterns")
        println()

        // Step 3: Generate recommendations
        println("💡 Generating recommendations...")
        recommendationEngine = RecommendationEngine(
            hotspots = hotspots,
            recurrencePatterns = convertPatterns(recurrences),
            bugs = bugs,
            qualityConfig = qualityConfig ?: QualityConfiguration.default()
        )

        val recommendations = recommendationEngine.generateRecommendations(
            limit = qualityConfig?.recommendationTopN ?: 5,
            includeTesting = true,
            includeReview = true,
            includeRefactoring = true,
            includeRecurrenceWarnings = true
        )

        println("✓ Generated ${recommendations.size} recommendations")
        println()

        // Step 4: Submit for approval
        approvalGate = HumanApprovalGate()
        
        val thresholdBreaches = scores
            .filter { it.isAboveThreshold }
            .map { it.modulePath }

        println("✅ Quality Improvement analysis complete!")
        println()

        return QualityAnalysisResult.Completed(
            totalBugs = bugs.size,
            hotspots = hotspots,
            recommendations = recommendations,
            thresholdBreaches = thresholdBreaches
        )
    }

    /**
     * Analyze a specific module
     */
    suspend fun analyzeModule(modulePath: String): QualityAnalysisResult {
        println("🔍 Analyzing module: $modulePath")

        val bugs = currentBugs.filter { 
            it.files.contains(modulePath) || it.modules.contains(modulePath)
        }

        if (bugs.isEmpty()) {
            return QualityAnalysisResult.Completed(
                totalBugs = 0,
                hotspots = emptyList(),
                recommendations = emptyList(),
                thresholdBreaches = emptyList()
            )
        }

        val analysis = analysisService ?: BugAnalysisService(bugs, qualityConfig ?: QualityConfiguration.default())
        val analysis = analysis.analyze()
        val moduleHotspots = analysis.hotspots.filter { it.modulePath == modulePath }

        recommendationEngine = RecommendationEngine(
            hotspots = moduleHotspots,
            recurrencePatterns = convertPatterns(analysis.recurrencePatterns),
            bugs = bugs,
            qualityConfig = qualityConfig ?: QualityConfiguration.default()
        )

        val recommendations = recommendationEngine.generateRecommendations(
            limit = 3,
            includeTesting = true,
            includeReview = true,
            includeRefactoring = true,
            includeRecurrenceWarnings = true
        )

        println("✅ Module analysis complete: ${recommendations.size} recommendations")

        return QualityAnalysisResult.Completed(
            totalBugs = bugs.size,
            hotspots = moduleHotspots,
            recommendations = recommendations,
            thresholdBreaches = listOf(modulePath)
        )
    }

    /**
     * Convert Kotlin patterns to Dart format
     */
    private fun convertPatterns(patterns: List<RecurrencePattern>): Map<String, RecurrenceData> {
        return patterns.associate { p -> p.file to RecurrenceData(p.file, p.recurrenceCount, p.lastBugDate) }
    }

    /**
     * Get approval state
     */
    fun getApprovalState(recommendationId: String): ApprovalState? {
        return approvalGate.getApprovalState(recommendationId)
    }

    /**
     * Approve a recommendation
     */
    fun approveRecommendation(
        recommendationId: String,
        approverName: String,
        agentProposal: Map<String, Any>? = null
    ): Boolean {
        return approvalGate.approve(
            recommendationId,
            approverName,
            agentProposal?.toDartMap()
        )
    }

    /**
     * Reject a recommendation
     */
    fun rejectRecommendation(
        recommendationId: String,
        reason: String
    ): Boolean {
        return approvalGate.reject(recommendationId, reason)
    }

    /**
     * Export results
     */
    fun exportResults(): QualityExport {
        val analysis = analysisService ?: BugAnalysisService(currentBugs, qualityConfig ?: QualityConfiguration.default())
        val scores = analysis.computeDefectDensityScores()

        return QualityExport(
            bugs = currentBugs.size,
            hotspots = analysis.identifyHotspots(scores),
            thresholdBreaches = scores
                .filter { it.isAboveThreshold }
                .map { it.modulePath }
        )
    }
}

/**
 * Quality Analysis Result sealed class
 */
sealed class QualityAnalysisResult {
    data class Completed(
        val totalBugs: Int,
        val hotspots: List<Hotspot>,
        val recommendations: List<Recommendation>,
        val thresholdBreaches: List<String>
    ) : QualityAnalysisResult()
}

/**
 * Quality Export data class
 */
data class QualityExport(
    val bugs: Int,
    val hotspots: List<Hotspot>,
    val thresholdBreaches: List<String>
)

/**
 * Recurrence pattern data for type compatibility
 */
data class RecurrenceData(
    val file: String,
    val recurrenceCount: Int,
    val lastBugDate: String
)

/**
 * Approval state
 */
data class ApprovalState(
    val approved: Boolean,
    val approvedAt: String,
    val approvedBy: String,
    val agentProposal: Map<String, Any>?
)

/**
 * Quality configuration with defaults
 */
data class QualityConfiguration(
    val thresholds: Thresholds = Thresholds.default(),
    val weights: SeverityWeights = SeverityWeights(),
    val recommendationTopN: Int = 5,
    val integrations: Integrations = Integrations()
) {
    companion object {
        fun default(): QualityConfiguration {
            return QualityConfiguration(
                thresholds = Thresholds.default(),
                weights = SeverityWeights(),
                recommendationTopN = 5,
                integrations = Integrations()
            )
        }
    }
}

/**
 * Thresholds configuration
 */
data class Thresholds(
    val repository: Int = 50,
    val module: Int = 15,
    val file: Int = 3
) {
    companion object {
        fun default(): Thresholds {
            return Thresholds()
        }
    }
}

/**
 * Severity weights
 */
data class SeverityWeights(
    val critical: Int = 3,
    val major: Int = 2,
    val minor: Int = 1
)

/**
 * Integrations configuration
 */
data class Integrations(
    val slack: SlackConfig? = null,
    val teams: TeamsConfig? = null,
    val issueTrackers: Map<String, IssueTrackerConfig> = emptyMap(),
    val qualityServer: QualityServerConfig? = null
)

/**
 * Slack configuration
 */
data class SlackConfig(
    val enabled: Boolean = true,
    val webhookUrl: String? = null,
    val channel: String = "#engineers"
)

/**
 * Microsoft Teams configuration
 */
data class TeamsConfig(
    val enabled: Boolean = true,
    val webhookUrl: String? = null
)

/**
 * Issue tracker configuration
 */
data class IssueTrackerConfig(
    val type: String, // github, jira, linear, azure_devops
    val enabled: Boolean = true,
    val token: String? = null,
    val baseUrl: String? = null
)

/**
 * Quality server configuration
 */
data class QualityServerConfig(
    val requireHumanApproval: Boolean = true,
    val apiEndpoint: String = "/quality/api"
)

/**
 * Extension functions for Kotlin-Dart interoperability
 */
fun ApprovalState.toDartMap(): Map<String, Any?> {
    return mapOf(
        "approved" to approved,
        "approvedAt" to approvedAt,
        "approvedBy" to approvedBy,
        "agentProposal" to agentProposal
    )
}

fun Map<String, Any>.toDartMap(): Map<String, Any> = this

// Test KDoc for top-level
/**
* Runs full bug analysis across all modules. Returns actionable recommendations for testing, code review, and refactoring when defect density exceeds configuration thresholds.
*
* @param projectId Optional project identifier for targeted ingestion
* @param since Date if-then to consider only bugs created after this timestamp
* @return QualityAnalysisResult.Completed with totalBugs, hotspots, recommendations, thresholdBreaches, generatedAt, and version
*/