import { Router } from 'express';
import { getReport, generateReport } from '../../controllers/report';

const router = Router();

router.get('/:id', getReport);
router.post('/', generateReport);

export default router;