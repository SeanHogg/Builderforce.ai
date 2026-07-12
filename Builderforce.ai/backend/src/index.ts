/**
 * BuilderForce Backend Entry Point
 *
 * Backend for Reporting Dashboard and Weekly Digest system.
 * Provides:
 * - Dashboard API endpoints
 * - Weekly digest worker and scheduler
 * - Cache management for dashboard metrics
 *
 * Dependencies:
 * - Express.js for HTTP routes
 * - Cron for scheduled digest generation
 */

import express from 'express';
import dashboardRoutes from './routes/dashboard';
import digestRoutes from './routes/digest';

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS (for development)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'builderforce-dashboard',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api', dashboardRoutes);
app.use('/api', digestRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`BuilderForce Dashboard Backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Dashboard API: http://localhost:${PORT}/api/dashboard`);
  console.log(`Digest API: http://localhost:${PORT}/api/digest`);
});

// Note: In production, use a production server like PM2, Docker, or Kubernetes
// For scheduled digest generation, integrate with a job queue (Bull, BullMQ, etc.)
// For authentication, implement JWT or session-based auth

export { app, PORT };