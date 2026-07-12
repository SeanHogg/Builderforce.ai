import { Request, Response } from 'express';
import { ReportService } from '../../services/report';

export const getReport = async (req: Request, res: Response) => {
  try {
    const report = await ReportService.getReport(req.params.id);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch report' });
  }
};

export const generateReport = async (req: Request, res: Response) => {
  try {
    const report = await ReportService.generateReport(req.body);
    res.status(201).json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report' });
  }
};