'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

export default function OnboardingWizard() {
  const t = useTranslations('onboarding');
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    projectName: '',
    description: '',
    team: '',
    deadlines: [] as string[],
    integrations: {} as Record<string, boolean>,
    // Add other fields as needed
  });

  const handleNext = () => setStep(prev => prev + 1);
  const handleBack = () => setStep(prev => prev - 1);

  return (
    <div className="onboarding-wizard">
      <h1>{t('title')}</h1>
      {step === 1 && (
        <div>
          <h2>{t('step1.title')}</h2>
          {/* Add form fields for project setup */}
          <button onClick={handleNext}>{t('next')}</button>
        </div>
      )}
      {/* Add other steps as needed */}
    </div>
  );
}
