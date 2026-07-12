/**
 * Budget Constraints API Entry Point
 * Exposes REST endpoints for budget constraint management with role-based access control
 */

import express from 'express';
import budgetConstraintsRouter from './api/tasks/budget-constraints.router';

const app = express();

// Enable JSON parsing for request bodies
app.use(express.json());

// Mount budget constraints API at /api/budget-constraints
app.use('/api/budget-constraints', budgetConstraintsRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'budget-constraints-api' });
});

// Simple enrollment endpoint for demo purposes
app.post('/api/budget-constraints/enrollment/register', (req, res) => {
  const { userId, projectId, role } = req.body;
  const enrollmentKey = `${userId}-${projectId}`;
  const enrollments = global.enrollments || {};
  enrollments[enrollmentKey] = {
    canEnroll: true,
    isEnrolled: true,
    role: role || 'viewer',
  };
  global.enrollments = enrollments;
  res.status(201).json({ message: 'Enrollment registered', role });
});

export { app };