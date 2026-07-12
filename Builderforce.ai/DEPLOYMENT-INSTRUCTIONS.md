# Deployment Instructions - Reporting Dashboard & Weekly Digest

## Overview
This document provides instructions for deploying the Reporting Dashboard and Weekly Digest system.

## Backend Deployment

### Prerequisites
- Node.js v16 or higher
- npm or yarn
- Postgres database (for production metrics storage)
- Email service configuration (SendGrid, AWS SES, etc.)
- Slack API token for distribution

### Setup

1. **Clone and Navigate**
   ```bash
   cd Builderforce.ai/backend
   npm install
   ```

2. **Configure Environment Variables**
   Create `.env` file:
   ```env
   PORT=3001
   DATABASE_URL=postgres://user:pass@localhost:5432/builderforce
   EMAIL_SERVICE_API_KEY=your_api_key
   SLACK_API_TOKEN=xoxb-your-token
   SLACK_CHANNEL_ID=your_channel_id
   ```

3. **Build and Start**
   ```bash
   npm run build
   npm start
   ```

4. **Cron Configuration**
   For production digest scheduling, integrate with job queue:
   ```bash
   # Using BullMQ with Redis
   npm install bullmq redis
   ```

### Docker Deployment (Optional)

Create `Dockerfile.backend` in the backend directory:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src

EXPOSE 3001

CMD ["node", "dist/index.js"]
```

Build and run:
```bash
docker build -t builderforce-dashboard-backend .
docker run -p 3001:3001 --env-file .env builderforce-dashboard-backend
```

## Frontend Deployment

### Prerequisites
- Node.js v16 or higher
- Next.js 13+ configured

### Integration

1. **Import Dashboard Component**
   ```typescript
   import { StakeholderAlignmentDashboard } from '@/components/dashboard/StakeholderAlignmentDashboard';
   ```

2. **Add to Page**
   ```typescript
   import { StakeholderAlignmentDashboard } from '@/components/dashboard/StakeholderAlignmentDashboard';

   export default function DashboardPage() {
     return (
       <div className="container mx-auto p-6">
         <StakeholderAlignmentDashboard />
       </div>
     );
   }
   ```

3. **Update API Endpoints**
   In `builderforce.ai/frontend/src/dashboard/api.ts`:
   ```typescript
   const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

   export async function getDashboardMetrics(filters: DashboardFilters): Promise<DashboardDTO> {
     const response = await fetch(`${API_BASE}/dashboard`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify(filters),
     });
     return response.json();
   }

   export async function getLatestDigest(): Promise<WeeklyDigest | null> {
     const response = await fetch(`${API_BASE}/digest/latest`);
     if (!response.ok) return null;
     return response.json();
   }
   ```

### Build and Deploy

```bash
npm run build
npm start
```

## Monitoring

### Health Check
```bash
curl http://localhost:3001/health
```

### Logs
Check application logs for:
- Dashboard generation errors
- Digest generation failures
- Cache invalidation events
- Distribution failures

### Metrics
Monitor:
- API response times (target: < 1s)
- Cache hit rates (target: > 80%)
- Digest generation frequency
- Email/Slack delivery success rates

## Security Checklist

- [ ] Enable HTTPS in production
- [ ] Implement JWT authentication for API
- [ ] Add rate limiting to endpoints
- [ ] Sanitize all user inputs
- [ ] Set secure HTTP-only cookies
- [ ] Implement CORS restrictions
- [ ] Add audit logging
- [ ] Enable database encryption at rest
- [ ] Implement IP whitelisting if needed
- [ ] Set up security headers (Content Security Policy, etc.)

## Rollback Plan

If issues arise:

1. **Backend Rollback**
   ```bash
   # Stop current version
   systemctl stop builderforce-dashboard

   # Deploy previous version
   systemctl start builderforce-dashboard
   ```

2. **Database Rollback**
   ```sql
   -- Restore previous digest configuration
   DELETE FROM digest_config;
   INSERT INTO digest_config (config_json) VALUES ('old_config');
   ```

3. **Frontend Rollback**
   ```bash
   # Rollback to previous NPM version or git commit
   npm install builderforce-dashboard-ui@1.2.3
   ```

## Post-Deployment Checklist

- [ ] Verify dashboard loads correctly
- [ ] Test all filter combinations
- [ ] Verify cache is working (check last updated timestamps)
- [ ] Test digest generation and distribution
- [ ] Confirm email/Slack deliveries
- [ ] Check for any console errors
- [ ] Verify data accuracy across projects
- [ ] Update monitoring dashboards

## Troubleshooting

### Dashboard Not Loading
1. Check backend is running: `curl http://localhost:3001/health`
2. Verify API URL is correct in frontend
3. Check browser console for CORS errors
4. Verify database connectivity

### Digest Not Generating
1. Check cron/worker is running
2. Verify storage permissions
3. Check email/Slack API tokens
4. Review worker logs for errors

### Cache Not Working
1. Verify cache TTL is set correctly (60 seconds)
2. Check backend memory limits
3. Review cache invalidation logic

## Maintenance

### Weekly Tasks
- Review digest success rates
- Monitor API performance metrics
- Update stakeholder distribution lists
- Review and purge old digests

### Monthly Tasks
- Update digest templates
- Review and optimize query performance
- Update security patches
- Review audit logs

### Quarterly Tasks
- Review user feedback
- Optimize database queries
- Update to latest dependencies
- Review and update documentation