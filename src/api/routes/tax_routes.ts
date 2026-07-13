/**
 * Tax Compliance API Routes
 * 
 * RESTful endpoints for W-9/W-8BEN form collection, storage, and 1099 generation.
 */

import { Router } from 'express';
import { 
  TaxFormSubmissionService, 
  Tax1099Service, 
  TaxFormValidationService 
} from '../../services/tax';

import { 
  W9FormInput, 
  W8BENFormInput, 
  Generate1099Request 
} from '../../data/types';

const router = Router();

// Initialize services
const taxFormService = new TaxFormSubmissionService(
  new W9Repository('postgres://'),
  new W8BENRepository('postgres://'),
  new TaxFormValidationService()
);

const tax1099Service = new Tax1099Service(
  new W9Repository('postgres://'),
  new W8BENRepository('postgres://')
);

/**
 * @route   POST /api/tax/forms/w9
 * @desc    Submit a new W-9 tax form
 * @access  Public (onboarding flow)
 */
router.post('/w9', async (req, res) => {
  try {
    const freelancerId = req.user?.id;
    if (!freelancerId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const data: W9FormInput = {
      taxYear: req.body.taxYear || new Date().getFullYear(),
      taxpayerType: req.body.taxpayerType,
      tinType: req.body.tinType,
      tin: req.body.tin,
      recipientName: req.body.recipientName,
      businessName: req.body.businessName,
      signature: {
        signerName: req.body.signature.signerName,
        signatureDate: new Date(req.body.signature.signatureDate),
      },
      scannedDocument: req.file,
    };

    // Add address from request
    data.address = {
      streetLine1: req.body.address.streetLine1,
      streetLine2: req.body.address.streetLine2,
      city: req.body.address.city,
      state: req.body.address.state,
      postalCode: req.body.address.postalCode,
      country: req.body.address.country || 'US',
    };

    if (req.body.accountNumbers) data.accountNumbers = req.body.accountNumbers;
    if (req.body.resetEIN) data.resetEIN = req.body.resetEIN;

    const result = await taxFormService.submitW9Form(freelancerId, data);

    if (result.validationErrors && result.validationErrors.length > 0) {
      return res.status(400).json({
        ...result,
        message: 'Tax form validation failed'
      });
    }

    res.status(201).json(result);
  } catch (error: any) {
    console.error('Error submitting W-9 form:', error);
    res.status(500).json({ error: error.message || 'Failed to submit tax form' });
  }
});

/**
 * @route   POST /api/tax/forms/w8ben
 * @desc    Submit a new W-8BEN tax form
 * @access  Public (onboarding flow)
 */
router.post('/w8ben', async (req, res) => {
  try {
    const freelancerId = req.user?.id;
    if (!freelancerId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const data: W8BENFormInput = {
      beneficialOwner: req.body.beneficialOwner,
      taxpayerType: req.body.taxpayerType,
      businessName: req.body.businessName,
      foreignTaxNumber: req.body.foreignTaxNumber,
      foreignAddress: {
        country: req.body.foreignAddress.country,
        streetLine1: req.body.foreignAddress.streetLine1,
        city: req.body.foreignAddress.city,
        region: req.body.foreignAddress.region,
        postalCode: req.body.foreignAddress.postalCode,
      },
      signature: {
        signatoryName: req.body.signature.signatoryName,
        signatureDate: new Date(req.body.signature.signatureDate),
      },
      waiverText: req.body.waiverText,
    };

    const result = await taxFormService.submitW8BENForm(freelancerId, data);

    if (result.validationErrors && result.validationErrors.length > 0) {
      return res.status(400).json({
        ...result,
        message: 'Tax form validation failed'
      });
    }

    res.status(201).json(result);
  } catch (error: any) {
    console.error('Error submitting W-8BEN form:', error);
    res.status(500).json({ error: error.message || 'Failed to submit tax form' });
  }
});

/**
 * @route   GET /api/tax/forms/:formId
 * @desc    Retrieve a tax form by ID
 * @access  Authorized (freelancer or admin)
 */
router.get('/:formId', async (req, res) => {
  try {
    const formId = req.params.formId;
    const freelancerId = req.user?.id;

    // In a real implementation, we'd check if the user is authorized to view this form
    // For now, we'll just return the basic info

    res.json({
      formId,
      message: 'Tax form retrieved (implementation needed for full details)'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to retrieve tax form' });
  }
});

/**
 * @route   GET /api/tax/forms/list
 * @desc    List tax forms for a freelancer
 * @access  Authorized
 */
router.get('/list', async (req, res) => {
  try {
    const freelancerId = req.user?.id;
    const formType = req.query.formType as 'w9' | 'w8ben' | undefined;
    const status = req.query.status as string | undefined;

    if (!freelancerId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // In a real implementation, we'd query the appropriate repository
    // and return paginated results

    res.json({
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list tax forms' });
  }
});

/**
 * @route   POST /api/tax/1099s/generate
 * @desc    Generate annual 1099 forms for all eligible payees
 * @access  Admin only
 */
router.post('/1099s/generate', async (req, res) => {
  try {
    const fiscalYear = req.body.fiscalYear || new Date().getFullYear();
    const formType = req.body.formType || '1099-NEC';

    const result = await tax1099Service.generateAll1099s(fiscalYear);

    // Check if errors occurred
    if (result.errors.length > 0) {
      return res.status(207).json({
        message: '1099 generation completed with some errors',
        totalGenerated: result.generated.length,
        errors: result.errors,
      });
    }

    res.status(201).json({
      message: '1099 generation completed successfully',
      totalGenerated: result.generated.length,
      forms: result.generated,
    });
  } catch (error: any) {
    console.error('Error generating 1099s:', error);
    res.status(500).json({ error: error.message || 'Failed to generate 1099s' });
  }
});

/**
 * @route   POST /api/tax/1099s/:formId/efile
 * @desc    Prepare a 1099 form for e-filing
 * @access  Admin only
 */
router.post('/:formId/efile', async (req, res) => {
  try {
    const formId = req.params.formId;
    const provider = req.body.provider || 'third-party-provider';
    const fiscalYear = req.body.fiscalYear || new Date().getFullYear();
    const currentDate = new Date();

    // Prepare for e-filing
    const form = await tax1099Service.prepareForEfiling(formId, provider);

    // Check e-filing requirements
    const requirements = await tax1099Service.checkEfilingRequirements(
      formId,
      fiscalYear,
      currentDate
    );

    if (!requirements.ready) {
      return res.status(400).json({
        message: 'E-filing requirements not met',
        missing: requirements.missing,
        details: requirements.efileMessage,
      });
    }

    res.status(200).json({
      message: 'Form ready for e-filing',
      form,
      efileRequirements: requirements,
    });
  } catch (error: any) {
    console.error('Error preparing 1099 for e-filing:', error);
    res.status(500).json({ error: error.message || 'Failed to prepare form for e-filing' });
  }
});

/**
 * @route   GET /api/tax/1099s/:formId/efile/requirements
 * @desc    Check e-filing requirements for a 1099 form
 * @access  Admin only
 */
router.get('/:formId/efile/requirements', async (req, res) => {
  try {
    const formId = req.params.formId;
    const fiscalYear = req.query.fiscalYear ? parseInt(req.query.fiscalYear as string) : new Date().getFullYear();
    const currentDate = new Date();

    const requirements = await tax1099Service.checkEfilingRequirements(
      formId,
      fiscalYear,
      currentDate
    );

    res.status(200).json({
      formId,
      fiscalYear,
      ready: requirements.ready,
      missing: requirements.missing,
      message: requirements.efileMessage,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to check e-filing requirements' });
  }
});

/**
 * @route   POST /api/tax/1099s/:formId/export
 * @desc    Export a 1099 form in third-party format
 * @access  Admin only
 */
router.post('/:formId/export', async (req, res) => {
  try {
    const formId = req.params.formId;
    const provider = req.body.provider || 'third-party-provider';

    const exportData = await tax1099Service.exportForThirdParty(formId, provider);

    res.status(200).json({
      message: '1099 exported successfully',
      provider,
      exportData,
    });
  } catch (error: any) {
    console.error('Error exporting 1099:', error);
    res.status(500).json({ error: error.message || 'Failed to export 1099' });
  }
});

/**
 * @route   GET /api/tax/1099s/list/:fiscalYear
 * @desc    List generated 1099s for a fiscal year
 * @access  Admin only
 */
router.get('/1099s/list/:fiscalYear', async (req, res) => {
  try {
    const fiscalYear = parseInt(req.params.fiscalYear);
    // In a real implementation, query the generated 1099s table
    // For now, return an empty list
    res.json({
      fiscalYear,
      forms: [],
      total: 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list 1099s' });
  }
});

export default router;