# LLM Task Extension

Generic JSON-only LLM tool for structured tasks callable from workflows. Includes automatic Hen task completion notifications.

## Overview

This extension provides a robust solution for automatically notifying account holders when all "Hen tasks" associated with their account are complete. It leverages DDD principles with clear separation of concerns and clean architecture.

## Architecture

### Domain Layer (DDD Style)

**HenTaskCompletionNotifier**
- Domain service responsible for:
  - Detecting when the last Hen task completes (FR.1)
  - Retrieving account holder's email (FR.2)
  - Composing email content with static subject/body (FR.3)
  - Dispatching the email (FR.4)
  - Logging notification attempts for auditing (FR.5)

**EmailNotifier Port**
- Interface: `send(to: string, subject: string, html: string): Promise<boolean>`
- Single Responsibility: Only email dispatch
- Implemented by adapters like `ResendEmailNotifier`

**AccountEmailResolver Port**
- Interface: `getPrimaryEmail(accountId: string): Promise<string | null>`
- Single Responsibility: Only account → email resolution
- Implemented by services like `AccountUtil`

### Infrastructure Layer

**ResendEmailNotifier**
- Concrete adapter for Resend API
- Handles email sending and error logging
- Graceful degradation when API key is missing

**AccountUtil**
- Concrete implementation of AccountEmailResolver
- Retrieves account details from store/database
- Returns mock data for testing

## Components

### 1. hen-task-completion-notifier.ts

Core domain service implementing business logic for Hen task notifications.

**Exports:**
- `HenTaskCompletionNotifier` - Main notifier class
- `HenTaskCompletionNotifierSchema` - Zod schema for configuration
- `ResendEmailNotifier` - Email adapter
- Port interfaces: `EmailNotifier`, `AccountEmailResolver`, `NotificationLogEntry`

**Configuration via Schema:**
```typescript
{
  enabled: boolean;
  platformName: string;
  platformLoginUrl: string;
  resendApiKey?: string;
}
```

**Key Methods:**
- `handleTaskCompletion(event)` - Process task completion with notification logic
- `notify(accountId, accountEmail)` - Direct notification entry point
- `createWithResend(config, accountEmailResolver)` - Factory with Resend adapter

### 2. llm-task-tool.ts

Integration tool for the LLM agent system.

**Purpose:**
- Registers event handlers with LLMTask instances
- Bridges domain logic with agent system
- Provides fallback accountEmailResolver

**Configuration:**
```typescript
{
  enabled: true,
  platformName: "Builderforce",
  platformLoginUrl: "https://builderforce.ai",
  resendApiKey?: string
}
```

### 3. src/types/task.ts

Task-specific types for the notification system.

**Exports:**
- `BaseTask` - Base task properties
- `TaskStatus` - Status enumeration
- `TaskCompletionEvent` - Event when task completes
- `TaskUpdateEvent` - Event for task updates
- `HenTask` - Hen-specific tasks

## Integration

### Plugin Registration

```typescript
import { LLMTaskTool } from "./llm-task-tool.js";
import { HenTaskCompletionNotifierToolConfigSchema } from "./llm-task-tool.js";

// Create configuration
const config = HenTaskCompletionNotifierToolConfigSchema.parse({
  enabled: true,
  platformName: "Builderforce",
  platformLoginUrl: "https://builderforce.ai",
  resendApiKey: process.env.RESEND_API_KEY,
});

// Create and register tool
const tool = new LLMTaskTool(config, accountEmailResolver);
tool.register(llmTask);
api.registerExtension("llmTaskTool", tool);
```

### Using the Notifier Directly

```typescript
import { HenTaskCompletionNotifier } from "./src/hen-task-completion-notifier.js";
import { AccountUtil } from "../src/utils/accounts.js";

// Create account resolver
const accountUtil = new AccountUtil();

// Create notifier with Resend
const notifier = HenTaskCompletionNotifier.createWithResend(
  {
    enabled: true,
    platformName: "My Platform",
    platformLoginUrl: "https://myplatform.com/login",
    resendApiKey: process.env.RESEND_API_KEY,
  },
  accountUtil
);

// Handle task completion
const event = { task: { accountId: "123", id: "task-1", status: "completed" } };
const result = await notifier.handleTaskCompletion(event);

console.log(result);
// { accountId: "123", email: "user@example.com", subject: "...", success: true, sentAt: Date }
```

## Email Content

### Subject
```
Your Hen Tasks are Complete!
```

### Body Template
```
Good news! All Hen tasks for your account are now complete.
   Log in to [PlatformName] to view details and next steps.
   Thank you for using our service!

[Button: Log in to [PlatformName]]
```

### HTML Rendering
- Professional dark header with Platform name
- Clean white content area
- Call-to-action button styled with brand color
- Footer with copyright

## Acceptance Criteria Compliance

✅ **AC.1**: When all Hen tasks complete, exactly one email is sent
✅ **AC.2**: Email received within 5 minutes (async notification)
✅ **AC.3**: Subject and body match exact content
✅ **AC.4**: No email sent if tasks remain incomplete
✅ **AC.5**: No duplicate emails for same event
✅ **AC.6**: Log entry created for each attempt

## Testing

Run tests with:
```bash
npm test agent-runtime/extensions/llm-task/src/llm-task-tool.test.ts
```

## Design Principles

1. **Single Responsibility** - Each class has one clear purpose
2. **Domain-Driven** - Domain layer separated from infrastructure
3. **Dependency Inversion** - Depends on ports/interfaces, not implementations
4. **Open/closed** - Extensible via adapters without modifying core logic
5. **DRY** - Reused patterns and constants throughout

## Fallback Behavior

- **API key missing**: Email service gracefully degrades (logs warning, returns false)
- **Account not found**: Returns error log entry, no email sent
- **Email sending failed**: Logs detailed error, returns failure log entry
- **Notification disabled**: Short-circuits early, returns disabled log entry

## Future Enhancements (Out of Scope)

Per PRD #688:
- Retry mechanisms for failed sends
- Batching for multiple accounts
- User preferences/opt-out
- Template customization
- SMS/in-app push notifications
- Advanced analytics