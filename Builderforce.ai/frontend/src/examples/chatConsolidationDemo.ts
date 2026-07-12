/**
 * Example usage of the chat consolidation feature
 * This demonstrates how to use the APIs for different target users
 */

import { consolidateChats, batchConsolidateChats } from '../services/chatConsolidationService';
import { ChatConsolidationParams } from '../types/chat';

/**
 * Example 1: Customer Support Agent Use Case
 * 
 * Scenario: Support agent needs to consolidate multiple customer
 * conversations (email, chat, portal) into a single view
 * 
 * Use case: Merging support conversations across channels
 */
export async function exampleCustomerSupportConsolidation(): Promise<void> {
  console.log('\n=== Example 1: Customer Support Agent ===\n');

  const params: ChatConsolidationParams = {
    target_chat_id: 'support_ticket_12345',
    source_chat_ids: [
      'email_thread_support_789',
      'webchat_customer_interaction_ABC',
      'portal_ticket_request_XYZ'
    ]
  };

  try {
    console.log('Performing consolidation for customer support thread...');
    const result = await consolidateChats(
      params.target_chat_id,
      params.source_chat_ids
    );

    if (result.success) {
      console.log('✓ Consolidation successful!');
      console.log(`  - Merged ${result.merged_count} messages`);
      console.log(`  - Source chats preserved: ${result.source_chat_ids.join(', ')}`);
      console.log(`  - Target: ${result.target_chat_id}`);
    } else {
      console.error('✗ Consolidation failed:', result.error);
    }
  } catch (error) {
    console.error('Error during consolidation:', error);
  }
}

/**
 * Example 2: Sales Representative Use Case
 * 
 * Scenario: Sales rep wants to merge all touchpoints with a prospect
 * into a single account timeline
 * 
 * Use case: Pre-sales chats, follow-ups, and email conversations
 */
export async function exampleSalesConsolidation(): Promise<void> {
  console.log('\n=== Example 2: Sales Representative ===\n');

  const params: ChatConsolidationParams = {
    target_chat_id: 'account_abc123_sales_timeline',
    source_chat_ids: [
      'pre_sales_brainstorming_call_GHJ',
      'follow_up_discussion_MNO',
      'email_thread_deal_discussion_PQR'
    ]
  };

  try {
    console.log('Consolidating sales touchpoints for prospect...');
    const result = await consolidateChats(
      params.target_chat_id,
      params.source_chat_ids
    );

    if (result.success) {
      console.log('✓ Sales consolidation successful!');
      console.log(`  - All ${result.merged_count} messages merged`);
      console.log(`  - Complete prospect conversation history available`);
    } else {
      console.error('✗ Sales consolidation failed:', result.error);
    }
  } catch (error) {
    console.error('Error during consolidation:', error);
  }
}

/**
 * Example 3: Project Manager Use Case
 * 
 * Scenario: Merging discussions from different brainstorming sessions
 * and sub-threads into a unified project discussion
 * 
 * Use case: Project team brainstorming and discussion consolidation
 */
export async function exampleProjectManagerConsolidation(): Promise<void> {
  console.log('\n=== Example 3: Project Manager ===\n');

  const params: ChatConsolidationParams = {
    target_chat_id: 'project_wizard_app_2024',
    source_chat_ids: [
      'brainstorming_session_001',
      'user_research_discussion',
      'feature_debate_thread',
      'design_review_comments',
      'technical_architecture_chat'
    ]
  };

  try {
    console.log('Consolidating project discussions...');
    const result = await batchConsolidateChats(
      params.target_chat_id,
      params.source_chat_ids
    );

    if (result.success) {
      console.log('✓ Project discussions consolidated!');
      console.log(`  - All project conversations unified`);
      console.log(`  - Easy access to complete decision history`);
    } else {
      console.error('✗ Consolidation failed:', result.error);
    }
  } catch (error) {
    console.error('Error during consolidation:', error);
  }
}

/**
 * Example 4: Error Handling
 * 
 * Scenario: Demonstrating proper error handling for invalid inputs
 */
export async function exampleErrorHandling(): Promise<void> {
  console.log('\n=== Example 4: Error Handling ===\n');

  // Scenario 1: Invalid target chat
  console.log('Testing invalid target chat...');
  const result1 = await consolidateChats(
    'invalid_id',
    ['chat_source1']
  );
  console.log(`Result: ${result1.success ? 'Success' : 'Failed with error:', result1.error}`);

  // Scenario 2: Invalid source chat
  console.log('\nTesting invalid source chat...');
  const result2 = await consolidateChats(
    'chat_target',
    ['non_existent_chat']
  );
  console.log(`Result: ${result2.success ? 'Success' : 'Failed with error:', result2.error}`);

  // Scenario 3: Missing parameters
  console.log('\nTesting missing parameters...');
  const result3 = await consolidateChats('', []);
  console.log(`Result: ${result3.success ? 'Success' : 'Failed with error:', result3.error}`);
}

/**
 * Example 5: Performance Testing
 * 
 * Scenario: Verifying performance meets AC7 requirements
 */
export async function examplePerformanceTesting(): Promise<void> {
  console.log('\n=== Example 5: Performance Testing ===\n');

  const iterations = 5;
  const totalDuration = [];

  console.log(`Testing performance with ${iterations} consolidate operations...`);

  for (let i = 1; i <= iterations; i++) {
    const target = `test_target_${i}`;
    const sources = [
      `chat_source_${i}_1`,
      `chat_source_${i}_2`,
      `chat_source_${i}_3`
    ];

    const startTime = Date.now();
    const result = await consolidateChats(target, sources);
    const duration = Date.now() - startTime;

    totalDuration.push(duration);
    console.log(`  Iteration ${i}: ${duration}ms (success: ${result.success})`);
  }

  const avgDuration = totalDuration.reduce((a, b) => a + b, 0) / iterations;
  const maxDuration = Math.max(...totalDuration);
  const minDuration = Math.min(...totalDuration);

  console.log(`\nPerformance Summary:`);
  console.log(`  Average: ${avgDuration.toFixed(2)}ms`);
  console.log(`  Min: ${minDuration}ms`);
  console.log(`  Max: ${maxDuration}ms`);
  console.log(`  Target: <3000ms (AC7 requirement)`);

  const allWithinLimit = totalDuration.every(d => d < 3000);
  console.log(`  All operations within 3s limit: ${allWithinLimit ? '✓ YES' : '✗ NO'}`);
}

/**
 * Main function to run all examples
 */
export async function runAllExamples(): Promise<void> {
  console.log('\n🎬 Chat Consolidation Examples\n');
  console.log('=====================================');

  try {
    await exampleCustomerSupportConsolidation();
    await exampleSalesConsolidation();
    await exampleProjectManagerConsolidation();
    await exampleErrorHandling();
    await examplePerformanceTesting();
  } catch (error) {
    console.error('Error running examples:', error);
  }

  console.log('\n=====================================');
  console.log('Demo complete!\n');
}

// Export types for integration
export type {
  ChatConsolidationParams,
  ConsolidationResult,
};