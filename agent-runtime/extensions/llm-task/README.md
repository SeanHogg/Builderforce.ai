# LLM Task Extension

Extends the LLM task system with Hen task completion notifications.

## Features

- **Automatic Email Notifications**: Sends an email when all Hen tasks for an account complete
- **Duplicate Prevention**: Prevents multiple notifications for the same account completion
- **Configurable Platform Branding**: Customize platform name and login URL
- **Graceful Degradation**: Works even when email API is not configured

## Usage

### Configuration

```typescript
const config = {
  enabled: true,
  platformName: "Builderforce",
  platformLoginUrl: "https://builderforce.ai",
  resendApiKey: "resend-api-key" // Optional, for actual email sending
};
```

### Event Handling

The extension automatically registers with the LLM task system:

```typescript
const tool = new LLMTaskTool(config, accountUtil);
tool.register(llmTaskInstance);
```

When a Hen task completes, the system will automatically:
1. Detect if all Hen tasks for the account are complete
2. Retrieve the account holder's email
3. Send the notification email
4. Log the notification attempt

### Manual Notification

For testing or manual usage:

```typescript
const notifier = HenTaskCompletionNotifier.createWithResend(config, accountUtil);
await notifier.notify("account-id", "account@example.com");
```

## Email Template

The notification email includes:

- **Subject**: "Your Hen Tasks are Complete!"
- **Body**: Personalized with platform name and login URL
- **Branding**: Professional HTML email with header and footer

## Testing

Run tests:

```bash
cd agent-runtime
npm test
```

## Architecture

### Domain Ports

- **EmailNotifier**: Interface for sending emails (implements with Resend API)
- **AccountEmailResolver**: Interface for resolving account holder emails

### Responsibilities

- **HenTaskCompletionNotifier**: Domain service that coordinates the notification flow
- **NotificationStorage**: Prevents duplicate notifications
- **LLMTaskTool**: Integrates with the LLM task system

### DRY Principles

- Reuses EmailNotifier and AccountEmailResolver interfaces
- Consistent error handling and logging
- Shared validation logic via Zod schemas
- Configuration defaults for common cases